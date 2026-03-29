import { GunService } from '@/services/gunService';

const WARN_THRESHOLD = 0.60;
const CRITICAL_THRESHOLD = 0.75;
const EMERGENCY_THRESHOLD = 0.85;

const CHECK_INTERVAL_MS = 30_000;
const PERIODIC_GC_INTERVAL_MS = 120_000;

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

type CleanupLevel = 'none' | 'light' | 'aggressive' | 'emergency';

export class MemoryWatchdogService {
  private static checkTimer: ReturnType<typeof setInterval> | null = null;
  private static periodicTimer: ReturnType<typeof setInterval> | null = null;
  private static cleanupCallbacks: Array<(level: CleanupLevel) => void> = [];
  private static lastLevel: CleanupLevel = 'none';
  private static lastResetTime = 0;
  private static readonly RESET_COOLDOWN_MS = 300_000; // 5 min cooldown between Gun resets
  private static started = false;

  static start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.isMemoryAPIAvailable()) {
      console.info('[MemoryWatchdog] performance.memory not available, using periodic cleanup only');
      this.periodicTimer = setInterval(() => this.doCleanup('light'), PERIODIC_GC_INTERVAL_MS);
      return;
    }

    console.info('[MemoryWatchdog] Started monitoring memory usage');
    this.checkTimer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.periodicTimer = setInterval(() => this.doCleanup('light'), PERIODIC_GC_INTERVAL_MS);
  }

  static stop(): void {
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = null; }
    if (this.periodicTimer) { clearInterval(this.periodicTimer); this.periodicTimer = null; }
    this.started = false;
  }

  static onCleanup(cb: (level: CleanupLevel) => void): () => void {
    this.cleanupCallbacks.push(cb);
    return () => {
      this.cleanupCallbacks = this.cleanupCallbacks.filter(c => c !== cb);
    };
  }

  static getMemoryUsage(): { ratio: number; usedMB: number; limitMB: number } | null {
    if (!this.isMemoryAPIAvailable()) return null;
    const mem = (performance as any).memory as MemoryInfo;
    if (!mem.jsHeapSizeLimit || mem.jsHeapSizeLimit <= 0) return null;
    return {
      ratio: mem.usedJSHeapSize / mem.jsHeapSizeLimit,
      usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
      limitMB: Math.round(mem.jsHeapSizeLimit / 1024 / 1024),
    };
  }

  private static isMemoryAPIAvailable(): boolean {
    return typeof performance !== 'undefined' && 'memory' in performance;
  }

  private static check(): void {
    const usage = this.getMemoryUsage();
    if (!usage) return;

    let level: CleanupLevel = 'none';
    if (usage.ratio >= EMERGENCY_THRESHOLD) {
      level = 'emergency';
    } else if (usage.ratio >= CRITICAL_THRESHOLD) {
      level = 'aggressive';
    } else if (usage.ratio >= WARN_THRESHOLD) {
      level = 'light';
    }

    if (level !== 'none') {
      console.warn(`[MemoryWatchdog] Memory at ${usage.usedMB}MB / ${usage.limitMB}MB (${(usage.ratio * 100).toFixed(1)}%) → ${level} cleanup`);
      this.doCleanup(level);
    }

    if (level === 'emergency' && this.lastLevel === 'emergency') {
      const now = Date.now();
      if (now - this.lastResetTime > this.RESET_COOLDOWN_MS) {
        console.error('[MemoryWatchdog] Sustained emergency memory pressure — forcing Gun reconnect');
        this.forceGunReset();
        this.lastResetTime = now;
        this.lastLevel = 'none';
        return;
      }
    }

    this.lastLevel = level;
  }

  private static doCleanup(level: CleanupLevel): void {
    GunService.evictCache(level);

    for (const cb of this.cleanupCallbacks) {
      try { cb(level); } catch (e) { console.warn('[MemoryWatchdog] Cleanup callback error:', e); }
    }

    if (level === 'aggressive' || level === 'emergency') {
      this.clearGunLocalStorage();
    }
  }

  private static clearGunLocalStorage(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('gun/') || key.startsWith('gap/') || key.startsWith('rad/'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      if (keysToRemove.length > 0) {
        console.info(`[MemoryWatchdog] Cleared ${keysToRemove.length} Gun localStorage entries`);
      }
    } catch { /* localStorage not available */ }
  }

  private static forceGunReset(): void {
    try {
      GunService.reconnect();
      console.warn('[MemoryWatchdog] Gun instance reset complete');
    } catch (e) {
      console.error('[MemoryWatchdog] Gun reset failed:', e);
    }
  }
}
