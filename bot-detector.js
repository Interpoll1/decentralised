const MAX_TIMESTAMPS = 100;
const MAX_HASHES = 20;
const RECALC_INTERVAL = 10;
const BURST_WINDOW_MS = 5000;
const CLEANUP_INTERVAL_MS = 2 * 60_000;
const STALE_THRESHOLD_MS = 10 * 60_000;
const MAX_IDLE_MS = 2 * 60 * 60_000;   // 2 hours with no messages → stale
const MAX_CONNECT_MS = 6 * 60 * 60_000; // 6 hours connected → eligible for cleanup

function stddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function scoreIntervalVariance(timestamps) {
  if (timestamps.length < 3) return 0;
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }
  const sd = stddev(intervals);
  return Math.round(20 * (1 - Math.min(1, sd / 2000)));
}

function scoreBurstRate(timestamps) {
  const now = timestamps[timestamps.length - 1] || Date.now();
  const cutoff = now - BURST_WINDOW_MS;
  const count = timestamps.filter(t => t >= cutoff).length;
  if (count <= 3) return 0;
  if (count <= 6) return 5;
  if (count <= 10) return 10;
  if (count <= 15) return 15;
  return 20;
}

function scoreContentDiversity(hashes) {
  if (hashes.length === 0) return 0;
  const unique = new Set(hashes).size;
  const ratio = unique / hashes.length;
  if (ratio >= 0.8) return 0;
  if (ratio >= 0.5) return 10;
  return 20;
}

function scoreSessionRate(messageCount, connectTime) {
  const ageMinutes = Math.max(1, (Date.now() - connectTime) / 60_000);
  const mpm = messageCount / ageMinutes;
  if (mpm < 5) return 0;
  if (mpm < 15) return 5;
  if (mpm < 30) return 10;
  if (mpm < 60) return 15;
  return 20;
}

function scoreRegistrationTiming(registerTime, firstMessageTime) {
  if (!registerTime || !firstMessageTime) return 0;
  const delta = firstMessageTime - registerTime;
  if (delta > 2000) return 0;
  if (delta >= 500) return 5;
  if (delta >= 100) return 10;
  if (delta >= 20) return 15;
  return 20;
}

function createPeerState(now) {
  return {
    connectTime: now,
    registerTime: 0,
    firstMessageTime: 0,
    timestamps: [],
    messageHashes: [],
    messageCount: 0,
    score: 0,
    lastRecalc: 0,
    disconnectedAt: 0,
  };
}

export class BotDetector {
  constructor() {
    this.peers = new Map();
    this._cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  _getState(peerId) {
    return this.peers.get(peerId);
  }

  onConnect(peerId) {
    const now = Date.now();
    this.peers.set(peerId, createPeerState(now));
  }

  onRegister(peerId) {
    const state = this._getState(peerId);
    if (state) state.registerTime = Date.now();
  }

  recordMessage(peerId, messageHash) {
    let state = this._getState(peerId);
    if (!state) {
      this.onConnect(peerId);
      state = this._getState(peerId);
    }

    const now = Date.now();
    if (!state.firstMessageTime) state.firstMessageTime = now;

    state.timestamps.push(now);
    if (state.timestamps.length > MAX_TIMESTAMPS) {
      state.timestamps = state.timestamps.slice(-MAX_TIMESTAMPS);
    }

    state.messageHashes.push(messageHash);
    if (state.messageHashes.length > MAX_HASHES) {
      state.messageHashes = state.messageHashes.slice(-MAX_HASHES);
    }

    state.messageCount++;

    if (state.messageCount - state.lastRecalc >= RECALC_INTERVAL || state.messageCount <= RECALC_INTERVAL) {
      this._recalculate(peerId, state);
      state.lastRecalc = state.messageCount;
    }

    return state.score;
  }

  _recalculate(peerId, state) {
    const s1 = scoreIntervalVariance(state.timestamps);
    const s2 = scoreBurstRate(state.timestamps);
    const s3 = scoreContentDiversity(state.messageHashes);
    const s4 = scoreSessionRate(state.messageCount, state.connectTime);
    const s5 = scoreRegistrationTiming(state.registerTime, state.firstMessageTime);

    state.score = Math.min(100, s1 + s2 + s3 + s4 + s5);

    if (state.score > 80) {
      console.log(`🤖 Bot detected: ${peerId} score=${state.score} action=ban`);
    } else if (state.score > 30) {
      console.log(`👀 Suspicious: ${peerId} score=${state.score}`);
    }
  }

  getScore(peerId) {
    const state = this._getState(peerId);
    return state ? state.score : 0;
  }

  getAction(peerId) {
    const state = this._getState(peerId);
    const score = state ? state.score : 0;

    if (score <= 30) {
      return { action: 'allow', score, multiplier: 1 };
    }
    if (score <= 60) {
      return { action: 'throttle', score, multiplier: 2 };
    }
    if (score <= 80) {
      return { action: 'challenge', score, multiplier: 5 };
    }
    return { action: 'ban', score, multiplier: 10 };
  }

  onDisconnect(peerId) {
    const state = this._getState(peerId);
    if (state) state.disconnectedAt = Date.now();
  }

  cleanup() {
    const now = Date.now();
    for (const [id, state] of this.peers) {
      if (state.disconnectedAt && now - state.disconnectedAt > STALE_THRESHOLD_MS) {
        this.peers.delete(id);
        continue;
      }
      // Remove long-lived idle connections: connected > 6 hours with no messages in last 2 hours
      if (!state.disconnectedAt && now - state.connectTime > MAX_CONNECT_MS) {
        const lastMsg = state.timestamps.length
          ? state.timestamps[state.timestamps.length - 1]
          : 0;
        if (!lastMsg || now - lastMsg > MAX_IDLE_MS) {
          this.peers.delete(id);
        }
      }
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this.peers.clear();
  }
}
