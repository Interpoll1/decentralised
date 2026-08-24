/**
 * api.js — the HTTP surface of the self-host relay.
 *
 * Three groups of routes:
 *
 *  1. The contract the *full* Vue client expects. Most of it degrades
 *     gracefully if missing, with one exception worth stating loudly:
 *     `POST /api/vote-authorize` returning 404 makes the client *deny* the vote
 *     (src/services/auditService.ts — only network errors, 409 and 5xx fall
 *     open). It must exist, so it does.
 *  2. `/db/*` — the HTTP side-channel onto the Gun graph the client uses for
 *     write confirmation, cold-start hydration and discovery.
 *  3. `/api/lite/*` — the tiny surface the build-free lite client uses. It
 *     writes polls into Gun in exactly the shape pollService.ts uses, so a poll
 *     created in the lite client shows up in the full app and vice versa.
 */

import crypto from 'crypto';
import config from './env.js';
import * as graph from './graph.js';
import { sanitizeId, sanitizeString, sanitizeSoul } from '../../security-utils.js';
import { verifyRelayRequestIntegrity } from '../../relay-integrity.js';

const NS = 'v3';
const RESERVATION_TTL_MS = 120_000;
const MAX_OPTIONS = 20;
const MAX_QUESTION = 500;
const MAX_OPTION_TEXT = 200;

/** HMAC key for reservation tokens. Per-process: tokens die with the relay. */
const reservationSecret = crypto.randomBytes(32);

/** `${pollId}:${deviceId}` → timestamp of the recorded vote. */
const recordedVotes = new Map();
/** token → { pollId, deviceId, expiresAt } */
const reservations = new Map();
/** verification code → receipt */
const receipts = new Map();

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

/** Everything this instance cannot do answers in a shape the client understands. */
function unavailable(res, feature) {
  return json(res, 501, {
    error: 'not_available',
    feature,
    message: `${feature} is not available on a self-hosted instance.`,
  });
}

function readBody(req, maxBytes = config.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Verify the client's seal (`_ts/_nonce/_sig/_pub/_hash/_pow`). Returns null
 * when the payload is acceptable, or a reason string when it is not.
 */
function checkSeal(payload, messageType) {
  const result = verifyRelayRequestIntegrity(payload, messageType);
  if (result.valid) return null;
  // REQUIRE_POW=0 forgives the *work factor* and nothing else. Skipping the
  // whole check would also skip the signature, so anyone could post a vote in
  // someone else's name — the opposite of what a "make it cheaper on slow
  // phones" switch should mean.
  if (!config.requirePow && result.reason === 'proof-of-work verification failed') return null;
  return result.reason;
}

/**
 * Roots `/db/write` will accept. The route exists for one job — the client
 * pushing poll tallies it just wrote (see PollDetailPage.vue) — and it carries
 * no signature, so an open version of it lets anyone who can reach the port
 * rewrite any node in the graph, instance config included.
 */
const WRITABLE_ROOTS = [
  `${NS}/polls/`,
  `${NS}/communities/`,
  `${NS}/posts/`,
  `${NS}/comments/`,
  `${NS}/pollVotes/`,
  `${NS}/postVotes/`,
  `${NS}/commentVotes/`,
  `${NS}/events/`,
  `${NS}/chatrooms/`,
  `${NS}/chats/`,
  `${NS}/chat-presence/`,
  `${NS}/chat-read/`,
];

function isWritableSoul(soul) {
  return WRITABLE_ROOTS.some(root => soul.startsWith(root));
}

function issueReservation(pollId, deviceId) {
  const expiresAt = Date.now() + RESERVATION_TTL_MS;
  const raw = `${pollId}:${deviceId}:${expiresAt}`;
  const mac = crypto.createHmac('sha256', reservationSecret).update(raw).digest('hex').slice(0, 32);
  const token = `${expiresAt}.${mac}`;
  reservations.set(token, { pollId, deviceId, expiresAt });
  return token;
}

function consumeReservation(token, pollId, deviceId) {
  const entry = reservations.get(token);
  if (!entry) return { ok: false, reason: 'unknown reservation' };
  reservations.delete(token);
  if (entry.expiresAt < Date.now()) return { ok: false, reason: 'reservation expired' };
  if (entry.pollId !== pollId || entry.deviceId !== deviceId) {
    return { ok: false, reason: 'reservation does not match this vote' };
  }
  return { ok: true };
}

function pruneExpired(now = Date.now()) {
  for (const [token, entry] of reservations) {
    if (entry.expiresAt < now) reservations.delete(token);
  }
  if (config.ttlMs) {
    const cutoff = now - config.ttlMs;
    for (const [key, ts] of recordedVotes) if (ts < cutoff) recordedVotes.delete(key);
    for (const [code, receipt] of receipts) if (receipt.timestamp < cutoff) receipts.delete(code);
  }
}
setInterval(pruneExpired, 60_000).unref?.();

// ── Reading polls/posts back out of the graph ────────────────────────────────

/** Turn a Gun poll node (options as an index-keyed child node) into JSON. */
function shapePoll(node) {
  if (!node || !node.id) return null;
  const options = Object.entries(node.options || {})
    .filter(([key, value]) => key !== '_' && value && value.id)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, option]) => ({
      id: option.id,
      text: option.text || '',
      votes: option.votes || 0,
    }));
  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  return {
    id: node.id,
    communityId: node.communityId || '',
    authorId: node.authorId || '',
    authorName: node.authorName || '',
    question: node.question || '',
    description: node.description || '',
    options,
    createdAt: node.createdAt || 0,
    expiresAt: node.expiresAt || 0,
    allowMultipleChoices: !!node.allowMultipleChoices,
    showResultsBeforeVoting: node.showResultsBeforeVoting !== false,
    isPrivate: !!node.isPrivate,
    requireLogin: !!node.requireLogin,
    totalVotes: Math.max(totalVotes, node.totalVotes || 0),
    isExpired: !!node.expiresAt && node.expiresAt < Date.now(),
  };
}

async function loadPoll(pollId) {
  const node = await graph.readDeep(`${NS}/polls/${pollId}`, 3);
  return shapePoll(node);
}

async function listCollection(root, limit, shape) {
  const entries = graph.childSouls(`${NS}/${root}`, limit);
  const rows = await Promise.all(entries.map(entry => graph.readDeep(entry.soul, 3)));
  return rows
    .map(row => (shape ? shape(row) : row))
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// ── Lite client helpers ──────────────────────────────────────────────────────

/**
 * Write a poll into Gun in the exact shape pollService.ts writes
 * (`v3/polls/<id>` with an index-keyed `options` child), so the full client can
 * read a poll the lite client created.
 */
function writePoll(poll) {
  const soul = `${NS}/polls/${poll.id}`;
  const optionsSoul = `${soul}/options`;

  // Written node-by-node rather than as one nested object: Gun's own expansion
  // of nested plain objects into child nodes is not something the relay can
  // observe reliably (and does not happen at all with radisk off), and the
  // child souls have to match `<poll>/options/<index>` exactly, because that is
  // where both clients write vote tallies.
  poll.options.forEach((option, index) => {
    graph.writeSoul(`${optionsSoul}/${index}`, {
      id: option.id,
      text: option.text,
      votes: option.votes || 0,
    });
  });
  graph.writeSoul(
    optionsSoul,
    Object.fromEntries(poll.options.map((_, index) => [index, { '#': `${optionsSoul}/${index}` }])),
  );

  graph.writeSoul(soul, {
    id: poll.id,
    communityId: poll.communityId || '',
    authorId: poll.authorId || '',
    authorName: poll.authorName || '',
    question: poll.question,
    description: poll.description || '',
    createdAt: poll.createdAt,
    expiresAt: poll.expiresAt,
    allowMultipleChoices: !!poll.allowMultipleChoices,
    showResultsBeforeVoting: poll.showResultsBeforeVoting !== false,
    requireLogin: false,
    isPrivate: false,
    totalVotes: poll.totalVotes || 0,
    isExpired: false,
    options: { '#': optionsSoul },
  });
}

function makeReceipt({ pollId, optionIds, deviceId, pubkey, signature }) {
  const timestamp = Date.now();
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ pollId, optionIds, deviceId, timestamp }))
    .digest('hex');
  const code = hash.slice(0, 12).toUpperCase();
  const receipt = { code, hash, pollId, optionIds, deviceId, pubkey: pubkey || '', signature: signature || '', timestamp };
  receipts.set(code, receipt);
  return receipt;
}

// ── Router ───────────────────────────────────────────────────────────────────

/**
 * Handle one request. Returns true when the request was served, false when the
 * caller should fall through to static file serving.
 */
export async function handleApi(req, res, url, ctx) {
  const { pathname, searchParams } = url;
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (!pathname.startsWith('/api/') && !pathname.startsWith('/db/') && pathname !== '/health') {
    return false;
  }

  // ── instance / health ──────────────────────────────────────────────────────
  if (pathname === '/health' || pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      edition: config.edition,
      uptimeSeconds: Math.round(process.uptime()),
      peers: ctx.hub.peerCount,
      messagesRelayed: ctx.hub.messagesRelayed,
      ttlHours: config.ttlHours,
      ephemeral: config.ephemeral,
      graph: graph.stats(),
    });
    return true;
  }

  if (pathname === '/api/instance') {
    json(res, 200, {
      name: config.instanceName,
      accentColor: config.accentColor,
      ttlHours: config.ttlHours,
      ephemeral: config.ephemeral,
    });
    return true;
  }

  // ── cloud-only surfaces: answer honestly instead of 404-ing ────────────────
  if (pathname === '/api/me') {
    json(res, 200, { user: null });
    return true;
  }
  if (pathname.startsWith('/auth/')) return unavailable(res, 'OAuth sign-in'), true;
  if (pathname === '/api/upload-video') return unavailable(res, 'Video upload'), true;
  if (pathname.startsWith('/api/moderation')) return unavailable(res, 'Moderation API'), true;
  if (pathname === '/api/push/register') return unavailable(res, 'Push notifications'), true;

  // ── sealed vote flow ───────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/vote-authorize') {
    let body;
    try { body = await readBody(req); } catch (err) { return json(res, 400, { allowed: false, reason: err.message }), true; }

    const sealProblem = checkSeal(body, 'vote-authorize');
    if (sealProblem) return json(res, 400, { allowed: false, reason: sealProblem }), true;

    const pollId = sanitizeId(body.pollId);
    const deviceId = sanitizeId(body.deviceId);
    if (!pollId || !deviceId) return json(res, 400, { allowed: false, reason: 'invalid pollId or deviceId' }), true;

    if (recordedVotes.has(`${pollId}:${deviceId}`)) {
      // 409 + "already" is the one denial the client honours without falling open.
      return json(res, 409, { allowed: false, reason: 'This device has already voted on this poll' }), true;
    }

    json(res, 200, {
      allowed: true,
      reservationToken: issueReservation(pollId, deviceId),
      requireLogin: false,
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/vote-confirm') {
    let body;
    try { body = await readBody(req); } catch (err) { return json(res, 400, { ok: false, reason: err.message }), true; }

    const sealProblem = checkSeal(body, 'vote-confirm');
    if (sealProblem) return json(res, 400, { ok: false, reason: sealProblem }), true;

    const pollId = sanitizeId(body.pollId);
    const deviceId = sanitizeId(body.deviceId);
    if (!pollId || !deviceId) return json(res, 400, { ok: false, reason: 'invalid pollId or deviceId' }), true;

    const key = `${pollId}:${deviceId}`;
    if (recordedVotes.has(key)) return json(res, 200, { ok: true, alreadyRecorded: true }), true;

    const claim = consumeReservation(String(body.reservationToken || ''), pollId, deviceId);
    if (!claim.ok) return json(res, 400, { ok: false, reason: claim.reason }), true;

    recordedVotes.set(key, Date.now());
    json(res, 200, { ok: true, alreadyRecorded: false });
    return true;
  }

  if (method === 'POST' && pathname === '/api/poll-policy') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false }), true; }
    const sealProblem = checkSeal(body, 'poll-policy');
    if (sealProblem) return json(res, 400, { ok: false, reason: sealProblem }), true;
    json(res, 200, { ok: true });
    return true;
  }

  if (method === 'POST' && pathname === '/api/receipts') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false }), true; }
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    receipts.set(code, { code, timestamp: Date.now(), type: body.type || 'vote', payload: body.payload ?? null });
    json(res, 200, { ok: true, code });
    return true;
  }

  // ── read routes (cold-start fast path for the full client) ────────────────
  if (method === 'GET' && pathname === '/api/polls') {
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);
    json(res, 200, { polls: await listCollection('polls', limit, shapePoll), hasMore: false });
    return true;
  }

  if (method === 'GET' && pathname === '/api/posts') {
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 500);
    json(res, 200, { posts: await listCollection('posts', limit), hasMore: false });
    return true;
  }

  if (method === 'GET' && pathname === '/api/communities') {
    json(res, 200, { communities: await listCollection('communities', 200) });
    return true;
  }

  if (method === 'GET' && pathname === '/api/feed') {
    const limit = Math.min(Number(searchParams.get('limit')) || 30, 200);
    const [posts, polls] = await Promise.all([
      listCollection('posts', limit),
      listCollection('polls', limit, shapePoll),
    ]);
    const items = [
      ...posts.map(data => ({ type: 'post', createdAt: data.createdAt || 0, data })),
      ...polls.map(data => ({ type: 'poll', createdAt: data.createdAt || 0, data })),
    ].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    json(res, 200, { items, hasMore: false });
    return true;
  }

  if (method === 'GET' && pathname === '/api/comment-counts') {
    const ids = (searchParams.get('ids') || '').split(',').map(id => sanitizeId(id)).filter(Boolean).slice(0, 50);
    const counts = {};
    await Promise.all(ids.map(async id => {
      const node = await graph.readSoul(`${NS}/comments/${id}`);
      counts[id] = node ? Object.keys(node).length : 0;
    }));
    json(res, 200, { counts });
    return true;
  }

  if (method === 'GET' && pathname === '/api/search') {
    const query = sanitizeString(searchParams.get('q') || '', 200).toLowerCase();
    if (!query) return json(res, 200, { results: [], total: 0 }), true;
    const [posts, polls] = await Promise.all([
      listCollection('posts', 200),
      listCollection('polls', 200, shapePoll),
    ]);
    const results = [...posts, ...polls].filter(row =>
      JSON.stringify(row).toLowerCase().includes(query),
    ).slice(0, Math.min(Number(searchParams.get('limit')) || 25, 100));
    json(res, 200, { results, total: results.length });
    return true;
  }

  const pollMatch = pathname.match(/^\/api\/poll\/([^/]+)$/);
  if (method === 'GET' && pollMatch) {
    const poll = await loadPoll(sanitizeId(decodeURIComponent(pollMatch[1])) || '');
    if (!poll) return json(res, 404, { error: 'not_found' }), true;
    json(res, 200, poll);
    return true;
  }

  const postMatch = pathname.match(/^\/api\/post\/([^/]+)$/);
  if (method === 'GET' && postMatch) {
    const postId = sanitizeId(decodeURIComponent(postMatch[1]));
    const node = postId ? await graph.readDeep(`${NS}/posts/${postId}`, 2) : null;
    if (!node) return json(res, 404, { error: 'not_found' }), true;
    json(res, 200, node);
    return true;
  }

  // ── /db/* — HTTP window onto the Gun graph ────────────────────────────────
  if (method === 'GET' && pathname === '/db/soul') {
    const soul = sanitizeSoul(searchParams.get('soul') || '');
    if (!soul) return json(res, 400, { error: 'invalid soul' }), true;
    const data = graph.has(soul) ? await graph.readSoul(soul) : null;
    if (!data) return json(res, 404, { soul, data: null }), true;
    json(res, 200, { soul, data });
    return true;
  }

  if (method === 'GET' && pathname === '/db/search') {
    const prefix = sanitizeSoul(searchParams.get('prefix') || '');
    if (!prefix) return json(res, 400, { error: 'invalid prefix' }), true;
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 500);
    const entries = graph.soulsWithPrefix(prefix, limit);
    const results = await Promise.all(entries.map(async entry => ({
      soul: entry.soul,
      data: await graph.readSoul(entry.soul),
    })));
    json(res, 200, { results: results.filter(row => row.data) });
    return true;
  }

  if (method === 'POST' && pathname === '/db/write') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false }), true; }
    const soul = sanitizeSoul(body.soul || '');
    if (!soul || !body.data || typeof body.data !== 'object') {
      return json(res, 400, { ok: false, reason: 'soul and data are required' }), true;
    }
    if (!isWritableSoul(soul)) {
      return json(res, 403, { ok: false, reason: 'soul is not writable over /db/write' }), true;
    }
    graph.writeSoul(soul, body.data);
    json(res, 200, { ok: true });
    return true;
  }

  // ── lite client ───────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/lite/poll') {
    let body;
    try { body = await readBody(req); } catch (err) { return json(res, 400, { error: err.message }), true; }

    const question = sanitizeString(String(body.question || ''), MAX_QUESTION).trim();
    const rawOptions = Array.isArray(body.options) ? body.options : [];
    const options = rawOptions
      .map(text => sanitizeString(String(text || ''), MAX_OPTION_TEXT).trim())
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);

    if (!question) return json(res, 400, { error: 'A question is required' }), true;
    if (options.length < 2) return json(res, 400, { error: 'At least two options are required' }), true;

    const hours = Math.min(Math.max(Number(body.durationHours) || 24, 0.1), 24 * 365);
    const now = Date.now();
    const pollId = `poll-${now}-${crypto.randomBytes(4).toString('hex')}`;
    const poll = {
      id: pollId,
      communityId: '',
      authorId: sanitizeId(body.authorId) || 'anonymous',
      authorName: sanitizeString(String(body.authorName || ''), 60) || 'anonymous',
      question,
      description: sanitizeString(String(body.description || ''), 2000),
      options: options.map((text, index) => ({ id: `${pollId}-option-${index}`, text, votes: 0 })),
      createdAt: now,
      expiresAt: now + hours * 3600_000,
      allowMultipleChoices: !!body.allowMultipleChoices,
      showResultsBeforeVoting: body.showResultsBeforeVoting !== false,
      totalVotes: 0,
    };
    writePoll(poll);
    json(res, 200, { poll });
    return true;
  }

  const litePollMatch = pathname.match(/^\/api\/lite\/poll\/([^/]+)$/);
  if (method === 'GET' && litePollMatch) {
    const poll = await loadPoll(sanitizeId(decodeURIComponent(litePollMatch[1])) || '');
    if (!poll) return json(res, 404, { error: 'This poll has expired or was never on this instance.' }), true;
    json(res, 200, { poll });
    return true;
  }

  if (method === 'POST' && pathname === '/api/lite/vote') {
    let body;
    try { body = await readBody(req); } catch (err) { return json(res, 400, { error: err.message }), true; }

    const pollId = sanitizeId(body.pollId);
    const deviceId = sanitizeId(body.deviceId);
    const optionIds = (Array.isArray(body.optionIds) ? body.optionIds : [])
      .map(id => sanitizeId(id)).filter(Boolean);
    if (!pollId || !deviceId || optionIds.length === 0) {
      return json(res, 400, { error: 'pollId, deviceId and at least one option are required' }), true;
    }

    const poll = await loadPoll(pollId);
    if (!poll) return json(res, 404, { error: 'This poll has expired or was never on this instance.' }), true;
    if (poll.isExpired) return json(res, 410, { error: 'This poll has closed.' }), true;
    if (!poll.allowMultipleChoices && optionIds.length > 1) {
      return json(res, 400, { error: 'This poll accepts a single choice.' }), true;
    }

    const key = `${pollId}:${deviceId}`;
    if (recordedVotes.has(key)) {
      return json(res, 409, { error: 'This device has already voted on this poll.' }), true;
    }

    const chosen = poll.options.filter(option => optionIds.includes(option.id));
    if (chosen.length !== optionIds.length) {
      return json(res, 400, { error: 'Unknown option for this poll.' }), true;
    }

    // Vote counts are leaf writes on the option node, exactly as the full
    // client does it — so both clients converge on the same tallies.
    for (const option of chosen) {
      const index = poll.options.findIndex(candidate => candidate.id === option.id);
      graph.writeSoul(`${NS}/polls/${pollId}/options/${index}`, { votes: option.votes + 1 });
    }
    recordedVotes.set(key, Date.now());
    graph.writeSoul(`${NS}/polls/${pollId}`, { totalVotes: poll.totalVotes + chosen.length });

    const receipt = makeReceipt({ pollId, optionIds, deviceId, pubkey: body.pubkey, signature: body.signature });
    const updated = await loadPoll(pollId);
    // Same event name and payload shape the full client broadcasts after a vote
    // (src/stores/pollStore.ts), so both clients refresh from one message.
    ctx.hub.broadcast({ type: 'poll-updated', data: updated, timestamp: Date.now() });
    json(res, 200, { ok: true, receipt, poll: updated });
    return true;
  }

  const receiptMatch = pathname.match(/^\/api\/lite\/receipt\/([^/]+)$/);
  if (method === 'GET' && receiptMatch) {
    const code = decodeURIComponent(receiptMatch[1]).toUpperCase();
    const receipt = receipts.get(code);
    if (!receipt) return json(res, 404, { error: 'No receipt with that code on this instance.' }), true;
    json(res, 200, { receipt });
    return true;
  }

  json(res, 404, { error: 'not_found', path: pathname });
  return true;
}
