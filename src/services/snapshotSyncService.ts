import type { NetworkSnapshot } from './snapshotService';

const CHUNK_SIZE = 32 * 1024;
const MAX_SNAPSHOT_SIZE = 50 * 1024 * 1024; // 50 MB
const TRANSFER_TIMEOUT_MS = 120_000; // 2 minutes
const MAX_TOTAL_CHUNKS = Math.ceil(MAX_SNAPSHOT_SIZE / CHUNK_SIZE);
const MAX_PENDING_OFFERS = 50;

interface TransferState {
  peerId: string;
  direction: 'sending' | 'receiving';
  totalChunks: number;
  receivedChunks: Map<number, string>;
  hash: string;
  startedAt: number;
}

interface SnapshotOffer {
  peerId: string;
  size: number;
  hash: string;
  meta: { postCount: number; communityCount: number; blockHeight: number };
}

type OfferCallback = (offer: SnapshotOffer) => void;
type ProgressCallback = (progress: { direction: string; current: number; total: number; percent: number }) => void;
type CompleteCallback = (snapshot: NetworkSnapshot) => void;
type ErrorCallback = (error: string) => void;

export class SnapshotSyncService {
  private static transfer: TransferState | null = null;
  private static serializedData: string = '';
  private static onOfferCallbacks: Set<OfferCallback> = new Set();
  private static onProgressCallbacks: Set<ProgressCallback> = new Set();
  private static onCompleteCallbacks: Set<CompleteCallback> = new Set();
  private static onErrorCallbacks: Set<ErrorCallback> = new Set();
  private static initialized = false;
  private static timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  // Pending offers keyed by peerId, so receiver can look up the hash
  private static pendingOffers: Map<string, SnapshotOffer> = new Map();

  static async initialize(): Promise<void> {
    if (this.initialized) return;
    const { WebSocketService } = await import('./websocketService');

    WebSocketService.subscribe('snapshot-offer', (data: any) => {
      if (typeof data.peerId !== 'string' || typeof data.size !== 'number' ||
          typeof data.hash !== 'string' || !data.meta || typeof data.meta !== 'object') {
        return;
      }
      // Evict oldest if at capacity
      if (this.pendingOffers.size >= MAX_PENDING_OFFERS) {
        const oldest = this.pendingOffers.keys().next().value;
        if (oldest !== undefined) this.pendingOffers.delete(oldest);
      }
      this.pendingOffers.set(data.peerId, data);
      for (const cb of this.onOfferCallbacks) cb(data);
    });

    WebSocketService.subscribe('snapshot-accept', (data: any) => this.handleAccept(data));
    WebSocketService.subscribe('snapshot-chunk', (data: any) => this.handleChunk(data));
    WebSocketService.subscribe('snapshot-complete', (data: any) => this.handleComplete(data));

    WebSocketService.subscribe('snapshot-cancel', (data: any) => {
      this.getLocalPeerId().then(localId => {
        if (this.transfer && data.targetPeerId === localId) {
          const reason = data.reason || 'Remote peer cancelled';
          this.clearTransfer();
          for (const cb of this.onErrorCallbacks) cb(reason);
        }
      });
    });

    this.initialized = true;
  }

  static async offerSnapshot(snapshot: NetworkSnapshot): Promise<void> {
    const json = JSON.stringify(snapshot);
    const hash = await this.computeHash(json);
    this.serializedData = json;

    const { WebSocketService } = await import('./websocketService');
    const peerId = WebSocketService.getPeerId();

    WebSocketService.broadcast('snapshot-offer', {
      peerId,
      size: json.length,
      hash,
      meta: {
        postCount: snapshot.meta.postCount,
        communityCount: snapshot.meta.communityCount,
        blockHeight: snapshot.meta.blockHeight,
      },
    });
  }

  static async acceptOffer(peerId: string): Promise<void> {
    if (this.transfer) {
      this.emitError('A transfer is already in progress');
      return;
    }

    const offer = this.pendingOffers.get(peerId);
    if (!offer) {
      this.emitError('No pending offer from this peer');
      return;
    }

    if (offer.size > MAX_SNAPSHOT_SIZE) {
      this.emitError('Offered snapshot exceeds maximum size');
      return;
    }

    const { WebSocketService } = await import('./websocketService');
    const localId = WebSocketService.getPeerId();

    this.pendingOffers.delete(peerId);

    this.transfer = {
      peerId,
      direction: 'receiving',
      totalChunks: 0,
      receivedChunks: new Map(),
      hash: offer.hash,
      startedAt: Date.now(),
    };

    this.startTimeout();

    WebSocketService.broadcast('snapshot-accept', {
      targetPeerId: peerId,
      peerId: localId,
    });
  }

  static async cancelTransfer(reason?: string): Promise<void> {
    if (!this.transfer) return;
    const { WebSocketService } = await import('./websocketService');

    WebSocketService.broadcast('snapshot-cancel', {
      targetPeerId: this.transfer.peerId,
      reason: reason || 'Transfer cancelled',
    });

    this.clearTransfer();
  }

  static onOffer(callback: OfferCallback): () => void {
    this.onOfferCallbacks.add(callback);
    return () => { this.onOfferCallbacks.delete(callback); };
  }

  static onProgress(callback: ProgressCallback): () => void {
    this.onProgressCallbacks.add(callback);
    return () => { this.onProgressCallbacks.delete(callback); };
  }

  static onComplete(callback: CompleteCallback): () => void {
    this.onCompleteCallbacks.add(callback);
    return () => { this.onCompleteCallbacks.delete(callback); };
  }

  static onError(callback: ErrorCallback): () => void {
    this.onErrorCallbacks.add(callback);
    return () => { this.onErrorCallbacks.delete(callback); };
  }

  static cleanup(): void {
    this.clearTransfer();
    this.pendingOffers.clear();
    this.onOfferCallbacks.clear();
    this.onProgressCallbacks.clear();
    this.onCompleteCallbacks.clear();
    this.onErrorCallbacks.clear();
    this.initialized = false;
  }

  // --- Internal handlers ---

  private static async handleAccept(data: any): Promise<void> {
    const localId = await this.getLocalPeerId();
    if (data.targetPeerId !== localId) return;
    if (!this.serializedData) return;

    const totalChunks = Math.ceil(this.serializedData.length / CHUNK_SIZE);
    const hash = await this.computeHash(this.serializedData);

    this.transfer = {
      peerId: data.peerId,
      direction: 'sending',
      totalChunks,
      receivedChunks: new Map(),
      hash,
      startedAt: Date.now(),
    };

    this.startTimeout();

    const { WebSocketService } = await import('./websocketService');

    for (let i = 0; i < totalChunks; i++) {
      const chunk = this.serializedData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      WebSocketService.broadcast('snapshot-chunk', {
        targetPeerId: data.peerId,
        index: i,
        total: totalChunks,
        data: chunk,
      });

      this.emitProgress('sending', i + 1, totalChunks);
    }
  }

  private static async handleChunk(data: any): Promise<void> {
    const localId = await this.getLocalPeerId();
    if (data.targetPeerId !== localId) return;
    if (!this.transfer || this.transfer.direction !== 'receiving') return;

    const total = data.total;
    const index = data.index;

    // Validate chunk metadata
    if (typeof total !== 'number' || !Number.isInteger(total) || total <= 0 || total > MAX_TOTAL_CHUNKS) {
      this.emitError('Invalid chunk total');
      this.clearTransfer();
      return;
    }
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= total) {
      return; // Ignore out-of-bounds chunk
    }
    if (typeof data.data !== 'string' || data.data.length > CHUNK_SIZE + 1024) {
      return; // Ignore oversized chunk (small margin for encoding overhead)
    }

    // Lock totalChunks to the value from the first chunk received
    if (this.transfer.totalChunks === 0) {
      this.transfer.totalChunks = total;
    } else if (this.transfer.totalChunks !== total) {
      this.emitError('Chunk total changed mid-transfer');
      this.clearTransfer();
      return;
    }

    this.transfer.receivedChunks.set(index, data.data);
    this.emitProgress('receiving', this.transfer.receivedChunks.size, total);

    if (this.transfer.receivedChunks.size === total) {
      await this.finalizeReceive();
    }
  }

  private static async finalizeReceive(): Promise<void> {
    if (!this.transfer) return;

    // Verify every chunk index is present
    for (let i = 0; i < this.transfer.totalChunks; i++) {
      if (!this.transfer.receivedChunks.has(i)) {
        this.emitError(`Missing chunk at index ${i}`);
        this.clearTransfer();
        return;
      }
    }

    // Reassemble in order
    let full = '';
    for (let i = 0; i < this.transfer.totalChunks; i++) {
      full += this.transfer.receivedChunks.get(i)!;
    }

    // Verify hash matches the one from the offer
    const hash = await this.computeHash(full);
    if (!this.transfer.hash || hash !== this.transfer.hash) {
      this.emitError('Snapshot hash mismatch or missing hash');
      this.clearTransfer();
      return;
    }

    const { WebSocketService } = await import('./websocketService');
    const localId = await this.getLocalPeerId();
    const senderPeerId = this.transfer.peerId;

    WebSocketService.broadcast('snapshot-complete', {
      targetPeerId: senderPeerId,
      peerId: localId,
    });

    try {
      const parsed = JSON.parse(full);

      // Validate snapshot structure (C3)
      if (!this.isValidSnapshot(parsed)) {
        this.emitError('Received data is not a valid snapshot');
        this.clearTransfer();
        return;
      }

      const snapshot = parsed as NetworkSnapshot;
      this.clearTransfer();
      for (const cb of this.onCompleteCallbacks) cb(snapshot);
    } catch {
      this.emitError('Failed to parse received snapshot');
      this.clearTransfer();
    }
  }

  private static async handleComplete(data: any): Promise<void> {
    const localId = await this.getLocalPeerId();
    if (data.targetPeerId !== localId) return;

    this.clearTransfer();
  }

  private static isValidSnapshot(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (obj.version !== '2.0') return false;
    if (typeof obj.exportDate !== 'number') return false;
    if (!obj.meta || typeof obj.meta !== 'object') return false;
    if (!obj.chain || typeof obj.chain !== 'object') return false;
    if (!obj.gun || typeof obj.gun !== 'object') return false;
    if (!Array.isArray(obj.chain.blocks)) return false;
    if (!Array.isArray(obj.gun.posts)) return false;
    if (!Array.isArray(obj.gun.communities)) return false;
    return true;
  }

  private static clearTransfer(): void {
    this.transfer = null;
    this.serializedData = '';
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private static startTimeout(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = setTimeout(() => {
      if (this.transfer) {
        this.emitError('Transfer timed out');
        void this.cancelTransfer('Transfer timed out');
      }
    }, TRANSFER_TIMEOUT_MS);
  }

  private static async computeHash(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private static async getLocalPeerId(): Promise<string> {
    const { WebSocketService } = await import('./websocketService');
    return WebSocketService.getPeerId();
  }

  private static emitProgress(direction: string, current: number, total: number): void {
    const percent = Math.round((current / total) * 100);
    for (const cb of this.onProgressCallbacks) cb({ direction, current, total, percent });
  }

  private static emitError(message: string): void {
    for (const cb of this.onErrorCallbacks) cb(message);
  }
}
