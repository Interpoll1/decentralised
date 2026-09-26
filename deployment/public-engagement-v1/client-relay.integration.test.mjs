// Local callback composition only. No server/listener/network/production DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { signAction } from '../../shared-validation/engagement.js';

if (!process.env.REVIEW_BACKEND_DIR) throw new Error('Set REVIEW_BACKEND_DIR to the disposable verified patched backend copy');
const { handleEngagement } = await import(pathToFileURL(resolve(process.env.REVIEW_BACKEND_DIR, 'shared-validation/engagement-http.js')));
const source = readFileSync(new URL('../../src/services/publicEngagementService.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('client.ts', source, ts.ScriptTarget.Latest, true);
const needed = new Set(['createPublicAction', 'publishReaction', 'ReactionPublishError']);
const selected = tree.statements.filter(n => n.name && needed.has(n.name.getText(tree))).map(n => n.getText(tree).replace(/^export /, '')).join('\n');
const compiled = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = '01'.padStart(64, '0'); // Synthetic fixture, not user credentials.
const actor = bytesToHex(schnorr.getPublicKey(hexToBytes(key)));

function local({ loseFirst = false, genericReceipt = false } = {}) {
  const committed = new Map(), requests = [];
  const chain = { get() { return chain; } };
  let lose = loseFirst;
  const fetch = async (_url, options) => {
    requests.push(options.body);
    const req = new EventEmitter();
    const res = { headersSent: false, status: 0, value: null,
      writeHead(status) { this.status = status; this.headersSent = true; }, end(body) { this.value = JSON.parse(body); } };
    const request = handleEngagement(req, res, { db: {}, namespace: 'v5', accept: async (_db, a) => {
      const duplicate = committed.has(a.id); committed.set(a.id, a);
      return { status: duplicate ? 'duplicate' : 'accepted' };
    } });
    req.emit('data', Buffer.from(options.body)); req.emit('end'); await request;
    if (lose) { lose = false; throw new Error('response lost after commit'); }
    return { ok: res.status === 200, status: res.status, json: async () => genericReceipt ? { ok: true } : res.value };
  };
  const client = vm.runInNewContext(compiled + '\n({createPublicAction,publishReaction})', {
    StorageService: { getMetadata: async () => ({ privateKey: key, publicKey: actor }) },
    GunService: { getGun: () => chain }, gunPut: async () => ({ ok: true }),
    crypto: webcrypto, signAction, GUN_NAMESPACE: 'v5', config: { relay: { api: 'https://offline.invalid' } }, fetch, AbortSignal,
  });
  return { client, committed, requests };
}

test('actual client signing/publishing and backend handler agree on accepted receipt', async () => {
  const { client, committed } = local();
  const a = await client.createPublicAction(actor, 'reaction', 'post', 'post-review', 'up');
  await client.publishReaction(a); assert.equal(committed.size, 1); assert.equal(committed.get(a.id).actor, actor);
});
test('response lost after commit retries identical envelope and receives duplicate receipt', async () => {
  const { client, committed, requests } = local({ loseFirst: true });
  await client.publishReaction(await client.createPublicAction(actor, 'reaction', 'comment', 'comment-review', 'down'));
  assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]); assert.equal(committed.size, 1);
});
test('malformed signed context is rejected before acceptance, never unsigned fallback', async () => {
  const { client, committed, requests } = local();
  const a = await client.createPublicAction(actor, 'reaction', 'post', 'post-review', 'up');
  await assert.rejects(client.publishReaction({ ...a, targetId: 'post-swapped' }), /ENGAGEMENT_REJECTED/);
  assert.equal(committed.size, 0); assert.equal(requests.length, 1);
});
test('generic legacy server ok cannot satisfy upgraded client evidence', async () => {
  const { client } = local({ genericReceipt: true });
  await assert.rejects(client.publishReaction(await client.createPublicAction(actor, 'reaction', 'post', 'post-review', 'up')), /ENGAGEMENT_REJECTED/);
});
