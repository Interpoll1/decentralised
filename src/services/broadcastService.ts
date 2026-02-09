// src/services/broadcastService.ts
import { StorageService } from './storageService';
import { Poll, ChainBlock } from '../types/chain';

type SyncMessage =
  | { type: 'new-poll'; data: Poll }
  | { type: 'new-block'; data: ChainBlock }
  | { type: 'request-sync'; peerId: string }
  | { type: 'sync-response'; polls: Poll[]; blocks: ChainBlock[] };

export class BroadcastService {
  private static channel: BroadcastChannel | null = null;
  private static peerId: string = Math.random().toString(36).substring(7);
  private static callbacks: Map<string, (data: any) => void> = new Map();

  static initialize() {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    this.channel = new BroadcastChannel('interpoll-sync');

    this.channel.onmessage = (event: MessageEvent) => {
      const message = event.data;

      // Don't process our own messages
      if ('peerId' in message && message.peerId === this.peerId) {
        return;
      }

      const callback = this.callbacks.get(message.type);
      if (callback) {
        callback(message.data || message);
      }
    };

    // Request initial sync from other tabs
    setTimeout(() => {
      this.broadcast('request-sync', { peerId: this.peerId });
    }, 1000);
  }

  static broadcast(type: string, data: any) {
    if (!this.channel) return;

    const message: any = { type, data, timestamp: Date.now() };

    try {
      this.channel.postMessage(message);
    } catch (error) {
      // silently ignore postMessage errors
    }
  }

  static subscribe(type: string, callback: (data: any) => void) {
    this.callbacks.set(type, callback);
  }

  static getPeerId(): string {
    return this.peerId;
  }

  static cleanup() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.callbacks.clear();
  }
}