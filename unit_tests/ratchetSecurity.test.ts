import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { StorageService } from '../src/services/storageService';
import { getOrCreateIdentityBundle, SignalSession } from '../src/services/signalProtocol';

beforeEach(async () => {
  const db = await StorageService.getDB();
  await db.clear('metadata');
  await db.clear('chat-messages');
});

async function peers() {
  const a = await getOrCreateIdentityBundle('alice');
  const b = await getOrCreateIdentityBundle('bob');
  const sender = new SignalSession('alice', 'bob');
  const receiver = new SignalSession('bob', 'alice');
  const first = await sender.encrypt('hello', a, b.bundle);
  expect(await receiver.decrypt(first, b, a.bundle.ik, 'bob')).toBe('hello');
  return { a, b, sender, receiver };
}

describe('P0-A: durable ratchet consumption', () => {
  it('concurrent sends have distinct positions and both decrypt', async () => {
    const { a, b, sender, receiver } = await peers();
    const envelopes = await Promise.all(['X', 'Y'].map(text => sender.encrypt(text, a, b.bundle)));
    expect(new Set(envelopes.map(e => `${e.dh}:${e.n}`)).size).toBe(2);
    const plaintexts = [];
    for (const e of envelopes.sort((x, y) => y.n - x.n)) {
      plaintexts.push(await receiver.decrypt(e, b, a.bundle.ik, 'bob'));
    }
    expect(plaintexts.sort()).toEqual(['X', 'Y']);
  });

  it('independent instances and a reopened database consume the next positions', async () => {
    const { a, b, receiver } = await peers();
    const envelopes = await Promise.all(['X', 'Y'].map(text =>
      new SignalSession('alice', 'bob').encrypt(text, a, b.bundle)));
    expect(envelopes.map(e => e.n).sort()).toEqual([1, 2]);
    for (const e of envelopes.sort((x, y) => x.n - y.n)) {
      await receiver.decrypt(e, b, a.bundle.ik, 'bob');
    }
    (await StorageService.getDB()).close();
    (StorageService as any).dbPromise = undefined;
    const next = await new SignalSession('alice', 'bob').encrypt('restart', a, b.bundle);
    expect(next.n).toBe(3);
    expect(await new SignalSession('bob', 'alice').decrypt(next, b, a.bundle.ik, 'bob')).toBe('restart');
  });
});

it('64 concurrent consumers across instances decrypt exactly once', async () => {
  const { a, b, sender, receiver } = await peers();
  const reply = await receiver.encrypt('reply', b, a.bundle);
  await sender.decrypt(reply, a, b.bundle.ik, 'alice');
  const values = Array.from({ length: 64 }, (_, i) => `burst-${i}`);
  const envelopes = await Promise.all(values.map(t => new SignalSession('alice', 'bob').encrypt(t, a, b.bundle)));
  expect(new Set(envelopes.map(e => `${e.dh}:${e.n}`)).size).toBe(64);
  const recovered = [];
  for (const e of [...envelopes].sort((a,b) => b.n-a.n)) {
    recovered.push(await receiver.decrypt(e, b, a.bundle.ik, 'bob'));
    await expect(receiver.decrypt(e, b, a.bundle.ik, 'bob')).rejects.toThrow();
  }
  expect(recovered.sort()).toEqual(values.sort());
});

it('logical retries reuse durable ciphertext after restart', async () => {
  const { a, b, sender, receiver } = await peers();
  const envelopes = await Promise.all(Array.from({length: 8}, () =>
    new SignalSession('alice','bob').encrypt('retry', a, b.bundle, 'logical-1')));
  expect(new Set(envelopes.map(e => JSON.stringify(e))).size).toBe(1);
  expect(await receiver.decrypt(envelopes[0], b, a.bundle.ik, 'bob')).toBe('retry');
  const before = JSON.stringify(await StorageService.getMetadata('signal-session:alice:bob'));
  (await StorageService.getDB()).close(); (StorageService as any).dbPromise = undefined;
  expect(await new SignalSession('alice','bob').encrypt('retry', a, b.bundle, 'logical-1')).toEqual(envelopes[0]);
  expect(JSON.stringify(await StorageService.getMetadata('signal-session:alice:bob'))).toBe(before);
  await expect(sender.encrypt('changed', a, b.bundle, 'logical-1')).rejects.toThrow();
});

it('send and receive overlap without overwriting the other chain', async () => {
  const { a, b, sender, receiver } = await peers();
  await sender.decrypt(await receiver.encrypt('reply', b, a.bundle), a, b.bundle.ik, 'alice');
  await receiver.decrypt(await sender.encrypt('roundtrip', a, b.bundle), b, a.bundle.ik, 'bob');
  const incoming = await receiver.encrypt('incoming', b, a.bundle);
  const [outgoing, text] = await Promise.all([
    sender.encrypt('outgoing', a, b.bundle),
    new SignalSession('alice','bob').decrypt(incoming, a, b.bundle.ik, 'alice'),
  ]);
  expect(text).toBe('incoming');
  expect(await receiver.decrypt(outgoing, b, a.bundle.ik, 'bob')).toBe('outgoing');
  const next = await sender.encrypt('next', a, b.bundle);
  expect(await receiver.decrypt(next, b, a.bundle.ik, 'bob')).toBe('next');
});
