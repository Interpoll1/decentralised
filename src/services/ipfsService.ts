import { GunService } from './gunService';
import { StorageService } from './storageService';
import imageCompression from 'browser-image-compression';

// ── Strategy ──────────────────────────────────────────────────────────────────
//
// Previous: stored full base64 image (up to 1 MB) directly in the Gun graph.
//   Problem: large Gun nodes get synced to every peer that touches the community
//   graph, ballooning storage and sync time for every relay.
//
// New:
//   • Full image  → stored in IndexedDB (local only, no Gun sync overhead)
//   • Thumbnail   → stored in Gun (small, fast, displayable without full load)
//   • Metadata    → stored in Gun: { id, size, uploadedAt, hasFull: true }
//
// This means:
//   - The Gun graph stays small — only thumbnails (~50-100 KB) are synced.
//   - Full images load from local IndexedDB on the device that uploaded,
//     or can be fetched from the API if exposed via /api/image/:cid (future).
//   - `downloadImage()` tries IndexedDB first, then falls back to Gun thumbnail.

const FULL_IMAGE_STORE_KEY = (cid: string) => `ipfs-full:${cid}`;

export class IPFSService {
  private static isReady = false;

  static getReadyStatus(): boolean {
    return this.isReady;
  }

  static async initialize() {
    this.isReady = true;
  }

  static async uploadImage(file: File): Promise<{
    cid: string;
    thumbnail: string; // Base64 thumbnail (stored in Gun)
    size: number;
  }> {
    if (!this.isReady) await this.initialize();

    // Compress full image (max 1 MB) — stored locally only
    const compressed = await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
    });

    // Thumbnail for Gun sync (max 100 KB / 800px) — small enough to propagate
    const thumbnailBlob = await imageCompression(file, {
      maxSizeMB: 0.1,
      maxWidthOrHeight: 800,
      useWebWorker: true,
    });

    const fullImageBase64 = await this.fileToBase64(compressed);
    const thumbnailBase64 = await this.fileToBase64(thumbnailBlob);

    const cid = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Store full image in IndexedDB (local, no Gun propagation cost)
    try {
      await StorageService.setMetadata(FULL_IMAGE_STORE_KEY(cid), fullImageBase64);
    } catch (err) {
      console.warn('[IPFSService] Failed to store full image in IndexedDB:', err);
    }

    // Store only thumbnail + metadata pointer in Gun
    const gun = GunService.getGun();
    await new Promise<void>((resolve) => {
      gun.get('images').get(cid).put({
        id: cid,
        thumbnail: thumbnailBase64,
        size: compressed.size,
        uploadedAt: Date.now(),
        hasFull: true,  // signals that a full-res copy exists locally on the uploader
      }, (ack: any) => {
        if (ack?.err) console.warn('[IPFSService] Gun thumbnail write error:', ack.err);
        resolve();
      });
    });

    return { cid, thumbnail: thumbnailBase64, size: compressed.size };
  }

  /**
   * Returns the best available image for a given cid:
   *   1. Full image from IndexedDB (fast, no network)
   *   2. Thumbnail from Gun (slower on first load, but universally available)
   */
  static async downloadImage(cid: string): Promise<string | null> {
    if (!this.isReady) await this.initialize();

    // Try local full-res first
    try {
      const local = await StorageService.getMetadata(FULL_IMAGE_STORE_KEY(cid));
      if (local && typeof local === 'string' && local.length > 0) return local;
    } catch { /* not in local store */ }

    // Fall back to thumbnail from Gun
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 10000);
      gun.get('images').get(cid).once((data: any) => {
        clearTimeout(timeout);
        if (data?.thumbnail) resolve(data.thumbnail);
        // Legacy compat: old nodes stored full image in `data.data`
        else if (data?.data) resolve(data.data);
        else resolve(null);
      });
    });
  }

  /** Returns the thumbnail URL (Gun-synced, fast). Used for feed thumbnails. */
  static async getThumbnail(cid: string): Promise<string | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 5000);
      gun.get('images').get(cid).once((data: any) => {
        clearTimeout(timeout);
        resolve(data?.thumbnail ?? null);
      });
    });
  }

  static async pin(cid: string) {
    const gun = GunService.getGun();
    await gun.get('images').get(cid).get('pinned').put(true);
  }

  static async unpin(cid: string) {
    const gun = GunService.getGun();
    await gun.get('images').get(cid).get('pinned').put(false);
  }

  static async listPinned(): Promise<string[]> {
    const gun = GunService.getGun();
    const pinned: string[] = [];
    return new Promise((resolve) => {
      gun.get('images').map().once((data: any) => {
        if (data?.pinned && data.id) pinned.push(data.id);
      });
      setTimeout(() => resolve(pinned), 1000);
    });
  }

  private static async fileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}
