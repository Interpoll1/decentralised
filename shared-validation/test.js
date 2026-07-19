import assert from 'assert';
import crypto from 'crypto';
import { validateMessage, validateHttpRequest, validateSearchQuery, validateSoulPath, KNOWN_WS_TYPES } from './index.js';
import { canonicalJSON, computeHash, verifyContentHash, META_FIELDS } from './integrity.js';
import { verifySignature, generateKeyPair, signMessage } from './signatures.js';
import { verifyPoW, computePoW, hasLeadingZeroBits, POW_DIFFICULTY, POW_EXEMPT } from './pow.js';
import { ReplayProtector } from './replay.js';
import { ErrorCodes, makeError, makeHttpError } from './errors.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n1. Schema Validation (WebSocket)');
// ═══════════════════════════════════════════════════════════════════════════════

test('valid ping message', () => {
  const r = validateMessage('ping', { type: 'ping' });
  assert.strictEqual(r.valid, true);
});

test('valid register message', () => {
  const r = validateMessage('register', { type: 'register', peerId: 'abc123' });
  assert.strictEqual(r.valid, true);
});

test('register missing peerId', () => {
  const r = validateMessage('register', { type: 'register' });
  assert.strictEqual(r.valid, false);
});

test('unknown type rejected', () => {
  const r = validateMessage('evil-type', { type: 'evil-type' });
  assert.strictEqual(r.valid, false);
});

test('broadcast requires data object', () => {
  const r = validateMessage('broadcast', { type: 'broadcast', data: { foo: 1 } });
  assert.strictEqual(r.valid, true);
});

test('broadcast without data fails', () => {
  const r = validateMessage('broadcast', { type: 'broadcast' });
  assert.strictEqual(r.valid, false);
});

test('new-poll requires pollId', () => {
  const r = validateMessage('new-poll', { type: 'new-poll' });
  assert.strictEqual(r.valid, false);
});

test('valid new-poll', () => {
  const r = validateMessage('new-poll', { type: 'new-poll', pollId: 'poll-123' });
  assert.strictEqual(r.valid, true);
});

test('integrity fields accepted on any message', () => {
  const r = validateMessage('broadcast', {
    type: 'broadcast', data: {}, _hash: 'abc', _sig: 'def', _pub: 'ghi', _pow: 'jkl', _ts: 123, _nonce: 'xyz'
  });
  assert.strictEqual(r.valid, true);
});

test('ping rejects additional properties', () => {
  const r = validateMessage('ping', { type: 'ping', evil: true });
  assert.strictEqual(r.valid, false);
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n2. HTTP Request Validation');
// ═══════════════════════════════════════════════════════════════════════════════

test('valid vote-authorize', () => {
  const r = validateHttpRequest('vote-authorize', { pollId: 'p1', deviceId: 'd1' });
  assert.strictEqual(r.valid, true);
});

test('valid vote-confirm', () => {
  const r = validateHttpRequest('vote-confirm', { pollId: 'p1', deviceId: 'd1' });
  assert.strictEqual(r.valid, true);
});

test('vote-authorize missing pollId', () => {
  const r = validateHttpRequest('vote-authorize', { deviceId: 'd1' });
  assert.strictEqual(r.valid, false);
});

test('vote-authorize missing deviceId', () => {
  const r = validateHttpRequest('vote-authorize', { pollId: 'p1' });
  assert.strictEqual(r.valid, false);
});

test('valid receipt', () => {
  const r = validateHttpRequest('receipt', { type: 'receipt', payload: {} });
  assert.strictEqual(r.valid, true);
});

test('receipt wrong type value', () => {
  const r = validateHttpRequest('receipt', { type: 'wrong', payload: {} });
  assert.strictEqual(r.valid, false);
});

test('valid index request', () => {
  const r = validateHttpRequest('index', { type: 'post', id: 'post-1', data: {} });
  assert.strictEqual(r.valid, true);
});

test('index missing data', () => {
  const r = validateHttpRequest('index', { type: 'post', id: 'post-1' });
  assert.strictEqual(r.valid, false);
});

test('unknown endpoint', () => {
  const r = validateHttpRequest('evil-endpoint', {});
  assert.strictEqual(r.valid, false);
});

test('vote-authorize allows extra fields', () => {
  const r = validateHttpRequest('vote-authorize', { pollId: 'p1', deviceId: 'd1', _hash: 'abc', extra: true });
  assert.strictEqual(r.valid, true);
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n3. Search/Soul Validation');
// ═══════════════════════════════════════════════════════════════════════════════

test('valid search query', () => {
  const r = validateSearchQuery('hello world');
  assert.strictEqual(r, 'hello world');
});

test('empty search query returns null', () => {
  assert.strictEqual(validateSearchQuery(''), null);
});

test('search query strips control chars', () => {
  const r = validateSearchQuery('hello\x00world');
  assert.strictEqual(r, 'helloworld');
});

test('search query too long returns null', () => {
  assert.strictEqual(validateSearchQuery('a'.repeat(201), 200), null);
});

test('non-string search returns null', () => {
  assert.strictEqual(validateSearchQuery(123), null);
});

test('valid soul path', () => {
  assert.strictEqual(validateSoulPath('v2/polls/poll-123'), true);
});

test('soul path with traversal rejected', () => {
  assert.strictEqual(validateSoulPath('v2/../etc/passwd'), false);
});

test('soul path with invalid chars rejected', () => {
  assert.strictEqual(validateSoulPath('v2/polls/<script>'), false);
});

test('empty soul path rejected', () => {
  assert.strictEqual(validateSoulPath(''), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n4. Content Hash Integrity');
// ═══════════════════════════════════════════════════════════════════════════════

test('canonicalJSON strips meta fields', () => {
  const obj = { type: 'test', data: 1, _hash: 'abc', _sig: 'def', _pub: 'ghi' };
  const json = canonicalJSON(obj);
  assert.ok(!json.includes('_hash'));
  assert.ok(!json.includes('_sig'));
  assert.ok(json.includes('type'));
});

test('canonicalJSON sorts keys', () => {
  const a = canonicalJSON({ z: 1, a: 2 });
  const b = canonicalJSON({ a: 2, z: 1 });
  assert.strictEqual(a, b);
});

test('canonicalJSON handles nested objects', () => {
  const json = canonicalJSON({ data: { b: 2, a: 1 } });
  assert.ok(json.includes('"a":1'));
  assert.ok(json.indexOf('"a"') < json.indexOf('"b"'));
});

test('computeHash returns hex string', () => {
  const hash = computeHash({ type: 'test' });
  assert.strictEqual(typeof hash, 'string');
  assert.strictEqual(hash.length, 64);
  assert.ok(/^[0-9a-f]+$/.test(hash));
});

test('computeHash is deterministic', () => {
  const h1 = computeHash({ type: 'test', data: { a: 1 } });
  const h2 = computeHash({ type: 'test', data: { a: 1 } });
  assert.strictEqual(h1, h2);
});

test('computeHash ignores meta fields', () => {
  const h1 = computeHash({ type: 'test' });
  const h2 = computeHash({ type: 'test', _hash: 'abc', _sig: 'def' });
  assert.strictEqual(h1, h2);
});

test('verifyContentHash succeeds for valid hash', () => {
  const msg = { type: 'test', data: 'hello' };
  msg._hash = computeHash(msg);
  assert.strictEqual(verifyContentHash(msg), true);
});

test('verifyContentHash fails for tampered message', () => {
  const msg = { type: 'test', data: 'hello' };
  msg._hash = computeHash(msg);
  msg.data = 'tampered';
  assert.strictEqual(verifyContentHash(msg), false);
});

test('verifyContentHash fails for missing hash', () => {
  assert.strictEqual(verifyContentHash({ type: 'test' }), false);
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n5. Signature Verification');
// ═══════════════════════════════════════════════════════════════════════════════

test('generateKeyPair returns valid structure', () => {
  const kp = generateKeyPair();
  assert.ok(kp.publicKey);
  assert.ok(kp.privateKey);
  assert.strictEqual(typeof kp.publicKey, 'string');
  assert.strictEqual(typeof kp.privateKey, 'string');
  assert.match(kp.publicKey, /^[0-9a-f]{64}$/);
  assert.match(kp.privateKey, /^[0-9a-f]{64}$/);
});

test('signMessage adds _pub and _sig', () => {
  const kp = generateKeyPair();
  const msg = { type: 'test', data: 'hello' };
  const signed = signMessage(msg, kp);
  assert.ok(signed._pub);
  assert.ok(signed._sig);
  assert.strictEqual(signed.type, 'test');
});

test('verifySignature succeeds for valid signature', () => {
  const kp = generateKeyPair();
  const msg = { type: 'test', data: 'hello' };
  const signed = signMessage(msg, kp);
  assert.strictEqual(verifySignature(signed), true);
});

test('verifySignature fails for tampered message', () => {
  const kp = generateKeyPair();
  const msg = { type: 'test', data: 'hello' };
  const signed = signMessage(msg, kp);
  signed.data = 'tampered';
  assert.strictEqual(verifySignature(signed), false);
});

test('verifySignature fails for wrong key', () => {
  const kp1 = generateKeyPair();
  const kp2 = generateKeyPair();
  const msg = { type: 'test', data: 'hello' };
  const signed = signMessage(msg, kp1);
  signed._pub = kp2.publicKey;
  assert.strictEqual(verifySignature(signed), false);
});

test('verifySignature fails for missing fields', () => {
  assert.strictEqual(verifySignature({}), false);
  assert.strictEqual(verifySignature(null), false);
  assert.strictEqual(verifySignature({ _pub: 'x' }), false);
});

test('verifySignature fails for invalid hex', () => {
  assert.strictEqual(verifySignature({ _pub: 'zzzz'.repeat(16), _sig: 'zzzz'.repeat(32) }), false);
});

test('verifySignature fails for wrong-length pubkey', () => {
  assert.strictEqual(verifySignature({ _pub: 'aa'.repeat(16), _sig: 'bb'.repeat(64) }), false);
});

test('signMessage preserves original message fields', () => {
  const kp = generateKeyPair();
  const msg = { type: 'broadcast', data: { nested: true }, extra: 42 };
  const signed = signMessage(msg, kp);
  assert.strictEqual(signed.extra, 42);
  assert.deepStrictEqual(signed.data, { nested: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n6. Proof-of-Work');
// ═══════════════════════════════════════════════════════════════════════════════

test('hasLeadingZeroBits works correctly', () => {
  assert.strictEqual(hasLeadingZeroBits('0000ffff', 16), true);
  assert.strictEqual(hasLeadingZeroBits('0000ffff', 17), false);
  assert.strictEqual(hasLeadingZeroBits('00ffffff', 8), true);
  assert.strictEqual(hasLeadingZeroBits('00ffffff', 9), false);
});

test('computePoW produces valid nonce', () => {
  const hash = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
  const nonce = computePoW(hash, 8);
  assert.ok(typeof nonce === 'string');
  const input = hash + ':' + nonce;
  const result = crypto.createHash('sha256').update(input).digest('hex');
  assert.strictEqual(hasLeadingZeroBits(result, 8), true);
});

test('verifyPoW succeeds for valid PoW', () => {
  const msg = { type: 'broadcast', data: {} };
  const hash = computeHash(msg);
  msg._hash = hash;
  const difficulty = POW_DIFFICULTY['broadcast'];
  msg._pow = computePoW(hash, difficulty);
  assert.strictEqual(verifyPoW(msg), true);
});

test('verifyPoW fails for invalid PoW', () => {
  const msg = { type: 'broadcast', data: {}, _hash: 'abc'.repeat(21) + 'a', _pow: 'wrong' };
  assert.strictEqual(verifyPoW(msg), false);
});

test('verifyPoW skips exempt types', () => {
  assert.strictEqual(verifyPoW({ type: 'ping' }), true);
  assert.strictEqual(verifyPoW({ type: 'register' }), true);
});

test('verifyPoW fails for missing fields', () => {
  assert.strictEqual(verifyPoW({ type: 'broadcast', data: {} }), false);
  assert.strictEqual(verifyPoW(null), false);
});

test('POW_EXEMPT contains expected types', () => {
  assert.ok(POW_EXEMPT.has('ping'));
  assert.ok(POW_EXEMPT.has('register'));
  assert.ok(POW_EXEMPT.has('join-room'));
  assert.ok(!POW_EXEMPT.has('broadcast'));
  assert.ok(!POW_EXEMPT.has('new-poll'));
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n7. Replay Protection');
// ═══════════════════════════════════════════════════════════════════════════════

test('fresh message accepted', () => {
  const rp = new ReplayProtector();
  const r = rp.check({ type: 'broadcast', data: {}, _ts: Date.now(), _nonce: 'unique-1' });
  assert.strictEqual(r.fresh, true);
  rp.destroy();
});

test('duplicate nonce rejected', () => {
  const rp = new ReplayProtector();
  const msg = { type: 'broadcast', data: {}, _ts: Date.now(), _nonce: 'dup-1' };
  rp.check(msg);
  const r = rp.check({ ...msg, _nonce: 'dup-1' });
  assert.strictEqual(r.fresh, false);
  assert.ok(r.reason.includes('duplicate'));
  rp.destroy();
});

test('expired timestamp rejected', () => {
  const rp = new ReplayProtector();
  const r = rp.check({ type: 'broadcast', data: {}, _ts: Date.now() - 60_000, _nonce: 'old-1' });
  assert.strictEqual(r.fresh, false);
  assert.ok(r.reason.includes('drift'));
  rp.destroy();
});

test('missing _ts rejected for protected type', () => {
  const rp = new ReplayProtector();
  const r = rp.check({ type: 'broadcast', data: {}, _nonce: 'n1' });
  assert.strictEqual(r.fresh, false);
  rp.destroy();
});

test('missing _nonce rejected for protected type', () => {
  const rp = new ReplayProtector();
  const r = rp.check({ type: 'broadcast', data: {}, _ts: Date.now() });
  assert.strictEqual(r.fresh, false);
  rp.destroy();
});

test('exempt type skips replay check', () => {
  const rp = new ReplayProtector();
  const r = rp.check({ type: 'ping' });
  assert.strictEqual(r.fresh, true);
  rp.destroy();
});

test('nonce too long rejected', () => {
  const rp = new ReplayProtector();
  const r = rp.check({ type: 'broadcast', data: {}, _ts: Date.now(), _nonce: 'x'.repeat(65) });
  assert.strictEqual(r.fresh, false);
  assert.ok(r.reason.includes('too long'));
  rp.destroy();
});

test('invalid message rejected', () => {
  const rp = new ReplayProtector();
  assert.strictEqual(rp.check(null).fresh, false);
  assert.strictEqual(rp.check(undefined).fresh, false);
  rp.destroy();
});

test('different nonces both accepted', () => {
  const rp = new ReplayProtector();
  const now = Date.now();
  assert.strictEqual(rp.check({ type: 'new-poll', pollId: 'p1', _ts: now, _nonce: 'a1' }).fresh, true);
  assert.strictEqual(rp.check({ type: 'new-poll', pollId: 'p2', _ts: now, _nonce: 'a2' }).fresh, true);
  rp.destroy();
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n8. Error Helpers');
// ═══════════════════════════════════════════════════════════════════════════════

test('makeError produces correct structure', () => {
  const err = makeError(ErrorCodes.SCHEMA_INVALID, 'bad field');
  assert.strictEqual(err.type, 'error');
  assert.strictEqual(err.code, 'SCHEMA_INVALID');
  assert.deepStrictEqual(err.details, ['bad field']);
  assert.ok(typeof err.timestamp === 'number');
});

test('makeError wraps array details', () => {
  const err = makeError(ErrorCodes.HASH_MISMATCH, ['a', 'b']);
  assert.deepStrictEqual(err.details, ['a', 'b']);
});

test('makeHttpError includes statusCode', () => {
  const err = makeHttpError(ErrorCodes.PAYLOAD_TOO_LARGE, 413, 'too big');
  assert.strictEqual(err.statusCode, 413);
  assert.strictEqual(err.body.code, 'PAYLOAD_TOO_LARGE');
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n9. Integration: Full Pipeline');
// ═══════════════════════════════════════════════════════════════════════════════

test('full pipeline: sign → hash → pow → verify all pass', () => {
  const kp = generateKeyPair();
  let msg = { type: 'broadcast', data: { text: 'hello world' } };
  // 1. Sign
  msg = signMessage(msg, kp);
  // 2. Hash
  msg._hash = computeHash(msg);
  // 3. PoW
  const difficulty = POW_DIFFICULTY['broadcast'];
  msg._pow = computePoW(msg._hash, difficulty);
  // 4. Add replay fields
  msg._ts = Date.now();
  msg._nonce = 'integration-test-nonce-1';

  // Verify all stages
  assert.strictEqual(verifySignature(msg), true, 'signature should verify');
  assert.strictEqual(verifyContentHash(msg), true, 'hash should verify');
  assert.strictEqual(verifyPoW(msg), true, 'PoW should verify');
  const rp = new ReplayProtector();
  assert.strictEqual(rp.check(msg).fresh, true, 'replay check should pass');
  rp.destroy();
});

test('full pipeline: tampered message fails at hash stage', () => {
  const kp = generateKeyPair();
  let msg = { type: 'broadcast', data: { text: 'hello' } };
  msg = signMessage(msg, kp);
  msg._hash = computeHash(msg);
  msg._pow = computePoW(msg._hash, POW_DIFFICULTY['broadcast']);
  msg._ts = Date.now();
  msg._nonce = 'integration-test-nonce-2';

  // Tamper
  msg.data.text = 'EVIL';

  // Hash check should fail
  assert.strictEqual(verifyContentHash(msg), false);
});

test('full pipeline: schema validates then integrity validates', () => {
  const kp = generateKeyPair();
  let msg = { type: 'new-poll', pollId: 'poll-integration-1' };
  msg = signMessage(msg, kp);
  msg._hash = computeHash(msg);
  msg._pow = computePoW(msg._hash, POW_DIFFICULTY['new-poll']);
  msg._ts = Date.now();
  msg._nonce = 'integration-test-nonce-3';

  // Schema validates
  const schemaResult = validateMessage('new-poll', msg);
  assert.strictEqual(schemaResult.valid, true);

  // Integrity validates
  assert.strictEqual(verifyContentHash(msg), true);
  assert.strictEqual(verifySignature(msg), true);
  assert.strictEqual(verifyPoW(msg), true);
});

// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
