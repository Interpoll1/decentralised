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
