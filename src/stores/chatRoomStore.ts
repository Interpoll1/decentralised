// src/stores/chatRoomStore.ts
//
// One encrypted room at a time.
//
// `enterRoom` used to only open a live subscription, so a room you came back to
// was empty until somebody typed — Gun holds no local copy, and the graph may
// legitimately have nothing after an eviction. It now renders this device's
// durable history first and merges the graph on top, guarded by a generation
// token so switching rooms mid-load cannot cross the two conversations.

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ChatRoomService } from '@/services/chatRoomService';
import { StorageService } from '@/services/storageService';
import type { ChatRoom, DisplayMessage } from '@/services/chatRoomService';

/** How long to follow a just-sent message before trusting the outbox loop. */
const STATUS_POLL_ATTEMPTS = 8;

export const useChatRoomStore = defineStore('chatRoom', () => {
  const rooms = ref<ChatRoom[]>([]);
  const currentRoom = ref<ChatRoom | null>(null);
  const messages = ref<DisplayMessage[]>([]);
  const loading = ref(false);
  /** True only while the initial history for the open room is still arriving. */
  const loadingHistory = ref(false);
  const error = ref<string | null>(null);

  let messageUnsubscribe: (() => void) | null = null;
  /** Guards every async continuation against a room switch mid-flight. */
  let generation = 0;

  const sortedMessages = computed(() =>
    [...messages.value].sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      if (a.senderId === b.senderId && a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
        return a.seq - b.seq;
      }
      // Deterministic tiebreak, so the room reads the same on every device.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
  );

  /** Replace by id, or append. The same message arrives from send and from Gun. */
  function upsert(msg: DisplayMessage) {
    const at = messages.value.findIndex(m => m.id === msg.id);
    if (at === -1) messages.value.push(msg);
    else messages.value[at] = { ...messages.value[at], ...msg };
  }

  function teardown() {
    if (messageUnsubscribe) {
      messageUnsubscribe();
      messageUnsubscribe = null;
    }
  }

  async function loadRooms() {
    loading.value = true;
    error.value = null;
    try {
      rooms.value = await ChatRoomService.listJoinedRooms();
    } catch (err: any) {
      error.value = err.message || 'Failed to load rooms';
    } finally {
      loading.value = false;
    }
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

  async function enterRoom(room: ChatRoom): Promise<void> {
    const token = ++generation;
    teardown();

    currentRoom.value = room;
    messages.value = [];
    loadingHistory.value = true;

    try {
      // 1. This device's own copy — instant, and correct with no network at all.
      const local = await ChatRoomService.getLocalHistory(room.id);
      if (token !== generation) return;
      local.forEach(upsert);
      loadingHistory.value = false;

      // 2. Live updates.
      messageUnsubscribe = ChatRoomService.subscribeToMessages(room.id, (msg) => {
        if (token !== generation) return;
        upsert(msg);
      });

      // 3. The graph's answer, merged on top.
      const history = await ChatRoomService.loadHistory(room.id);
      if (token !== generation) return;
      history.forEach(upsert);
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

  async function sendMessage(text: string, senderId: string, senderName: string) {
    if (!currentRoom.value) throw new Error('No room selected');
    const msg = await ChatRoomService.sendMessage(currentRoom.value.id, text, senderId, senderName);
    upsert(msg);
    void trackDelivery(msg.id, generation);
    return msg;
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
    generation++;
    teardown();
    currentRoom.value = null;
    messages.value = [];
    loadingHistory.value = false;
  }

  return {
    rooms,
    currentRoom,
    messages,
    sortedMessages,
    loading,
    loadingHistory,
    error,
    loadRooms,
    createRoom,
    joinRoom,
    enterRoom,
    sendMessage,
    leaveRoom,
    leaveCurrentRoom,
  };
});
