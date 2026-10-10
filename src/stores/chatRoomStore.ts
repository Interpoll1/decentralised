// src/stores/chatRoomStore.ts
//
// One encrypted room at a time.
//
// `enterRoom` used to only open a live subscription, so a room you came back to
// was empty until somebody typed — Gun holds no local copy, and the graph may
// legitimately have nothing after an eviction. It now renders this device's
// durable history first and merges the graph on top, guarded by a generation
// token so switching rooms mid-load cannot cross the two conversations.
//
// Group-chat features (replies, reactions, edits, deletes, pins, polls, media)
// are all ordinary signed room messages carrying a `GroupExt`; `timeline`
// folds them into bubbles (see utils/groupTimeline). Typing, presence and read
// receipts are ephemeral signed signals, never history.

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ChatRoomService, isVisibleRow } from '@/services/chatRoomService';
import { StorageService } from '@/services/storageService';
import type { ChatRoom, DisplayMessage, GroupSignal, JoinRequest, RoomMember, RoomSummary } from '@/services/chatRoomService';
import type { GroupExt, GroupMedia } from '@/types/social';
import { compareTimeline, foldTimeline } from '@/utils/groupTimeline';

/** Reactive proxies cannot cross into IndexedDB (structured clone) — hand services plain data. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** How long to follow a just-sent message before trusting the outbox loop. */
const STATUS_POLL_ATTEMPTS = 8;
const TYPING_TTL_MS = 6_000;
const ONLINE_TTL_MS = 90_000;
const HEARTBEAT_MS = 40_000;
const TYPING_THROTTLE_MS = 3_000;

export const useChatRoomStore = defineStore('chatRoom', () => {
  const rooms = ref<ChatRoom[]>([]);
  const summaries = ref<Record<string, RoomSummary>>({});
  const currentRoom = ref<ChatRoom | null>(null);
  const messages = ref<DisplayMessage[]>([]);
  const loading = ref(false);
  /** True only while the initial history for the open room is still arriving. */
  const loadingHistory = ref(false);
  const error = ref<string | null>(null);

  const me = ref({ id: '', name: '' });
  const members = ref<RoomMember[]>([]);
  const names = ref<Record<string, string>>({});
  const isOwner = ref(false);
  const pendingJoins = ref<JoinRequest[]>([]);
  /** Latest signal per member device. */
  const signals = ref<Record<string, GroupSignal>>({});
  /** Read mark when the room was opened — drives the "new messages" divider. */
  const readMarkAtOpen = ref(0);
  const now = ref(Date.now());

  let messageUnsubscribe: (() => void) | null = null;
  let extraUnsubscribes: (() => void)[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastTypingSent = 0;
  let myRead = 0;
  /** Guards every async continuation against a room switch mid-flight. */
  let generation = 0;
  const mediaCache = new Map<string, Promise<string>>();

  const sortedMessages = computed(() => [...messages.value].sort(compareTimeline));
  const folded = computed(() => foldTimeline(messages.value, me.value.id));
  const timeline = computed(() => folded.value.items);
  const pinnedMessages = computed(() => folded.value.pinned);

  function displayName(accountId: string): string {
    if (accountId === me.value.id) return 'You';
    return names.value[accountId] || `Member ${accountId.slice(0, 6)}`;
  }

  const otherSignals = computed(() => Object.values(signals.value).filter(s => s.account !== me.value.id));
  const typingNames = computed(() => {
    const seen = new Set<string>();
    return otherSignals.value
      .filter(s => s.typing && now.value - s.typing < TYPING_TTL_MS)
      .map(s => s.name || displayName(s.account))
      .filter(n => !seen.has(n) && !!seen.add(n));
  });
  const onlineAccounts = computed(() => new Set(
    Object.values(signals.value).filter(s => now.value - s.ts < ONLINE_TTL_MS).map(s => s.account)
      .concat(me.value.id ? [me.value.id] : []),
  ));
  /** Other member accounts, for read receipts and mentions. */
  const otherAccounts = computed(() => [...new Set(members.value.filter(m => m.accountId !== me.value.id).map(m => m.accountId))]);

  /** Who (other than the author) has read up to this message's time. */
  function readBy(msg: DisplayMessage): string[] {
    const best = new Map<string, number>();
    for (const s of otherSignals.value) best.set(s.account, Math.max(best.get(s.account) ?? 0, s.read));
    return [...best].filter(([account, read]) => account !== msg.senderId && read >= msg.timestamp).map(([account]) => account);
  }

  /** Replace by id, or append. The same message arrives from send and from Gun. */
  function upsert(msg: DisplayMessage) {
    const at = messages.value.findIndex(m => m.id === msg.id);
    if (at === -1) messages.value.push(msg);
    else messages.value[at] = { ...messages.value[at], ...msg };
    if (msg.senderId && msg.senderName && msg.senderId !== me.value.id && names.value[msg.senderId] !== msg.senderName) {
      names.value = { ...names.value, [msg.senderId]: msg.senderName };
      void ChatRoomService.rememberNames(msg.roomId, { [msg.senderId]: msg.senderName });
    }
  }

  function teardown() {
    if (messageUnsubscribe) {
      messageUnsubscribe();
      messageUnsubscribe = null;
    }
    extraUnsubscribes.forEach(stop => stop());
    extraUnsubscribes = [];
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    signals.value = {};
    pendingJoins.value = [];
    members.value = [];
    isOwner.value = false;
  }

  function setIdentity(id: string, name: string) {
    me.value = { id, name };
  }

  async function loadRooms() {
    loading.value = true;
    error.value = null;
    try {
      rooms.value = await ChatRoomService.listJoinedRooms();
      void refreshSummaries();
    } catch (err: any) {
      error.value = err.message || 'Failed to load rooms';
    } finally {
      loading.value = false;
    }
  }

  async function refreshSummaries() {
    const next: Record<string, RoomSummary> = {};
    for (const room of rooms.value) {
      next[room.id] = await ChatRoomService.summary(room.id, me.value.id).catch(() => ({ unread: 0, mentions: 0 }));
    }
    summaries.value = next;
  }

  async function createRoom(name: string, description: string, creatorId: string, password?: string) {
    loading.value = true;
    error.value = null;
    try {
      const result = await ChatRoomService.createRoom(name, description, creatorId, password);
      rooms.value.unshift(result.room);
      return result;
    } catch (err: any) {
      error.value = err.message || 'Failed to create room';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function joinRoom(roomId: string, keyOrPassword: string, method: 'invite' | 'password') {
    loading.value = true;
    error.value = null;
    try {
      const room = await ChatRoomService.joinRoom(roomId, keyOrPassword, method);
      const exists = rooms.value.find(r => r.id === roomId);
      if (!exists) rooms.value.unshift(room);
      return room;
    } catch (err: any) {
      error.value = err.message || 'Failed to join room';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  /** Non-member: ask the owner for admission. Resolves 'member' once approved. */
  async function requestJoin(roomId: string, name: string, password?: string) {
    return ChatRoomService.requestJoin(roomId, name, password);
  }
  const accessMode = (roomId: string) => ChatRoomService.accessMode(roomId).catch(() => 'approval' as const);

  async function refreshMembers(roomId: string) {
    const [list, known] = await Promise.all([ChatRoomService.listMembers(roomId), ChatRoomService.getNames(roomId)]);
    members.value = list;
    names.value = { ...known, ...names.value };
  }

  async function enterRoom(room: ChatRoom): Promise<void> {
    const token = ++generation;
    teardown();

    currentRoom.value = room;
    messages.value = [];
    loadingHistory.value = true;

    try {
      // 1. This device's own copy — instant, and correct with no network at all.
      const [local, mark, known] = await Promise.all([
        ChatRoomService.getLocalHistory(room.id), ChatRoomService.getReadMark(room.id), ChatRoomService.getNames(room.id),
      ]);
      if (token !== generation) return;
      readMarkAtOpen.value = myRead = mark;
      names.value = known;
      local.forEach(upsert);
      loadingHistory.value = false;

      // 2. Live updates.
      messageUnsubscribe = ChatRoomService.subscribeToMessages(room.id, (msg) => {
        if (token !== generation) return;
        upsert(msg);
      });
      await startRoomExtras(room, token);

      // 3. The graph's answer, merged on top.
      const history = await ChatRoomService.loadHistory(room.id);
      if (token !== generation) return;
      history.forEach(upsert);
      await refreshMembers(room.id);
    } catch (err: any) {
      if (token !== generation) return;
      error.value = err.message || 'Failed to load messages';
    } finally {
      if (token === generation) loadingHistory.value = false;
    }

    // Retry anything this device failed to deliver earlier in this room.
    ChatRoomService.startOutboxLoop();
    void ChatRoomService.flushOutbox();
  }

  async function startRoomExtras(room: ChatRoom, token: number) {
    await refreshMembers(room.id);
    isOwner.value = await ChatRoomService.isOwner(room.id);
    if (token !== generation) return;
    const stopSignals = await ChatRoomService.watchSignals(room.id, (signal) => {
      if (token !== generation) return;
      const key = `${signal.account}:${signal.device}`;
      const prev = signals.value[key];
      if (prev && prev.ts >= signal.ts) return;
      signals.value = { ...signals.value, [key]: signal };
      if (signal.relays?.length && signal.account !== me.value.id) ChatRoomService.adoptRelays(signal.relays);
      if (signal.name && signal.account !== me.value.id && names.value[signal.account] !== signal.name) {
        names.value = { ...names.value, [signal.account]: signal.name };
      }
    });
    extraUnsubscribes.push(stopSignals);
    extraUnsubscribes.push(ChatRoomService.onMembershipChange((roomId) => {
      if (token !== generation || roomId !== room.id) return;
      // Let the epoch commit land before re-reading it.
      setTimeout(() => {
        if (token !== generation) return;
        void refreshMembers(room.id).then(() => {
          if (currentRoom.value) currentRoom.value = { ...currentRoom.value, memberCount: members.value.length };
        });
      }, 300);
    }));
    if (isOwner.value) {
      const stopJoins = await ChatRoomService.watchJoinRequests(room.id, (pending) => {
        if (token === generation) pendingJoins.value = pending;
      });
      extraUnsubscribes.push(stopJoins);
    }
    if (token !== generation) { extraUnsubscribes.forEach(stop => stop()); extraUnsubscribes = []; return; }
    const tick = setInterval(() => { now.value = Date.now(); }, 2_000);
    extraUnsubscribes.push(() => clearInterval(tick));
    heartbeat = setInterval(() => { void signal(0); }, HEARTBEAT_MS);
    void signal(0);
  }

  async function signal(typing: number) {
    const room = currentRoom.value;
    if (!room || !me.value.id) return;
    await ChatRoomService.sendSignal(room.id, { name: me.value.name, typing, read: myRead }).catch(() => {});
  }

  /** Called on keystrokes; throttled so a burst of typing is one write. */
  function notifyTyping() {
    const t = Date.now();
    if (t - lastTypingSent < TYPING_THROTTLE_MS) return;
    lastTypingSent = t;
    void signal(t);
  }
  function stopTyping() {
    if (!lastTypingSent) return;
    lastTypingSent = 0;
    void signal(0);
  }

  /** Advance this device's read position to the newest visible message. */
  async function markRead() {
    const room = currentRoom.value;
    if (!room) return;
    const latest = messages.value.filter(m => isVisibleRow(m.ext)).reduce((t, m) => Math.max(t, m.timestamp), 0);
    if (latest <= myRead) return;
    myRead = latest;
    await ChatRoomService.setReadMark(room.id, latest);
    if (summaries.value[room.id]) summaries.value = { ...summaries.value, [room.id]: { ...summaries.value[room.id], unread: 0, mentions: 0 } };
    void signal(0);
  }

  async function sendMessage(text: string, senderId: string, senderName: string, ext?: GroupExt) {
    if (!currentRoom.value) throw new Error('No room selected');
    const msg = await ChatRoomService.sendMessage(currentRoom.value.id, text, senderId, senderName, ext && plain(ext));
    upsert(msg);
    void trackDelivery(msg.id, generation);
    if (!ext || ext.k === 'msg' || ext.k === 'poll') {
      myRead = Math.max(myRead, msg.timestamp);
      // Clear "is typing…" on the other side now rather than after its TTL.
      if (lastTypingSent) { lastTypingSent = 0; void signal(0); }
    }
    return msg;
  }

  // Thin wrappers so views never assemble protocol shapes themselves.
  const send = (ext: GroupExt, text = '') => sendMessage(text, me.value.id, me.value.name, ext);
  function sendText(text: string, opts: { replyTo?: string; mentions?: string[] } = {}) {
    const ext: GroupExt = { k: 'msg', ...(opts.replyTo ? { replyTo: opts.replyTo } : {}), ...(opts.mentions?.length ? { mentions: opts.mentions } : {}) };
    return send(ext, text);
  }
  async function sendMedia(file: File, caption = '', replyTo?: string) {
    const media = await ChatRoomService.uploadMedia(file);
    return send({ k: 'msg', media, ...(replyTo ? { replyTo } : {}) }, caption);
  }
  /** Copy a message into another joined room, flagged as forwarded. */
  async function forward(roomId: string, source: { text: string; media?: GroupMedia }) {
    const ext: GroupExt = { k: 'msg', forwarded: true, ...(source.media ? { media: source.media } : {}) };
    const msg = await ChatRoomService.sendMessage(roomId, source.text, me.value.id, me.value.name, plain(ext));
    if (roomId === currentRoom.value?.id) upsert(msg);
    return msg;
  }
  const react = (target: string, emoji: string) => send({ k: 'react', target, emoji });
  const editMessage = (target: string, text: string) => send({ k: 'edit', target }, text);
  const deleteMessage = (target: string) => send({ k: 'delete', target });
  const pin = (target: string) => send({ k: 'pin', target });
  const unpin = (target: string) => send({ k: 'unpin', target });
  const createPoll = (question: string, options: string[], multi: boolean) => send({ k: 'poll', question, options, multi });
  const vote = (target: string, choices: number[]) => send({ k: 'vote', target, choices });

  function loadMedia(media: GroupMedia): Promise<string> {
    let url = mediaCache.get(media.mediaId);
    if (!url) {
      url = ChatRoomService.openMedia(plain(media));
      url.catch(() => mediaCache.delete(media.mediaId));
      mediaCache.set(media.mediaId, url);
    }
    return url;
  }

  async function approveJoin(request: JoinRequest) {
    if (!currentRoom.value) return;
    const room = await ChatRoomService.approveJoin(currentRoom.value.id, plain(request));
    pendingJoins.value = pendingJoins.value.filter(r => r.id !== request.id);
    names.value = { ...names.value, [request.binding.accountId]: request.name };
    currentRoom.value = { ...currentRoom.value, memberCount: room.memberCount };
    await refreshMembers(currentRoom.value.id);
  }
  async function declineJoin(request: JoinRequest) {
    if (!currentRoom.value) return;
    await ChatRoomService.declineJoin(currentRoom.value.id, plain(request));
    pendingJoins.value = pendingJoins.value.filter(r => r.id !== request.id);
  }
  async function removeMember(member: RoomMember) {
    if (!currentRoom.value) return;
    const room = await ChatRoomService.removeMember(currentRoom.value.id, member.accountId, member.deviceId);
    currentRoom.value = { ...currentRoom.value, memberCount: room.memberCount };
    await refreshMembers(currentRoom.value.id);
  }

  /**
   * Follow a just-sent message until the relay confirms it. Delivery happens in
   * the background, so without this the bubble would sit on "pending" until the
   * next full room load even after it had gone out.
   */
  async function trackDelivery(messageId: string, token: number): Promise<void> {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 1_000 : 5_000));
      if (token !== generation) return;
      const row = await StorageService.getChatMessage(messageId);
      if (!row) return;
      const at = messages.value.findIndex(m => m.id === messageId);
      if (at !== -1) {
        messages.value[at] = { ...messages.value[at], status: row.syncStatus, error: row.error };
      }
      if (row.syncStatus === 'confirmed' || row.syncStatus === 'failed') return;
    }
  }

  async function leaveRoom(roomId: string) {
    await ChatRoomService.leaveRoom(roomId);
    rooms.value = rooms.value.filter(r => r.id !== roomId);
    if (currentRoom.value?.id === roomId) {
      leaveCurrentRoom();
    }
  }

  function leaveCurrentRoom() {
    if (currentRoom.value && lastTypingSent) void signal(0);
    generation++;
    teardown();
    currentRoom.value = null;
    messages.value = [];
    loadingHistory.value = false;
    lastTypingSent = 0;
  }

  return {
    rooms,
    summaries,
    currentRoom,
    messages,
    sortedMessages,
    timeline,
    pinnedMessages,
    loading,
    loadingHistory,
    error,
    me,
    members,
    names,
    isOwner,
    pendingJoins,
    typingNames,
    onlineAccounts,
    otherAccounts,
    readMarkAtOpen,
    displayName,
    readBy,
    setIdentity,
    loadRooms,
    refreshSummaries,
    createRoom,
    joinRoom,
    requestJoin,
    accessMode,
    enterRoom,
    sendMessage,
    sendText,
    sendMedia,
    forward,
    react,
    editMessage,
    deleteMessage,
    pin,
    unpin,
    createPoll,
    vote,
    loadMedia,
    notifyTyping,
    stopTyping,
    markRead,
    approveJoin,
    declineJoin,
    removeMember,
    leaveRoom,
    leaveCurrentRoom,
  };
});
