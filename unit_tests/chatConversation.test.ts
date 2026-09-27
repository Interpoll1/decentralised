import { ALICE, BOB, getOrCreateIdentityBundle } from './dmIdentityFixture';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn() }, GUN_NAMESPACE: 'test' }));
vi.mock('../src/utils/gunAsync', () => ({ gunPut: vi.fn(), gunOnce: vi.fn(), gunReadChildren: vi.fn(), toGunRecord: (x: unknown) => x }));
import ChatService from '../src/services/chatService';
import { StorageService } from '../src/services/storageService';
import { GunService } from '../src/services/gunService';
import { gunPut, gunReadChildren } from '../src/utils/gunAsync';

const ROOM = [ALICE, BOB].sort().join(':');

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(async () => { const db = await StorageService.getDB(); await db.clear('metadata'); await db.clear('chat-messages'); });

async function setup() {
  const a = await getOrCreateIdentityBundle(ALICE), b = await getOrCreateIdentityBundle(BOB);
  const node: any = { get: vi.fn(), put: vi.fn(), once: vi.fn(), on: vi.fn(), map: vi.fn() };
  node.get.mockReturnValue(node); node.map.mockReturnValue(node); node.on.mockReturnValue(node);
  vi.mocked(GunService.getGun).mockReturnValue(node);
  vi.mocked(gunPut).mockResolvedValue({ ok: true } as any);
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const make = (me: string, peer: string, mine: any, theirs: any) => {
    const s = new ChatService('wss://example.invalid', me) as any;
    s.myBundle = mine; s.theirBundles.set(peer, theirs.bundle);
    s.ensureOPKPool = vi.fn().mockResolvedValue(undefined); s.ready = true;
    return s;
  };
  return { a, b, alice: make(ALICE, BOB, a, b), bob: make(BOB, ALICE, b, a) };
}

/** Wait until `sender` has encrypted `id`, then hand the wire record to `receiver`.
 *  Both parties share one fake IndexedDB, so the sender's row is moved aside while
 *  the receiver stores its own copy under the same logical id. */
async function transfer(sender: any, receiver: any, id: string) {
  let out: any;
  await vi.waitFor(async () => { out = await StorageService.getChatMessage(id); expect(out?.encryptedEnvelope).toBeTruthy(); });
  await StorageService.deleteChatMessage(id);
  const raw = { ...JSON.parse(out.encryptedEnvelope), id, senderId: sender.userId, recipientId: receiver.userId, timestamp: out.timestamp, seq: out.seq };
  const result = await receiver.receiveRemote(raw, ROOM);
  return { result, raw };
}

describe('ChatService — sending', () => {
  it('rejects empty and whitespace-only messages', async () => {
    const { alice } = await setup();
    await expect(alice.sendMessage(BOB, '')).rejects.toThrow(/empty/);
    await expect(alice.sendMessage(BOB, '   \n\t')).rejects.toThrow(/empty/);
    expect(await StorageService.getAllChatMessages()).toHaveLength(0);
  });

  it('refuses to send before identity is initialised', async () => {
    const chat = new ChatService('wss://example.invalid', ALICE);
    await expect(chat.sendMessage(BOB, 'hi')).rejects.toThrow(/not initialized/);
  });

  it('trims text, stores a pending outgoing row and returns it as sent', async () => {
    const { alice } = await setup();
    const msg = await alice.sendMessage(BOB, '  hello bob  ');
    expect(msg).toMatchObject({ from: ALICE, to: BOB, message: 'hello bob', sent: true, status: 'pending' });
    const row = await StorageService.getChatMessage(msg.id);
    expect(row).toMatchObject({ roomId: ROOM, outgoing: true, text: 'hello bob', kind: 'dm' });
  });

  it('assigns strictly increasing seq to consecutive sends', async () => {
    const { alice } = await setup();
    const ids = [];
    for (const t of ['one', 'two', 'three']) ids.push((await alice.sendMessage(BOB, t)).id);
    const seqs = await Promise.all(ids.map(async id => (await StorageService.getChatMessage(id))!.seq));
    expect(seqs[0]).toBeLessThan(seqs[1]); expect(seqs[1]).toBeLessThan(seqs[2]);
  });

  it('never stores or publishes plaintext in the Gun record', async () => {
    const { alice } = await setup();
    const msg = await alice.sendMessage(BOB, 'top secret plaintext');
    await vi.waitFor(() => expect(gunPut).toHaveBeenCalled());
    const record = vi.mocked(gunPut).mock.calls.at(-1)![1] as any;
    expect(JSON.stringify(record)).not.toContain('top secret plaintext');
    expect(record).toMatchObject({ id: msg.id, senderId: ALICE, recipientId: BOB });
    expect(typeof record.ct).toBe('string');
  });

  it('a Gun ACK alone leaves the message pending (no fake delivery)', async () => {
    const { alice } = await setup();
    const statuses: any[] = []; alice.onMessageStatus = (s: any) => statuses.push(s);
    const msg = await alice.sendMessage(BOB, 'ping');
    await vi.waitFor(() => expect(statuses).toHaveLength(1));
    expect(statuses[0]).toMatchObject({ id: msg.id, status: 'pending' });
  });
});

describe('ChatService — two-party conversation', () => {
  it('alternating back-and-forth decrypts every message on the other side', async () => {
    const { alice, bob } = await setup();
    const script: [any, any, string][] = [
      [alice, bob, 'hi bob'], [bob, alice, 'hey alice'], [alice, bob, 'how are you?'],
      [alice, bob, 'double text'], [bob, alice, 'fine 👍 émoji ✓'], [bob, alice, 'x'.repeat(4000)],
    ];
    for (const [from, to, text] of script) {
      const sent = await from.sendMessage(to.userId, text);
      const { result } = await transfer(from, to, sent.id);
      expect(result.status).toBe('accepted');
      expect(result.row.text).toBe(text);
      expect(result.row.outgoing).toBe(false);
    }
  });

  it('out-of-order arrival still decrypts every message', async () => {
    const { alice, bob } = await setup();
    const ids = [];
    for (const t of ['m0', 'm1', 'm2', 'm3']) ids.push((await alice.sendMessage(BOB, t)).id);
    const raws = [];
    for (const id of ids) {
      let out: any;
      await vi.waitFor(async () => { out = await StorageService.getChatMessage(id); expect(out?.encryptedEnvelope).toBeTruthy(); });
      raws.push({ ...JSON.parse(out.encryptedEnvelope), id, senderId: ALICE, recipientId: BOB, timestamp: out.timestamp, seq: out.seq });
    }
    for (const id of ids) await StorageService.deleteChatMessage(id);
    // m2 arrives before the bootstrap (m0): held durably, not dropped.
    const early = await bob.receiveRemote(raws[2], ROOM);
    expect(early).toMatchObject({ status: 'retryable', persisted: true });
    for (const i of [0, 3, 1]) expect((await bob.receiveRemote(raws[i], ROOM)).status).toBe('accepted');
    await bob.retryPendingReceives();
    expect((await bob.receiveRemote(raws[2], ROOM)).status).toBe('duplicate');
    const history = (await bob.getLocalHistory(ALICE)).map((m: any) => m.message);
    expect(history).toEqual(['m0', 'm1', 'm2', 'm3']);
  });

  it('redelivery of the same record is a duplicate, not a second message', async () => {
    const { alice, bob } = await setup();
    const sent = await alice.sendMessage(BOB, 'once');
    const { raw } = await transfer(alice, bob, sent.id);
    const again = await bob.receiveRemote(raw, ROOM);
    expect(again.status).toBe('duplicate');
    expect((await bob.getLocalHistory(ALICE)).filter((m: any) => m.message === 'once')).toHaveLength(1);
  });

  it('recipient delivery receipt flips the sender to confirmed', async () => {
    const { alice, bob } = await setup();
    const sent = await alice.sendMessage(BOB, 'please ack');
    let out: any;
    await vi.waitFor(async () => { out = await StorageService.getChatMessage(sent.id); expect(out?.encryptedEnvelope).toBeTruthy(); });
    await transfer(alice, bob, sent.id);
    let receipt: any;
    await vi.waitFor(async () => {
      receipt = (await StorageService.getAllChatMessages()).find(r => r.control && r.senderId === BOB && r.encryptedEnvelope);
      expect(receipt).toBeTruthy();
    });
    // Restore Alice's device view, then deliver the receipt to her.
    await StorageService.deleteChatMessage(sent.id); await StorageService.saveChatMessage(out);
    await StorageService.deleteChatMessage(receipt.id);
    alice.onDelivered = vi.fn();
    await alice.receiveRemote({ ...JSON.parse(receipt.encryptedEnvelope), id: receipt.id, senderId: BOB, recipientId: ALICE }, ROOM);
    expect(alice.onDelivered).toHaveBeenCalledWith({ messageId: sent.id, recipientId: BOB });
    const [shown] = await alice.getLocalHistory(BOB);
    expect(shown).toMatchObject({ id: sent.id, status: 'confirmed' });
  });

  it('live room records fire onMessage for text but never for control receipts', async () => {
    const { alice, bob } = await setup();
    const sent = await alice.sendMessage(BOB, 'live!');
    let out: any;
    await vi.waitFor(async () => { out = await StorageService.getChatMessage(sent.id); expect(out?.encryptedEnvelope).toBeTruthy(); });
    await StorageService.deleteChatMessage(sent.id);
    const seen: any[] = []; bob.onMessage = (m: any) => seen.push(m);
    bob.handleRoomRecord(ROOM, { ...JSON.parse(out.encryptedEnvelope), id: sent.id, senderId: ALICE, recipientId: BOB, timestamp: out.timestamp });
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toMatchObject({ from: ALICE, to: BOB, message: 'live!', sent: false });
    bob.handleRoomRecord(ROOM, null); bob.handleRoomRecord(ROOM, { noid: true });
    await new Promise(r => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
  });

  it('loadHistory merges local rows with remote Gun records', async () => {
    const { alice, bob } = await setup();
    const a1 = await alice.sendMessage(BOB, 'remote one');
    let out: any;
    await vi.waitFor(async () => { out = await StorageService.getChatMessage(a1.id); expect(out?.encryptedEnvelope).toBeTruthy(); });
    await StorageService.deleteChatMessage(a1.id);
    await StorageService.saveChatMessage({ id: 'local-own', roomId: ROOM, kind: 'dm', senderId: BOB, recipientId: ALICE, text: 'my local',
      timestamp: out.timestamp + 10, seq: 1, outgoing: true, syncStatus: 'pending', syncAttempts: 0 });
    vi.mocked(gunReadChildren).mockResolvedValue([
      { key: a1.id, value: { ...JSON.parse(out.encryptedEnvelope), id: a1.id, senderId: ALICE, recipientId: BOB, timestamp: out.timestamp, seq: out.seq } },
      { key: 'junk', value: 'not an object' },
      { key: 'forged', value: { id: 'forged', senderId: ALICE, recipientId: BOB, ct: 'AAAA', dh: 'x', n: 0, pn: 0, v: 5 } },
    ] as any);
    const history = await bob.loadHistory(ALICE);
    expect(history.map((m: any) => m.message)).toEqual(['remote one', 'my local']);
  });
});

describe('ChatService — receive routing rejects', () => {
  const base = { id: 'm1', senderId: ALICE, recipientId: BOB, v: 5, ct: 'AA', dh: 'AA', n: 0, pn: 0 };
  it.each([
    ['self-sent', { senderId: BOB }],
    ['wrong recipient', { recipientId: ALICE }],
    ['non-hex sender', { senderId: 'z'.repeat(64) }],
    ['missing id', { id: '' }],
    ['oversized id', { id: 'x'.repeat(300) }],
  ])('%s', async (_n, patch) => {
    const { bob } = await setup();
    const r = await bob.receiveRemote({ ...base, ...patch }, ROOM);
    expect(r.status).toBe('rejected-auth');
    expect(await StorageService.getAllChatMessages()).toHaveLength(0);
  });

  it('wrong room id for the sender pair', async () => {
    const { bob } = await setup();
    expect((await bob.receiveRemote(base, `${BOB}:${'f'.repeat(64)}`)).status).toBe('rejected-auth');
  });

  it('messages for a locally cleared room are dropped as stale', async () => {
    const { alice, bob } = await setup();
    const sent = await alice.sendMessage(BOB, 'after clear');
    let out: any;
    await vi.waitFor(async () => { out = await StorageService.getChatMessage(sent.id); expect(out?.encryptedEnvelope).toBeTruthy(); });
    await StorageService.deleteChatMessage(sent.id);
    bob.clearedRooms.add(ROOM);
    const r = await bob.receiveRemote({ ...JSON.parse(out.encryptedEnvelope), id: sent.id, senderId: ALICE, recipientId: BOB }, ROOM);
    expect(r.status).toBe('rejected-stale');
  });

  it('tampered ciphertext is rejected and stores nothing', async () => {
    const { alice, bob } = await setup();
    const sent = await alice.sendMessage(BOB, 'integrity');
    let out: any;
    await vi.waitFor(async () => { out = await StorageService.getChatMessage(sent.id); expect(out?.encryptedEnvelope).toBeTruthy(); });
    await StorageService.deleteChatMessage(sent.id);
    const env = JSON.parse(out.encryptedEnvelope);
    // Flip a byte in the GCM body (after the 12-byte IV prefix).
    const blob = Buffer.from(env.ct, 'base64'); blob[20] ^= 0xff;
    const ct = blob.toString('base64');
    const r = await bob.receiveRemote({ ...env, ct, id: sent.id, senderId: ALICE, recipientId: BOB }, ROOM);
    expect(['rejected-auth', 'retryable']).toContain(r.status);
    expect(await bob.getLocalHistory(ALICE)).toHaveLength(0);
  });
});

describe('ChatService — history rendering', () => {
  const row = (id: string, text: string, extra: any = {}) => ({ id, roomId: ROOM, kind: 'dm' as const, senderId: BOB, recipientId: ALICE,
    text, timestamp: 1000 + Number(id.replace(/\D/g, '') || 0), seq: 0, outgoing: false, syncStatus: 'confirmed' as const, syncAttempts: 0, ...extra });

  it('hides control, corrupted and empty rows; sorts by time', async () => {
    const { alice } = await setup();
    for (const r of [row('r3', 'third'), row('r1', 'first'), row('r2', ''), row('r4', 'ctl', { control: 'delivery-receipt-v1' }),
      row('r5', 'bad', { syncStatus: 'corrupted' }), row('r0', 'zeroth')]) await StorageService.saveChatMessage(r as any);
    expect((await alice.getLocalHistory(BOB)).map((m: any) => m.message)).toEqual(['zeroth', 'first', 'third']);
  });

  it('decodes inline file payloads and never leaks raw JSON for broken ones', async () => {
    const { alice } = await setup();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x') }));
    const inline = JSON.stringify({ _file: true, name: 'a.png', mime: 'image/png', size: 3, data: btoa('abc') });
    const linked = JSON.stringify({ _file: true, _url: true, url: 'https://x/y.mp4', name: 'y.mp4', mime: 'video/mp4', size: 9 });
    const empty = JSON.stringify({ _file: true, name: 'gone.txt' });
    await StorageService.saveChatMessage(row('f1', inline) as any);
    await StorageService.saveChatMessage(row('f2', linked) as any);
    await StorageService.saveChatMessage(row('f3', empty) as any);
    await StorageService.saveChatMessage(row('f4', '{"_file":true,broken') as any);
    const [a, b, c, d] = await alice.getLocalHistory(BOB);
    expect(a).toMatchObject({ message: 'a.png', mediaType: 'image', mediaUrl: 'blob:x', fileSize: 3 });
    expect(b).toMatchObject({ message: 'y.mp4', mediaType: 'video', mediaUrl: 'https://x/y.mp4' });
    expect(c).toMatchObject({ message: 'gone.txt', mediaUrl: undefined });
    expect(d.message).toBe('');
  });

  it('keeps separate rooms isolated', async () => {
    const { alice } = await setup();
    await StorageService.saveChatMessage(row('r1', 'bob room') as any);
    await StorageService.saveChatMessage({ ...row('r2', 'other room'), roomId: `${ALICE}:other` } as any);
    expect((await alice.getLocalHistory(BOB)).map((m: any) => m.message)).toEqual(['bob room']);
  });
});
