// useChat.ts - Vue Composable for P2P Chat

import { ref, onMounted, onUnmounted, Ref } from 'vue';
import ChatService, { ChatMessage, RecipientInfo } from '../services/chatService';

interface UseChatReturn {
  chat: Ref<ChatService | null>;
  connected: Ref<boolean>;
  messages: Ref<Record<string, ChatMessage[]>>;
  typing: Ref<Record<string, boolean>>;
  publicKey: Ref<string>;
  startChat: (recipient: RecipientInfo) => Promise<void>;
  sendMessage: (recipientId: string, message: string) => Promise<string>;
  sendTyping: (recipientId: string, isTyping: boolean) => void;
  markAsRead: (recipientId: string) => void;
  loadHistory: (recipientId: string) => Promise<void>;
  getMessages: (recipientId: string) => ChatMessage[];
  isTyping: (recipientId: string) => boolean;
}

export function useChat(wsUrl: string, userId: string): UseChatReturn {
  const chat = ref<ChatService | null>(null);
  const connected = ref(false);
  const messages = ref<Record<string, ChatMessage[]>>({});
  const typing = ref<Record<string, boolean>>({});
  const publicKey = ref('');

  const initChat = async () => {
    const chatService = new ChatService(wsUrl, userId);

    // Setup callbacks
    chatService.onMessage = (msg: ChatMessage) => {
      if (!messages.value[msg.from]) {
        messages.value[msg.from] = [];
      }
      messages.value[msg.from].push(msg);
    };

    chatService.onTyping = ({ from, isTyping }) => {
      typing.value[from] = isTyping;
    };

    chatService.onConnectionChange = (status: boolean) => {
      connected.value = status;
    };

    chatService.onDelivered = ({ messageId }) => {
      console.log(`Message ${messageId} delivered`);
    };

    chatService.onReadReceipt = ({ from }) => {
      // Mark messages as read
      if (messages.value[from]) {
        messages.value[from].forEach(msg => {
          if (!msg.sent) msg.read = true;
        });
      }
    };

    // Initialize and get public key
    const pubKey = await chatService.init();
    publicKey.value = pubKey;
    chat.value = chatService;
  };

  const startChat = async (recipient: RecipientInfo) => {
    if (!chat.value) return;
    
    await chat.value.startChat(recipient);
    
    // Load chat history
    await loadHistory(recipient.userId);
  };

  const sendMessage = async (recipientId: string, message: string): Promise<string> => {
    if (!chat.value) throw new Error('Chat not initialized');
    
    const messageId = await chat.value.sendMessage(recipientId, message);
    
    // Add to local state
    if (!messages.value[recipientId]) {
      messages.value[recipientId] = [];
    }
    
    messages.value[recipientId].push({
      id: messageId,
      from: userId,
      to: recipientId,
      message,
      timestamp: Date.now(),
      read: false,
      sent: true,
    });

    return messageId;
  };

  const sendTyping = (recipientId: string, isTyping: boolean) => {
    if (!chat.value) return;
    chat.value.sendTyping(recipientId, isTyping);
  };

  const markAsRead = (recipientId: string) => {
    if (!chat.value) return;
    chat.value.markAsRead(recipientId);
    
    // Mark local messages as read
    if (messages.value[recipientId]) {
      messages.value[recipientId].forEach(msg => {
        if (!msg.sent) msg.read = true;
      });
    }
  };

  const loadHistory = async (recipientId: string) => {
    if (!chat.value) return;
    
    const history = await chat.value.loadHistory(recipientId);
    messages.value[recipientId] = history;
  };

  const getMessages = (recipientId: string): ChatMessage[] => {
    return messages.value[recipientId] || [];
  };

  const isTyping = (recipientId: string): boolean => {
    return typing.value[recipientId] || false;
  };

  onMounted(() => {
    if (wsUrl && userId) {
      initChat();
    }
  });

  onUnmounted(() => {
    if (chat.value) {
      chat.value.disconnect();
    }
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
