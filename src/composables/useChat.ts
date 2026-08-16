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
import ChatService from '../services/chatService';

export interface ChatEntry {
  userId: string;
  name: string;
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

  const unreadDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const subscribedChatRooms  = new Set<string>();
  let   chatDiscoverySubscribed = false;
  let   bgChatService: ChatService | null = null;
  let   bgChatInitialised = false;
  let   bgChatInitPromise: Promise<void> | null = null;

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
        const unread = rows.filter(row => !row.outgoing && !row.readAt).length;
        const latest = rows.reduce((n, r) => (r.timestamp > n.timestamp ? r : n));
        const body   = latest.text.length > 80 ? `${latest.text.slice(0, 79)}…` : latest.text;
        const entry  = chatList.value.find(c => c.userId === otherUserId);
        if (!entry) return;
        entry.unreadCount = unread;
        if (latest.timestamp >= entry.lastMessageTime) {
          entry.lastMessageTime = latest.timestamp;
          entry.lastMessage     = latest.outgoing ? `You: ${body}` : body;
        }
        chatList.value = [...chatList.value].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
      })();
    }, 500));
  }

  function subscribeToRoom(otherUserId: string, otherName: string, otherPublicKey: string) {
    const gun    = GunService.getGun();
    const roomId = getRoomId(currentUserId, otherUserId);
    if (subscribedChatRooms.has(roomId)) return;
    if (!chatList.value.find(c => c.userId === otherUserId)) {
      chatList.value = [...chatList.value, {
        userId: otherUserId, name: otherName,
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
        subscribeToRoom(otherUserId, otherUserId, '');
        gun.get('users').get(otherUserId).once((userData: any) => {
          const entry = chatList.value.find(c => c.userId === otherUserId);
          if (entry && userData) {
            entry.name      = userData.displayName || userData.username || otherUserId;
            entry.publicKey = userData.publicKey || '';
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
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') await Notification.requestPermission();
  }

  async function showIncomingMessageNotification(
    fromUserId: string, senderName: string, preview: string, isInThisChat: boolean,
  ) {
    if (isInThisChat) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(`💬 ${senderName}`, {
        // `renotify` is a real Notification API option but is missing from the
        // TS DOM lib, so the option bag is widened to include it.
        body: preview, icon: '/favicon.ico', tag: `chat-${fromUserId}`, renotify: true,
      } as NotificationOptions & { renotify: boolean });
      n.onclick = () => {
        window.focus();
        void router.push({ name: 'Chat', params: { userId: fromUserId }, query: { name: senderName } });
        n.close();
      };
    }
    const toast = await toastController.create({
      message: `💬 <strong>${senderName}</strong>: ${preview}`,
      duration: 5000, position: 'top', cssClass: 'chat-incoming-toast',
      buttons: [
        { text: 'Reply', handler: () => { void router.push({ name: 'Chat', params: { userId: fromUserId }, query: { name: senderName } }); } },
        { icon: 'close', role: 'cancel' },
      ],
    });
    await toast.present();
  }

  async function initBackgroundChat(activeTabRef: { value: string }) {
    const WS_URL = config.relay.websocket;
    bgChatService = new ChatService(WS_URL, currentUserId);
    bgChatService.onConnectionChange = () => {};

    // CRITICAL: opens WebSocket, registers with relay, publishes chat public key
    // to Gun so senders can encrypt to Y. Without this call the service is inert.
    try { await bgChatService.init(); }
    catch (err) { console.warn('[useChat] bgChatService.init() failed:', err); }

    await requestNotificationPermission();

    bgChatService.onMessage = (msg) => {
      if (msg.sent) return;
      const preview      = msg.message.length > 80 ? `${msg.message.slice(0, 79)}…` : msg.message;
      const currentRoute = router.currentRoute.value;
      const isInThisChat = currentRoute.name === 'Chat' && currentRoute.params.userId === msg.from;
      const entry        = chatList.value.find(c => c.userId === msg.from);

      if (entry) {
        const senderName = entry.name || msg.from;
        entry.lastMessage     = preview;
        entry.lastMessageTime = msg.timestamp;
        if (!isInThisChat) entry.unreadCount++;
        chatList.value    = [...chatList.value].sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
        void showIncomingMessageNotification(msg.from, senderName, preview, isInThisChat);
      } else {
        chatList.value = [{
          userId: msg.from, name: msg.from,
          lastMessage: preview, lastMessageTime: msg.timestamp,
          unreadCount: isInThisChat ? 0 : 1, publicKey: '',
        }, ...chatList.value];
        if (!isInThisChat) totalUnread.value++;
        subscribeToRoom(msg.from, msg.from, '');
        gun_lookupUser(msg.from);
        void showIncomingMessageNotification(msg.from, msg.from, preview, isInThisChat);
      }
    };
    bgChatInitialised = true;
  }

  function gun_lookupUser(userId: string) {
    const gun = GunService.getGun();
    gun.get('users').get(userId).once((userData: any) => {
      const entry = chatList.value.find(c => c.userId === userId);
      if (entry && userData) {
        entry.name      = userData.displayName || userData.username || userId;
        entry.publicKey = userData.publicKey || '';
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

  // ─── Navigation ───────────────────────────────────────────────────────────

  function openChat(chat: ChatEntry) {
    const entry = chatList.value.find(c => c.userId === chat.userId);
    if (entry) entry.unreadCount = 0;
    totalUnread.value = chatList.value.reduce((s, c) => s + c.unreadCount, 0);
    router.push({ name: 'Chat', params: { userId: chat.userId }, query: { name: chat.name, publicKey: chat.publicKey } });
  }

  function startChatWithUser(user: UserSearchResult) {
    router.push({ name: 'Chat', params: { userId: user.id }, query: { name: user.name, publicKey: user.publicKey } });
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
    bgChatService?.disconnect?.();
    bgChatService = null;
    bgChatInitialised = false;
  }

  return {
    chatList, totalUnread,
    userSearchQuery, userSearchResults, searchingUsers,
    loadChatList, ensureChatInitialized,
    processPendingChatInvites,
    openChat, startChatWithUser,
    clearUserSearch, handleUserSearch,
    teardown,
  };
}