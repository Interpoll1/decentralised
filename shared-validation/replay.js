const TIMESTAMP_WINDOW_MS = 30_000;
const NONCE_TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 30_000;

const REPLAY_PROTECTED_TYPES = new Set([
  'new-poll', 'new-block', 'new-event',
  'broadcast', 'chat-message', 'chatroom-message',
  'vote-authorize', 'vote-record', 'vote-confirm', 'index',
  'sync-response',
]);

export class ReplayProtector {
  constructor() {
    this.seenNonces = new Map();
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
  }

  check(message) {
    if (!message || typeof message !== 'object') {
      return { fresh: false, reason: 'invalid message' };
    }
    const msgType = message.type || '';
    if (!REPLAY_PROTECTED_TYPES.has(msgType)) {
      return { fresh: true };
    }
    if (!message._ts || typeof message._ts !== 'number') {
      return { fresh: false, reason: 'missing _ts timestamp' };
    }
    const now = Date.now();
    const drift = Math.abs(now - message._ts);
    if (drift > TIMESTAMP_WINDOW_MS) {
      return { fresh: false, reason: `timestamp drift ${drift}ms exceeds ${TIMESTAMP_WINDOW_MS}ms window` };
    }
    if (!message._nonce || typeof message._nonce !== 'string') {
      return { fresh: false, reason: 'missing _nonce' };
    }
    if (message._nonce.length > 64) {
      return { fresh: false, reason: 'nonce too long' };
    }
    if (this.seenNonces.has(message._nonce)) {
      return { fresh: false, reason: 'duplicate nonce (replay detected)' };
    }
    this.seenNonces.set(message._nonce, now);
    return { fresh: true };
  }

  _cleanup() {
    const cutoff = Date.now() - NONCE_TTL_MS;
    for (const [nonce, ts] of this.seenNonces) {
      if (ts < cutoff) this.seenNonces.delete(nonce);
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this.seenNonces.clear();
  }
}
