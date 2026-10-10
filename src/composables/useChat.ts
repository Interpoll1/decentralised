/**
 * useChat.ts
 *
 * All chat-related state, subscriptions and handlers extracted from HomePage.vue.
 * Loaded lazily — only initialised when the user taps the Chat tab for the first time.
 */

import { ref, shallowRef } from 'vue';
import router from '../router';
import { toastController } from '@ionic/vue';
import { GunService } from '../services/gunService';
import { StorageService } from '../services/storageService';
import { ChatInviteService } from '../services/chatInviteService';
import config from '../config';
import { chatPath, resolveChatUserId } from '../utils/privateRoute';
import ChatService from '../services/chatService';
import { initNotifications, notifyChatMessage, clearChatNotification } from '../services/notificationService';
import { summarizeRoom } from '../utils/chatPreview';
import { loadNicknames, saveNickname, cleanNickname } from '../utils/chatNicknames';
import { searchMessages as searchStoredMessages, MIN_MESSAGE_QUERY, type MessageHit } from '../utils/chatSearch';
import type { StoredChatMessage } from '../types/social';

export interface ChatEntry {
  userId: string;
  /** The name the network resolved for this user (or their id until it does). Never edited locally. */
  name: string;
  /** What YOU call them. Local only; always wins over `name`. */
  nickname?: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  publicKey: string;
}

export interface UserSearchResult {
  id: string;
  name: string;
  username: string;
  publicKey: string;
}

export function useChat(currentUserId: string, gunListeners: Array<() => void>) {
  const chatList           = shallowRef<ChatEntry[]>([]);
  const userSearchQuery    = ref('');
  const userSearchResults  = shallowRef<UserSearchResult[]>([]);
  const searchingUsers     = ref(false);

  const totalUnread = ref(0);

  /** True once the list has been painted from the local snapshot / IndexedDB (UI can drop its skeleton). */
  const chatListHydrated = ref(false);
  /** Your custom names, by user id. Loaded from storage during hydration. */
  const nicknames = new Map<string, string>();
  const CACHE_KEY = `chat-list-cache:${currentUserId}`;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let lastChatListLoad = 0;

  /**
   * Snapshot the conversation list (names, previews, unread) so the next visit paints instantly
   * instead of waiting for Gun lookups. Previews are the same plaintext already kept in the
   * chat-messages store; this adds no new exposure. IndexedDB is re-read afterwards as the truth.
   */
  function schedulePersist() {
    if (!currentUserId) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const entries = chatList.value.slice(0, 200).map(c => ({
        userId: c.userId, name: c.name, nickname: c.nickname, publicKey: c.publicKey,
        lastMessage: c.lastMessage, lastMessageTime: c.lastMessageTime, unreadCount: c.unreadCount,
      }));
      void StorageService.setMetadata(CACHE_KEY, { v: 1, savedAt: Date.now(), entries }).catch(() => {});
    }, 800);
  }

  function recount() {
    totalUnread.value = chatList.value.reduce((n, c) => n + c.unreadCount, 0);
  }

  /**
   * Paint the conversation list without touching the network.
   *  1) instantly from the saved snapshot (one small metadata read);
   *  2) then reconcile against IndexedDB, which is the source of truth for unread counts. This is
   *     what makes the badge correct on launch for messages that arrived while the app was closed
   *     (those used to be counted only if a live event happened to hit an installed handler).
   * Merges into whatever live events already added; never replaces them.
   */
  async function hydrateChatList(): Promise<void> {
    if (!currentUserId) return;
    try {
      nicknames.clear();
      for (const [id, n] of Object.entries(await loadNicknames(currentUserId))) nicknames.set(id, n);
    } catch { /* nicknames are best-effort here; they re-apply on the next hydrate */ }
    try {
      const snap = await StorageService.getMetadata(CACHE_KEY);
      if (snap?.v === 1 && Array.isArray(snap.entries) && chatList.value.length === 0) {
        const painted: ChatEntry[] = snap.entries
          .filter((e: any) => e && typeof e.userId === 'string' && e.userId !== currentUserId)
          .map((e: any) => ({
            userId: e.userId, name: typeof e.name === 'string' && e.name ? e.name : e.userId,
            nickname: nicknames.get(e.userId),
            lastMessage: typeof e.lastMessage === 'string' ? e.lastMessage : '',
            lastMessageTime: Number(e.lastMessageTime) || 0,
            unreadCount: Number(e.unreadCount) || 0,
            publicKey: typeof e.publicKey === 'string' ? e.publicKey : '',
          }));
        if (painted.length) {
          chatList.value = painted.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
          recount();
        }
      }
    } catch { /* cache is best-effort */ }
    chatListHydrated.value = true;   // snapshot (or nothing) is on screen: drop the skeleton now

    try {
      const rows: StoredChatMessage[] = await StorageService.getAllChatMessages();
      const byPeer = new Map<string, StoredChatMessage[]>();
      for (const r of rows) {
        if (r.kind !== 'dm') continue;
        const other = r.roomId.split(':').find(id => id !== currentUserId);
        if (!other) continue;
        const bucket = byPeer.get(other);
        if (bucket) bucket.push(r); else byPeer.set(other, [r]);
      }
      const next = new Map(chatList.value.map(c => [c.userId, c]));
      for (const [peer, list] of byPeer) {
        const sum = summarizeRoom(list);
        const cur = next.get(peer);
        if (cur) {
          if (sum) {
            cur.unreadCount = sum.unread;
            if (sum.lastMessageTime >= cur.lastMessageTime) {
              cur.lastMessageTime = sum.lastMessageTime;
              cur.lastMessage     = sum.lastMessage;
            }
          } else { cur.unreadCount = 0; }
        } else if (sum) {
          next.set(peer, {
            userId: peer, name: peer, nickname: nicknames.get(peer), publicKey: '',
            lastMessage: sum.lastMessage, lastMessageTime: sum.lastMessageTime, unreadCount: sum.unread,
          });
        }
      }
      for (const entry of next.values()) {                       // entries created by live events before we got here
        const nick = nicknames.get(entry.userId);
        if (nick) entry.nickname = nick; else delete entry.nickname;
      }
      chatList.value = [...next.values()].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
      recount();
      schedulePersist();
    } catch (err) {
      console.warn('[useChat] hydrate from IndexedDB failed:', err);
    }
  }

  const unreadDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const subscribedChatRooms  = new Set<string>();
  let   chatDiscoverySubscribed = false;
  let   bgChatService: ChatService | null = null;
  let   bgChatInitialised = false;
  let   bgChatInitPromise: Promise<void> | null = null;
  let   _stopRouteWatch:   (() => void) | null  = null; // router.afterEach unsub

  // ─── Room helpers ─────────────────────────────────────────────────────────

  function getRoomId(a: string, b: string) {
    return [a, b].sort().join(':');
  }

  function refreshRoomSummary(roomId: string, otherUserId: string) {
    const existing = unreadDebounceTimers.get(roomId);
    if (existing) clearTimeout(existing);
    unreadDebounceTimers.set(roomId, setTimeout(() => {
      void (async () => {
        const rows = await StorageService.getChatMessagesByRoom(roomId);
        if (rows.length === 0) return;
        const entry = chatList.value.find(c => c.userId === otherUserId);
        if (!entry) return;
        const summary = summarizeRoom(rows);
        if (!summary) {
          // Conversation was cleared: drop the stale preview.
          entry.unreadCount = 0; entry.lastMessage = ''; entry.lastMessageTime = 0;
        } else {
          entry.unreadCount = summary.unread;
          if (summary.lastMessageTime >= entry.lastMessageTime) {
            entry.lastMessageTime = summary.lastMessageTime;
            entry.lastMessage     = summary.lastMessage;
          }
        }
        chatList.value = [...chatList.value].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
        schedulePersist();
      })();
    }, 500));
  }

  function subscribeToRoom(otherUserId: string, otherName: string, otherPublicKey: string) {
    const gun    = GunService.getGun();
    const roomId = getRoomId(currentUserId, otherUserId);
    if (subscribedChatRooms.has(roomId)) return;
    if (!chatList.value.find(c => c.userId === otherUserId)) {
      chatList.value = [...chatList.value, {
        userId: otherUserId, name: otherName, nickname: nicknames.get(otherUserId),
        lastMessage: '', lastMessageTime: 0,
        unreadCount: 0, publicKey: otherPublicKey,
      }];
    }
    refreshRoomSummary(roomId, otherUserId);

    // Wire bgChatService so BOTH delivery paths work:
    // - WebSocket: relay forwards live frame → handleWsMessage → onMessage
    // - Gun: p2p sync / offline catch-up → handleRoomRecord → onMessage
    // Without startChat(), Gun messages land but are never decrypted.
    if (bgChatService) {
      void bgChatService.startChat({
        userId: otherUserId,
        name: otherName,
        publicKey: otherPublicKey || undefined,
      });
    }

    const listener = gun.get('chats').get(roomId).map().on((msg: any) => {
      if (!msg || !msg.senderId || !msg.timestamp) return;
      refreshRoomSummary(roomId, otherUserId);
    });
    subscribedChatRooms.add(roomId);
    gunListeners.push(() => { listener?.off?.(); subscribedChatRooms.delete(roomId); });
  }

  // ─── Load chat list ────────────────────────────────────────────────────────

  async function loadChatList() {
    const gun = GunService.getGun();
    try {
      const stored = await StorageService.getAllChatMessages();
      const peers  = new Set<string>();
      for (const row of stored) {
        if (row.kind !== 'dm') continue;
        const other = row.roomId.split(':').find(id => id !== currentUserId);
        if (other) peers.add(other);
      }
      for (const otherUserId of peers) {
        const known = chatList.value.find(c => c.userId === otherUserId);
        subscribeToRoom(otherUserId, known?.name || otherUserId, known?.publicKey || '');
        gun.get('users').get(otherUserId).once((userData: any) => {
          const entry = chatList.value.find(c => c.userId === otherUserId);
          if (entry && userData) {
            entry.name      = userData.displayName || userData.username || otherUserId;
            entry.publicKey = userData.publicKey || '';
            chatList.value  = [...chatList.value];
            schedulePersist();
          }
        });
      }
    } catch (err) {
      console.warn('[useChat] Could not read stored conversations:', err);
    }
    gun.get('chats').once((rooms: any) => {
      if (!rooms) return;
      Object.keys(rooms)
        .filter(k => k !== '_' && k.includes(currentUserId))
        .forEach((roomId) => {
          const otherUserId = roomId.split(':').find(id => id !== currentUserId);
          if (!otherUserId) return;
          gun.get('users').get(otherUserId).once((userData: any) => {
            subscribeToRoom(
              otherUserId,
              userData?.displayName || userData?.username || otherUserId,
              userData?.publicKey || '',
            );
          });
        });
    });
  }

  function ensureChatRoomDiscoverySubscription() {
    if (chatDiscoverySubscribed || !currentUserId) return;
    const gun = GunService.getGun();
    const discoveryListener = gun.get('users').get(currentUserId).get('rooms').map()
      .on((roomData: any, roomId: string) => {
        if (!roomId || roomId === '_' || typeof roomId !== 'string') return;
        if (!roomId.includes(':') || !roomId.includes(currentUserId)) return;
        const otherUserId = roomId.split(':').find(id => id !== currentUserId);
        if (!otherUserId) return;
        gun.get('users').get(otherUserId).once((userData: any) => {
          subscribeToRoom(
            otherUserId,
            userData?.displayName || userData?.username || otherUserId,
            userData?.publicKey || '',
          );
        });
      });
    chatDiscoverySubscribed = true;
    gunListeners.push(() => { discoveryListener?.off?.(); chatDiscoverySubscribed = false; });
  }

  // ─── Background chat ───────────────────────────────────────────────────────

  async function requestNotificationPermission() {
    // Delegates to the notification service: Capacitor LocalNotifications on a
    // native build (real Android notifications, tap-to-open), Notification API
    // on the web. Also registers the deep-link handler for notification taps.
    await initNotifications((path) => { void router.push(path); });
  }

  async function showIncomingMessageNotification(
    fromUserId: string, senderName: string, preview: string, isInThisChat: boolean,
  ) {
    if (isInThisChat) return;
    await notifyChatMessage({
      fromUserId,
      senderName,
      preview,
      path: chatPath(fromUserId, senderName),
    });
    // In-app toast suppressed — the platform notification handles foreground alerts.
    // The raw HTML message with <strong> tags was leaking into the UI as escaped markup.
  }

  async function initBackgroundChat(activeTabRef: { value: string }) {
    const WS_URL = config.relay.websocket;
    bgChatService = new ChatService(WS_URL, currentUserId);
    bgChatService.onConnectionChange = () => {};

    // Handlers are installed BEFORE init(). The relay replays everything that arrived while we
    // were away the moment we register, and init() used to be followed by an awaited
    // notification-permission prompt, so those replayed messages were accepted into IndexedDB
    // while no onMessage existed yet: the unread badge and list never counted them.
    bgChatService.onMessage = (msg) => {
      if (msg.sent) return;
      const preview      = msg.message.length > 80 ? `${msg.message.slice(0, 79)}…` : msg.message;
      const currentRoute = router.currentRoute.value;
      const isInThisChat = currentRoute.name === 'Chat' && resolveChatUserId(currentRoute.params.userId) === msg.from;
      const entry        = chatList.value.find(c => c.userId === msg.from);

      if (entry) {
        // Notifications must never show a raw 64-char id: custom name, else resolved name, else a short fallback.
        const senderName = entry.nickname || (entry.name && entry.name !== msg.from ? entry.name : `User ${msg.from.slice(0, 6)}`);
        entry.lastMessage     = preview;
        entry.lastMessageTime = msg.timestamp;
        if (!isInThisChat) entry.unreadCount++;
        chatList.value    = [...chatList.value].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
        void showIncomingMessageNotification(msg.from, senderName, preview, isInThisChat);
      } else {
        const nick = nicknames.get(msg.from);
        chatList.value = [{
          userId: msg.from, name: msg.from, nickname: nick,
          lastMessage: preview, lastMessageTime: msg.timestamp,
          unreadCount: isInThisChat ? 0 : 1, publicKey: '',
        }, ...chatList.value];
        if (!isInThisChat) totalUnread.value++;
        subscribeToRoom(msg.from, msg.from, '');
        gun_lookupUser(msg.from);
        void showIncomingMessageNotification(msg.from, nick || `User ${msg.from.slice(0, 6)}`, preview, isInThisChat);
      }
      // Reconcile with IndexedDB (debounced). At startup hydrateChatList() and the relay's offline
      // replay can both see the same message, so the in-memory ++ above could double count it; the
      // stored rows are the truth and this converges the badge to them either way. Skipped inside the
      // open chat, where the view is marking messages read itself.
      if (!isInThisChat) refreshRoomSummary(getRoomId(currentUserId, msg.from), msg.from);
      schedulePersist();
    };

    // When the remote peer reads our messages, ChatService fires onReadReceipt.
    // We don't need to update unread count here (that's the COUNT of messages we
    // haven't read — unrelated to whether THEY read ours), but we do need to
    // trigger a refreshRoomSummary so the last-message preview stays accurate.
    bgChatService.onReadReceipt = ({ from }) => {
      const roomId = getRoomId(currentUserId, from);
      refreshRoomSummary(roomId, from);
    };

    // When the user opens a chat room that has an unread badge, zeroing it via
    // openChat() only works when they tap from the chat list. Direct URL navigation
    // (deep link, back-button, notification tap) bypasses that path.
    // Watch the route so any navigation into a specific chat zeros the badge
    // and recalculates totalUnread from IDB truth — no stale UI state.
    const stopRouteWatch = router.afterEach((to) => {
      if (to.name !== 'Chat') return;
      const otherUserId = resolveChatUserId(to.params.userId);
      if (!otherUserId) return;
      const entry = chatList.value.find(c => c.userId === otherUserId);
      if (entry && entry.unreadCount > 0) {
        entry.unreadCount = 0;
        totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
      }
      // Re-derive the room summary from IDB after a short delay so IDB reflects
      // the read receipts that ChatView's initializeChat just wrote
      const roomId = getRoomId(currentUserId, otherUserId);
      setTimeout(() => refreshRoomSummary(roomId, otherUserId), 800);
    });
    // Store cleanup for teardown
    _stopRouteWatch = stopRouteWatch;

    // CRITICAL: opens WebSocket, registers with relay, publishes chat public key
    // to Gun so senders can encrypt to Y. Without this call the service is inert.
    try { await bgChatService.init(); }
    catch (err) { console.warn('[useChat] bgChatService.init() failed:', err); }

    // Never block chat on the browser's permission prompt (it can wait indefinitely).
    void requestNotificationPermission().catch(() => {});

    bgChatInitialised = true;
  }

  function gun_lookupUser(userId: string) {
    const gun = GunService.getGun();
    gun.get('users').get(userId).once((userData: any) => {
      const entry = chatList.value.find(c => c.userId === userId);
      if (entry && userData) {
        entry.name      = userData.displayName || userData.username || userId;
        entry.publicKey = userData.publicKey || '';
        chatList.value  = [...chatList.value];
        schedulePersist();
      }
    });
  }

  function ensureBackgroundChatInitialized(activeTabRef: { value: string }): Promise<void> {
    if (bgChatInitialised) return Promise.resolve();
    if (!bgChatInitPromise) {
      bgChatInitPromise = initBackgroundChat(activeTabRef).finally(() => { bgChatInitPromise = null; });
    }
    return bgChatInitPromise;
  }

  function ensureChatInitialized(activeTabRef: { value: string }): Promise<void> {
    return ensureBackgroundChatInitialized(activeTabRef).then(async () => {
      ensureChatRoomDiscoverySubscription();
      // Tab re-selections used to redo the whole Gun scan each time; live events keep the list
      // current, so only rescan if it has been a while.
      if (Date.now() - lastChatListLoad < 30_000) return;
      lastChatListLoad = Date.now();
      await loadChatList();
    });
  }

  // ─── Invites ───────────────────────────────────────────────────────────────

  async function processPendingChatInvites(userId: string) {
    const invites = await ChatInviteService.getPendingInvites(userId);
    if (invites.length === 0) return;
    for (const invite of invites.slice(0, 5)) {
      ChatInviteService.markInviteRead(userId, invite.id);
      const toast = await toastController.create({
        message: `💬 Chat invite from u/${invite.fromDisplayName}`,
        duration: 5000,
        position: 'top',
        buttons: [{ text: 'Open', handler: () => { void router.push(invite.inviteLink); } }],
      });
      await toast.present();
    }
  }

  /**
   * Rename a chat locally. An empty (or all-whitespace) name removes the custom name and the list
   * goes back to the resolved name / "User xxxxxx". Persisted before it returns; never sent anywhere.
   */
  async function setNickname(userId: string, raw: string): Promise<void> {
    const nick = cleanNickname(raw);
    if (nick) nicknames.set(userId, nick); else nicknames.delete(userId);
    const entry = chatList.value.find(c => c.userId === userId);
    if (entry) {
      if (nick) entry.nickname = nick; else delete entry.nickname;
      chatList.value = [...chatList.value];
      schedulePersist();
    }
    try { await saveNickname(currentUserId, userId, nick); }
    catch (err) { console.warn('[useChat] could not save the chat name:', err); }
  }

  /**
   * Look through the messages stored on this device for `query`, grouped by conversation.
   * Purely local. The stored rows are re-read at most every few seconds so typing stays cheap
   * while a message that just arrived still becomes findable almost immediately.
   */
  let searchRows: { at: number; rows: StoredChatMessage[] } | null = null;
  async function searchMessages(query: string): Promise<Record<string, MessageHit>> {
    const q = query.trim();
    if (!currentUserId || Array.from(q).length < MIN_MESSAGE_QUERY) return {};
    try {
      const now = Date.now();
      if (!searchRows || now - searchRows.at > 3_000) searchRows = { at: now, rows: await StorageService.getAllChatMessages() };
      return searchStoredMessages(searchRows.rows, currentUserId, q);
    } catch (err) {
      console.warn('[useChat] message search failed:', err);
      return {};
    }
  }

  // ─── Navigation ───────────────────────────────────────────────────────────

  function openChat(chat: ChatEntry) {
    const entry = chatList.value.find(c => c.userId === chat.userId);
    if (entry) entry.unreadCount = 0;
    void clearChatNotification(chat.userId);
    totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
    schedulePersist();
    router.push(chatPath(chat.userId, nicknames.get(chat.userId) || chat.nickname || chat.name));
  }

  function startChatWithUser(user: UserSearchResult) {
    router.push(chatPath(user.id, user.name));
  }

  function clearUserSearch() {
    userSearchQuery.value   = '';
    userSearchResults.value = [];
  }

  async function handleUserSearch() {
    const query = userSearchQuery.value.trim();
    if (query.length < 2) { userSearchResults.value = []; return; }
    searchingUsers.value = true;
    try {
      const gun     = GunService.getGun();
      const results: UserSearchResult[] = [];
      const seen    = new Set<string>();
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 1000);
        gun.get('users').once((users: any) => {
          if (!users) { resolve(); return; }
          const userKeys = Object.keys(users).filter(k => k !== '_');
          let processed  = 0;
          userKeys.forEach(userId => {
            gun.get('users').get(userId).once((userData: any) => {
              processed++;
              if (userData && userData.id && !seen.has(userData.id)) {
                const name     = userData.displayName || userData.username || '';
                const username = userData.username || '';
                if (name.toLowerCase().includes(query.toLowerCase()) ||
                    username.toLowerCase().includes(query.toLowerCase())) {
                  seen.add(userData.id);
                  results.push({ id: userData.id, name: userData.displayName || userData.username || 'Anonymous', username: userData.username || userData.id, publicKey: userData.publicKey || '' });
                }
              }
              if (processed === userKeys.length) { clearTimeout(timeout); resolve(); }
            });
          });
        });
      });
      userSearchResults.value = results.slice(0, 10);
    } catch (err) {
      console.error('User search error:', err);
    } finally {
      searchingUsers.value = false;
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  function teardown() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    bgChatService?.disconnect?.();
    bgChatService = null;
    bgChatInitialised = false;
    _stopRouteWatch?.();
    _stopRouteWatch = null;
  }

  return {
    chatList, totalUnread, chatListHydrated, hydrateChatList, setNickname, searchMessages,
    userSearchQuery, userSearchResults, searchingUsers,
    loadChatList, ensureChatInitialized,
    processPendingChatInvites,
    openChat, startChatWithUser,
    clearUserSearch, handleUserSearch,
    teardown,
  };
}