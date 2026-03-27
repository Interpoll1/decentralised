import Gun from 'gun';
import 'gun/sea';
import config from '../config';

export const GUN_NAMESPACE = 'v2';

// Roots that get namespaced under GUN_NAMESPACE — Gun is now live-updates only,
// not the initial load source. These namespaced paths are still written to on
// createPost/createPoll so Gun relay peers can pick up new content in real time.
const NAMESPACED_ROOTS = new Set(['posts', 'communities', 'polls', 'postVotes', 'users', 'comments', 'events', 'chatrooms', 'server-config']);

function createNamespacedProxy(gun: any, nsNode: any): any {
  return new Proxy(gun, {
    get(target, prop) {
      if (prop === 'get') {
        return (path: string) => {
          if (NAMESPACED_ROOTS.has(path)) {
            return nsNode.get(path);
          }
          return target.get(path);
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

export class GunService {
  private static gun: any = null;
  private static proxiedGun: any = null;
  private static user: any = null;
  private static isInitialized = false;

  static initialize() {
    if (this.isInitialized && this.gun) return this.proxiedGun;

    // Purge orphaned Gun localStorage from when localStorage was enabled
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('gun/') || k.startsWith('rad/'))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* localStorage may be unavailable */ }

    this.gun = Gun({
      peers: [config.relay.gun],
      localStorage: false, // API warmup is primary data source; Gun is live-updates only
      radisk: false,
      axe: false,
      // ── Increased batching — Gun is live-updates only now, less urgency ──
      // wait: buffer writes for 250ms before flushing (was 150ms)
      // chunk: max 150 records per WS message (was 100)
      wait: 250,
      chunk: 150,
    });

    const nsNode = this.gun.get(GUN_NAMESPACE);
    this.proxiedGun = createNamespacedProxy(this.gun, nsNode);
    this.user = this.gun.user();
    this.isInitialized = true;
    return this.proxiedGun;
  }

  static getGun() {
    if (!this.gun) this.initialize();
    return this.proxiedGun;
  }

  static getRawGun() {
    if (!this.gun) this.initialize();
    return this.gun;
  }

  static getUser() {
    if (!this.user) this.initialize();
    return this.user;
  }

  static reconnect(newPeerUrl?: string) {
    const peerUrl = newPeerUrl || config.relay.gun;
    this.isInitialized = false;
    this.gun = null;
    this.proxiedGun = null;
    this.user = null;
    this.gun = Gun({
      peers: [peerUrl],
      localStorage: true,
      radisk: false,
      axe: false,
      wait: 250,
      chunk: 150,
    });
    const nsNode = this.gun.get(GUN_NAMESPACE);
    this.proxiedGun = createNamespacedProxy(this.gun, nsNode);
    this.user = this.gun.user();
    this.isInitialized = true;
    return this.proxiedGun;
  }

  static getPeerStats(): { isConnected: boolean; peerCount: number } {
    if (typeof window === 'undefined') return { isConnected: false, peerCount: 0 };
    if (!this.gun) {
      try { this.initialize(); } catch { return { isConnected: false, peerCount: 0 }; }
    }
    try {
      const peers = this.gun?._.opt?.peers || {};
      const activePeers = Object.values(peers).filter((peer: any) => peer?.wire?.readyState === 1);
      return { isConnected: activePeers.length > 0, peerCount: activePeers.length };
    } catch {
      return { isConnected: false, peerCount: 0 };
    }
  }

  static async put(path: string, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.getGun().get(path).put(data, (ack: any) => {
          if (ack.err) reject(ack.err);
          else resolve();
        });
      } catch (error) { reject(error); }
    });
  }

  static async get(path: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        this.getGun().get(path).once((data: any) => resolve(data));
      } catch { resolve(null); }
    });
  }

  static subscribe(path: string, callback: (data: any) => void): void {
    try {
      this.getGun().get(path).on(callback);
    } catch { }
  }

  // Throttled map — prevents 1K+ records/sec DOM warning
  static map(path: string, callback: (data: any) => void): void {
    const batch: any[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (batch.length > 0) batch.splice(0).forEach(data => callback(data));
    };

    try {
      this.getGun().get(path).map().on((data: any) => {
        if (!data || data._) return;
        batch.push(data);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, 100);
        if (batch.length >= 50) { if (timer) clearTimeout(timer); flush(); }
      });
    } catch { }
  }

  static cleanup(): void {
    this.isInitialized = false;
  }
}