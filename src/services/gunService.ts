// src/services/gunService.ts
import Gun from 'gun';
import 'gun/sea';

export class GunService {
  private static gun: any = null;
  private static user: any = null;
  private static isInitialized = false;

  static initialize() {
    if (this.isInitialized && this.gun) {
      return this.gun;
    }

    console.log('Initializing GunDB...');

    try {
      // Initialize Gun with relay server
      this.gun = Gun({
        peers: ['http://localhost:8765/gun'],
        localStorage: true,
        radisk: false // Let server handle persistence
      });

      this.user = this.gun.user();
      this.isInitialized = true;

      console.log('GunDB initialized successfully');

      // Monitor connections (but don't spam)
      let lastPeerCount = -1;
      setInterval(() => {
        try {
          const peerCount = Object.keys(this.gun?._.opt?.peers || {}).length;
          if (peerCount !== lastPeerCount) {
            console.log(`Gun peers: ${peerCount}`);
            lastPeerCount = peerCount;
          }
        } catch (e) {
          // Ignore peer count errors
        }
      }, 30000);

      return this.gun;
    } catch (error) {
      console.error('Gun initialization error:', error);
      throw error;
    }
  }

  static getGun() {
    if (!this.gun) {
      console.log('Gun not initialized, initializing now...');
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

  // Helper: Safely put data
  static async put(path: string, data: any): Promise<void> {
    const gun = this.getGun();
    
    return new Promise((resolve, reject) => {
      try {
        gun.get(path).put(data, (ack: any) => {
          if (ack.err) {
            console.error('Gun put error:', ack.err);
            reject(ack.err);
          } else {
            resolve();
          }
        });
      } catch (error) {
        console.error('Gun put exception:', error);
        reject(error);
      }
    });
  }

  // Helper: Safely get data once
  static async get(path: string): Promise<any> {
    const gun = this.getGun();
    
    return new Promise((resolve) => {
      try {
        gun.get(path).once((data: any) => {
          resolve(data);
        });
      } catch (error) {
        console.error('Gun get error:', error);
        resolve(null);
      }
    });
  }

  // Helper: Subscribe to changes
  static subscribe(path: string, callback: (data: any) => void): void {
    const gun = this.getGun();
    
    try {
      gun.get(path).on(callback);
    } catch (error) {
      console.error('Gun subscribe error:', error);
    }
  }

  // Helper: Map over collection
  static map(path: string, callback: (data: any) => void): void {
    const gun = this.getGun();
    
    try {
      gun.get(path).map().on((data: any) => {
        if (data && !data._) {
          callback(data);
        }
      });
    } catch (error) {
      console.error('Gun map error:', error);
    }
  }

  // Cleanup
  static cleanup(): void {
    if (this.gun) {
      // Gun doesn't have a formal cleanup, but we can reset
      this.isInitialized = false;
      console.log('Gun cleaned up');
    }
  }
}