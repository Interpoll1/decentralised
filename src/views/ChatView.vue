<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="$router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>

        <!-- Avatar + truncated name -->
        <div class="header-identity" slot="start">
          <div class="hdr-avatar" :class="avatarTone(recipientId)">
            {{ (recipientName || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="hdr-info">
            <span class="hdr-name">{{ recipientName }}</span>
            <span class="hdr-status" :class="{ connected: connected && !chatError, error: chatError }">
              {{ statusLabel }}
            </span>
          </div>
        </div>

        <ion-buttons slot="end">
          <button class="header-action-btn danger" @click="confirmDeleteAll" title="Delete all messages">
            <svg viewBox="0 0 24 24" fill="none">
              <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <!-- Typing indicator -->
    <div v-if="isTypingState" class="typing-bar">
      <span class="typing-dots"><span></span><span></span><span></span></span>
      {{ recipientName }} is typing…
    </div>

    <ion-content ref="content">
      <div class="chat-container">
        <div ref="messagesContainer" class="messages-area">

          <!-- Empty state -->
          <div v-if="currentMessages.length === 0 && chatReady" class="empty-chat">
            <div class="empty-avatar" :class="avatarTone(recipientId)">
              {{ (recipientName || '?').charAt(0).toUpperCase() }}
            </div>
            <p class="empty-name">{{ recipientName }}</p>
            <p class="empty-hint">Messages are end-to-end encrypted. Say hello!</p>
          </div>

          <template v-for="(msg, i) in currentMessages" :key="msg.id">
            <!-- Date separator -->
            <div v-if="showDateSep(i)" class="date-sep">
              <span>{{ dateSepLabel(msg.timestamp) }}</span>
            </div>

            <div class="message" :class="{ sent: msg.sent, received: !msg.sent, tail: showTail(i) }">
              <!-- Media bubble -->
              <div v-if="msg.mediaUrl" class="message-content media-bubble">
                <img v-if="msg.mediaType === 'image'" :src="msg.mediaUrl" class="media-img" @click="openMedia(msg.mediaUrl)" />
                <video v-else-if="msg.mediaType === 'video'" :src="msg.mediaUrl" controls class="media-video" />
                <div v-if="msg.mediaLoading" class="media-loading">
                  <div class="mini-spinner"></div>
                </div>
              </div>

              <!-- Text bubble -->
              <div v-else class="message-content">
                <p>{{ msg.message }}</p>
              </div>

              <div class="message-meta">
                <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
                <span v-if="msg.sent" class="message-status" :class="{ stalled: msg.status === 'failed' }">
                  {{ deliveryMark(msg) }}
                </span>
              </div>
            </div>
          </template>

          <!-- P2P transfer progress -->
          <div v-if="p2pTransfer" class="p2p-progress">
            <div class="p2p-bar" :style="{ width: p2pTransfer.progress + '%' }"></div>
            <span>{{ p2pTransfer.name }} · {{ p2pTransfer.progress }}%</span>
          </div>
        </div>

        <!-- Banners -->
        <div v-if="chatError" class="chat-error-banner">{{ chatError }}</div>
        <div v-else-if="recipientKeyMissing" class="chat-warning-banner">
          {{ recipientName }} hasn't opened the app yet — messages are saved and delivered once they appear.
        </div>
        <div v-else-if="!connected && chatReady" class="chat-warning-banner">
          Offline — messages are queued and sent when connectivity returns.
        </div>

        <!-- Input row -->
        <div class="input-row">
          <!-- Hidden file input -->
          <input ref="fileInput" type="file" accept="image/*,video/*" style="display:none" @change="onFileSelected" />

          <div class="input-pill" :class="{ focused: inputFocused }">
            <textarea
              v-model="messageInput"
              @keydown.enter.exact.prevent="handleSend"
              @input="handleTyping"
              @focus="inputFocused = true"
              @blur="inputFocused = false"
              :placeholder="chatError ? 'Chat unavailable' : chatReady ? 'Message…' : 'Setting up…'"
              :disabled="!chatReady"
              class="message-input"
              rows="1"
            />
          </div>

          <!-- Attach button — right of input -->
          <button class="attach-btn" @click="fileInput?.click()" :disabled="!chatReady" title="Send image or video">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <!-- Send — always last -->
          <button @click="handleSend" :disabled="!messageInput.trim() || !chatReady" class="send-button">
            <svg fill="currentColor" viewBox="0 0 24 24">
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
  IonPage, IonHeader, IonToolbar, IonContent,
  IonButtons, onIonViewWillEnter, alertController, toastController,
} from '@ionic/vue';
import ChatService, { type ChatMessage } from '../services/chatService';
import { UserService } from '../services/userService';
import { GunService } from '../services/gunService';
import { StorageService } from '../services/storageService';
import config from '@/config';

const route = useRoute();
const props = defineProps<{ userId: string }>();

const recipientId   = computed(() => props.userId || (route.params.userId as string) || '');
const recipientName = computed(() => (route.query.name as string) || 'User');
const WS_URL        = config.relay.websocket;

// ── State ──────────────────────────────────────────────────────────────────────
const connected           = ref(false);
const chatReady           = ref(false);
const chatError           = ref('');
const recipientKeyMissing = ref(false);
const messageInput        = ref('');
const inputFocused        = ref(false);
const messages            = ref<(ChatMessage & { mediaUrl?: string; mediaType?: 'image' | 'video'; mediaLoading?: boolean })[]>([]);
const typingState         = ref(false);
const content             = ref<any>(null);
const typingTimer         = ref<number | null>(null);
const fileInput           = ref<HTMLInputElement | null>(null);
const messagesContainer   = ref<HTMLDivElement | null>(null);

interface P2PTransfer { name: string; progress: number }
const p2pTransfer = ref<P2PTransfer | null>(null);

let chatService: ChatService | null = null;
let initGeneration = 0;

// ── WebRTC P2P ─────────────────────────────────────────────────────────────────
let peerConn: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;
let myUserId = '';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const CHUNK_SIZE  = 16 * 1024; // 16 KB

function gunSignal() {
  return GunService.getGun().get('chat-signals').get([myUserId, recipientId.value].sort().join(':'));
}

function closePeer() {
  dataChannel?.close();
  peerConn?.close();
  dataChannel = null;
  peerConn    = null;
}

async function createPeer(initiator: boolean): Promise<RTCDataChannel> {
  closePeer();
  peerConn = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // ICE candidates → Gun
  peerConn.onicecandidate = ({ candidate }) => {
    if (candidate) {
      gunSignal().get(`ice-${myUserId}-${Date.now()}`).put(JSON.stringify({ from: myUserId, candidate: candidate.toJSON() }));
    }
  };

  // Listen for remote ICE via Gun
  gunSignal().map().on((raw: any, key: string) => {
    if (!raw || typeof raw !== 'string') return;
    try {
      const data = JSON.parse(raw);
      if (data.from === myUserId) return; // own candidate
      if (data.candidate && peerConn?.remoteDescription) {
        void peerConn.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    } catch {}
  });

  if (initiator) {
    dataChannel = peerConn.createDataChannel('media', { ordered: true });
    setupDataChannel(dataChannel);

    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    gunSignal().get('offer').put(JSON.stringify({ from: myUserId, sdp: offer }));

    // Wait for answer
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('P2P answer timeout')), 20_000);
      gunSignal().get('answer').on(async (raw: any) => {
        if (!raw) return;
        try {
          const data = JSON.parse(raw);
          if (data.from === myUserId) return;
          await peerConn!.setRemoteDescription(new RTCSessionDescription(data.sdp));
          clearTimeout(timeout);
          resolve();
        } catch {}
      });
    });
  } else {
    // Receiver: wait for offer, send answer
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('P2P offer timeout')), 20_000);
      gunSignal().get('offer').on(async (raw: any) => {
        if (!raw) return;
        try {
          const data = JSON.parse(raw);
          if (data.from === myUserId) return;
          await peerConn!.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await peerConn!.createAnswer();
          await peerConn!.setLocalDescription(answer);
          gunSignal().get('answer').put(JSON.stringify({ from: myUserId, sdp: answer }));
          clearTimeout(timeout);
          resolve();
        } catch {}
      });
    });

    await new Promise<void>((resolve) => {
      peerConn!.ondatachannel = (e) => {
        dataChannel = e.channel;
        setupDataChannel(dataChannel);
        resolve();
      };
    });
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('P2P connection timeout')), 15_000);
    peerConn!.oniceconnectionstatechange = () => {
      const s = peerConn?.iceConnectionState;
      if (s === 'connected' || s === 'completed') { clearTimeout(timeout); resolve(); }
      if (s === 'failed') { clearTimeout(timeout); reject(new Error('ICE failed')); }
    };
  });

  return dataChannel!;
}

// Incoming file receive state
let recvMeta: { name: string; size: number; mime: string } | null = null;
let recvChunks: ArrayBuffer[] = [];
let recvReceived = 0;

function setupDataChannel(dc: RTCDataChannel) {
  dc.binaryType = 'arraybuffer';
  dc.onmessage = (e) => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'meta') {
        recvMeta    = msg;
        recvChunks  = [];
        recvReceived = 0;
        p2pTransfer.value = { name: msg.name, progress: 0 };
      } else if (msg.type === 'done' && recvMeta) {
        const blob     = new Blob(recvChunks, { type: recvMeta.mime });
        const url      = URL.createObjectURL(blob);
        const mtype    = String(recvMeta.mime || '').startsWith('video') ? 'video' : 'image';
        const fakeMsg: ChatMessage & { mediaUrl: string; mediaType: 'image' | 'video' } = {
          id: `p2p-${Date.now()}`, from: recipientId.value, to: myUserId,
          message: `[${mtype === 'video' ? 'Video' : 'Image'}]`,
          timestamp: Date.now(), read: false, sent: false,
          mediaUrl: url, mediaType: mtype,
        };
        messages.value.push(fakeMsg);
        nextTick(() => scrollToBottom());
        p2pTransfer.value = null;
        recvMeta = null;
      }
    } else {
      // Binary chunk
      recvChunks.push(e.data as ArrayBuffer);
      recvReceived += (e.data as ArrayBuffer).byteLength;
      if (recvMeta) {
        p2pTransfer.value = { name: recvMeta.name, progress: Math.round((recvReceived / recvMeta.size) * 100) };
      }
    }
  };
}

async function sendFileP2P(file: File) {
  const toast = await toastController.create({ message: 'Connecting peer-to-peer…', duration: 3000, position: 'top' });
  await toast.present();

  // Signal to recipient that we want to send via WebRTC
  gunSignal().get('want-p2p').put(JSON.stringify({ from: myUserId, ts: Date.now() }));

  try {
    const dc = await createPeer(true);

    // Send meta
    dc.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, mime: file.type }));

    // Stream chunks
    const buffer = await file.arrayBuffer();
    let offset   = 0;
    p2pTransfer.value = { name: file.name, progress: 0 };

    while (offset < buffer.byteLength) {
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      dc.send(chunk);
      offset += chunk.byteLength;
      p2pTransfer.value = { name: file.name, progress: Math.round((offset / buffer.byteLength) * 100) };
      // Backpressure: yield if buffer is getting full
      if (dc.bufferedAmount > 1_048_576) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    dc.send(JSON.stringify({ type: 'done' }));

    // Show preview on sender side
    const url   = URL.createObjectURL(file);
    const mtype = file.type.startsWith('video') ? 'video' : 'image';
    const fakeMsg: ChatMessage & { mediaUrl: string; mediaType: 'image' | 'video' } = {
      id: `p2p-sent-${Date.now()}`, from: myUserId, to: recipientId.value,
      message: `[${mtype === 'video' ? 'Video' : 'Image'}]`,
      timestamp: Date.now(), read: false, sent: true,
      mediaUrl: url, mediaType: mtype,
    };
    messages.value.push(fakeMsg);
    nextTick(() => scrollToBottom());
    p2pTransfer.value = null;
  } catch (err: any) {
    p2pTransfer.value = null;
    const t = await toastController.create({ message: `P2P failed: ${err?.message || 'unknown error'}`, duration: 3000, position: 'top', color: 'warning' });
    await t.present();
  }
}

function listenForIncomingP2P() {
  gunSignal().get('want-p2p').on(async (raw: any) => {
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.from === myUserId) return;
      // Peer wants to send us a file — connect as receiver
      await createPeer(false);
    } catch {}
  });
}

async function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  (e.target as HTMLInputElement).value = '';
  await sendFileP2P(file);
}

function openMedia(url: string) {
  window.open(url, '_blank');
}

// ── Avatar tone ────────────────────────────────────────────────────────────────
const TONES = ['tone-violet','tone-blue','tone-teal','tone-amber','tone-rose'];
function avatarTone(id: string) {
  const code = (id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}

// ── Delete all ─────────────────────────────────────────────────────────────────
async function confirmDeleteAll() {
  const alert = await alertController.create({
    header: 'Delete all messages?',
    message: 'This clears your local copy only. The other person keeps their copy.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete', role: 'destructive', cssClass: 'alert-danger',
        handler: async () => {
          if (!chatService) return;
          const stored = await StorageService.getAllChatMessages();
          const roomId = [myUserId, recipientId.value].sort().join(':');
          for (const m of stored.filter(m => m.roomId === roomId)) {
            await StorageService.deleteChatMessage(m.id);
          }
          messages.value = [];
        },
      },
    ],
  });
  await alert.present();
}

// ── Chat callbacks ─────────────────────────────────────────────────────────────
const currentMessages = computed(() => messages.value);
const isTypingState   = computed(() => typingState.value);

const statusLabel = computed(() => {
  if (chatError.value)  return 'Failed';
  if (!chatReady.value) return 'Setting up…';
  return connected.value ? 'Connected' : 'Offline';
});

function deliveryMark(msg: ChatMessage): string {
  if (msg.status === 'failed')  return '!';
  if (msg.status === 'pending') return '⋯';
  return msg.read ? '✓✓' : '✓';
}

function upsertMessage(msg: ChatMessage) {
  const at = messages.value.findIndex(m => m.id === msg.id);
  if (at === -1) messages.value.push(msg);
  else messages.value[at] = { ...messages.value[at], ...msg };
}

function bindChatCallbacks(service: ChatService) {
  service.onConnectionChange = (status) => { connected.value = status; };
  service.onMessage = (msg) => { upsertMessage(msg); nextTick(() => scrollToBottom()); };
  service.onMessageStatus = ({ id, status, error }) => {
    const at = messages.value.findIndex(m => m.id === id);
    if (at !== -1) messages.value[at] = { ...messages.value[at], status, error };
  };
  service.onTyping = ({ from, isTyping }) => { if (from === recipientId.value) typingState.value = isTyping; };
  service.onReadReceipt = ({ from, at }) => {
    if (from !== recipientId.value) return;
    messages.value.forEach(m => { if (m.sent && m.timestamp <= at) m.read = true; });
  };
  service.onRecipientKeyChange = ({ userId, available }) => {
    if (userId === recipientId.value) recipientKeyMissing.value = !available;
  };
  service.onDelivered = () => {};
}

function resetChatState() {
  messages.value = []; connected.value = false; chatReady.value = false;
  chatError.value = ''; recipientKeyMissing.value = false;
  messageInput.value = ''; typingState.value = false;
}

function disconnectChat() { chatService?.disconnect(); chatService = null; }

async function initializeChat() {
  const targetUserId = recipientId.value;
  if (!targetUserId) return;
  const gen = ++initGeneration;
  disconnectChat(); resetChatState(); closePeer();

  const currentUser = await UserService.getCurrentUser();
  if (gen !== initGeneration) return;
  myUserId = currentUser.id;

  const service = new ChatService(WS_URL, currentUser.id);
  bindChatCallbacks(service);
  chatService = service;

  try {
    await service.init();
    if (gen !== initGeneration) { service.disconnect(); return; }

    messages.value = await service.getLocalHistory(targetUserId);
    if (gen !== initGeneration) { service.disconnect(); return; }
    chatReady.value = true;
    recipientKeyMissing.value = !service.hasRecipientKey(targetUserId);
    scrollToBottom();

    // Start listening for incoming P2P file transfers
    listenForIncomingP2P();

    await service.startChat({ userId: targetUserId, name: recipientName.value });
    if (gen !== initGeneration) { service.disconnect(); return; }
    recipientKeyMissing.value = !service.hasRecipientKey(targetUserId);

    const history = await service.loadHistory(targetUserId);
    if (gen !== initGeneration) { service.disconnect(); return; }
    history.forEach(upsertMessage);
    messages.value.sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    chatError.value = err instanceof Error ? err.message : 'Could not start encrypted chat.';
  }
  service.markAsRead(targetUserId);
  scrollToBottom();
}

watch(recipientId, async (n, o) => { if (n && n !== o) await initializeChat(); });
onIonViewWillEnter(() => {
  if (!chatReady.value && recipientId.value) { void initializeChat(); return; }
  chatService?.markAsRead(recipientId.value);
});
onUnmounted(() => { initGeneration++; disconnectChat(); closePeer(); });

// ── Helpers ────────────────────────────────────────────────────────────────────
const scrollToBottom = () => { if (content.value) content.value.$el.scrollToBottom(300); };
watch(currentMessages, () => nextTick(() => scrollToBottom()), { deep: true });

const handleSend = async () => {
  if (!messageInput.value.trim() || !chatReady.value || !chatService) return;
  const text = messageInput.value.trim();
  messageInput.value = '';
  try {
    upsertMessage(await chatService.sendMessage(recipientId.value, text));
    chatService.sendTyping(recipientId.value, false);
    nextTick(() => scrollToBottom());
  } catch (err) {
    messageInput.value = text;
    chatError.value = err instanceof Error ? err.message : 'Message could not be sent';
  }
};

const handleTyping = () => {
  if (!chatService) return;
  chatService.sendTyping(recipientId.value, true);
  if (typingTimer.value) clearTimeout(typingTimer.value);
  typingTimer.value = window.setTimeout(() => chatService?.sendTyping(recipientId.value, false), 2000);
};

// Date separators
function showDateSep(i: number): boolean {
  if (i === 0) return true;
  const prev = currentMessages.value[i - 1];
  const curr = currentMessages.value[i];
  return new Date(prev.timestamp).toDateString() !== new Date(curr.timestamp).toDateString();
}
function dateSepLabel(ts: number): string {
  const d = new Date(ts), now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// Show tail only on last bubble in a consecutive run
function showTail(i: number): boolean {
  const msgs = currentMessages.value;
  if (i === msgs.length - 1) return true;
  return msgs[i].sent !== msgs[i + 1].sent;
}

const formatTime = (ts: number): string => {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
</script>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

/* ── Header ──────────────────────────────────────────────── */
.back-btn, .header-action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; cursor: pointer;
  transition: background 160ms;
}
.back-btn { color: var(--app-text-muted); margin-left: 2px; }
.back-btn:hover { background: rgba(255,255,255,0.06); color: var(--app-text); }
.back-btn svg, .header-action-btn svg { width: 22px; height: 22px; }
.header-action-btn.danger { color: #f87171; }
.header-action-btn.danger:hover { background: rgba(239,68,68,0.1); }

.header-identity {
  display: flex; align-items: center; gap: 10px;
  padding: 4px 0 4px 4px;
  min-width: 0;        /* allow flex shrink */
  flex: 1;
  overflow: hidden;
}
.hdr-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 800; color: #fff; flex-shrink: 0;
}
.hdr-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; overflow: hidden; }
.hdr-name {
  font-size: 14px; font-weight: 700; color: var(--app-text); line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}
.hdr-status { font-size: 10.5px; color: var(--app-text-subtle); font-weight: 500; }
.hdr-status.connected { color: #34d399; }
.hdr-status.error     { color: #f87171; }

/* ── Avatar tones ──────────────────────────────────────────── */
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); }

/* ── Typing ──────────────────────────────────────────────── */
.typing-bar {
  padding: 4px 16px 5px; font-size: 12px; color: var(--app-text-subtle);
  font-style: italic; display: flex; align-items: center; gap: 6px;
}
.typing-dots span {
  display: inline-block; width: 4px; height: 4px; border-radius: 50%;
  background: var(--app-text-subtle); animation: tdot 1.2s infinite ease-in-out;
}
.typing-dots span:nth-child(2) { animation-delay: .2s; }
.typing-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes tdot { 0%,80%,100% { transform: scale(0.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }

/* ── Layout ────────────────────────────────────────────────── */
.chat-container { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.messages-area {
  flex: 1; overflow-y: auto; padding: 12px 12px 6px;
  display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.07) transparent;
}

/* ── Empty state ───────────────────────────────────────────── */
.empty-chat {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; flex: 1; gap: 8px; padding: 40px 24px;
}
.empty-avatar {
  width: 72px; height: 72px; border-radius: 50%;
  font-size: 28px; font-weight: 900; color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.empty-name { font-size: 18px; font-weight: 700; color: var(--app-text); margin: 0; }
.empty-hint { font-size: 13px; color: var(--app-text-muted); margin: 0; text-align: center; }

/* ── Date separator ────────────────────────────────────────── */
.date-sep {
  display: flex; align-items: center; justify-content: center;
  margin: 10px 0 6px;
}
.date-sep span {
  font-size: 11px; font-weight: 600; color: var(--app-text-subtle);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
  padding: 3px 10px; border-radius: 999px; letter-spacing: 0.03em;
}

/* ── Message bubbles — square with tail poke ──────────────── */
.message {
  display: flex; flex-direction: column; max-width: 78%;
  animation: bubbleIn .2s cubic-bezier(0.34,1.56,0.64,1) both;
  margin-bottom: 1px; position: relative;
}
.message.sent     { align-self: flex-end;   align-items: flex-end;   }
.message.received { align-self: flex-start; align-items: flex-start; }
/* Extra breathing room when sender switches */
.message.tail     { margin-bottom: 10px; }
@keyframes bubbleIn { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; } }

.message-content {
  padding: 8px 14px;
  border-radius: 20px; /* comfortable, not pill */
  position: relative;
}

/* Sent: indigo, sharp bottom-right corner for tail */
.message.sent .message-content {
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  box-shadow: 0 2px 8px rgba(99,102,241,0.28);
  border-bottom-right-radius: 4px;
}
.message.sent .message-content p { color: #fff; }

/* Tail — sent, bottom-right */
.message.sent.tail .message-content::after {
  content: '';
  position: absolute; bottom: 0; right: -7px;
  width: 0; height: 0;
  border-style: solid;
  border-width: 8px 0 0 8px;
  border-color: transparent transparent transparent #8b5cf6;
}

/* Received: dark glass, sharp bottom-left corner */
.message.received .message-content {
  background: rgba(255,255,255,0.09);
  border: 1px solid rgba(255,255,255,0.1);
  border-bottom-left-radius: 4px;
}
.message.received .message-content p { color: var(--app-text); }

/* Tail — received, bottom-left */
.message.received.tail .message-content::after {
  content: '';
  position: absolute; bottom: 0; left: -7px;
  width: 0; height: 0;
  border-style: solid;
  border-width: 0 0 8px 8px;
  border-color: transparent transparent rgba(255,255,255,0.09) transparent;
}

.message-content p { margin: 0; font-size: 14.5px; line-height: 1.55; word-break: break-word; }

.message-meta { display: flex; align-items: center; gap: 4px; margin-top: 2px; padding: 0 3px; }
.message-time   { font-size: 10.5px; color: var(--app-text-subtle); }
.message-status { font-size: 10.5px; color: #a5b4fc; letter-spacing: -0.5px; }
.message-status.stalled { color: #fbbf24; font-weight: 700; }

/* ── Media bubbles ──────────────────────────────────────────── */
.media-bubble { padding: 4px !important; overflow: hidden; }
.media-img { display: block; max-width: 240px; max-height: 300px; border-radius: 16px; object-fit: cover; cursor: zoom-in; }
.media-video { display: block; max-width: 260px; border-radius: 16px; }
.media-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); border-radius: 16px;
}

/* ── P2P progress ───────────────────────────────────────────── */
.p2p-progress {
  margin: 6px 12px; padding: 10px 14px; border-radius: 12px;
  background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
  font-size: 12px; color: var(--app-text-muted); position: relative; overflow: hidden;
}
.p2p-bar {
  position: absolute; top: 0; left: 0; height: 100%;
  background: rgba(99,102,241,0.15); transition: width 200ms;
}
.p2p-progress span { position: relative; z-index: 1; }

/* ── Banners ────────────────────────────────────────────────── */
.chat-error-banner, .chat-warning-banner {
  margin: 0 12px 6px; padding: 8px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.5;
}
.chat-error-banner   { color: #f87171; background: rgba(239,68,68,0.09); border: 1px solid rgba(239,68,68,0.22); }
.chat-warning-banner { color: #fbbf24; background: rgba(251,191,36,0.09); border: 1px solid rgba(251,191,36,0.22); }

/* ── Input row ─────────────────────────────────────────────── */
.input-row {
  display: flex; align-items: flex-end; gap: 6px;
  padding: 8px 10px 12px;
  border-top: 1px solid rgba(255,255,255,0.06);
}

.input-pill {
  flex: 1; display: flex; align-items: flex-end;
  padding: 8px 14px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 22px;
  transition: border-color 180ms, box-shadow 180ms;
  min-height: 44px;
}
.input-pill.focused {
  border-color: rgba(99,102,241,0.45);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}

.message-input {
  flex: 1; background: transparent; border: none; outline: none;
  resize: none; font-size: 14.5px; line-height: 1.5;
  color: var(--ion-text-color); font-family: inherit;
  max-height: 120px; padding: 0;
}
.message-input::placeholder { color: var(--app-text-subtle); }
.message-input:disabled { opacity: .4; cursor: not-allowed; }

.attach-btn {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%;
  background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
  color: var(--app-text-muted); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 150ms, color 150ms;
}
.attach-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); color: var(--app-text); }
.attach-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.attach-btn svg { width: 18px; height: 18px; }

.send-button {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; border: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  box-shadow: 0 3px 12px rgba(99,102,241,0.38);
  transition: transform 160ms, box-shadow 160ms;
}
.send-button svg { width: 18px; height: 18px; }
.send-button:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 5px 18px rgba(99,102,241,0.5); }
.send-button:active:not(:disabled) { transform: scale(0.93); }
.send-button:disabled { background: rgba(255,255,255,0.08); color: var(--app-text-subtle); box-shadow: none; cursor: not-allowed; }

/* ── Spinner ────────────────────────────────────────────────── */
.mini-spinner {
  width: 24px; height: 24px;
  border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) { .message, .send-button, .input-pill { animation: none; transition: none; } }
</style>








