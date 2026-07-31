const PENALTY_SCHEDULE = [2, 8, 30, 120, 300]; // seconds

// Maximum number of peers to track in memory.
// When exceeded, the oldest (by last activity) entries are evicted.
// This prevents unbounded growth under sustained attack traffic.
const MAX_PEERS = 50_000;

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
      // Evict oldest entry when map is at capacity to bound memory usage
      if (this.peers.size >= MAX_PEERS) {
        this._evictOldest();
      }
      entry = { timestamps: [], violations: 0, lastViolation: 0, cooldownUntil: 0 };
      this.peers.set(id, entry);
    }
    return entry;
  }

  _evictOldest() {
    const now = Date.now();
    let oldestId = null;
    let oldestActivity = Infinity;
    for (const [id, entry] of this.peers) {
      const latestTs = entry.timestamps.length ? entry.timestamps[entry.timestamps.length - 1] : 0;
      const lastActivity = Math.max(latestTs, entry.lastViolation, entry.cooldownUntil);
      if (lastActivity < oldestActivity) {
        oldestActivity = lastActivity;
        oldestId = id;
      }
    }
    if (oldestId !== null) this.peers.delete(oldestId);
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

  _check(id, limitOverride, defaultLimit) {
    const now = Date.now();
    const entry = this._getEntry(id);
    const limit = Number.isFinite(limitOverride) && limitOverride > 0
      ? Math.floor(limitOverride)
      : defaultLimit;

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

  checkHttp(ip, limitOverride) {
    return this._check(ip, limitOverride, this.httpLimit);
  }

  checkWs(peerId, limitOverride) {
    return this._check(peerId, limitOverride, this.wsLimit);
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

  /**
   * Serialise violation state (not timestamps — those belong to the current window
   * and are intentionally dropped on restart to avoid holding stale bans forever).
   * Only peers with active cooldowns or violations are included.
   *
   * Usage in bash.sh / the relay entry point:
   *   const limiter = new RateLimiter();
   *   if (fs.existsSync(STATE_FILE)) limiter.restore(JSON.parse(fs.readFileSync(STATE_FILE)));
   *   process.on('SIGTERM', () => fs.writeFileSync(STATE_FILE, JSON.stringify(limiter.dump())));
   */
  dump() {
    const now = Date.now();
    const out = {};
    for (const [id, entry] of this.peers) {
      // Skip fully clean entries — no point persisting them
      if (entry.violations === 0 && now >= entry.cooldownUntil) continue;
      // Decay before serialising so restored state is accurate
      this._decayViolations(entry, now);
      if (entry.violations === 0 && now >= entry.cooldownUntil) continue;
      out[id] = {
        violations: entry.violations,
        lastViolation: entry.lastViolation,
        cooldownUntil: entry.cooldownUntil,
        // timestamps intentionally omitted — they expire with the process
      };
    }
    return out;
  }

  /**
   * Restore previously dumped state. Call this immediately after construction,
   * before the relay starts accepting connections.
   */
  restore(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    const now = Date.now();
    for (const [id, saved] of Object.entries(snapshot)) {
      if (!saved || typeof saved !== 'object') continue;
      const violations = Number(saved.violations) || 0;
      const lastViolation = Number(saved.lastViolation) || 0;
      const cooldownUntil = Number(saved.cooldownUntil) || 0;
      // Drop entries whose cooldown has already expired and have zero violations
      if (violations === 0 && now >= cooldownUntil) continue;
      if (this.peers.size >= MAX_PEERS) this._evictOldest();
      this.peers.set(id, {
        timestamps: [], // fresh — don't inherit old window
        violations,
        lastViolation,
        cooldownUntil,
      });
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this.peers.clear();
  }
}
