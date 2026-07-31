<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ recipientName }}</ion-title>
        <ion-note slot="end" class="connection-status" :class="{ connected: connected && !chatError, error: chatError }">
          {{ statusLabel }}
        </ion-note>
      </ion-toolbar>
      <ion-toolbar v-if="isTypingState">
        <ion-note>typing...</ion-note>
      </ion-toolbar>
    </ion-header>

    <ion-content ref="content">
      <div class="chat-container">

        <!-- Messages Area -->
        <div ref="messagesContainer" class="messages-area">
          <div
  v-for="msg in currentMessages"
  :key="msg.id"
  class="message"
  :class="{ sent: msg.sent, received: !msg.sent }"
>
  <div class="message-content">
    <p>{{ msg.message }}</p>
  </div>
  <div class="message-meta">
    <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
    <span v-if="msg.sent" class="message-status" :class="{ stalled: msg.status === 'failed' }">
      {{ deliveryMark(msg) }}
    </span>
  </div>
</div>
        </div>

        <div v-if="chatError" class="chat-error-banner">
          {{ chatError }}
        </div>
        <div v-else-if="recipientKeyMissing" class="chat-warning-banner">
          {{ recipientName }} hasn’t opened the app yet, so there’s no key to encrypt for them.
          You can still write — messages are saved here and sent automatically once they appear.
        </div>
        <div v-else-if="!connected && chatReady" class="chat-warning-banner">
          No peers reachable. Messages are queued on this device and sent when a connection returns.
        </div>

        <!-- Input Area -->
        <div class="input-area">
          <textarea
            v-model="messageInput"
            @keydown.enter.exact.prevent="handleSend"
            @input="handleTyping"
            :placeholder="chatError ? 'Chat unavailable' : chatReady ? 'Type a message...' : 'Setting up encrypted chat...'"
            :disabled="!chatReady"
            class="message-input"
            rows="1"
          />
          <button
            @click="handleSend"
            :disabled="!messageInput.trim() || !chatReady"
            class="send-button"
          >
            
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
ion-content {
  --background: transparent;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.messages-area {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--ion-text-color-rgb), 0.10) transparent;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 72%;
  animation: bubbleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  margin-bottom: 6px;
}

.message.sent     { align-self: flex-end; align-items: flex-end; }
.message.received { align-self: flex-start; align-items: flex-start; }

@keyframes bubbleIn {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.message-content {
  padding: 7px 12px;
  border-radius: 999px;
  max-width: 100%;
  position: relative;
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
}

.message.sent .message-content {
  background: rgba(var(--ion-color-primary-rgb), 0.82);
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.60);
  border-top-color: rgba(255, 255, 255, 0.35);
  border-bottom-right-radius: 4px;
  box-shadow:
    0 4px 20px rgba(var(--ion-color-primary-rgb), 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.message.sent .message-content p {
  color: #ffffff;
  opacity: 1;
}

.message.received .message-content {
  background: rgba(var(--ion-card-background-rgb), 0.28);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-bottom-color: var(--glass-border-bottom);
  border-bottom-left-radius: 4px;
  box-shadow: var(--glass-shadow), var(--glass-highlight), var(--glass-inner-glow);
}

.message.received .message-content p {
  color: var(--ion-text-color);
  opacity: 0.9;
}

.message-content p {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  word-break: break-word;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  padding: 0 4px;
}

.message-time {
  font-size: 11px;
  color: var(--ion-color-medium);
  opacity: 0.75;
  line-height: 1;
}

.message-status {
  font-size: 12px;
  color: var(--ion-color-primary);
  letter-spacing: -1px;
  line-height: 1;
}

.input-area {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 4px 8px;
  margin: 4px 12px 12px;
  border-radius: 24px;
  background: rgba(var(--ion-card-background-rgb), 0.35);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-bottom-color: var(--glass-border-bottom);
  box-shadow: var(--glass-shadow), var(--glass-highlight), var(--glass-inner-glow);
  transition: var(--liquid-transition);
}

.input-area:focus-within {
  border-color: rgba(var(--ion-color-primary-rgb), 0.45);
  border-top-color: rgba(var(--ion-color-primary-rgb), 0.65);
  box-shadow:
    0 8px 40px rgba(var(--ion-color-primary-rgb), 0.12),
    0 1.5px 4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1px 0 rgba(255, 255, 255, 0.08),
    inset 0 0 30px rgba(255, 255, 255, 0.12);
}

.message-input {
  border-top: 1px #ffffff;
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-size: 15px;
  line-height: 1;
  color: var(--ion-text-color);
margin-bottom: 7px;
  font-family: inherit;
}

.message-input::placeholder { color: var(--ion-color-medium); }
.message-input:disabled      { opacity: 0.45; cursor: not-allowed; }

.send-button {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--ion-color-primary-rgb), 0.90);
  color: #ffffff;
  box-shadow:
    0 4px 16px rgba(var(--ion-color-primary-rgb), 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.30);
  transition: var(--liquid-spring);
}

.send-button:hover:not(:disabled) {
  background: var(--ion-color-primary);
  transform: translateY(-1px) scale(1.06);
  box-shadow:
    0 8px 28px rgba(var(--ion-color-primary-rgb), 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.send-button:active:not(:disabled) { transform: scale(0.94); }

.send-button:disabled {
  background: rgba(var(--ion-color-medium-rgb), 0.30);
  color: var(--ion-color-medium);
  box-shadow: none;
  cursor: not-allowed;
}

.w-5 { width: 20px; height: 20px; }

.connection-status {
  font-size: 12px;
  margin-right: 12px;
  padding: 3px 10px;
  border-radius: 20px;
  background: rgba(var(--ion-color-medium-rgb), 0.12);
  border: 1px solid rgba(var(--ion-color-medium-rgb), 0.20);
  color: var(--ion-color-medium);
  transition: var(--liquid-transition);
}

.connection-status.connected {
  background: rgba(var(--ion-color-success-rgb), 0.12);
  border-color: rgba(var(--ion-color-success-rgb), 0.30);
  color: var(--ion-color-success);
}

.connection-status.error {
  background: rgba(var(--ion-color-danger-rgb), 0.12);
  border-color: rgba(var(--ion-color-danger-rgb), 0.30);
  color: var(--ion-color-danger);
}

.chat-error-banner {
  margin: 0 12px 8px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: var(--ion-color-danger);
  background: rgba(var(--ion-color-danger-rgb), 0.12);
  border: 1px solid rgba(var(--ion-color-danger-rgb), 0.30);
}

.chat-warning-banner {
  margin: 0 12px 8px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ion-color-warning-shade);
  background: rgba(var(--ion-color-warning-rgb), 0.12);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.30);
}

.message-status.stalled {
  color: var(--ion-color-warning);
  font-weight: 700;
}

html.dark .message.received .message-content {
  background: #0d0d0d;
  border-color: rgba(255, 255, 255, 0.06);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
}

html.dark .input-area {
  background: #0a0a0a;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow: none;
}

html.dark .input-area:focus-within {
  border-color: rgba(var(--ion-color-primary-rgb), 0.35);
  box-shadow: 0 0 0 1px rgba(var(--ion-color-primary-rgb), 0.20);
}

html.dark .send-button {
  background: rgba(var(--ion-color-primary-rgb), 0.85);
}

html.dark .send-button:hover:not(:disabled) {
  background: var(--ion-color-primary);
  box-shadow: 0 6px 20px rgba(var(--ion-color-primary-rgb), 0.30);
}

@media (prefers-reduced-motion: reduce) {
  .message { animation: none; }
  .send-button, .input-area, .connection-status { transition: none; }
}
</style>
