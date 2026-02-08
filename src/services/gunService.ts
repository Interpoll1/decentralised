import Gun from 'gun';
import 'gun/sea';
import config from '../config';

export class GunService {
  private static gun: any = null;
  private static user: any = null;
  private static isInitialized = false;

  static initialize() {
    if (this.isInitialized && this.gun) {
      return this.gun;
    }

    try {
      this.gun = Gun({
        peers: [config.relay.gun],
        localStorage: true,
        radisk: false
      });

      this.user = this.gun.user();
      this.isInitialized = true;

      return this.gun;
    } catch (error) {
      throw error;
    }
  }

  static getGun() {
    if (!this.gun) {
      return this.initialize();
    }
    return this.gun;
  }

  static getUser() {
    if (!this.user) {
      this.initialize();
    }
    return this.user;
  }

  /**
   * Reconnect Gun to a new relay peer URL.
   * Creates a fresh Gun instance pointed at the new peer.
   */
  static reconnect(newPeerUrl?: string) {
    const peerUrl = newPeerUrl || config.relay.gun;

    // Tear down old instance
    this.isInitialized = false;
    this.gun = null;
    this.user = null;

    this.gun = Gun({
      peers: [peerUrl],
      localStorage: true,
      radisk: false
    });

    this.user = this.gun.user();
    this.isInitialized = true;

    return this.gun;
  }

  static getPeerStats(): { isConnected: boolean; peerCount: number } {
    if (typeof window === 'undefined') {
      return { isConnected: false, peerCount: 0 };
    }

    if (!this.gun) {
      try {
        this.initialize();
      } catch (_err) {
        return { isConnected: false, peerCount: 0 };
      }
    }

    try {
      const peers = this.gun?._.opt?.peers || {};
      const activePeers = Object.values(peers).filter((peer: any) => peer?.wire?.readyState === 1);

      return {
        isConnected: activePeers.length > 0,
        peerCount: activePeers.length,
      };
    } catch (_error) {
      return { isConnected: false, peerCount: 0 };
    }
  }

  static async put(path: string, data: any): Promise<void> {
    const gun = this.getGun();

    return new Promise((resolve, reject) => {
      try {
        gun.get(path).put(data, (ack: any) => {
          if (ack.err) {
            reject(ack.err);
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  static async get(path: string): Promise<any> {
    const gun = this.getGun();

    return new Promise((resolve) => {
      try {
        gun.get(path).once((data: any) => {
          resolve(data);
        });
      } catch (_error) {
        resolve(null);
      }
    });
  }

  static subscribe(path: string, callback: (data: any) => void): void {
    const gun = this.getGun();

    try {
      gun.get(path).on(callback);
    } catch (_error) {
      // Subscription failed
    }
  }

  static map(path: string, callback: (data: any) => void): void {
    const gun = this.getGun();

    try {
      gun.get(path).map().on((data: any) => {
        if (data && !data._) {
          callback(data);
        }
      });
    } catch (_error) {
      // Map failed
    }
  }

  static cleanup(): void {
    if (this.gun) {
      this.isInitialized = false;
    }
  }
}
