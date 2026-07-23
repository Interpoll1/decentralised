import { GunService } from '@/services/gunService';

const WARN_THRESHOLD = 0.60;
const CRITICAL_THRESHOLD = 0.75;
const EMERGENCY_THRESHOLD = 0.85;

// Mobile browsers cap tab memory far lower than desktop and (on iOS Safari)
// expose no `performance.memory`, so we rely on the node-count heuristic there
// and must react sooner — before the OS freezes/kills the tab.
const IS_MOBILE = typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (typeof (navigator as any).deviceMemory === 'number' && (navigator as any).deviceMemory <= 4));

const CHECK_INTERVAL_MS = IS_MOBILE ? 15_000 : 30_000;
const PERIODIC_GC_INTERVAL_MS = IS_MOBILE ? 60_000 : 120_000;

// Node-count thresholds for heuristic memory pressure detection (when performance.memory unavailable).
// Mobile uses tighter limits so cleanup + Gun eviction kick in well before a freeze.
const HEURISTIC_WARN_NODES = IS_MOBILE ? 600 : 1200;
const HEURISTIC_CRITICAL_NODES = IS_MOBILE ? 900 : 1600;
const HEURISTIC_EMERGENCY_NODES = IS_MOBILE ? 1300 : 2500;

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
  /** Recent heap ratios; the window minimum is the pressure signal (see pressureRatio). */
  private static recentRatios: number[] = [];
  private static readonly RATIO_WINDOW = 4;

  static start(): void {
    if (this.started) return;
    this.started = true;

    if (!this.isMemoryAPIAvailable()) {
      console.info('[MemoryWatchdog] performance.memory not available, using heuristic + periodic cleanup');
    } else {
      console.info('[MemoryWatchdog] Started monitoring memory usage');
    }

    // Always run checks — uses heuristic fallback when performance.memory unavailable
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

  /**
   * Pressure signal used for cleanup decisions.
   *
   * `usedJSHeapSize` counts garbage that simply hasn't been collected yet. Under
   * Gun's normal sync churn a single sample swings by well over a gigabyte
   * between GCs, so reacting to one reading makes the watchdog fire at 85% on a
   * heap whose live set is a few hundred MB — and its response (evicting Gun
   * graph nodes) provokes a re-sync storm that produces *more* churn. Using the
   * lowest reading in a short window approximates the post-GC floor, i.e. the
   * live set, so only real growth escalates.
   */
  private static pressureRatio(current: number): number {
    this.recentRatios.push(current);
    if (this.recentRatios.length > this.RATIO_WINDOW) this.recentRatios.shift();
    return Math.min(...this.recentRatios);
  }

  private static isMemoryAPIAvailable(): boolean {
    return typeof performance !== 'undefined' && 'memory' in performance;
  }

  private static check(): void {
    const usage = this.getMemoryUsage();

    let level: CleanupLevel = 'none';

    if (usage) {
      // Real memory API available — judge on the recent floor, not one sample.
      const ratio = this.pressureRatio(usage.ratio);
      if (ratio >= EMERGENCY_THRESHOLD) {
        level = 'emergency';
      } else if (ratio >= CRITICAL_THRESHOLD) {
        level = 'aggressive';
      } else if (ratio >= WARN_THRESHOLD) {
        level = 'light';
      }
    } else {
      // Heuristic: estimate memory pressure from Gun graph size
      level = this.estimateMemoryPressure();
    }

    if (level !== 'none') {
      const usageStr = usage
        ? `${usage.usedMB}MB / ${usage.limitMB}MB (${(usage.ratio * 100).toFixed(1)}%)`
        : `heuristic estimate`;
      console.warn(`[MemoryWatchdog] Memory at ${usageStr} → ${level} cleanup`);
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

  private static estimateMemoryPressure(): CleanupLevel {
    try {
      const nodeCount = GunService.getGraphNodeCount();
      if (nodeCount >= HEURISTIC_EMERGENCY_NODES) return 'emergency';
      if (nodeCount >= HEURISTIC_CRITICAL_NODES) return 'aggressive';
      if (nodeCount >= HEURISTIC_WARN_NODES) return 'light';
    } catch {
      // GunService not initialized yet
    }
    return 'none';
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
