import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImpactWorkerV2 } from './host.mjs';
import { analyzeSnapshot } from './core.mjs';
import { demo, publicKey, attest } from '../coordination-impact/fixtures.mjs';
import { parseExecutionArgs } from './options.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const s = demo(), observer = publicKey(9999), raw = Buffer.from(JSON.stringify(s));
test('isolated v2 worker reproduces pure API and freshly verifies receipts', async () => {
  const host = new ImpactWorkerV2(), r = await host.run(raw, observer);
  assert.deepEqual(r.result, analyzeSnapshot(s, observer));
  const replay = await host.run(raw, observer, { receipt: Buffer.from(JSON.stringify(r.result.receipt)) });
  assert.equal(replay.result.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
  assert.ok(r.metrics.workerHeapBytes > 0); assert.ok(r.wallMs > 0);
  assert.equal(r.execution.deadlineMs, 5000);
  assert.equal(r.execution.workers, 2);
  assert.equal(r.metrics.checkedActions, s.observations.length);
});

test('bad signatures in either partition prevent both analysis and receipt verification', async () => {
  const validReceipt = Buffer.from(JSON.stringify(analyzeSnapshot(s, observer).receipt));
  for (const index of [0, 1, s.observations.length - 1]) {
    const bad = structuredClone(s); bad.observations[index].action.signature = '00'.repeat(64);
    const input = Buffer.from(JSON.stringify(attest(bad)));
    for (const options of [{}, { receipt: validReceipt }]) {
      const r = await new ImpactWorkerV2().run(input, observer, options);
      assert.equal(r.result.reason, 'ACTION_AUTHENTICATION'); assert.equal(r.result.receipt, undefined);
    }
  }
});

test('caller mutation cannot change either partition input after dispatch', async () => {
  const bytes = Buffer.from(raw), pending = new ImpactWorkerV2().run(bytes, observer);
  bytes.fill(0);
  assert.deepEqual((await pending).result, analyzeSnapshot(s, observer));
});
test('malformed, oversized and tampered worker payloads never produce a receipt', async () => {
  const host = new ImpactWorkerV2();
  assert.equal((await host.run(Buffer.from('{'), observer)).result.reason, 'INVALID_INPUT');
  assert.equal((await host.run(new Uint8Array(1_048_577), observer)).result.reason, 'INPUT_BUDGET');
  assert.equal((await host.run(raw, 'bad')).result.reason, 'OBSERVER_AUTHORITY');
  assert.equal((await host.run(raw, observer, { receipt: Buffer.from('{}') })).result.status, 'RECEIPT_MISMATCH');
});
test('busy, cancellation and deadline leave no queued job and allow recovery', async () => {
  const host = new ImpactWorkerV2(), controller = new AbortController();
  const first = host.run(raw, observer, { signal: controller.signal });
  assert.equal((await host.run(raw, observer)).result.reason, 'BUSY');
  controller.abort(); assert.equal((await first).result.reason, 'CANCELLED');
  assert.equal((await host.run(raw, observer, { deadlineMs: 1 })).result.reason, 'DEADLINE');
  assert.equal((await host.run(raw, observer)).result.status, 'REVIEW_CANDIDATES');
});

test('extended execution is explicit, bounded and recorded without changing the receipt', async () => {
  const host = new ImpactWorkerV2();
  for (const deadlineMs of [0, 10001, 1.5, NaN, '10000'])
    await assert.rejects(host.run(raw, observer, { deadlineMs }), /Invalid deadline/);
  const r = await host.run(raw, observer, { deadlineMs: 10000 });
  assert.deepEqual(r.result, analyzeSnapshot(s, observer));
  assert.equal(r.execution.deadlineMs, 10000);
  assert.deepEqual(parseExecutionArgs(['input']), { args: ['input'], deadlineMs: 5000 });
  for (const args of [['input', '--deadline-ms'], ['input', '--deadline-ms', '10001'],
    ['input', '--deadline-ms', '5s'], ['--deadline-ms', '10000', 'input'],
    ['input', '--deadline-ms', '5000', '--deadline-ms', '10000']])
    assert.throws(() => parseExecutionArgs(args), /RUN_OPTIONS/);
});

test('snapshot file CLI analyzes and independently verifies, including paths with spaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'interpoll-v2-snapshot-'));
  try {
    const input = join(directory, 'signed snapshot.json'), output = join(directory, 'v2 receipt.json');
    await writeFile(input, raw, { flag: 'wx' });
    const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
    const analyze = spawnSync(process.execPath, [cli, 'analyze', input, observer, output, '--deadline-ms', '10000'],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(analyze.status, 0, analyze.stderr);
    const result = JSON.parse(analyze.stdout);
    assert.equal(result.execution.deadlineMs, 10000);
    const bytes = await readFile(output);
    assert.deepEqual(JSON.parse(bytes), result.result.receipt);
    const verify = spawnSync(process.execPath, [cli, 'verify', input, observer, output], { encoding: 'utf8', timeout: 10000 });
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).result.status, 'VERIFIED_RELATIVE_TO_SNAPSHOT');
    const invalid = spawnSync(process.execPath, [cli, 'analyze', input, observer, output, '--deadline-ms', '10001'],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /RUN_OPTIONS/);
    assert.deepEqual(await readFile(output), bytes);
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('interpoll-v2-snapshot-'))
      throw Error('Unexpected temporary cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
});
