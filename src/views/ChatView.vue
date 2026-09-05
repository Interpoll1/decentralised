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
            <span class="hdr-status">
              <span class="presence-dot" :class="recipientOnline ? 'presence-dot--online' : 'presence-dot--offline'"></span>
              {{ recipientOnline ? 'Online' : 'Offline' }}
            </span>
          </div>
        </div>

        <ion-buttons slot="end">
          <span class="hdr-ws-status" :class="{ 'hdr-ws-status--ok': connected && !chatError }">
            {{ connected && !chatError ? 'Connected' : chatError ? 'Error' : 'Offline' }}
          </span>
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
                <!-- Image -->
                <div v-if="msg.mediaType === 'image'" class="media-wrap" @click="openLightbox(msg)">
                  <img :src="msg.mediaUrl" class="media-img" loading="lazy" />
                  <div class="media-overlay-btns">
                    <button class="media-dl-btn" @click.stop="downloadMedia(msg)" title="Download">
                      <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  </div>
                </div>
                <!-- Video -->
                <div v-else-if="msg.mediaType === 'video'" class="media-wrap media-wrap--video">
                  <div class="video-thumb-shell" @click="openLightbox(msg)">
                    <video
                      :src="msg.mediaUrl"
                      playsinline preload="metadata"
                      class="media-video"
                      @loadedmetadata="(e: any) => e.target.closest('.video-thumb-shell')?.classList.add('loaded')"
                      @click.stop
                    />
                    <!-- shimmer shown until metadata loaded -->
                    <div class="video-shimmer">
                      <div class="video-shimmer-wave"></div>
                      <svg class="video-film-icon" viewBox="0 0 24 24" fill="none">
                        <rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M2 7h20M2 17h20M7 2v20M17 2v20" stroke="currentColor" stroke-width="1.2" opacity=".5"/>
                      </svg>
                    </div>
                    <!-- play icon overlay -->
                    <div class="video-play-btn">
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                  <div class="media-overlay-btns">
                    <button class="media-dl-btn" @click.stop="downloadMedia(msg)" title="Download">
                      <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                  </div>
                </div>
                <!-- Generic file -->
                <a v-else :href="msg.mediaUrl" :download="msg.fileName || msg.message" target="_blank" rel="noopener" class="file-download-link">
                  <span class="file-icon">&#128196;</span>
                  <span class="file-name">{{ msg.fileName || msg.message }}</span>
                  <span v-if="msg.fileSize" class="file-size">{{ msg.fileSize >= 1048576 ? (msg.fileSize / 1048576).toFixed(1) + ' MB' : (msg.fileSize / 1024).toFixed(1) + ' KB' }}</span>
                </a>
                <!-- Upload progress overlay (relay upload) -->
                <div v-if="msg.uploadProgress != null && msg.uploadProgress != undefined && msg.uploadProgress < 100" class="media-upload-overlay">
                  <div class="media-upload-bar" :style="{ width: msg.uploadProgress + '%' }"></div>
                  <span class="media-upload-pct">{{ msg.uploadProgress }}%</span>
                </div>
              </div>

              <!-- Text bubble — guard against raw _file JSON or empty failed-decode rows -->
              <div v-else-if="msg.message && !msg.message.startsWith('{&quot;_file&quot;')" class="message-content">
                <p>{{ msg.message }}</p>
              </div>
              <!-- _file message that failed to decode, or raw JSON leaked through -->
              <div v-else class="message-content media-bubble" style="background:transparent!important;box-shadow:none!important;">
                <div class="media-decode-err">
                  <svg viewBox="0 0 24 24" fill="none" style="width:22px;height:22px;opacity:.5"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 6v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                  <span>Media unavailable</span>
                </div>
              </div>

              <div class="message-meta">
                <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
                <span v-if="msg.sent" class="message-status" :class="{ stalled: msg.status === 'failed' }">
                  {{ deliveryMark(msg) }}
                </span>
              </div>
            </div>
          </template>

          <!-- Lightbox -->
        <Teleport to="body">
          <div v-if="lightbox" class="lightbox-backdrop" @click.self="lightbox = null" @keydown.esc="lightbox = null" tabindex="-1">
            <div class="lightbox-inner">
              <button class="lightbox-close" @click="lightbox = null">&#10005;</button>
              <button class="lightbox-dl" @click="downloadMedia(lightbox)" title="Download">
                <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                Download
              </button>
              <img v-if="lightbox.mediaType === 'image'" :src="lightbox.mediaUrl" class="lightbox-media" />
              <video v-else-if="lightbox.mediaType === 'video'" :src="lightbox.mediaUrl" controls autoplay playsinline class="lightbox-media" />
            </div>
          </div>
        </Teleport>

        <!-- P2P transfer progress -->
          <div v-if="p2pTransfer" class="p2p-progress-card">
            <div class="p2p-progress-header">
              <!-- File thumbnail preview -->
              <div class="p2p-thumb">
                <img v-if="p2pTransfer.previewUrl" :src="p2pTransfer.previewUrl" class="p2p-thumb-img" />
                <span v-else class="p2p-direction-icon">
                  <svg v-if="p2pTransfer.direction === 'sending'" viewBox="0 0 24 24" fill="none">
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <svg v-else viewBox="0 0 24 24" fill="none">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </div>
              <div class="p2p-file-info">
                <span class="p2p-file-name">{{ p2pTransfer.name }}</span>
                <span class="p2p-file-status">
                  {{ p2pTransfer.direction === 'sending' ? 'Sending' : 'Receiving' }} · {{ p2pTransfer.progress < 5 && p2pTransfer.direction === 'sending' ? 'Connecting…' : p2pTransfer.progress + '%' }}
                </span>
              </div>
              <span class="p2p-pct">{{ p2pTransfer.progress }}%</span>
            </div>
            <div class="p2p-track">
              <div class="p2p-fill" :style="{ width: Math.max(p2pTransfer.progress, 3) + '%' }">
                <div class="p2p-shimmer"></div>
              </div>
            </div>
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

        <!-- P2P info banner: shown when hovering attach or actively transferring -->
        <div class="p2p-info-banner" :class="{ 'p2p-info-banner--active': showP2PInfo || !!p2pTransfer }">
          <svg viewBox="0 0 24 24" fill="none" class="p2p-info-icon">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/>
            <path d="M12 8h.01M12 11v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span>
            Image &amp; video transfers are <strong>direct peer-to-peer</strong> — no server involved.
            <strong>Both users must be online</strong> at the same time. Unlike text messages, files
            cannot be queued for offline delivery.
          </span>
        </div>

        <!-- Typing indicator above input (presence is shown in header only) -->
        <div class="bottom-status-bar" :class="{ 'bottom-status-bar--visible': isTypingState }">
          <div v-if="isTypingState" class="typing-indicator">
            <span class="typing-dots"><span></span><span></span><span></span></span>
            <span class="typing-label">{{ recipientName }} is typing…</span>
          </div>
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
          <button class="attach-btn" @click="openFilePickerWithPresence()" :disabled="!chatReady" title="Send image or video"
            @mouseenter="showP2PInfo = true" @mouseleave="showP2PInfo = false"
            @focus="showP2PInfo = true"   @blur="showP2PInfo = false">
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

interface P2PTransfer { name: string; progress: number; direction: 'sending' | 'receiving'; previewUrl?: string }
const p2pTransfer  = ref<P2PTransfer | null>(null);
const showP2PInfo  = ref(false);

let chatService: ChatService | null = null;
let initGeneration = 0;

// ── P2P debug logger ───────────────────────────────────────────────────────────
let lastP2PLog = '';
let lastP2PLogCount = 0;
function p2pLog(step: string, data?: any) {
  const ts = new Date().toISOString().slice(11, 23);
  const key = step + (data ? JSON.stringify(data) : '');
  if (key === lastP2PLog) {
    lastP2PLogCount++;
    if (lastP2PLogCount > 3) return; // suppress after 3 repeats
  } else {
    lastP2PLog = key; lastP2PLogCount = 0;
  }
  data !== undefined
    ? console.log(`[P2P ${ts}] ${step}`, data)
    : console.log(`[P2P ${ts}] ${step}`);
}
function p2pErr(step: string, err?: any) {
  console.error(`[P2P ERR] ${step}`, err ?? '');
}

// ── Presence ────────────────────────────────────────────────────────────────────
// Presence is fully owned by ChatService. This ref is updated via
// service.onPeerPresence → bindChatCallbacks → recipientOnline.value = online.
const recipientOnline = ref(false);

// ── WebRTC P2P ─────────────────────────────────────────────────────────────────
let peerConn:    RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel   | null = null;
let myUserId = '';
let p2pSession = '';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const CHUNK_SIZE    = 64 * 1024;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// ── Relay WS P2P signaling ────────────────────────────────────────────────────
const _rtcWaiters = new Map<string, (payload: any) => void>();
let _rtcListenerAttached = false;

function ensureRtcListener() {
  if (_rtcListenerAttached) return;
  _rtcListenerAttached = true;
  // Primary: chatService.onRtcSignal fires for relay WS frames
  if (chatService) {
    chatService.onRtcSignal = (d: { from: string; payload: any }) => {
      if (!d?.payload) return;
      const key  = `${d.from}:${d.payload.kind}:${d.payload.sess || ''}`;
      const wild = `${d.from}:${d.payload.kind}:*`;
      const cb   = _rtcWaiters.get(key) || _rtcWaiters.get(wild);
      if (cb) cb(d.payload);
    };
  }
  // Fallback: Gun peer wire
  const attachToWire = () => {
    try {
      const peers = (GunService.getGun() as any)?._.opt?.peers || {};
      for (const k of Object.keys(peers)) {
        const wire = peers[k]?.wire as WebSocket | undefined;
        if (!wire || (wire as any).__rtcPatched) continue;
        (wire as any).__rtcPatched = true;
        wire.addEventListener('message', (e: MessageEvent) => {
          try {
            const d = JSON.parse(e.data);
            if (d?.type !== 'rtc-signal' || !d.payload) return;
            const key  = `${d.from}:${d.payload.kind}:${d.payload.sess || ''}`;
            const wild = `${d.from}:${d.payload.kind}:*`;
            const cb   = _rtcWaiters.get(key) || _rtcWaiters.get(wild);
            if (cb) cb(d.payload);
          } catch {}
        });
      }
    } catch {}
  };
  attachToWire();
  GunService.onReconnect(() => {
    _rtcListenerAttached = false;
    setTimeout(() => {
      _rtcListenerAttached = true;
      // Re-assign chatService handler in case service was reconnected
      if (chatService) {
        chatService.onRtcSignal = (d: { from: string; payload: any }) => {
          if (!d?.payload) return;
          const key  = `${d.from}:${d.payload.kind}:${d.payload.sess || ''}`;
          const wild = `${d.from}:${d.payload.kind}:*`;
          const cb   = _rtcWaiters.get(key) || _rtcWaiters.get(wild);
          if (cb) cb(d.payload);
        };
      }
      attachToWire();
    }, 500);
  });
}

function sendRtcSignal(toUserId: string, payload: Record<string, any>) {
  // Primary: chat relay WS via chatService (routed by userId, always authed)
  if (chatService) { chatService.sendRtcSignal(toUserId, payload); }
  // Also try Gun peer wire as fallback in case relay rtc-signal not deployed
  try {
    const peers = (GunService.getGun() as any)?._.opt?.peers || {};
    for (const k of Object.keys(peers)) {
      const wire = peers[k]?.wire as WebSocket | undefined;
      if (wire?.readyState === WebSocket.OPEN) {
        wire.send(JSON.stringify({ type: 'rtc-signal', to: toUserId, payload }));
        return;
      }
    }
  } catch {}
}

function waitForRtcSignal(fromUserId: string, kind: string, sess: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const key   = `${fromUserId}:${kind}:${sess}`;
    const timer = setTimeout(() => { _rtcWaiters.delete(key); reject(new Error(`rtc-signal timeout: ${kind}`)); }, timeoutMs);
    _rtcWaiters.set(key, (payload) => { clearTimeout(timer); _rtcWaiters.delete(key); resolve(payload); });
    const roomKey  = [myUserId, fromUserId].sort().join(':');
    const gunChain = GunService.getGun().get('chat-p2p').get(roomKey).map().on((raw: any) => {
      if (!raw) return;
      try {
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (d?.kind === kind && (d?.sess === sess || !sess) && d?.from !== myUserId) {
          clearTimeout(timer); _rtcWaiters.delete(key);
          try { gunChain?.off?.(); } catch {}
          resolve(d);
        }
      } catch {}
    });
  });
}

let _iceQueue: any[] = [];
let _iceHandler: ((c: any) => void) | null = null;

function startIceQueue(fromUserId: string, sess: string) {
  _iceQueue = []; _iceHandler = null;
  const wildKey = `${fromUserId}:ice:*`;
  const handler = (payload: any) => {
    if (payload.sess !== sess) return;
    if (_iceHandler) _iceHandler(payload.ice); else _iceQueue.push(payload.ice);
    _rtcWaiters.set(wildKey, handler);
  };
  _rtcWaiters.set(wildKey, handler);
  const roomKey = [myUserId, fromUserId].sort().join(':');
  GunService.getGun().get('chat-p2p').get(roomKey).map().on((raw: any, key: string) => {
    if (!raw || !key?.includes('ice')) return;
    try {
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (d?.ice && d?.sess === sess && d?.from !== myUserId) {
        if (_iceHandler) _iceHandler(d.ice); else _iceQueue.push(d.ice);
      }
    } catch {}
  });
}

function stopIceQueue(fromUserId: string) {
  _rtcWaiters.delete(`${fromUserId}:ice:*`);
  _iceQueue = []; _iceHandler = null;
}

function onNextIce(handler: (candidate: any) => void) {
  _iceHandler = handler;
  for (const c of _iceQueue.splice(0)) handler(c);
}

function startSignalKeepAlive() {}
function stopSignalKeepAlive() {}

// Sender sets this true in offererConnect(), receiver sets false in answererConnect().
// Must NOT be derived from userId comparison — that made only the alphabetically-
// lower user capable of initiating, deadlocking the other user's send attempts.
let iAmOfferer = false;

function closePeer() {
  dataChannel?.close(); peerConn?.close();
  dataChannel = null;   peerConn    = null;
}

async function clearSignals() {
  // Null want-p2p so Gun's in-memory graph doesn't replay it to the next
  // answerer subscriber. The relay no longer persists bare chat-p2p nodes
  // to MySQL, but Gun's own in-memory graph still holds the last value.
  p2pLog('clearSignals: nulling want-p2p');
  // Clear stale want-p2p from Gun graph so it doesn't replay to new subscribers
  const roomKey = [myUserId, recipientId.value].sort().join(':');
  try { GunService.getGun().get('chat-p2p').get(roomKey).get('want-p2p').put(null as any); } catch {}
  await new Promise<void>(r => setTimeout(r, 100));
}

async function setupPeerConnection(): Promise<void> {
  closePeer();
  p2pLog('setupPeerConnection: creating RTCPeerConnection', { isOfferer: iAmOfferer, session: p2pSession });
  peerConn = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Buffer remote ICE candidates that arrive before setRemoteDescription
  const pendingIce: RTCIceCandidateInit[] = [];


  peerConn.onicecandidate = ({ candidate }) => {
    if (!candidate) { p2pLog('ICE: gathering complete'); return; }
    p2pLog('ICE: local candidate', { type: candidate.type, protocol: candidate.protocol });
    sendRtcSignal(recipientId.value, { kind: 'ice', sess: p2pSession, from: myUserId, ice: candidate.toJSON() });
  };

  peerConn.onicegatheringstatechange  = () => { p2pLog('ICE gathering state:', peerConn?.iceGatheringState); };
  peerConn.oniceconnectionstatechange = () => { p2pLog('ICE connection state:', peerConn?.iceConnectionState); };
  peerConn.onsignalingstatechange     = () => { p2pLog('Signaling state:', peerConn?.signalingState); };
  peerConn.onconnectionstatechange    = () => { p2pLog('Connection state:', peerConn?.connectionState); };

  async function flushPendingIce() {
    if (!peerConn?.remoteDescription || pendingIce.length === 0) return;
    p2pLog(`ICE: flushing ${pendingIce.length} buffered candidates`);
    for (const ice of pendingIce.splice(0)) {
      await peerConn.addIceCandidate(new RTCIceCandidate(ice)).catch(e => p2pErr('addIceCandidate (flush)', e));
    }
  }

  const origSetRemote = peerConn.setRemoteDescription.bind(peerConn);
  peerConn.setRemoteDescription = async (desc: RTCSessionDescriptionInit) => {
    await origSetRemote(desc);
    await flushPendingIce();
  };

  // ICE candidates arrive via relay WS queue (fast) + Gun fallback
  startIceQueue(recipientId.value, p2pSession);
  onNextIce((ice) => {
    const apply = (candidate: any) => {
      if (!peerConn?.remoteDescription) { p2pLog('ICE: buffering candidate'); pendingIce.push(candidate); return; }
      p2pLog('ICE: applying remote candidate', { type: candidate?.type });
      void peerConn.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => p2pErr('addIceCandidate', e));
    };
    apply(ice);
    onNextIce(apply);
  });
}

async function waitForDataChannel(): Promise<RTCDataChannel> {
  if (iAmOfferer) {
    p2pLog('DataChannel: creating as offerer');
    dataChannel = peerConn!.createDataChannel('media', { ordered: true });
    dataChannel.onopen  = () => p2pLog('DataChannel: open (offerer)');
    dataChannel.onclose = () => p2pLog('DataChannel: closed (offerer)');
    dataChannel.onerror = (e) => p2pErr('DataChannel error (offerer)', e);
    return dataChannel;
  }
  p2pLog('DataChannel: waiting for ondatachannel (answerer)');
  return new Promise(resolve => {
    peerConn!.ondatachannel = e => {
      p2pLog('DataChannel: received (answerer)');
      dataChannel = e.channel;
      dataChannel.onopen  = () => p2pLog('DataChannel: open (answerer)');
      dataChannel.onclose = () => p2pLog('DataChannel: closed (answerer)');
      dataChannel.onerror = ev => p2pErr('DataChannel error (answerer)', ev);
      resolve(e.channel);
    };
  });
}

async function negotiate(preRegisteredReadyPromise?: Promise<any>): Promise<void> {
  const sess = p2pSession;
  p2pLog('negotiate: start', { role: iAmOfferer ? 'offerer' : 'answerer', sess });

  if (iAmOfferer) {
    p2pLog('negotiate: waiting for answerer-ready...');
    await (preRegisteredReadyPromise ?? waitForRtcSignal(recipientId.value, 'ready', sess, 30_000));
    p2pLog('negotiate: answerer-ready received');

    const offer = await peerConn!.createOffer();
    await peerConn!.setLocalDescription(offer);
    p2pLog('negotiate: sending offer via relay WS');
    sendRtcSignal(recipientId.value, { kind: 'offer', sess, from: myUserId, sdp: peerConn!.localDescription });

    p2pLog('negotiate: waiting for answer…');
    const answerPayload = await waitForRtcSignal(recipientId.value, 'answer', sess, 30_000);
    if (peerConn!.signalingState !== 'have-local-offer') { p2pErr('negotiate: unexpected state', peerConn?.signalingState); return; }
    await peerConn!.setRemoteDescription(new RTCSessionDescription(answerPayload.sdp));
    p2pLog('negotiate: remote answer applied ✓');

  } else {
    p2pLog('negotiate: listening for offer, then sending ready');
    const offerPromise = waitForRtcSignal(recipientId.value, 'offer', sess, 30_000);

    sendRtcSignal(recipientId.value, { kind: 'ready', sess, from: myUserId, ts: Date.now() });
    p2pLog('negotiate: answerer-ready sent ✓');

    const offerPayload = await offerPromise;
    if (peerConn!.signalingState !== 'stable') { p2pErr('negotiate: unexpected state', peerConn?.signalingState); return; }
    p2pLog('negotiate: applying remote offer');
    await peerConn!.setRemoteDescription(new RTCSessionDescription(offerPayload.sdp));
    const answer = await peerConn!.createAnswer();
    await peerConn!.setLocalDescription(answer);
    sendRtcSignal(recipientId.value, { kind: 'answer', sess, from: myUserId, sdp: peerConn!.localDescription });
    p2pLog('negotiate: answer sent ✓');
  }

  p2pLog('negotiate: complete ✓');
}

async function waitForConnected(): Promise<void> {
  const s = peerConn!.iceConnectionState;
  p2pLog('waitForConnected: current state', { state: s });
  if (s === 'connected' || s === 'completed') { p2pLog('waitForConnected: already connected'); return; }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      p2pErr('waitForConnected: ICE timeout', { finalState: peerConn?.iceConnectionState });
      reject(new Error('Could not establish direct connection (ICE timeout)'));
    }, 15_000);
    peerConn!.oniceconnectionstatechange = () => {
      const st = peerConn?.iceConnectionState;
      p2pLog('waitForConnected: state change', { st });
      if (st === 'connected' || st === 'completed') { clearTimeout(t); p2pLog('waitForConnected: connected'); resolve(); }
      if (st === 'failed') { clearTimeout(t); p2pErr('waitForConnected: ICE failed'); reject(new Error('Direct connection failed')); }
    };
  });
}

let recvMeta:     { name: string; size: number; type: string } | null = null;
let recvChunks:   ArrayBuffer[] = [];
let recvReceived: number = 0;

function setupDataChannelHandlers(dc: RTCDataChannel) {
  dc.binaryType = 'arraybuffer';
  dc.onmessage = e => {
    if (typeof e.data === 'string') {
      const msg = JSON.parse(e.data);
      if (msg.type === 'meta') {
        recvMeta = msg; recvChunks = []; recvReceived = 0;
        p2pTransfer.value = { name: msg.name, progress: 0, direction: 'receiving' };
      } else if (msg.type === 'done' && recvMeta) {
        const blob  = new Blob(recvChunks, { type: recvMeta.type });
        const url   = URL.createObjectURL(blob);
        const mtype = recvMeta.type.startsWith('video') ? 'video' : 'image';
        messages.value = [...messages.value, {
          id: `p2p-recv-${Date.now()}`, from: recipientId.value, to: myUserId,
          message: `[${mtype}]`, timestamp: Date.now(), read: false, sent: false,
          mediaUrl: url, mediaType: mtype,
        } as any];
        nextTick(() => scrollToBottom());
        p2pTransfer.value = null; recvMeta = null;
      }
    } else {
      recvChunks.push(e.data as ArrayBuffer);
      recvReceived += (e.data as ArrayBuffer).byteLength;
      if (recvMeta) p2pTransfer.value = {
        name: recvMeta.name,
        progress: Math.round((recvReceived / recvMeta.size) * 100),
        direction: 'receiving',
      };
    }
  };
}

// Offerer: generates session, clears stale signals, drives the negotiation
async function offererConnect(): Promise<RTCDataChannel> {
  iAmOfferer = true;  // must be set before setupPeerConnection/negotiate/waitForDataChannel
  p2pSession = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  p2pLog('offererConnect: new session', { sess: p2pSession, myUserId, recipientId: recipientId.value });

  startSignalKeepAlive();
  await clearSignals();

  await setupPeerConnection();
  p2pLog('offererConnect: peer conn ready');

  ensureRtcListener();
  startIceQueue(recipientId.value, p2pSession);

  // Pre-register 'ready' waiter BEFORE sending want-p2p.
  // The answerer can send 'ready' very fast (sub-ms on same device) and if
  // we haven't registered the waiter yet the signal is dropped and we timeout.
  const readyPromise = waitForRtcSignal(recipientId.value, 'ready', p2pSession, 30_000);

  p2pLog('offererConnect: sending want-p2p');
  sendRtcSignal(recipientId.value, { kind: 'want-p2p', sess: p2pSession, from: myUserId, ts: Date.now() });
  // Gun fallback: also write to Gun so receiver picks it up even if relay
  // rtc-signal forwarding is not yet deployed on the production server
  const _wantRoomKey = [myUserId, recipientId.value].sort().join(':');
  try { GunService.getGun().get('chat-p2p').get(_wantRoomKey).get('want-p2p')
    .put(JSON.stringify({ kind: 'want-p2p', sess: p2pSession, from: myUserId, ts: Date.now() })); } catch {}

  const [dc] = await Promise.all([waitForDataChannel(), negotiate(readyPromise)]);
  p2pLog('offererConnect: negotiation done, waiting for ICE');

  await waitForConnected();
  stopIceQueue(recipientId.value);
  stopSignalKeepAlive();
  p2pLog('offererConnect: READY');
  setupDataChannelHandlers(dc);
  return dc;
}

// Answerer: takes the session token from the offerer's want-p2p signal, never generates one
async function answererConnect(sess: string): Promise<void> {
  iAmOfferer = false;
  if (dataChannel?.readyState === 'open') { p2pLog('answererConnect: channel already open'); return; }

  p2pSession = sess;
  p2pLog('answererConnect: using offerer session', { sess: p2pSession, myUserId, recipientId: recipientId.value });

  ensureRtcListener();
  startIceQueue(recipientId.value, p2pSession);

  await setupPeerConnection();
  p2pLog('answererConnect: peer conn ready');

  const [dc] = await Promise.all([waitForDataChannel(), negotiate()]);
  p2pLog('answererConnect: negotiation done, waiting for ICE');

  await waitForConnected();
  stopIceQueue(recipientId.value);
  stopSignalKeepAlive();
  p2pLog('answererConnect: READY');
  setupDataChannelHandlers(dc);
}

async function sendFileP2P(file: File) {
  p2pLog('sendFileP2P: start', { name: file.name, size: file.size, type: file.type });

  if (file.size > MAX_FILE_SIZE) {
    const t = await toastController.create({
      message: `File too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Maximum is 100 MB.`,
      duration: 4000, position: 'top', color: 'warning',
    });
    await t.present();
    return;
  }

  // Suppress offline signal for the full transfer duration.
  const releaseOfflineSuppression = chatService?.suppressOffline(120_000) ?? (() => {});

  // Warn if offline but still attempt
  if (chatService && !(await chatService.isPeerOnline(recipientId.value))) {
    const tw = await toastController.create({ message: recipientName.value + ' appears offline. Attempting anyway...', duration: 3000, position: 'top', color: 'warning' });
    await tw.present();
  }
    const previewUrl = file.type.startsWith('image') ? URL.createObjectURL(file) : undefined;
  p2pTransfer.value = { name: file.name, progress: 0, direction: 'sending', previewUrl };

  const doTransfer = async () => {
    const dc = await offererConnect();
    dc.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size, type: file.type }));
    const buffer = await file.arrayBuffer();
    let offset = 0;
    while (offset < buffer.byteLength) {
      while (dc.bufferedAmount > 256 * 1024) await new Promise(r => setTimeout(r, 20));
      const chunk = buffer.slice(offset, offset + CHUNK_SIZE);
      dc.send(chunk); offset += chunk.byteLength;
      p2pTransfer.value = { name: file.name, progress: Math.round(offset / buffer.byteLength * 100), direction: 'sending', previewUrl };
    }
    dc.send(JSON.stringify({ type: 'done' }));
  };
  let lastErr: any;
  for (const [attempt, delay] of [[0,0],[1,3000],[2,8000]] as [number,number][]) {
    if (delay) { closePeer(); p2pTransfer.value = { name: file.name, progress: 0, direction: 'sending', previewUrl }; await new Promise(r => setTimeout(r, delay)); }
    try {
      await doTransfer();
      const url = URL.createObjectURL(file);
      const mtype = file.type.startsWith('video') ? 'video' : 'image';
      messages.value = [...messages.value, { id: 'p2p-sent-' + Date.now(), from: myUserId, to: recipientId.value, message: '[' + mtype + ']', timestamp: Date.now(), read: false, sent: true, mediaUrl: url, mediaType: mtype } as any];
      nextTick(() => scrollToBottom(true)); p2pTransfer.value = null; releaseOfflineSuppression();
      p2pLog('sendFileP2P: complete', { attempt }); return;
    } catch (e: any) { lastErr = e; p2pErr('sendFileP2P attempt ' + attempt, e); }
  }
  p2pTransfer.value = null; releaseOfflineSuppression(); closePeer();
  const t = await toastController.create({ message: 'File transfer failed after 3 attempts.', duration: 5000, position: 'top', color: 'warning' });
  await t.present();
}

function listenForIncomingP2P() {
  p2pLog('listenForIncomingP2P: watching for want-p2p via relay WS + Gun fallback');
  let answering = false;
  let lastProcessedKey = '';

  ensureRtcListener();

  const handleWantP2P = async (d: any) => {
    const signalKey = `${d.sess}-${d.ts}`;
    if (d.from === myUserId)                { p2pLog('listenForIncomingP2P: ignoring own signal'); return; }
    if (dataChannel?.readyState === 'open') { p2pLog('listenForIncomingP2P: channel already open'); return; }
    if (signalKey === lastProcessedKey)     { p2pLog('listenForIncomingP2P: duplicate, skipping'); return; }
    if (answering)                          { p2pLog('listenForIncomingP2P: already answering'); return; }
    const age = Date.now() - (d.ts ?? 0);
    if (age > 60_000) { p2pLog('listenForIncomingP2P: stale signal, ignoring', { ageMs: age }); return; }
    lastProcessedKey = signalKey;
    answering = true;
    p2pLog('listenForIncomingP2P: parsed', { from: d.from, myUserId, sess: d.sess, signalKey });
    p2pLog('listenForIncomingP2P: starting answererConnect', { sess: d.sess });
    try {
      await answererConnect(d.sess || '');
      p2pLog('listenForIncomingP2P: answererConnect complete');
    } catch (e) { p2pErr('listenForIncomingP2P', e); }
    finally { answering = false; }
  };

  // Layer 1: relay WS (fast)
  const wantKey = `${recipientId.value}:want-p2p:*`;
  const wantHandler = async (payload: any) => {
    await handleWantP2P(payload);
    _rtcWaiters.set(wantKey, wantHandler);
  };
  _rtcWaiters.set(wantKey, wantHandler);

  // Layer 2: Gun fallback
  const roomKey = [myUserId, recipientId.value].sort().join(':');
  GunService.getGun().get('chat-p2p').get(roomKey).get('want-p2p').on(async (raw: any) => {
    if (!raw) return;
    try {
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      await handleWantP2P(d);
    } catch (e) { p2pErr('listenForIncomingP2P Gun', e); }
  });
}

async function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file || !chatService) return;
  // For small files (<= 400 KB) chatService sends inline — instant.
  // For large files it uploads to the relay; we show a progress placeholder.
  const isLarge = file.size > 400 * 1024;
  let placeholderId: string | null = null;
  if (isLarge) {
    // Insert a placeholder bubble with a preview URL and 0% progress
    placeholderId = `upload-${Date.now()}`;
    // Create a local preview URL for both image and video — shown during upload
    const previewUrl = (file.type.startsWith('image') || file.type.startsWith('video'))
      ? URL.createObjectURL(file) : undefined;
    const mtype = file.type.startsWith('video') ? 'video' : file.type.startsWith('image') ? 'image' : 'file';
    upsertMessage({
      id: placeholderId, from: myUserId, to: recipientId.value,
      message: file.name, timestamp: Date.now(), read: false, sent: true,
      mediaUrl: previewUrl, mediaType: mtype as any,
      fileName: file.name, fileSize: file.size,
      uploadProgress: 0,
    } as any);
    nextTick(() => scrollToBottom(true));
    // Estimate upload duration from file size (assume ~500 KB/s on a typical connection)
    // and advance progress smoothly to 92%, leaving the last 8% for server processing.
    const estimatedMs  = Math.max(800, (file.size / (500 * 1024)) * 1000);
    const tickMs       = 250;
    const totalTicks   = estimatedMs / tickMs;
    const stepPerTick  = 92 / totalTicks;
    let fakePct = 0;
    const fakeTimer = setInterval(() => {
      // Ease-out: slow down as we approach 92% so it doesn't look frozen if upload runs long
      const remaining = 92 - fakePct;
      fakePct = Math.min(fakePct + stepPerTick * (remaining / 92 + 0.3), 92);
      const idx = messages.value.findIndex(m => m.id === placeholderId);
      if (idx !== -1) {
        const updated = [...messages.value];
        (updated[idx] as any).uploadProgress = Math.round(fakePct);
        messages.value = updated;
      }
    }, tickMs);
    try {
      const msg = await chatService.sendFile(recipientId.value, file);
      clearInterval(fakeTimer);
      // Replace placeholder with the real sent message.
      // Keep the local blob URL (previewUrl) as the sender's mediaUrl — avoids a
      // network round-trip back to the relay just to show your own sent video/image.
      const idx = messages.value.findIndex(m => m.id === placeholderId);
      const existingPreview = idx !== -1 ? (messages.value[idx] as any).mediaUrl : undefined;
      const finalMsg = {
        ...msg,
        mediaUrl: existingPreview || msg.mediaUrl, // prefer local blob
        uploadProgress: undefined, // clear progress overlay
      };
      if (idx !== -1) {
        const updated = [...messages.value];
        updated[idx] = finalMsg as any;
        messages.value = updated;
      } else {
        upsertMessage(finalMsg);
      }
      nextTick(() => scrollToBottom(true));
    } catch (err: any) {
      clearInterval(fakeTimer);
      // Remove placeholder on error
      messages.value = messages.value.filter(m => m.id !== placeholderId);
      const t = await toastController.create({ message: err?.message || 'Failed to send file', duration: 5000, position: 'top', color: 'danger' });
      await t.present();
    }
  } else {
    // Small file — instant, no progress UI needed
    try {
      const msg = await chatService.sendFile(recipientId.value, file);
      upsertMessage(msg);
      nextTick(() => scrollToBottom(true));
    } catch (err: any) {
      const t = await toastController.create({ message: err?.message || 'Failed to send file', duration: 5000, position: 'top', color: 'danger' });
      await t.present();
    }
  }
}

function openFilePickerWithPresence() {
  // Suppress offline signal before file picker opens — on mobile the picker
  // triggers visibilitychange (hidden=true) which would flash us offline to peer.
  chatService?.suppressOffline(60_000);
  fileInput.value?.click();
}

// Lightbox state
const lightbox = ref<{ mediaUrl: string; mediaType: 'image'|'video'; fileName?: string } | null>(null);
function openLightbox(msg: any) { lightbox.value = { mediaUrl: msg.mediaUrl, mediaType: msg.mediaType, fileName: msg.fileName }; }
function downloadMedia(msg: any) {
  if (!msg?.mediaUrl) return;
  const a = document.createElement('a');
  a.href = msg.mediaUrl;
  a.download = msg.fileName || (msg.mediaType === 'video' ? 'video.mp4' : 'image');
  a.target = '_blank';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
    message: 'This clears your copy of the conversation. The other person keeps their copy.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Delete', role: 'destructive', cssClass: 'alert-danger',
        handler: async () => {
          if (!chatService) return;
          const roomId = [myUserId, recipientId.value].sort().join(':');
          try {
            const all  = await StorageService.getAllChatMessages();
            const mine = all.filter((m: any) => m.roomId === roomId);
            // Overwrite each message as corrupted so it never re-renders
            for (const m of mine) {
              await StorageService.saveChatMessage({ ...m, text: '', syncStatus: 'corrupted' as any });
            }
            // Nullify our own outgoing Gun nodes and write deletion marker
            const gun = GunService.getGun();
            for (const m of mine.filter((m: any) => m.outgoing)) {
              try { gun.get('chats').get(roomId).get(m.id).put(null as any); } catch {}
            }
            try { gun.get('chat-deleted').get(roomId).get(myUserId)
              .put({ ts: Date.now(), cleared: true }); } catch {}
          } catch (err) {
            console.error('[Chat] delete failed:', err);
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
  // Primary dedup: by message id (covers 99% of cases)
  let at = messages.value.findIndex(m => m.id === msg.id);

  // Secondary dedup: only for upload placeholders whose id was temporary.
  // A placeholder id starts with 'upload-'; Gun re-delivers the real message
  // with a different id shortly after. Match by exact timestamp + from + mediaType.
  // Window is 500ms (not 2s) to avoid false-positives on rapid-fire messages.
  if (at === -1 && msg.sent) {
    at = messages.value.findIndex(m =>
      m.sent &&
      m.from === msg.from &&
      m.id.startsWith('upload-') &&
      Math.abs(m.timestamp - msg.timestamp) < 500 &&
      m.mediaType === msg.mediaType
    );
  }

  if (at === -1) {
    messages.value = [...messages.value, msg];
  } else {
    const updated = [...messages.value];
    const existing = updated[at];
    updated[at] = {
      ...existing,
      ...msg,
      // Never downgrade sent:true → sent:false from a Gun re-delivery where
      // senderId comparison fails (e.g. case/encoding mismatch). Once a message
      // is known to be outgoing, keep it that way.
      sent: existing.sent || msg.sent,
      // Never downgrade read:true → read:false
      read: existing.read || msg.read,
      // Keep local blob URL while it's still valid (avoids flicker to relay URL)
      mediaUrl: existing.mediaUrl || msg.mediaUrl,
      id: existing.id.startsWith('upload-') ? msg.id : existing.id,
    };
    messages.value = updated;
  }
}

function bindChatCallbacks(service: ChatService) {
  service.onConnectionChange = (status) => { connected.value = status; };
  service.onMessage = (msg) => {
    upsertMessage(msg);
    nextTick(() => scrollToBottom(true));
    // If an incoming message arrives while we're actively viewing this chat,
    // immediately send a read receipt so the sender gets their double tick.
    if (!msg.sent && document.visibilityState === 'visible') {
      service.markAsRead(recipientId.value);
    }
  };
  service.onMessageStatus = ({ id, status, error }) => {
    const at = messages.value.findIndex(m => m.id === id);
    if (at !== -1) {
      const updated = [...messages.value];
      updated[at] = { ...updated[at], status, error };
      messages.value = updated;
    }
  };
  let _typingClearTimer: number | null = null;
  service.onTyping = ({ from, isTyping }) => {
    if (from !== recipientId.value) return;
    typingState.value = isTyping;
    if (_typingClearTimer) clearTimeout(_typingClearTimer);
    if (isTyping) _typingClearTimer = window.setTimeout(() => { typingState.value = false; }, 4000);
  };
  service.onReadReceipt = ({ from, at }) => {

    if (from !== recipientId.value) return;
    const cutoff = at || Date.now();
    let changed = false;
    const updated = messages.value.map(m => {
      // Use m.sent OR m.from === myUserId as fallback — Gun re-delivery can
      // set sent:false if senderId comparison fails, but from===myUserId is reliable
      const isOurs = m.sent || m.from === myUserId;
      if (isOurs && !m.read && m.timestamp <= cutoff) { changed = true; return { ...m, read: true, sent: true }; }
      return m;
    });
    if (changed) messages.value = updated;
  };
  service.onRecipientKeyChange = ({ userId, available }) => {
    if (userId === recipientId.value) recipientKeyMissing.value = !available;
  };
  service.onDelivered = () => {};
  // Presence — chatService fires this whenever the peer's Gun node updates.
  // The stale-check logic lives in chatService; we just reflect the result.
  service.onPeerPresence = ({ userId, online }) => {
    if (userId === recipientId.value) recipientOnline.value = online;
  };
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

  // Resolve identity — authenticated users get their real userId (Schnorr publicKey),
  // anonymous users get a stable random ID from localStorage.
  let resolvedUserId = '';
  try {
    const currentUser = await UserService.getCurrentUser();
    resolvedUserId = currentUser?.id || '';
  } catch { }
  if (!resolvedUserId) {
    const ANON_KEY = 'interpoll-anon-id';
    let anonId = localStorage.getItem(ANON_KEY);
    if (!anonId) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      anonId = Array.from(bytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(ANON_KEY, anonId);
    }
    resolvedUserId = anonId;
  }
  if (gen !== initGeneration) return;
  myUserId = resolvedUserId;

  const service = new ChatService(WS_URL, resolvedUserId);
  bindChatCallbacks(service);
  chatService = service;

  try {
    await service.init();
    if (gen !== initGeneration) { service.disconnect(); return; }

    messages.value = await service.getLocalHistory(targetUserId);
    if (gen !== initGeneration) { service.disconnect(); return; }
    chatReady.value = true;
    recipientKeyMissing.value = !service.hasRecipientKey(targetUserId);
    forceScrollImmediate();

    // Start listening for incoming P2P file transfers
    listenForIncomingP2P();

    await service.startChat({ userId: targetUserId, name: recipientName.value });
    if (gen !== initGeneration) { service.disconnect(); return; }
    recipientKeyMissing.value = !service.hasRecipientKey(targetUserId);

    const history = await service.loadHistory(targetUserId);
    if (gen !== initGeneration) { service.disconnect(); return; }
    history.forEach(upsertMessage);
    messages.value = [...messages.value].sort((a, b) => a.timestamp - b.timestamp);
  } catch (err) {
    chatError.value = err instanceof Error ? err.message : 'Could not start encrypted chat.';
  }
  service.markAsRead(targetUserId);
  forceScrollImmediate();
}

watch(recipientId, async (n, o) => { if (n && n !== o) await initializeChat(); });
onIonViewWillEnter(() => {
  if (!chatReady.value && recipientId.value) { void initializeChat(); return; }
  // Re-bind callbacks every time the view becomes active
  if (chatService) bindChatCallbacks(chatService);
  chatService?.markAsRead(recipientId.value);
  forceScrollImmediate();
  // Re-probe Gun ack soul when view becomes active — catches receipts written while away
  if (chatService && recipientId.value) {
    const roomId = [myUserId, recipientId.value].sort().join(':');
    const applyReceipt = (at: number) => {
      let changed = false;
      const updated = messages.value.map(m => {
        if (m.sent && !m.read && m.timestamp <= at) { changed = true; return { ...m, read: true }; }
        return m;
      });
      if (changed) messages.value = updated;
    };
    const probeAck = (delay: number) => setTimeout(() => {
      try {
        GunService.getGun()
          .get('chat-read-ack').get(roomId).get(recipientId.value)
          .once((s: any) => {
            if (!s || typeof s !== 'object') return;
            if (Object.keys(s).every(k => k === '_')) return;
            const at = Number(s.timestamp);
            if (at > 1_000_000 && (!s.to || s.to === myUserId)) applyReceipt(at);
          });
      } catch {}
    }, delay);
    probeAck(300);
    probeAck(1500);
    probeAck(4000);
  }
});
onUnmounted(() => { initGeneration++; disconnectChat(); closePeer(); });

// ── Helpers ────────────────────────────────────────────────────────────────────

// messagesContainer (.messages-area) is the actual overflow-y:auto scroller.
// We target it directly — no ion-content shadow DOM gymnastics needed.

const scrollToBottom = (force = false) => {
  nextTick(() => {
    const el = messagesContainer.value;
    if (!el) return;
    if (!force) {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (dist > 200) return; // user scrolled up to read history — don't hijack
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  });
};

// On initial load the DOM isn't fully painted after one nextTick.
// Retry a few times so the last message is always visible on open.
const forceScrollImmediate = () => {
  let tries = 0;
  const attempt = () => {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
    if (++tries < 6) setTimeout(attempt, 80);
  };
  nextTick(attempt);
};

watch(currentMessages, () => scrollToBottom(), { deep: true });

const handleSend = async () => {
  if (!messageInput.value.trim() || !chatReady.value || !chatService) return;
  const text = messageInput.value.trim();
  messageInput.value = '';
  try {
    upsertMessage(await chatService.sendMessage(recipientId.value, text));
    chatService.sendTyping(recipientId.value, false);
    nextTick(() => scrollToBottom(true)); // force scroll after own send
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
.hdr-ws-status {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; padding: 3px 8px; border-radius: 999px;
  color: var(--app-text-subtle);
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  margin-right: 4px; white-space: nowrap;
}
.hdr-ws-status--ok {
  color: #34d399;
  background: rgba(52,211,153,0.1);
  border-color: rgba(52,211,153,0.25);
}
.hdr-status { font-size: 10.5px; color: var(--app-text-subtle); font-weight: 500; display: flex; align-items: center; gap: 4px; }

.presence-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; display: inline-block;
}
.presence-dot--online  { background: #34d399; box-shadow: 0 0 5px rgba(52,211,153,0.7); }
.presence-dot--offline { background: rgba(255,255,255,0.2); }

/* Typing bar above input — collapsed when not typing */
.bottom-status-bar {
  max-height: 0;
  overflow: hidden;
  transition: max-height 200ms ease, padding 200ms ease;
  padding: 0 14px;
}
.bottom-status-bar--visible {
  max-height: 36px;
  padding: 4px 14px;
}
.typing-indicator { display: flex; align-items: center; gap: 6px; }
.typing-label { font-size: 11px; color: rgba(255,255,255,0.45); }

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
.message.tail     { margin-bottom: 7px; }
@keyframes bubbleIn { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; } }

.message-content {
  padding: 7px 13px;
  border-radius: 16px; /* comfortable, not pill */
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

/* Received: same purple gradient as sent, mirrored direction — same bubble, different side */
.message.received .message-content {
  background: linear-gradient(225deg,#6366f1,#8b5cf6);
  box-shadow: 0 2px 8px rgba(99,102,241,0.28);
  border-bottom-left-radius: 4px;
}
.message.received .message-content p { color: #fff; }

/* Tail — received, bottom-left (true mirror of sent bottom-right) */
.message.received.tail .message-content::after {
  content: '';
  position: absolute; bottom: 0; left: -7px;
  width: 0; height: 0;
  border-style: solid;
  border-width: 8px 8px 0 0;
  border-color: transparent #6366f1 transparent transparent;
}

.message-content p { margin: 0; font-size: 14.5px; line-height: 1.55; word-break: break-word; }

.message-meta { display: flex; align-items: center; gap: 4px; margin-top: 2px; padding: 0 3px; }
.message-time   { font-size: 10.5px; color: rgba(255,255,255,0.45); }
.message-status { font-size: 10.5px; color: rgba(165,180,252,0.9); letter-spacing: -0.5px; }
.message-status.stalled { color: #fbbf24; font-weight: 700; }

/* ── Media bubbles ──────────────────────────────────────────── */
/* Strip the inherited chat-bubble colour so image/video sit clean */
.media-bubble {
  padding: 3px !important;
  background: transparent !important;
  box-shadow: none !important;
}
.message.sent  .media-bubble { background: transparent !important; }
.message.received .media-bubble { background: transparent !important; }

.media-wrap {
  position: relative; display: inline-block; border-radius: 14px; overflow: hidden;
  cursor: zoom-in; line-height: 0;
}
.media-wrap--video { cursor: default; }
.media-img  { display: block; max-width: 230px; max-height: 250px; object-fit: cover; border-radius: 14px; }
.media-video { display: block; max-width: 240px; max-height: 250px; border-radius: 14px; background: #000; }

/* Video thumbnail shell — shimmer until metadata loads */
.video-thumb-shell {
  position: relative; width: 230px; height: 170px; border-radius: 14px;
  overflow: hidden; cursor: pointer; background: #0d0d14;
}
.video-thumb-shell .media-video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0; transition: opacity 300ms ease;
}
.video-thumb-shell.loaded .media-video  { opacity: 1; }
.video-thumb-shell.loaded .video-shimmer { opacity: 0; pointer-events: none; }

/* Shimmer skeleton shown before video metadata arrives */
.video-shimmer {
  position: absolute; inset: 0; border-radius: 14px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%);
  display: flex; align-items: center; justify-content: center;
  transition: opacity 300ms ease;
  overflow: hidden;
}
.video-shimmer-wave {
  position: absolute; inset: 0;
  background: linear-gradient(90deg,
    transparent 0%, rgba(255,255,255,0.04) 40%,
    rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 60%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer-sweep 1.6s infinite ease-in-out;
}
@keyframes shimmer-sweep { from { background-position: -200% 0; } to { background-position: 200% 0; } }
.video-film-icon { width: 36px; height: 36px; color: rgba(255,255,255,0.2); position: relative; z-index: 1; }

/* Play button overlay */
.video-play-btn {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  z-index: 2;
}
.video-play-btn svg {
  width: 44px; height: 44px; color: rgba(255,255,255,0.85);
  filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5));
  transition: transform 160ms ease;
}
.video-thumb-shell:hover .video-play-btn svg { transform: scale(1.1); }

/* Media decode error */
.media-decode-err {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  color: rgba(255,255,255,0.4); font-size: 13px;
  background: rgba(255,255,255,0.04); border-radius: 12px; min-width: 160px;
}

/* Download button shown on hover */
.media-overlay-btns {
  position: absolute; top: 6px; right: 6px;
  display: flex; gap: 4px;
  opacity: 0; transition: opacity 180ms ease;
  pointer-events: none;
}
.media-wrap:hover .media-overlay-btns { opacity: 1; pointer-events: auto; }
.media-dl-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); color: #fff;
}
.media-dl-btn svg { width: 15px; height: 15px; }

/* Upload progress overlay */
.media-upload-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-end; padding-bottom: 10px;
  background: rgba(0,0,0,0.35); border-radius: 14px;
}
.media-upload-bar {
  position: absolute; bottom: 0; left: 0; height: 3px;
  background: #a78bfa; border-radius: 0 0 14px 14px;
  transition: width 300ms ease;
}
.media-upload-pct {
  font-size: 13px; font-weight: 700; color: #fff;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
}

.file-download-link {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: rgba(255,255,255,0.08); border-radius: 8px;
  color: #a78bfa; text-decoration: none; min-width: 160px;
}
.file-icon { font-size: 20px; flex-shrink: 0; }
.file-name { font-size: 13px; font-weight: 500; flex: 1; word-break: break-all; }
.file-size { font-size: 11px; color: rgba(255,255,255,0.45); white-space: nowrap; }
.media-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); border-radius: 14px;
}

/* ── Lightbox ────────────────────────────────────────────────── */
.lightbox-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,0.92); display: flex; align-items: center; justify-content: center;
  animation: lb-in 160ms ease;
}
@keyframes lb-in { from { opacity: 0 } to { opacity: 1 } }
.lightbox-inner {
  position: relative; max-width: 96vw; max-height: 92vh;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
.lightbox-media {
  max-width: 96vw; max-height: 82vh; border-radius: 10px;
  object-fit: contain; box-shadow: 0 8px 40px rgba(0,0,0,0.6);
}
.lightbox-close {
  position: absolute; top: -38px; right: 0;
  background: rgba(255,255,255,0.1); border: none; color: #fff;
  font-size: 18px; width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.lightbox-dl {
  display: flex; align-items: center; gap: 6px;
  background: rgba(167,139,250,0.18); border: 1px solid rgba(167,139,250,0.35);
  color: #a78bfa; border-radius: 8px; padding: 6px 16px; font-size: 13px;
  font-weight: 600; cursor: pointer;
}
.lightbox-dl svg { width: 14px; height: 14px; }

/* ── P2P progress ───────────────────────────────────────────── */
/* ── P2P info banner ───────────────────────────────────────── */
.p2p-info-banner {
  display: flex; align-items: flex-start; gap: 9px;
  margin: 0 10px 4px;
  padding: 9px 12px;
  border-radius: 12px;
  background: rgba(99,102,241,0.07);
  border: 1px solid rgba(99,102,241,0.16);
  font-size: 11.5px; line-height: 1.5;
  color: var(--app-text-muted);
  /* Hidden by default, slides in on hover/active */
  max-height: 0; opacity: 0; overflow: hidden; padding-top: 0; padding-bottom: 0;
  transition: max-height 250ms ease, opacity 200ms ease, padding 200ms ease;
}
.p2p-info-banner--active {
  max-height: 120px; opacity: 1;
  padding: 9px 12px;
}
.p2p-info-icon {
  width: 15px; height: 15px; flex-shrink: 0; margin-top: 1px;
  color: #818cf8; opacity: 0.8;
}
.p2p-info-banner strong { color: var(--app-text); font-weight: 600; }

/* ── P2P progress card ─────────────────────────────────────── */
.p2p-progress-card {
  margin: 6px 10px;
  padding: 12px 14px 10px;
  border-radius: 14px;
  background: rgba(99,102,241,0.08);
  border: 1px solid rgba(99,102,241,0.2);
}

.p2p-progress-header {
  display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
}

.p2p-direction-icon {
  width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
  background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.25);
  display: flex; align-items: center; justify-content: center; color: #818cf8;
}
.p2p-thumb {
  width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0; overflow: hidden;
  background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
  display: flex; align-items: center; justify-content: center;
}
.p2p-thumb-img { width: 100%; height: 100%; object-fit: cover; }
.p2p-direction-icon svg { width: 16px; height: 16px; }

.p2p-file-info {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
}
.p2p-file-name {
  font-size: 13px; font-weight: 600; color: var(--app-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.p2p-file-status { font-size: 11px; color: var(--app-text-subtle); }

.p2p-pct {
  font-size: 13px; font-weight: 700; color: #818cf8;
  font-variant-numeric: tabular-nums; flex-shrink: 0;
}

/* Progress bar track */
.p2p-track {
  height: 5px; border-radius: 999px;
  background: rgba(255,255,255,0.07);
  overflow: hidden;
}
.p2p-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
  transition: width 180ms ease;
  position: relative; overflow: hidden;
}
/* Shimmer sweep on the fill */
.p2p-shimmer {
  position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: p2p-sweep 1.4s linear infinite;
}
@keyframes p2p-sweep {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

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