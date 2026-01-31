// src/services/ipfsService.ts
// Simplified image storage using GunDB (no IPFS - avoids Node.js issues)
import { GunService } from './gunService';
import imageCompression from 'browser-image-compression';

export class IPFSService {
  private static isReady = false;

  // Initialize (simplified - just use GunDB)
  static async initialize() {
    console.log('Initializing image storage (GunDB)...');
    this.isReady = true;
    console.log('Image storage ready');
  }

  // Upload image (returns hash, stores in GunDB)
  static async uploadImage(file: File): Promise<{
    cid: string;
    thumbnail: string; // Base64 thumbnail
    size: number;
  }> {
    if (!this.isReady) await this.initialize();

    // Compress full image (max 500 KB)
    const compressed = await imageCompression(file, {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true
    });

    // Create thumbnail (max 20 KB)
    const thumbnail = await imageCompression(file, {
      maxSizeMB: 0.02,
      maxWidthOrHeight: 300,
      useWebWorker: true
    });

    // Convert both to base64
    const fullImageBase64 = await this.fileToBase64(compressed);
    const thumbnailBase64 = await this.fileToBase64(thumbnail);

    // Generate hash (use timestamp + random for uniqueness)
    const cid = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Store full image in GunDB
    const gun = GunService.getGun();
    await gun.get('images').get(cid).put({
      id: cid,
      data: fullImageBase64,
      thumbnail: thumbnailBase64,
      size: compressed.size,
      uploadedAt: Date.now()
    });

    console.log(`Image uploaded: ${cid} (${(compressed.size / 1024).toFixed(0)} KB)`);

    return {
      cid: cid,
      thumbnail: thumbnailBase64,
      size: compressed.size
    };
  }

  // Download image from GunDB
  static async downloadImage(cid: string): Promise<string | null> {
    if (!this.isReady) await this.initialize();

    const gun = GunService.getGun();
    
    return new Promise((resolve) => {
      gun.get('images').get(cid).once((data: any) => {
        if (data && data.data) {
          resolve(data.data); // Returns base64 string
        } else {
          resolve(null);
        }
      });
    });
  }

  // Pin content (mark as important - just a flag in GunDB)
  static async pin(cid: string) {
    const gun = GunService.getGun();
    await gun.get('images').get(cid).get('pinned').put(true);
    console.log(`Pinned: ${cid}`);
  }

  // Unpin content
  static async unpin(cid: string) {
    const gun = GunService.getGun();
    await gun.get('images').get(cid).get('pinned').put(false);
    console.log(`Unpinned: ${cid}`);
  }

  // List pinned content
  static async listPinned(): Promise<string[]> {
    const gun = GunService.getGun();
    const pinned: string[] = [];

    return new Promise((resolve) => {
      gun.get('images').map().once((data: any) => {
        if (data && data.pinned && data.id) {
          pinned.push(data.id);
        }
      });

      setTimeout(() => resolve(pinned), 1000);
    });
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}