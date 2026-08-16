<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="$router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>{{ roomTitle }}</ion-title>
        <ion-buttons slot="end">
          <button class="header-action-btn" @click="shareInvite" :disabled="!hasAccess" title="Share invite">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Loading -->
      <div v-if="initialLoading" class="state-container">
        <div class="spinner"></div>
        <p class="state-sub">Decrypting room…</p>
      </div>

      <!-- Error -->
      <div v-else-if="chatRoomStore.error" class="state-container">
        <div class="state-icon error-icon">
          <ion-icon :icon="alertCircleOutline"></ion-icon>
        </div>
        <p class="state-title">Something went wrong</p>
        <p class="state-sub">{{ chatRoomStore.error }}</p>
        <button class="pill-btn outline" @click="initRoom">Retry</button>
      </div>

      <!-- No access -->
      <div v-else-if="!hasAccess" class="state-container">
        <div class="state-icon lock-icon">
          <ion-icon :icon="lockClosedOutline"></ion-icon>
        </div>
        <p class="state-title">No Access</p>
        <p class="state-sub">You don't have the encryption key for this room.</p>
        <button class="pill-btn accent" @click="goToJoin">Join with Invite</button>
      </div>

      <!-- Messages -->
      <div v-else class="chat-container">
        <div ref="messagesContainer" class="messages-area">
          <div v-if="chatRoomStore.sortedMessages.length === 0" class="empty-chat">
            <div class="empty-icon"><ion-icon :icon="chatbubblesOutline"></ion-icon></div>
            <p>No messages yet — say hello!</p>
          </div>
          <template v-for="(msg, i) in chatRoomStore.sortedMessages" :key="msg.id">
            <div class="message" :class="{ sent: msg.senderId === currentUserId, received: msg.senderId !== currentUserId }">
              <span v-if="msg.senderId !== currentUserId && !isSameSender(i)" class="sender-name">
                {{ msg.senderName }}
              </span>
              <div class="message-content"><p>{{ msg.text }}</p></div>
              <div class="message-meta">
                <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
                <span v-if="msg.status && msg.status !== 'confirmed'" class="message-status"
                  :class="{ stalled: msg.status === 'failed' }"
                  :title="msg.error || 'Saved on this device, still syncing'">
                  {{ msg.status === 'failed' ? '!' : '⋯' }}
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </ion-content>

    <ion-footer v-if="hasAccess && !initialLoading && !chatRoomStore.error" class="input-footer">
      <div class="input-area">
        <textarea
          v-model="messageInput"
          @keydown.enter.exact.prevent="handleSend"
          placeholder="Type a message…"
          :disabled="!chatRoomStore.currentRoom || chatRoomStore.loading"
          class="message-input"
          rows="1"
        />
        <button @click="handleSend"
          :disabled="!messageInput.trim() || !chatRoomStore.currentRoom || isSending"
          class="send-button">
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
  IonFooter, IonButtons, IonIcon,
  toastController,
} from '@ionic/vue';
import { lockClosedOutline, alertCircleOutline, chatbubblesOutline } from 'ionicons/icons';
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
    // Awaited: `enterRoom` now loads history (local first, then the graph)
    // instead of only opening a live subscription onto an empty room.
    await chatRoomStore.enterRoom(room);
    if (gen !== initGeneration) return;
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
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

.back-btn, .header-action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  transition: color 160ms ease, background 160ms ease;
}
.back-btn:hover, .header-action-btn:hover { color: var(--app-text); background: rgba(255,255,255,0.06); }
.back-btn svg, .header-action-btn svg { width: 22px; height: 22px; }
.header-action-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* States */
.state-container {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%; padding: 32px 24px; text-align: center; gap: 12px;
}
.state-icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
  display: flex; align-items: center; justify-content: center; color: #818cf8; font-size: 30px;
}
.state-icon.error-icon { background: rgba(239,68,68,.1); border-color: rgba(239,68,68,.2); color: #ef4444; }
.state-icon.lock-icon  { background: rgba(251,191,36,.1); border-color: rgba(251,191,36,.2); color: #fbbf24; }
.state-title { font-size: 17px; font-weight: 700; color: var(--app-text); margin: 0; }
.state-sub   { font-size: 13.5px; color: var(--app-text-muted); margin: 0; }
.spinner { width: 30px; height: 30px; border: 2.5px solid rgba(99,102,241,.2); border-top-color: #6366f1; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.pill-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 999px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: opacity 160ms, transform 160ms; }
.pill-btn.accent { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.38); }
.pill-btn.outline { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--app-text-muted); }
.pill-btn:hover { opacity: .88; transform: translateY(-1px); }

/* Messages */
.chat-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.messages-area {
  flex: 1; overflow-y: auto; padding: 16px 14px 8px;
  display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.08) transparent;
}

.empty-chat {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 12px; color: var(--app-text-muted);
}
.empty-icon { width: 52px; height: 52px; border-radius: 50%; background: rgba(99,102,241,.1); display: flex; align-items: center; justify-content: center; color: #818cf8; font-size: 26px; }
.empty-chat p { font-size: 14px; margin: 0; }

.sender-name { font-size: 11px; font-weight: 700; color: #818cf8; padding: 0 8px; margin-bottom: 2px; letter-spacing: 0.02em; }

.message { display: flex; flex-direction: column; max-width: 75%; animation: bubbleIn .22s cubic-bezier(0.34,1.56,0.64,1) both; margin-bottom: 4px; }
.message.sent     { align-self: flex-end;   align-items: flex-end; }
.message.received { align-self: flex-start; align-items: flex-start; }
@keyframes bubbleIn { from { opacity: 0; transform: translateY(6px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

.message-content { padding: 9px 14px; border-radius: 18px; max-width: 100%; }
.message.sent .message-content { background: linear-gradient(135deg,#6366f1,#8b5cf6); border-bottom-right-radius: 5px; box-shadow: 0 4px 16px rgba(99,102,241,.3); }
.message.sent .message-content p { color: #fff; }
.message.received .message-content { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.09); border-bottom-left-radius: 5px; }
.message.received .message-content p { color: var(--app-text); }
.message-content p { margin: 0; font-size: 14.5px; line-height: 1.5; word-break: break-word; }

.message-meta { display: flex; align-items: center; gap: 4px; margin-top: 3px; padding: 0 4px; }
.message-time { font-size: 11px; color: var(--app-text-subtle); line-height: 1; }
.message-status { font-size: 11px; color: var(--app-text-subtle); line-height: 1; }
.message-status.stalled { color: #fbbf24; font-weight: 700; }

/* Input footer */
.input-footer { background: transparent; --background: transparent; border-top: 1px solid rgba(255,255,255,.06); }
.input-area {
  display: flex; align-items: flex-end; gap: 10px;
  padding: 8px 10px; margin: 8px 12px 12px; border-radius: 24px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.input-area:focus-within { border-color: rgba(99,102,241,.5); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.message-input { flex: 1; background: transparent; border: none; outline: none; resize: none; font-size: 14.5px; line-height: 1.5; color: var(--ion-text-color); font-family: inherit; padding: 4px 4px 4px 6px; max-height: 120px; }
.message-input::placeholder { color: var(--app-text-subtle); }
.message-input:disabled { opacity: .45; cursor: not-allowed; }
.send-button { flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.4); transition: transform 160ms ease, box-shadow 160ms ease; }
.send-button:hover:not(:disabled) { transform: translateY(-1px) scale(1.06); box-shadow: 0 6px 20px rgba(99,102,241,.5); }
.send-button:active:not(:disabled) { transform: scale(0.94); }
.send-button:disabled { background: rgba(255,255,255,.08); color: var(--app-text-subtle); box-shadow: none; cursor: not-allowed; }
.w-5 { width: 20px; height: 20px; }

@media (prefers-reduced-motion: reduce) { .message { animation: none; } .send-button, .input-area { transition: none; } }
</style>