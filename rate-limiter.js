const PENALTY_SCHEDULE = [2, 8, 30, 120, 300]; // seconds

export class RateLimiter {
  constructor(options = {}) {
    this.httpLimit = options.httpLimit ?? 30;
    this.wsLimit = options.wsLimit ?? 60;
    this.windowMs = options.windowMs ?? 60_000;
    this.decayMs = 5 * 60_000; // 5 minutes of good behavior to decay 1 violation
    this.peers = new Map();
    this._cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  _getEntry(id) {
    let entry = this.peers.get(id);
    if (!entry) {
      entry = { timestamps: [], violations: 0, lastViolation: 0, cooldownUntil: 0 };
      this.peers.set(id, entry);
    }
    return entry;
  }

  _decayViolations(entry, now) {
    if (entry.violations > 0 && entry.lastViolation > 0) {
      const elapsed = now - entry.lastViolation;
      const decaySteps = Math.floor(elapsed / this.decayMs);
      if (decaySteps > 0) {
        entry.violations = Math.max(0, entry.violations - decaySteps);
        if (entry.violations === 0) {
          entry.lastViolation = 0;
        } else {
          entry.lastViolation += decaySteps * this.decayMs;
        }
      }
    }
  }

  _check(id, limit) {
    const now = Date.now();
    const entry = this._getEntry(id);

    this._decayViolations(entry, now);

    // Check cooldown
    if (now < entry.cooldownUntil) {
      const retryAfter = Math.ceil((entry.cooldownUntil - now) / 1000);
      return { allowed: false, retryAfter, violations: entry.violations };
    }

    // Sliding window: keep only timestamps within the window
    const windowStart = now - this.windowMs;
    entry.timestamps = entry.timestamps.filter(t => t > windowStart);

    if (entry.timestamps.length >= limit) {
      // Violation
      entry.violations++;
      entry.lastViolation = now;

      const penaltyIndex = Math.min(entry.violations - 1, PENALTY_SCHEDULE.length - 1);
      const penaltySec = PENALTY_SCHEDULE[penaltyIndex];
      entry.cooldownUntil = now + penaltySec * 1000;

      if (penaltySec >= 300) {
        console.log(`🚫 Rate limit: ${id} banned for ${penaltySec}s`);
      } else {
        console.log(`⚠️ Rate limit: ${id} violation #${entry.violations} — cooldown ${penaltySec}s`);
      }

      return { allowed: false, retryAfter: penaltySec, violations: entry.violations };
    }

    entry.timestamps.push(now);
    return { allowed: true, violations: entry.violations };
  }

  checkHttp(ip) {
    return this._check(ip, this.httpLimit);
  }

  checkWs(peerId) {
    return this._check(peerId, this.wsLimit);
  }

  getViolations(id) {
    const entry = this.peers.get(id);
    if (!entry) return 0;
    this._decayViolations(entry, Date.now());
    return entry.violations;
  }

  getRateLimitMultiplier(id) {
    const v = this.getViolations(id);
    if (v === 0) return 1;
    if (v <= 2) return 2;
    if (v <= 4) return 4;
    return 8;
  }

  cleanup() {
    const now = Date.now();
    const staleThreshold = Math.max(this.windowMs * 2, 600_000);
    for (const [id, entry] of this.peers) {
      const latestTs = entry.timestamps.length
        ? entry.timestamps[entry.timestamps.length - 1]
        : 0;
      const lastActivity = Math.max(latestTs, entry.lastViolation, entry.cooldownUntil);
      if (now - lastActivity > staleThreshold) {
        this.peers.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this.peers.clear();
  }
}
