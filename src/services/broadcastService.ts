export class BroadcastService {
  private static channel: BroadcastChannel | null = null;
  private static peerId: string = Math.random().toString(36).substring(7);
  private static callbacks: Map<string, (data: any) => void> = new Map();

  static initialize() {
    if (typeof BroadcastChannel === 'undefined') return;

    this.channel = new BroadcastChannel('interpoll-sync');

    this.channel.onmessage = (event: MessageEvent) => {
      const message = event.data;

      // Don't process our own messages
      if ('peerId' in message && message.peerId === this.peerId) return;

      const callback = this.callbacks.get(message.type);
      if (callback) callback(message.data || message);
    };

    // Request initial sync from other tabs (lastIndex -1 = send everything)
    setTimeout(() => {
      this.broadcast('request-sync', { peerId: this.peerId, lastIndex: -1 });
    }, 1000);
  }

  static broadcast(type: string, data: any) {
    if (!this.channel) return;

    const message: any = { type, data, timestamp: Date.now() };

    try {
      this.channel.postMessage(message);
    } catch {
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
    if (this.channel) this.channel.close();
    this.channel = null;
    this.callbacks.clear();
  }
}
