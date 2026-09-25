import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  CONTENT_POW_MAX_AGE_MS,
  CONTENT_POW_MIN_BITS,
  sha256Hex,
  solveContentPow,
  verifyContentPow,
} from '../shared-validation/contentPow.js';
import { classifySoul, createContentFirewall, installContentFirewall } from '../content-firewall.js';
import { EventEmitter } from 'events';

const NOW = 1_790_000_000_000;

function stampedPost(id, createdAt = NOW, authorId = 'author-1') {
  const powNonce = solveContentPow({ kind: 'post', id, createdAt, authorId });
  return { id, title: 'Hello', content: 'World', createdAt, authorId, powNonce };
}

function frame(soul, node, msgId = 'm1') {
  return JSON.stringify({ '#': msgId, put: { [soul]: { _: { '#': soul, '>': {} }, ...node } } });
}

function firewall(existing = new Set(), extra = {}) {
  return createContentFirewall({
    soulExists: async (soul) => existing.has(soul),
    now: () => NOW,
    log: () => {},
    ...extra,
  });
}

describe('contentPow', () => {
  it('sha256Hex matches node crypto across block boundaries', () => {
    for (const len of [0, 3, 55, 56, 63, 64, 65, 200]) {
      const s = 'a'.repeat(len);
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'latin1').digest('hex'));
    }
  });

  it('binds the stamp to kind, id, createdAt and author', () => {
    const rec = { kind: 'post', id: 'post-1', createdAt: NOW, authorId: 'a' };
    const powNonce = solveContentPow(rec);
    expect(verifyContentPow({ ...rec, powNonce })).toBe(true);
    expect(verifyContentPow({ ...rec, id: 'post-2', powNonce })).toBe(false);
    expect(verifyContentPow({ ...rec, kind: 'comment', powNonce })).toBe(false);
    expect(verifyContentPow({ ...rec, createdAt: NOW + 1, powNonce })).toBe(false);
    expect(verifyContentPow({ ...rec, authorId: 'b', powNonce })).toBe(false);
    expect(verifyContentPow({ ...rec, powNonce: 'x' })).toBe(false);
  });

  it('enforces freshness only when asked', () => {
    const old = NOW - CONTENT_POW_MAX_AGE_MS - 1;
    const rec = { kind: 'poll', id: 'poll-1', createdAt: old, authorId: '' };
    const powNonce = solveContentPow(rec);
    expect(verifyContentPow({ ...rec, powNonce })).toBe(true);
    expect(verifyContentPow({ ...rec, powNonce }, { fresh: true, now: NOW })).toBe(false);
  });

  it('uses a meaningful minimum difficulty', () => {
    expect(CONTENT_POW_MIN_BITS).toBeGreaterThanOrEqual(18);
  });
});

describe('content firewall', () => {
  it('classifies only content item souls', () => {
    expect(classifySoul('v5/posts/post-1')).toEqual({ kind: 'post', id: 'post-1' });
    expect(classifySoul('v5/communities/c-x/polls/poll-1')).toEqual({ kind: 'poll', id: 'poll-1' });
    expect(classifySoul('v5/comments/comment_1_a')).toEqual({ kind: 'comment', id: 'comment_1_a' });
    expect(classifySoul('v5/posts')).toBeNull();
    expect(classifySoul('v5/posts/post-1/comments/c1')).toBeNull();
    expect(classifySoul('v5/polls/poll-1/options')).toBeNull();
    expect(classifySoul('v5/postVotes/post-1/user')).toBeNull();
  });

  it('accepts a stamped new post and passes the frame through unchanged', async () => {
    const raw = frame('v5/posts/post-a', stampedPost('post-a'));
    const out = await firewall().filterFrame(raw, '1.1.1.1');
    expect(out.rejected).toEqual([]);
    expect(out.raw).toBe(raw);
  });

  it('rejects an unstamped new post', async () => {
    const raw = frame('v5/posts/post-b', { id: 'post-b', title: 'spam', createdAt: NOW });
    const out = await firewall().filterFrame(raw, '1.1.1.1');
    expect(out.raw).toBeNull();
    expect(out.rejected).toEqual([{ id: 'm1', err: 'content-pow-required' }]);
  });

  it('rejects metadata-only creation too (no smuggling content in later)', async () => {
    const raw = frame('v5/posts/post-c', { authorName: 'x' });
    expect((await firewall().filterFrame(raw, 'ip')).rejected).toHaveLength(1);
  });

  it('allows unstamped writes to content the relay already holds', async () => {
    const soul = 'v5/comments/comment_1_old';
    const raw = frame(soul, { content: 'edited', createdAt: 1 });
    const out = await firewall(new Set([soul])).filterFrame(raw, 'ip');
    expect(out.rejected).toEqual([]);
  });

  it('rejects a stale stamp on unknown content', async () => {
    const post = stampedPost('post-old', NOW - CONTENT_POW_MAX_AGE_MS - 60_000);
    const out = await firewall().filterFrame(frame('v5/posts/post-old', post), 'ip');
    expect(out.rejected[0]?.err).toBe('content-pow-required');
  });

  it('rate-limits creations per IP but charges root + community copies once', async () => {
    const fw = firewall(new Set(), { limits: { perMinute: 2, perHour: 10 } });
    const posts = ['post-r1', 'post-r2', 'post-r3'].map(id => stampedPost(id));
    for (const p of posts.slice(0, 2)) {
      expect((await fw.filterFrame(frame(`v5/posts/${p.id}`, p), 'ip-a')).rejected).toEqual([]);
      expect((await fw.filterFrame(frame(`v5/communities/c1/posts/${p.id}`, p), 'ip-a')).rejected).toEqual([]);
    }
    const third = await fw.filterFrame(frame('v5/posts/post-r3', posts[2]), 'ip-a');
    expect(third.rejected[0]?.err).toBe('rate-limited');
    // Another IP is unaffected.
    expect((await fw.filterFrame(frame('v5/posts/post-r3', posts[2]), 'ip-b')).rejected).toEqual([]);
  });

  it('drops only the offending message from a batched frame', async () => {
    const good = { '#': 'g', get: { '#': 'v5/posts' } };
    const bad = JSON.parse(frame('v5/polls/poll-x', { question: 'spam?', createdAt: NOW }, 'b'));
    const out = await firewall().filterFrame(JSON.stringify([good, bad]), 'ip');
    expect(JSON.parse(out.raw)).toEqual([good]);
    expect(out.rejected).toEqual([{ id: 'b', err: 'content-pow-required' }]);
  });

  it('ignores frames without puts and non-content souls', async () => {
    const fw = firewall();
    const get = JSON.stringify({ '#': 'x', get: { '#': 'v5/posts', '.': 'post-1' } });
    expect((await fw.filterFrame(get, 'ip')).raw).toBe(get);
    const vote = frame('v5/postVotes/post-1/u1', { envelope: '{}' });
    expect((await fw.filterFrame(vote, 'ip')).raw).toBe(vote);
  });

  it('log mode reports but lets writes through', async () => {
    const logs = [];
    const fw = firewall(new Set(), { mode: 'log', log: m => logs.push(m) });
    const raw = frame('v5/posts/post-l', { title: 'x', createdAt: NOW });
    const out = await fw.filterFrame(raw, 'ip');
    expect(out.rejected).toEqual([]);
    expect(out.raw).toBe(raw);
    expect(logs[0]).toMatch(/would reject/);
  });

  it('installContentFirewall filters messages before other listeners and error-acks rejects', async () => {
    const ws = new EventEmitter();
    ws.readyState = 1;
    const sent = [];
    ws.send = (m) => sent.push(JSON.parse(m));
    installContentFirewall(ws, { headers: { 'x-real-ip': '9.9.9.9' } }, firewall());
    const seen = [];
    ws.on('message', (m) => seen.push(m));

    const okRaw = frame('v5/posts/post-w', stampedPost('post-w'), 'ok1');
    ws.emit('message', frame('v5/posts/post-spam', { title: 'x', createdAt: NOW }, 'bad1'));
    ws.emit('message', okRaw);
    await new Promise(r => setTimeout(r, 20));

    expect(seen).toEqual([okRaw]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ '@': 'bad1', err: 'content-pow-required' });
  });
});
