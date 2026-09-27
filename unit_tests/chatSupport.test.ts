import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: vi.fn(), onReconnect: vi.fn(() => () => {}) }, GUN_NAMESPACE: 'test' }));
vi.mock('../src/services/userService', () => ({ UserService: { getCurrentUser: vi.fn() } }));
vi.mock('@/services/chatRoomService', () => ({ ChatRoomService: {
  listJoinedRooms: vi.fn(), createRoom: vi.fn(), joinRoom: vi.fn(), getLocalHistory: vi.fn(), loadHistory: vi.fn(),
  subscribeToMessages: vi.fn(), sendMessage: vi.fn(), leaveRoom: vi.fn(), startOutboxLoop: vi.fn(), flushOutbox: vi.fn(),
} }));
vi.mock('@/services/storageService', () => ({ StorageService: { getChatMessage: vi.fn() } }));
import { setActivePinia, createPinia } from 'pinia';
import { GunService } from '../src/services/gunService';
import { UserService } from '../src/services/userService';
import { ChatInviteService } from '../src/services/chatInviteService';
import { encodeMediaMessage, decodeMediaMessage, encryptAndUpload, fetchAndDecrypt } from '../src/services/chatMediaService';
import { ChatRoomService } from '@/services/chatRoomService';
import { StorageService } from '@/services/storageService';
import { useChatRoomStore } from '../src/stores/chatRoomStore';

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

// ── Invites ──────────────────────────────────────────────────────────────────
function gunTree(onceData: any = undefined) {
  const puts: { path: string[]; value: any }[] = [];
  const mk = (path: string[]): any => ({
    get: (k: string) => mk([...path, k]),
    put: (v: any) => { puts.push({ path, value: v }); },
    once: (cb: any) => { if (onceData !== undefined) cb(onceData); },
  });
  vi.mocked(GunService.getGun).mockReturnValue(mk([]) as any);
  return puts;
}

describe('ChatInviteService', () => {
  beforeEach(() => vi.mocked(UserService.getCurrentUser).mockResolvedValue({ id: 'me', displayName: 'Me & You' } as any));

  it('writes the invite under the recipient with an encoded link', async () => {
    const puts = gunTree();
    const inv = await ChatInviteService.sendInvite('bob');
    expect(puts[0].path).toEqual(['users', 'bob', 'chatInvites', inv.id]);
    expect(inv).toMatchObject({ fromUserId: 'me', toUserId: 'bob', fromDisplayName: 'Me & You', readAt: null });
    expect(inv.inviteLink).toBe('/chat/me?name=Me%20%26%20You');
    expect(inv.id).toMatch(/^chat-invite-/);
  });

  it('prefers customUsername and rejects self/empty targets', async () => {
    gunTree();
    vi.mocked(UserService.getCurrentUser).mockResolvedValue({ id: 'me', customUsername: 'cu', displayName: 'd' } as any);
    expect((await ChatInviteService.sendInvite('x')).fromDisplayName).toBe('cu');
    await expect(ChatInviteService.sendInvite('me')).rejects.toThrow(/Invalid/);
    await expect(ChatInviteService.sendInvite('')).rejects.toThrow(/Invalid/);
  });

  it('lists only unread, well-formed invites newest first', async () => {
    gunTree({ _: {}, 'chat-invite-1': { createdAt: 1 }, 'chat-invite-3': { createdAt: 3 }, 'chat-invite-2': { createdAt: 2, readAt: 5 },
      'chat-invite-bad': { createdAt: 'x' }, 'other': { createdAt: 9 }, 'chat-invite-null': null });
    expect((await ChatInviteService.getPendingInvites('me')).map(i => i.createdAt)).toEqual([3, 1]);
  });

  it('returns [] when Gun never answers (timeout)', async () => {
    vi.useFakeTimers(); gunTree();
    const p = ChatInviteService.getPendingInvites('me');
    await vi.advanceTimersByTimeAsync(2600);
    expect(await p).toEqual([]); vi.useRealTimers();
  });

  it('markInviteRead writes readAt', () => {
    const puts = gunTree();
    ChatInviteService.markInviteRead('me', 'chat-invite-1');
    expect(puts[0].path).toEqual(['users', 'me', 'chatInvites', 'chat-invite-1', 'readAt']);
    expect(typeof puts[0].value).toBe('number');
  });
});

// ── Media ────────────────────────────────────────────────────────────────────
describe('chatMediaService', () => {
  it('encode/decode round-trips and rejects non-media text', () => {
    const meta: any = { version: 1, mediaId: 'm', mediaName: 'a\nb.png' };
    expect(decodeMediaMessage(encodeMediaMessage(meta))).toEqual(meta);
    expect(decodeMediaMessage('hello')).toBeNull();
    expect(decodeMediaMessage('\x00MEDIA:{broken\x00')).toBeNull();
    expect(decodeMediaMessage('prefix\x00MEDIA:{}\x00')).toBeNull();
  });

  it('uploads only ciphertext and decrypts back to the original bytes', async () => {
    let stored: ArrayBuffer | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: any) => {
      if (init?.method === 'POST') { stored = await (init.body.get('file') as Blob).arrayBuffer(); return new Response(JSON.stringify({ mediaId: 'id1' })); }
      return new Response(stored!);
    }));
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: any) => { created.push(b); return 'blob:ok'; });
    const file = new File([new TextEncoder().encode('PLAINTEXT-IMAGE-BYTES')], 'p.png', { type: 'image/png' });
    const meta = await encryptAndUpload(file, 'tok');
    expect(new TextDecoder().decode(stored!)).not.toContain('PLAINTEXT');
    expect(await fetchAndDecrypt(meta, 'tok')).toBe('blob:ok');
    expect(await created[0].text()).toBe('PLAINTEXT-IMAGE-BYTES');
    // Descriptor tampering (AAD-bound) must fail decryption.
    await expect(fetchAndDecrypt({ ...meta, mediaName: 'evil.png' }, 'tok')).rejects.toThrow();
    await expect(fetchAndDecrypt({ ...meta, mediaType: 'text/html' }, 'tok')).rejects.toThrow();
  });

  it('refuses oversize files and bad relay responses', async () => {
    await expect(encryptAndUpload({ size: 101 * 1024 * 1024 } as File, 't')).rejects.toThrow(/too large/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(encryptAndUpload(new File(['x'], 'x'), 't')).rejects.toThrow(/500/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"mediaId":""}')));
    await expect(encryptAndUpload(new File(['x'], 'x'), 't')).rejects.toThrow(/Invalid media/);
  });
});

// ── Room store ───────────────────────────────────────────────────────────────
describe('chatRoomStore', () => {
  const room = (id: string): any => ({ id, name: id, createdAt: 0 });
  const msg = (id: string, ts: number, extra: any = {}): any => ({ id, roomId: 'r', text: id, senderId: 's', senderName: 'n', timestamp: ts, ...extra });
  beforeEach(() => { setActivePinia(createPinia()); vi.mocked(ChatRoomService.subscribeToMessages).mockReturnValue(vi.fn()); });

  it('renders local history, then merges live + graph without duplicates', async () => {
    let live: any;
    vi.mocked(ChatRoomService.subscribeToMessages).mockImplementation((_r, cb) => { live = cb; return vi.fn(); });
    vi.mocked(ChatRoomService.getLocalHistory).mockResolvedValue([msg('b', 2), msg('a', 1)]);
    vi.mocked(ChatRoomService.loadHistory).mockResolvedValue([msg('a', 1), msg('c', 3)]);
    const s = useChatRoomStore(); await s.enterRoom(room('r'));
    live(msg('c', 3, { text: 'edited' })); live(msg('d', 0));
    expect(s.sortedMessages.map(m => m.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(s.messages.find(m => m.id === 'c')!.text).toBe('edited');
    expect(s.loadingHistory).toBe(false);
    expect(ChatRoomService.flushOutbox).toHaveBeenCalled();
  });

  it('same-sender same-ms messages order by seq, then by id', () => {
    const s = useChatRoomStore();
    s.messages.push(msg('z', 5, { seq: 1 }), msg('y', 5, { seq: 2 }), msg('b', 5, { senderId: 'o' }), msg('a', 5, { senderId: 'p' }));
    expect(s.sortedMessages.map(m => m.id)).toEqual(['a', 'b', 'z', 'y']);
  });

  it('switching rooms mid-load never leaks the old room into the new one', async () => {
    let releaseA!: (v: any) => void;
    vi.mocked(ChatRoomService.getLocalHistory).mockImplementation(id => id === 'A' ? new Promise(r => { releaseA = r; }) : Promise.resolve([msg('b1', 1)]));
    vi.mocked(ChatRoomService.loadHistory).mockResolvedValue([]);
    const s = useChatRoomStore();
    const first = s.enterRoom(room('A'));
    await s.enterRoom(room('B'));
    releaseA([msg('a1', 1)]); await first;
    expect(s.currentRoom!.id).toBe('B');
    expect(s.messages.map(m => m.id)).toEqual(['b1']);
  });

  it('tears down the previous subscription on room switch and leave', async () => {
    const offA = vi.fn(), offB = vi.fn();
    vi.mocked(ChatRoomService.subscribeToMessages).mockReturnValueOnce(offA).mockReturnValueOnce(offB);
    vi.mocked(ChatRoomService.getLocalHistory).mockResolvedValue([]); vi.mocked(ChatRoomService.loadHistory).mockResolvedValue([]);
    const s = useChatRoomStore();
    await s.enterRoom(room('A')); await s.enterRoom(room('B'));
    expect(offA).toHaveBeenCalledOnce();
    s.leaveCurrentRoom();
    expect(offB).toHaveBeenCalledOnce(); expect(s.currentRoom).toBeNull(); expect(s.messages).toEqual([]);
  });

  it('surfaces history errors without throwing', async () => {
    vi.mocked(ChatRoomService.getLocalHistory).mockRejectedValue(new Error('idb down'));
    const s = useChatRoomStore(); await s.enterRoom(room('A'));
    expect(s.error).toBe('idb down'); expect(s.loadingHistory).toBe(false);
  });

  it('sendMessage requires a room, upserts, and tracks delivery to confirmed', async () => {
    vi.useFakeTimers();
    const s = useChatRoomStore();
    await expect(s.sendMessage('x', 's', 'n')).rejects.toThrow(/No room/);
    vi.mocked(ChatRoomService.getLocalHistory).mockResolvedValue([]); vi.mocked(ChatRoomService.loadHistory).mockResolvedValue([]);
    await s.enterRoom(room('A'));
    vi.mocked(ChatRoomService.sendMessage).mockResolvedValue(msg('m1', 1, { status: 'pending' }));
    vi.mocked(StorageService.getChatMessage).mockResolvedValueOnce({ syncStatus: 'pending' } as any).mockResolvedValueOnce({ syncStatus: 'confirmed' } as any);
    await s.sendMessage('hi', 's', 'n');
    expect(s.messages[0].status).toBe('pending');
    await vi.advanceTimersByTimeAsync(2100);
    expect(s.messages[0].status).toBe('confirmed');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(StorageService.getChatMessage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('create/join/leave keep the room list consistent and report errors', async () => {
    const s = useChatRoomStore();
    vi.mocked(ChatRoomService.createRoom).mockResolvedValue({ room: room('N'), inviteLink: 'l' });
    await s.createRoom('N', '', 'me');
    vi.mocked(ChatRoomService.joinRoom).mockResolvedValue(room('N'));
    await s.joinRoom('N', 'epoch-v1', 'invite');
    expect(s.rooms.map(r => r.id)).toEqual(['N']);
    vi.mocked(ChatRoomService.joinRoom).mockRejectedValue(new Error('Owner must approve'));
    await expect(s.joinRoom('Q', 'k', 'invite')).rejects.toThrow();
    expect(s.error).toBe('Owner must approve'); expect(s.loading).toBe(false);
    await s.leaveRoom('N'); expect(s.rooms).toEqual([]);
  });
});
