import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ChatRoomService } from '@/services/chatRoomService';
import type { ChatRoom, DisplayMessage } from '@/services/chatRoomService';

export const useChatRoomStore = defineStore('chatRoom', () => {
  const rooms = ref<ChatRoom[]>([]);
  const currentRoom = ref<ChatRoom | null>(null);
  const messages = ref<DisplayMessage[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let messageUnsubscribe: (() => void) | null = null;

  const sortedMessages = computed(() =>
    [...messages.value].sort((a, b) => a.timestamp - b.timestamp)
  );

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

  function enterRoom(room: ChatRoom) {
    if (messageUnsubscribe) {
      messageUnsubscribe();
      messageUnsubscribe = null;
    }

    currentRoom.value = room;
    messages.value = [];

    messageUnsubscribe = ChatRoomService.subscribeToMessages(room.id, (msg) => {
      if (!messages.value.find(m => m.id === msg.id)) {
        messages.value.push(msg);
      }
    });
  }

  async function sendMessage(text: string, senderId: string, senderName: string) {
    if (!currentRoom.value) throw new Error('No room selected');
    const msg = await ChatRoomService.sendMessage(currentRoom.value.id, text, senderId, senderName);
    if (!messages.value.find(m => m.id === msg.id)) {
      messages.value.push(msg);
    }
    return msg;
  }

  async function leaveRoom(roomId: string) {
    await ChatRoomService.leaveRoom(roomId);
    rooms.value = rooms.value.filter(r => r.id !== roomId);
    if (currentRoom.value?.id === roomId) {
      leaveCurrentRoom();
    }
  }

  function leaveCurrentRoom() {
    if (messageUnsubscribe) {
      messageUnsubscribe();
      messageUnsubscribe = null;
    }
    currentRoom.value = null;
    messages.value = [];
  }

  return {
    rooms,
    currentRoom,
    messages,
    sortedMessages,
    loading,
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
