// useChat.ts - Vue Composable for P2P Chat
//
// Thin reactive wrapper over `ChatService`. The service owns durability,
// ordering and retries; this only mirrors its callbacks into refs.

import { ref, onMounted, onUnmounted, shallowRef, type Ref, type ShallowRef } from 'vue';
import ChatService, { type ChatMessage, type RecipientInfo } from '../services/chatService';

interface UseChatReturn {
  chat: ShallowRef<ChatService | null>;
  connected: Ref<boolean>;
  messages: Ref<Record<string, ChatMessage[]>>;
  typing: Ref<Record<string, boolean>>;
  publicKey: Ref<string>;
  startChat: (recipient: RecipientInfo) => Promise<void>;
  sendMessage: (recipientId: string, message: string) => Promise<ChatMessage>;
  sendTyping: (recipientId: string, isTyping: boolean) => void;
  markAsRead: (recipientId: string) => void;
  loadHistory: (recipientId: string) => Promise<void>;
  getMessages: (recipientId: string) => ChatMessage[];
  isTyping: (recipientId: string) => boolean;
}

export function useChat(wsUrl: string, userId: string): UseChatReturn {
  // `shallowRef`, not `ref`: a deep ref would hand back a reactive Proxy of the
  // service, and every private field access through that proxy is a different
  // object identity than `this` — which broke the declared `Ref<ChatService>`
  // type and made instance state subtly unreliable.
  const chat = shallowRef<ChatService | null>(null);
  const connected = ref(false);
  const messages = ref<Record<string, ChatMessage[]>>({});
  const typing = ref<Record<string, boolean>>({});
  const publicKey = ref('');

  /** Conversation key for a message: whoever the other party is. */
  const peerOf = (msg: ChatMessage) => (msg.sent ? msg.to : msg.from);

  const upsert = (msg: ChatMessage) => {
    const peer = peerOf(msg);
    if (!peer) return;
    const list = messages.value[peer] ?? (messages.value[peer] = []);
    const at = list.findIndex((m) => m.id === msg.id);
    if (at === -1) list.push(msg);
    else list[at] = { ...list[at], ...msg };
  };

  const initChat = async () => {
    const chatService = new ChatService(wsUrl, userId);

    chatService.onMessage = upsert;

    chatService.onMessageStatus = ({ id, status, error }) => {
      for (const list of Object.values(messages.value)) {
        const at = list.findIndex((m) => m.id === id);
        if (at !== -1) { list[at] = { ...list[at], status, error }; return; }
      }
    };

    chatService.onTyping = ({ from, isTyping }) => {
      typing.value[from] = isTyping;
    };

    chatService.onConnectionChange = (status: boolean) => {
      connected.value = status;
    };

    chatService.onReadReceipt = ({ from, at }) => {
      const list = messages.value[from];
      if (!list) return;
      for (const msg of list) {
        if (msg.sent && msg.timestamp <= at) msg.read = true;
      }
    };

    publicKey.value = await chatService.init();
    chat.value = chatService;
  };

  const startChat = async (recipient: RecipientInfo) => {
    if (!chat.value) return;
    await chat.value.startChat(recipient);
    await loadHistory(recipient.userId);
  };

  const sendMessage = async (recipientId: string, message: string): Promise<ChatMessage> => {
    if (!chat.value) throw new Error('Chat not initialized');
    // The service returns the stored message; no optimistic duplicate is added
    // here, which is what used to leave two bubbles for one send.
    const sent = await chat.value.sendMessage(recipientId, message);
    upsert(sent);
    return sent;
  };

  const sendTyping = (recipientId: string, isTyping: boolean) => {
    chat.value?.sendTyping(recipientId, isTyping);
  };

  const markAsRead = (recipientId: string) => {
    if (!chat.value) return;
    chat.value.markAsRead(recipientId);
    for (const msg of messages.value[recipientId] || []) {
      if (!msg.sent) msg.read = true;
    }
  };

  const loadHistory = async (recipientId: string) => {
    if (!chat.value) return;
    // Local first so the conversation paints immediately, then the graph.
    messages.value[recipientId] = await chat.value.getLocalHistory(recipientId);
    messages.value[recipientId] = await chat.value.loadHistory(recipientId);
  };

  const getMessages = (recipientId: string): ChatMessage[] => messages.value[recipientId] || [];

  const isTyping = (recipientId: string): boolean => typing.value[recipientId] || false;

  onMounted(() => {
    if (wsUrl && userId) void initChat();
  });

  onUnmounted(() => {
    chat.value?.disconnect();
  });

  return {
    chat,
    connected,
    messages,
    typing,
    publicKey,
    startChat,
    sendMessage,
    sendTyping,
    markAsRead,
    loadHistory,
    getMessages,
    isTyping,
  };
}
