// Content firewall for the Gun relay — rejects bot-style creation of posts,
// comments and polls before Gun sees the write.
//
// Installed on each Gun WebSocket (see installContentFirewall). For every put
// that creates a content node it requires:
//   1. a valid proof-of-work stamp (shared-validation/contentPow.js) that is
//      fresh relative to the relay clock, and
//   2. the sender's IP to be under the per-IP creation rate limit.
// Writes to content the relay already holds (edits, counters, peer re-syncs)
// pass, so legacy unstamped content keeps working. "Holds" means a durable row
// with createdAt — a bare metadata node cannot be used to smuggle content in.
//
// Rejected puts are dropped and answered with a Gun error ack, so the client
// sees a failed write instead of a silent timeout.

import { verifyContentPow } from './shared-validation/contentPow.js';

const CONTENT_SOUL = /^v\d+\/(?:communities\/[^/]+\/)?(posts|comments|polls)\/([^/]+)$/;
const KIND = { posts: 'post', comments: 'comment', polls: 'poll' };

const DEFAULT_LIMITS = { perMinute: 6, perHour: 60 };
const KNOWN_CAP = 100_000;

/** Parse a content soul into { kind, id }, or null for anything else. */
export function classifySoul(soul) {
  const m = typeof soul === 'string' ? CONTENT_SOUL.exec(soul) : null;
  return m ? { kind: KIND[m[1]], id: m[2] } : null;
}

/**
 * @param {object} opts
 * @param {(soul: string) => Promise<boolean>} opts.soulExists  true if the durable store (MySQL)
 *   holds this soul as real content (a row with createdAt)
 * @param {'enforce'|'log'} [opts.mode]
 * @param {{perMinute:number, perHour:number}} [opts.limits]
 * @param {() => number} [opts.now]
 * @param {(msg: string) => void} [opts.log]
 */
export function createContentFirewall(opts) {
  const {
    soulExists,
    mode = 'enforce',
    limits = DEFAULT_LIMITS,
    now = () => Date.now(),
    log = (msg) => console.warn(msg),
  } = opts;

  const known = new Set();
  const creations = new Map(); // ip -> [{ t, key }]

  function remember(soul) {
    if (known.size >= KNOWN_CAP) known.delete(known.values().next().value);
    known.add(soul);
  }

  // Root and community copies of one item share an id: charge it once.
  function underRateLimit(ip, key) {
    const t = now();
    const list = (creations.get(ip) || []).filter(e => t - e.t < 3_600_000);
    if (list.some(e => e.key === key)) { creations.set(ip, list); return true; }
    const lastMinute = list.filter(e => t - e.t < 60_000).length;
    if (lastMinute >= limits.perMinute || list.length >= limits.perHour) {
      creations.set(ip, list);
      return false;
    }
    list.push({ t, key });
    creations.set(ip, list);
    return true;
  }

  const sweep = setInterval(() => {
    const t = now();
    for (const [ip, list] of creations) {
      const kept = list.filter(e => t - e.t < 3_600_000);
      if (kept.length) creations.set(ip, kept); else creations.delete(ip);
    }
  }, 300_000);
  if (sweep.unref) sweep.unref();

  /**
   * Check one soul/node pair from a put. Resolves to null (allowed) or an
   * error code.
   */
  async function checkNode(soul, node, ip) {
    const content = classifySoul(soul);
    if (!content || !node || typeof node !== 'object' || known.has(soul)) return null;

    const stamped = verifyContentPow({
      kind: content.kind,
      id: content.id,
      createdAt: node.createdAt,
      authorId: typeof node.authorId === 'string' ? node.authorId : '',
      powNonce: node.powNonce,
    }, { fresh: true, now: now() });

    if (stamped) {
      if (!underRateLimit(ip, `${content.kind}:${content.id}`)) return 'rate-limited';
      remember(soul);
      return null;
    }

    // Unstamped or stale: only allowed for content the relay already holds
    // (edits, legacy items re-synced by peers).
    let exists = false;
    try { exists = await soulExists(soul); } catch { exists = false; }
    if (exists) { remember(soul); return null; }
    return 'content-pow-required';
  }

  /**
   * Filter one raw WebSocket frame.
   * @returns {Promise<{ raw: string|null, rejected: Array<{ id: string, err: string }> }>}
   *   raw is the frame to pass on (unchanged when nothing was rejected, null
   *   when every message in it was dropped).
   */
  async function filterFrame(raw, ip) {
    const text = typeof raw === 'string' ? raw : raw?.toString?.();
    if (typeof text !== 'string' || !text.includes('"put"')) return { raw, rejected: [] };
    let parsed;
    try { parsed = JSON.parse(text); } catch { return { raw, rejected: [] }; }
    const list = Array.isArray(parsed) ? parsed : [parsed];

    const rejected = [];
    const kept = [];
    for (const msg of list) {
      const put = msg && typeof msg === 'object' ? msg.put : null;
      if (!put || typeof put !== 'object') { kept.push(msg); continue; }
      let err = null;
      for (const soul of Object.keys(put)) {
        err = await checkNode(soul, put[soul], ip);
        if (err) break;
      }
      if (!err) { kept.push(msg); continue; }
      const firstSoul = Object.keys(put).find(s => classifySoul(s)) || '?';
      log(`[content-firewall] ${mode === 'enforce' ? 'rejected' : 'would reject'} ${firstSoul} from ${ip}: ${err}`);
      if (mode === 'enforce') rejected.push({ id: msg['#'], err });
      else kept.push(msg);
    }

    if (!rejected.length) return { raw, rejected };
    if (!kept.length) return { raw: null, rejected };
    return { raw: JSON.stringify(Array.isArray(parsed) ? kept : kept[0]), rejected };
  }

  return { filterFrame, checkNode, classifySoul };
}

/**
 * Client IP behind nginx, mirroring security-utils' rate limiter. nginx sets
 * X-Real-IP from $remote_addr, so it cannot be spoofed by the client. Headers
 * like CF-Connecting-IP are deliberately ignored: the relay is not behind
 * Cloudflare, so a client could set them to dodge the rate limit.
 */
export function clientIpFromRequest(req) {
  const h = req?.headers || {};
  return h['x-real-ip']
    || String(h['x-forwarded-for'] || '').split(',')[0].trim()
    || req?.socket?.remoteAddress
    || 'unknown';
}

/**
 * Wrap a ws connection so every 'message' event passes through the firewall
 * before any listener (including Gun's) sees it. Frames are processed in
 * order per socket; rejected puts get a Gun error ack.
 */
export function installContentFirewall(ws, req, firewall) {
  const ip = clientIpFromRequest(req);
  const emit = ws.emit.bind(ws);
  let queue = Promise.resolve();

  ws.emit = function (event, ...args) {
    if (event !== 'message') return emit(event, ...args);
    queue = queue
      .then(() => firewall.filterFrame(args[0], ip))
      .then(({ raw, rejected }) => {
        for (const r of rejected) {
          if (!r.id || ws.readyState !== 1) continue;
          try {
            ws.send(JSON.stringify({ '@': r.id, err: r.err, '#': Math.random().toString(36).slice(2, 11) }));
          } catch { /* socket closed */ }
        }
        if (raw !== null) emit('message', raw, ...args.slice(1));
      })
      .catch(() => { emit('message', ...args); }); // never wedge the socket
    return true;
  };
}
