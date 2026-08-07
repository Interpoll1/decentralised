<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="$router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>{{ recipientName }}</ion-title>
        <ion-note slot="end" class="connection-status" :class="{ connected: connected && !chatError, error: chatError }">
          {{ statusLabel }}
        </ion-note>
      </ion-toolbar>
    </ion-header>

    <div v-if="isTypingState" class="typing-bar">
      <span class="typing-dots"><span></span><span></span><span></span></span>
      {{ recipientName }} is typing
    </div>

    <ion-content ref="content">
      <div class="chat-container">
        <div ref="messagesContainer" class="messages-area">
          <div v-for="msg in currentMessages" :key="msg.id"
            class="message" :class="{ sent: msg.sent, received: !msg.sent }">
            <div class="message-content"><p>{{ msg.message }}</p></div>
            <div class="message-meta">
              <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
              <span v-if="msg.sent" class="message-status" :class="{ stalled: msg.status === 'failed' }">
                {{ deliveryMark(msg) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="chatError" class="chat-error-banner">{{ chatError }}</div>
        <div v-else-if="recipientKeyMissing" class="chat-warning-banner">
          {{ recipientName }} hasn't opened the app yet — messages are saved and delivered once they appear.
        </div>
        <div v-else-if="!connected && chatReady" class="chat-warning-banner">
          Offline — messages are queued and sent when connectivity returns.
        </div>

        <div class="input-area">
          <textarea
            v-model="messageInput"
            @keydown.enter.exact.prevent="handleSend"
            @input="handleTyping"
            :placeholder="chatError ? 'Chat unavailable' : chatReady ? 'Type a message…' : 'Setting up encrypted chat…'"
            :disabled="!chatReady"
            class="message-input"
            rows="1"
          />
          <button @click="handleSend" :disabled="!messageInput.trim() || !chatReady" class="send-button">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
            </svg>
          </button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonNote, onIonViewWillEnter
} from '@ionic/vue';
import ChatService, { type ChatMessage } from '../services/chatService';
import { UserService } from '../services/userService';
import config from '@/config';

const route = useRoute();
const props = defineProps<{ userId: string }>();

const recipientId = computed(() => props.userId || (route.params.userId as string) || '');
const recipientName = computed(() => (route.query.name as string) || 'User');

const WS_URL = config.relay.websocket;

// ── State ─────────────────────────────────────────────────────────────────────
const connected           = ref(false);
const chatReady           = ref(false);
const chatError           = ref('');
const recipientKeyMissing = ref(false);
const messageInput        = ref('');
const messages            = ref<ChatMessage[]>([]);
const typingState         = ref(false);
const content             = ref<any>(null);
const typingTimer         = ref<number | null>(null);

let chatService: ChatService | null = null;
let initGeneration = 0;

const currentMessages = computed(() => messages.value);
const isTypingState   = computed(() => typingState.value);

const statusLabel = computed(() => {
  if (chatError.value) return 'Failed';
  if (!chatReady.value) return 'Setting up...';
  return connected.value ? 'Connected' : 'Offline';
});

/** ✓ written to the graph, ✓✓ read by them, ⋯ still queued, ! gave up retrying. */
function deliveryMark(msg: ChatMessage): string {
  if (msg.status === 'failed') return '!';
  if (msg.status === 'pending') return '⋯';
  return msg.read ? '✓✓' : '✓';
}

/** Replace or append by id — the same message can arrive from send and from Gun. */
function upsertMessage(msg: ChatMessage) {
  const at = messages.value.findIndex(m => m.id === msg.id);
  if (at === -1) messages.value.push(msg);
  else messages.value[at] = { ...messages.value[at], ...msg };
}

function bindChatCallbacks(service: ChatService) {
  service.onConnectionChange = (status) => {
    connected.value = status;
  };

  service.onMessage = (msg: ChatMessage) => {
    upsertMessage(msg);
    nextTick(() => scrollToBottom());
  };

  service.onMessageStatus = ({ id, status, error }) => {
    const at = messages.value.findIndex(m => m.id === id);
    if (at !== -1) messages.value[at] = { ...messages.value[at], status, error };
  };

  service.onTyping = ({ from, isTyping }) => {
    if (from === recipientId.value) typingState.value = isTyping;
  };

  service.onReadReceipt = ({ from, at }) => {
    if (from !== recipientId.value) return;
    // Only messages they could actually have seen — the receipt is a watermark,
    // not a blanket "everything is read".
    messages.value.forEach(m => { if (m.sent && m.timestamp <= at) m.read = true; });
  };

  service.onRecipientKeyChange = ({ userId, available }) => {
    if (userId === recipientId.value) recipientKeyMissing.value = !available;
  };

  service.onDelivered = () => { /* the status callback is the authoritative signal */ };
}

function resetChatState() {
  messages.value = [];
  connected.value = false;
  chatReady.value = false;
  chatError.value = '';
  recipientKeyMissing.value = false;
  messageInput.value = '';
  typingState.value = false;
}

function disconnectChat() {
  chatService?.disconnect();
  chatService = null;
}

async function initializeChat() {
  const targetUserId = recipientId.value;
  if (!targetUserId) return;

  const gen = ++initGeneration;
  disconnectChat();
  resetChatState();

  const currentUser = await UserService.getCurrentUser();
  if (gen !== initGeneration) return;

  const service = new ChatService(WS_URL, currentUser.id);
  bindChatCallbacks(service);
  chatService = service;

  try {
    await service.init();
    if (gen !== initGeneration) { service.disconnect(); return; }

    // Local history first: this device's copy is durable and needs no network,
    // so the conversation is on screen before any peer is contacted. The old
    // flow blocked here for up to ten seconds waiting for a connection, and
    // gave up entirely — showing nothing — if none arrived.
    messages.value = await service.getLocalHistory(targetUserId);
    if (gen !== initGeneration) { service.disconnect(); return; }
    chatReady.value = true;
    recipientKeyMissing.value = !service.hasRecipientKey(targetUserId);
    scrollToBottom();

    await service.startChat({ userId: targetUserId, name: recipientName.value });
    if (gen !== initGeneration) { service.disconnect(); return; }
    recipientKeyMissing.value = !service.hasRecipientKey(targetUserId);

    const history = await service.loadHistory(targetUserId);
    if (gen !== initGeneration) { service.disconnect(); return; }
    history.forEach(upsertMessage);
    messages.value.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    console.error('Chat setup failed:', err);
    chatError.value = err instanceof Error
      ? err.message
      : 'Could not start an encrypted chat with this user.';
  }

  service.markAsRead(targetUserId);
  scrollToBottom();
}

watch(recipientId, async (newId, oldId) => {
  if (newId && newId !== oldId) {
    await initializeChat();
  }
});

onIonViewWillEnter(() => {
  if (!chatReady.value && recipientId.value) {
    void initializeChat();
    return;
  }
  chatService?.markAsRead(recipientId.value);
});

onUnmounted(() => {
  initGeneration++;
  disconnectChat();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const scrollToBottom = () => {
  if (content.value) content.value.$el.scrollToBottom(300);
};

watch(currentMessages, () => nextTick(() => scrollToBottom()), { deep: true });

// ── Actions ───────────────────────────────────────────────────────────────────

const handleSend = async () => {
  // Deliberately not gated on `connected`: the message is written to IndexedDB
  // and retried from the outbox, so composing offline is safe. Blocking here is
  // what made the composer feel dead whenever no peer happened to be up.
  if (!messageInput.value.trim() || !chatReady.value || !chatService) return;

  const text = messageInput.value.trim();
  // Clear optimistically so a slow relay never lets the same text be sent twice.
  messageInput.value = '';

  try {
    // The service returns the stored message — the single source of this bubble.
    upsertMessage(await chatService.sendMessage(recipientId.value, text));
    chatService.sendTyping(recipientId.value, false);
    nextTick(() => scrollToBottom());
  } catch (err) {
    console.error('Failed to send message:', err);
    messageInput.value = text;
    chatError.value = err instanceof Error ? err.message : 'Message could not be sent';
  }
};

const handleTyping = () => {
  if (!chatService) return;
  chatService.sendTyping(recipientId.value, true);
  if (typingTimer.value) clearTimeout(typingTimer.value);
  typingTimer.value = window.setTimeout(() => {
    chatService?.sendTyping(recipientId.value, false);
  }, 2000);
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now  = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000)   return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
</script>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

.back-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  margin-left: 4px; transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text); }
.back-btn svg { width: 22px; height: 22px; }

.connection-status {
  font-size: 11.5px; margin-right: 12px; padding: 3px 10px;
  border-radius: 999px; font-weight: 600;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: var(--app-text-muted); transition: all 200ms ease;
}
.connection-status.connected {
  background: rgba(52,211,153,0.12); border-color: rgba(52,211,153,0.3); color: #34d399;
}
.connection-status.error {
  background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); color: #ef4444;
}

.typing-bar {
  padding: 4px 16px 6px; font-size: 12px; color: var(--app-text-subtle);
  font-style: italic; display: flex; align-items: center; gap: 6px;
}
.typing-dots span {
  display: inline-block; width: 4px; height: 4px; border-radius: 50%;
  background: var(--app-text-subtle); animation: tdot 1.2s infinite ease-in-out;
}
.typing-dots span:nth-child(2) { animation-delay: .2s; }
.typing-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes tdot { 0%,80%,100% { transform: scale(0.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }

.chat-container {
  display: flex; flex-direction: column; height: 100%; overflow: hidden;
}

.messages-area {
  flex: 1; overflow-y: auto; padding: 16px 14px 8px;
  display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.08) transparent;
}

.message {
  display: flex; flex-direction: column; max-width: 75%;
  animation: bubbleIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both;
  margin-bottom: 4px;
}
.message.sent     { align-self: flex-end;   align-items: flex-end; }
.message.received { align-self: flex-start; align-items: flex-start; }
@keyframes bubbleIn {
  from { opacity: 0; transform: translateY(6px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.message-content {
  padding: 9px 14px; border-radius: 18px; max-width: 100%;
}
.message.sent .message-content {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-bottom-right-radius: 5px;
  box-shadow: 0 4px 16px rgba(99,102,241,0.3);
}
.message.sent .message-content p { color: #fff; }
.message.received .message-content {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.09);
  border-bottom-left-radius: 5px;
}
.message.received .message-content p { color: var(--app-text); }
.message-content p { margin: 0; font-size: 14.5px; line-height: 1.5; word-break: break-word; }

.message-meta {
  display: flex; align-items: center; gap: 4px;
  margin-top: 3px; padding: 0 4px;
}
.message-time { font-size: 11px; color: var(--app-text-subtle); line-height: 1; }
.message-status { font-size: 11px; color: #818cf8; letter-spacing: -0.5px; line-height: 1; }
.message-status.stalled { color: #fbbf24; font-weight: 700; }

/* Banners */
.chat-error-banner, .chat-warning-banner {
  margin: 0 14px 8px; padding: 10px 14px; border-radius: 12px;
  font-size: 13px; line-height: 1.5;
}
.chat-error-banner {
  color: #ef4444; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25);
}
.chat-warning-banner {
  color: #fbbf24; background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.25);
}

/* Input */
.input-area {
  display: flex; align-items: flex-end; gap: 10px;
  padding: 8px 10px; margin: 4px 12px 12px;
  border-radius: 24px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.input-area:focus-within {
  border-color: rgba(99,102,241,0.5);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.message-input {
  flex: 1; background: transparent; border: none; outline: none; resize: none;
  font-size: 14.5px; line-height: 1.5; color: var(--ion-text-color);
  font-family: inherit; padding: 4px 4px 4px 6px; max-height: 120px;
}
.message-input::placeholder { color: var(--app-text-subtle); }
.message-input:disabled { opacity: 0.45; cursor: not-allowed; }

.send-button {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; border: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  box-shadow: 0 4px 14px rgba(99,102,241,0.4);
  transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
}
.send-button:hover:not(:disabled) { transform: translateY(-1px) scale(1.06); box-shadow: 0 6px 20px rgba(99,102,241,0.5); }
.send-button:active:not(:disabled) { transform: scale(0.94); }
.send-button:disabled { background: rgba(255,255,255,0.08); color: var(--app-text-subtle); box-shadow: none; cursor: not-allowed; }
.w-5 { width: 20px; height: 20px; }

@media (prefers-reduced-motion: reduce) {
  .message { animation: none; }
  .send-button, .input-area { transition: none; }
}
</style>