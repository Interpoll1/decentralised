<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ roomTitle }}</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="shareInvite" :disabled="!hasAccess">
            <ion-icon slot="icon-only" :icon="shareSocialOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Loading state -->
      <div v-if="initialLoading" class="status-container">
        <ion-spinner name="crescent"></ion-spinner>
        <p>Decrypting room...</p>
      </div>

      <!-- Error state -->
      <div v-else-if="chatRoomStore.error" class="status-container">
        <ion-icon :icon="alertCircleOutline" class="status-icon error"></ion-icon>
        <p>{{ chatRoomStore.error }}</p>
        <ion-button @click="initRoom" fill="outline">Retry</ion-button>
      </div>

      <!-- No access state -->
      <div v-else-if="!hasAccess" class="status-container">
        <ion-icon :icon="lockClosedOutline" class="status-icon"></ion-icon>
        <h2>No Access</h2>
        <p>You don't have the encryption key for this room.</p>
        <ion-button @click="goToJoin" fill="outline">Join with Invite</ion-button>
      </div>

      <!-- Messages -->
      <div v-else class="chat-container">
        <div ref="messagesContainer" class="messages-area">
          <div v-if="chatRoomStore.sortedMessages.length === 0" class="empty-chat">
            <p>No messages yet. Say hello! 👋</p>
          </div>
          <template v-for="(msg, i) in chatRoomStore.sortedMessages" :key="msg.id">
            <div
              class="message"
              :class="{ sent: msg.senderId === currentUserId, received: msg.senderId !== currentUserId }"
            >
              <span
                v-if="msg.senderId !== currentUserId && !isSameSender(i)"
                class="sender-name"
              >{{ msg.senderName }}</span>
              <div class="message-content">
                <p>{{ msg.text }}</p>
              </div>
              <div class="message-meta">
                <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </ion-content>

    <!-- Input footer -->
    <ion-footer v-if="hasAccess && !initialLoading && !chatRoomStore.error" class="input-footer">
      <div class="input-area">
        <textarea
          v-model="messageInput"
          @keydown.enter.exact.prevent="handleSend"
          placeholder="Type a message..."
          :disabled="!chatRoomStore.currentRoom || chatRoomStore.loading"
          class="message-input"
          rows="1"
        />
        <button
          @click="handleSend"
          :disabled="!messageInput.trim() || !chatRoomStore.currentRoom || isSending"
          class="send-button"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </div>
    </ion-footer>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonFooter, IonButtons, IonBackButton, IonButton, IonIcon,
  IonSpinner, toastController,
} from '@ionic/vue';
import { shareSocialOutline, lockClosedOutline, alertCircleOutline } from 'ionicons/icons';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { ChatRoomService } from '@/services/chatRoomService';
import { KeyVaultService } from '@/services/keyVaultService';
import { UserService } from '@/services/userService';
import { InviteLinkService } from '@/services/inviteLinkService';
import type { ChatRoom } from '@/services/chatRoomService';

const props = defineProps<{ roomId: string }>();

const route = useRoute();
const router = useRouter();
const chatRoomStore = useChatRoomStore();

const messagesContainer = ref<HTMLDivElement | null>(null);
const messageInput = ref('');
const initialLoading = ref(true);
const hasAccess = ref(false);
const currentUserId = ref('');
const currentUserName = ref('');
const isSending = ref(false);
const isInitialLoad = ref(true);

const roomTitle = ref('Loading...');

const roomId = computed(() => props.roomId || (route.params.roomId as string));

function isSameSender(index: number): boolean {
  if (index === 0) return false;
  const msgs = chatRoomStore.sortedMessages;
  return msgs[index].senderId === msgs[index - 1].senderId;
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const scrollToBottom = () => {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTo({
      top: messagesContainer.value.scrollHeight,
      behavior: 'smooth',
    });
  }
};

watch(() => chatRoomStore.sortedMessages.length, () => {
  if (isInitialLoad.value) return;
  nextTick(() => scrollToBottom());
});

let initGeneration = 0;

async function initRoom() {
  const gen = ++initGeneration;
  initialLoading.value = true;
  chatRoomStore.error = null;

  try {
    const user = await UserService.getCurrentUser();
    if (gen !== initGeneration) return;

    currentUserId.value = user.id;
    currentUserName.value = user.displayName || user.username || 'Anonymous';

    const keyExists = await KeyVaultService.hasKey(roomId.value);
    if (gen !== initGeneration) return;

    if (!keyExists) {
      hasAccess.value = false;
      initialLoading.value = false;
      return;
    }
    hasAccess.value = true;

    const rooms = await ChatRoomService.listJoinedRooms();
    if (gen !== initGeneration) return;

    const room: ChatRoom | undefined = rooms.find(r => r.id === roomId.value);

    if (!room) {
      chatRoomStore.error = 'Room not found or could not be decrypted.';
      initialLoading.value = false;
      return;
    }

    roomTitle.value = room.name;
    chatRoomStore.enterRoom(room);
    await nextTick();
    scrollToBottom();
    isInitialLoad.value = false;
  } catch (err: any) {
    if (gen !== initGeneration) return;
    chatRoomStore.error = err.message || 'Failed to load room';
  } finally {
    if (gen === initGeneration) {
      initialLoading.value = false;
    }
  }
}

async function handleSend() {
  const text = messageInput.value.trim();
  if (!text || !chatRoomStore.currentRoom || isSending.value) return;

  isSending.value = true;
  try {
    await chatRoomStore.sendMessage(text, currentUserId.value, currentUserName.value);
    messageInput.value = '';
    nextTick(() => scrollToBottom());
  } catch (err) {
    messageInput.value = text;
    console.error('Failed to send message:', err);
    const toast = await toastController.create({
      message: 'Failed to send. Please try again.',
      duration: 2500,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  } finally {
    isSending.value = false;
  }
}

async function shareInvite() {
  try {
    const stored = await KeyVaultService.getKey(roomId.value);
    if (!stored) return;

    const base64urlKey = stored.key
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const link = InviteLinkService.generateInviteLink(roomId.value, 'chatroom', base64urlKey);
    await navigator.clipboard.writeText(link);

    const toast = await toastController.create({
      message: 'Invite link copied!',
      duration: 2000,
      position: 'top',
      color: 'success',
    });
    await toast.present();
  } catch (err) {
    console.error('Failed to share invite:', err);
    const toast = await toastController.create({
      message: 'Failed to copy invite link.',
      duration: 2000,
      position: 'top',
      color: 'danger',
    });
    await toast.present();
  }
}

function goToJoin() {
  router.push(`/join/chatroom/${encodeURIComponent(roomId.value)}`);
}

watch(roomId, () => {
  chatRoomStore.leaveCurrentRoom();
  isInitialLoad.value = true;
  roomTitle.value = 'Loading...';
  initRoom();
});

onMounted(() => initRoom());

onUnmounted(() => {
  chatRoomStore.leaveCurrentRoom();
});
</script>

<style scoped>
ion-content {
  --background: transparent;
}

.status-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 32px;
  text-align: center;
  color: var(--ion-text-color);
  opacity: 0.8;
}

.status-icon {
  font-size: 48px;
  margin-bottom: 12px;
  color: var(--ion-color-medium);
}

.status-icon.error {
  color: var(--ion-color-danger);
}

.status-container h2 {
  margin: 0 0 8px;
  font-size: 20px;
}

.status-container p {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--ion-color-medium);
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

.empty-chat {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--ion-color-medium);
  font-size: 14px;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 72%;
  animation: bubbleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  margin-bottom: 6px;
}

.message.sent { align-self: flex-end; align-items: flex-end; }
.message.received { align-self: flex-start; align-items: flex-start; }

@keyframes bubbleIn {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}

.sender-name {
  font-size: 11px;
  font-weight: 600;
  color: var(--ion-color-primary);
  padding: 0 8px;
  margin-bottom: 2px;
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

.input-footer {
  background: transparent;
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
.message-input:disabled { opacity: 0.45; cursor: not-allowed; }

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
  .send-button, .input-area { transition: none; }
}
</style>
