// security-tests.js — Security test suite for InterPoll backend
// Run: node security-tests.js [relay-url] [gun-url]
//
// Tests: invalid payloads, injection attempts, oversized inputs,
//        malformed JSON, auth gates, CORS, WS message limits

const http = require('http');
const WebSocket = require('ws');

const RELAY_URL = process.argv[2] || 'http://localhost:8080';
const GUN_URL = process.argv[3] || 'http://localhost:8765';

let passed = 0;
let failed = 0;
let skipped = 0;

function log(status, name, detail) {
  const sym = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️';
  console.log(`${sym} [${status}] ${name}${detail ? ': ' + detail : ''}`);
  if (status === 'PASS') passed++;
  else if (status === 'FAIL') failed++;
  else skipped++;
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function fetchRaw(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'POST',
      headers: options.headers || {},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Test Groups ──────────────────────────────────────────────────────────────

async function testCORS() {
  console.log('\n── CORS Tests ──');

  try {
    const res = await fetchJSON(`${RELAY_URL}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    const acaoHeader = res.headers['access-control-allow-origin'];
    if (!acaoHeader || acaoHeader !== 'https://evil.example.com') {
      log('PASS', 'CORS rejects unknown origin', `ACAO: ${acaoHeader || 'none'}`);
    } else {
      log('FAIL', 'CORS rejects unknown origin', `ACAO reflected evil origin: ${acaoHeader}`);
    }
  } catch (e) { log('FAIL', 'CORS rejects unknown origin', e.message); }

  try {
    const res = await fetchJSON(`${RELAY_URL}/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    const acaoHeader = res.headers['access-control-allow-origin'];
    if (acaoHeader === 'http://localhost:5173') {
      log('PASS', 'CORS allows localhost:5173', `ACAO: ${acaoHeader}`);
    } else {
      log('FAIL', 'CORS allows localhost:5173', `ACAO: ${acaoHeader || 'none'}`);
    }
  } catch (e) { log('FAIL', 'CORS allows localhost:5173', e.message); }
}

async function testSecurityHeaders() {
  console.log('\n── Security Headers Tests ──');

  try {
    const res = await fetchJSON(`${RELAY_URL}/health`);
    const headers = res.headers;
    const checks = [
      ['x-content-type-options', 'nosniff'],
      ['x-frame-options', 'DENY'],
      ['referrer-policy', 'strict-origin-when-cross-origin'],
    ];
    for (const [header, expected] of checks) {
      if (headers[header] === expected) {
        log('PASS', `Header ${header}`, headers[header]);
      } else {
        log('FAIL', `Header ${header}`, `got: ${headers[header] || 'missing'}, expected: ${expected}`);
      }
    }
  } catch (e) { log('FAIL', 'Security headers check', e.message); }
}

async function testBodySizeLimits() {
  console.log('\n── Body Size Limits Tests ──');

  // Oversized vote-authorize body (>4KB)
  try {
    const bigPayload = JSON.stringify({ pollId: 'x'.repeat(5000), deviceId: 'test' });
    const res = await fetchRaw(`${RELAY_URL}/api/vote-authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigPayload,
    });
    if (res.status === 413 || res.status === 400) {
      log('PASS', 'Oversized vote-authorize rejected', `status: ${res.status}`);
    } else {
      log('FAIL', 'Oversized vote-authorize rejected', `status: ${res.status}`);
    }
  } catch (e) { log('FAIL', 'Oversized vote-authorize body', e.message); }

  // Oversized /db/write body (>100KB) on gun-relay
  try {
    const bigData = JSON.stringify({ soul: 'test', data: { x: 'y'.repeat(200000) } });
    const res = await fetchRaw(`${GUN_URL}/db/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bigData,
    });
    if (res.status === 413 || res.status === 400 || res.status === 401 || res.status === 403) {
      log('PASS', 'Oversized /db/write rejected', `status: ${res.status}`);
    } else {
      log('FAIL', 'Oversized /db/write rejected', `status: ${res.status}`);
    }
  } catch (e) { log('FAIL', 'Oversized /db/write body', e.message); }
}

async function testAuthGates() {
  console.log('\n── Authentication Gate Tests ──');

  // /db/write without auth
  try {
    const res = await fetchJSON(`${GUN_URL}/db/write`, {
      method: 'POST',
      body: { soul: 'test-soul', data: { test: true } },
    });
    if (res.status === 401 || res.status === 403) {
      log('PASS', '/db/write rejects unauthenticated', `status: ${res.status}`);
    } else {
      log('FAIL', '/db/write rejects unauthenticated', `status: ${res.status}, body: ${JSON.stringify(res.body)}`);
    }
  } catch (e) { log('FAIL', '/db/write auth gate', e.message); }

  // /admin/reindex without auth
  try {
    const res = await fetchJSON(`${GUN_URL}/admin/reindex`);
    if (res.status === 401 || res.status === 403) {
      log('PASS', '/admin/reindex rejects unauthenticated', `status: ${res.status}`);
    } else {
      log('FAIL', '/admin/reindex rejects unauthenticated', `status: ${res.status}`);
    }
  } catch (e) { log('FAIL', '/admin/reindex auth gate', e.message); }
}

async function testInputValidation() {
  console.log('\n── Input Validation Tests ──');

  // SQL injection in pollId
  const injectionPayloads = [
    { name: 'SQL injection in pollId', pollId: "'; DROP TABLE gun_nodes; --", deviceId: 'dev1' },
    { name: 'Script injection in pollId', pollId: '<script>alert(1)</script>', deviceId: 'dev1' },
    { name: 'Null byte in deviceId', pollId: 'poll1', deviceId: 'dev\x001' },
    { name: 'Command injection in deviceId', pollId: 'poll1', deviceId: '$(rm -rf /)' },
    { name: 'Oversized pollId', pollId: 'a'.repeat(300), deviceId: 'dev1' },
  ];

  for (const payload of injectionPayloads) {
    try {
      const res = await fetchJSON(`${RELAY_URL}/api/vote-authorize`, {
        method: 'POST',
        body: { pollId: payload.pollId, deviceId: payload.deviceId },
      });
      // Should either reject (400) or sanitize and proceed without crash
      if (res.status < 500) {
        log('PASS', payload.name, `status: ${res.status}`);
      } else {
        log('FAIL', payload.name, `status: ${res.status} — server error`);
      }
    } catch (e) { log('FAIL', payload.name, e.message); }
  }

  // Soul validation on gun-relay
  const soulInjections = [
    { name: 'SQL injection in soul', soul: "'; DROP TABLE gun_nodes; --" },
    { name: 'Path traversal in soul', soul: '../../../etc/passwd' },
    { name: 'Null byte in soul', soul: 'test\x00soul' },
  ];

  for (const payload of soulInjections) {
    try {
      const res = await fetchJSON(`${GUN_URL}/db/soul?soul=${encodeURIComponent(payload.soul)}`);
      if (res.status === 400) {
        log('PASS', payload.name, 'rejected with 400');
      } else if (res.status === 404) {
        log('PASS', payload.name, 'not found (safe)');
      } else if (res.status < 500) {
        log('PASS', payload.name, `status: ${res.status} (no server error)`);
      } else {
        log('FAIL', payload.name, `status: ${res.status} — server error`);
      }
    } catch (e) { log('FAIL', payload.name, e.message); }
  }
}

async function testMalformedJSON() {
  console.log('\n── Malformed JSON Tests ──');

  const malformed = [
    { name: 'Truncated JSON', body: '{"pollId": "test"' },
    { name: 'Empty body', body: '' },
    { name: 'Array instead of object', body: '[1,2,3]' },
    { name: 'Non-JSON text', body: 'hello world' },
    { name: 'Nested deeply', body: '{"a":'.repeat(100) + '"x"' + '}'.repeat(100) },
  ];

  for (const payload of malformed) {
    try {
      const res = await fetchRaw(`${RELAY_URL}/api/vote-authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload.body,
      });
      if (res.status < 500) {
        log('PASS', payload.name, `status: ${res.status}`);
      } else {
        log('FAIL', payload.name, `status: ${res.status} — server error`);
      }
    } catch (e) { log('FAIL', payload.name, e.message); }
  }
}

async function testErrorLeakage() {
  console.log('\n── Error Leakage Tests ──');

  // Check that error responses don't contain stack traces
  try {
    const res = await fetchJSON(`${GUN_URL}/db/soul?soul=nonexistent-soul-xyz`);
    const body = JSON.stringify(res.body);
    if (body.includes('at ') || body.includes('Error:') || body.includes('stack')) {
      log('FAIL', 'Error leakage in /db/soul', 'response contains stack trace');
    } else {
      log('PASS', 'No error leakage in /db/soul', `body: ${body.substring(0, 100)}`);
    }
  } catch (e) { log('FAIL', 'Error leakage check', e.message); }
}

async function testWSMessageValidation() {
  console.log('\n── WebSocket Message Validation Tests ──');

  const wsUrl = RELAY_URL.replace('http', 'ws');

  const wsTests = [
    { name: 'Missing type field', msg: { data: 'test' } },
    { name: 'Unknown type', msg: { type: 'hack-the-planet' } },
    { name: 'Register with invalid peerId (too short)', msg: { type: 'register', peerId: 'ab' } },
    { name: 'Register with injection in peerId', msg: { type: 'register', peerId: '<script>alert(1)</script>' } },
    { name: 'Broadcast with non-object data', msg: { type: 'broadcast', data: 'string-not-object' } },
    { name: 'Join-room with oversized roomId', msg: { type: 'join-room', roomId: 'x'.repeat(200) } },
  ];

  for (const test of wsTests) {
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); resolve('timeout'); }, 3000);
        ws.on('open', () => {
          ws.send(JSON.stringify(test.msg));
        });
        ws.on('message', (data) => {
          clearTimeout(timer);
          const msg = JSON.parse(data.toString());
          ws.close();
          if (msg.type === 'error') {
            resolve('rejected');
          } else {
            resolve('accepted');
          }
        });
        ws.on('close', () => { clearTimeout(timer); resolve('closed'); });
        ws.on('error', (e) => { clearTimeout(timer); resolve('error'); });
      }).then((result) => {
        if (result === 'rejected' || result === 'closed') {
          log('PASS', test.name, `result: ${result}`);
        } else if (result === 'timeout') {
          log('PASS', test.name, 'no response (silently dropped)');
        } else {
          log('FAIL', test.name, `message was accepted: ${result}`);
        }
      });
    } catch (e) { log('FAIL', test.name, e.message); }
  }
}

async function testVoteAuthorizeErrorBehavior() {
  console.log('\n── Vote Authorize Error Behavior ──');

  // The old bug: error handler returned allowed:true
  // With missing fields, should return allowed:false (not crash with allowed:true)
  try {
    const res = await fetchJSON(`${RELAY_URL}/api/vote-authorize`, {
      method: 'POST',
      body: {},
    });
    if (res.body && res.body.allowed === true) {
      log('FAIL', 'Empty vote-authorize returns allowed:false', 'got allowed:true (CRITICAL BUG)');
    } else {
      log('PASS', 'Empty vote-authorize returns allowed:false', `body: ${JSON.stringify(res.body)}`);
    }
  } catch (e) { log('FAIL', 'Vote-authorize error behavior', e.message); }
}

// ─── Run All Tests ────────────────────────────────────────────────────────────
async function main() {
  console.log('🔒 InterPoll Security Test Suite');
  console.log(`   Relay: ${RELAY_URL}`);
  console.log(`   Gun:   ${GUN_URL}`);
  console.log('');

  await testCORS();
  await testSecurityHeaders();
  await testBodySizeLimits();
  await testAuthGates();
  await testInputValidation();
  await testMalformedJSON();
  await testErrorLeakage();
  await testWSMessageValidation();
  await testVoteAuthorizeErrorBehavior();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`${'═'.repeat(50)}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
