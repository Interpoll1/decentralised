<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <ion-toggle v-model="meshEnabled">Peer-to-peer mesh</ion-toggle>
      <ion-badge :color="peerCount > 0 ? 'success' : 'medium'">
        {{ peerCount }} peer{{ peerCount === 1 ? '' : 's' }}
      </ion-badge>
    </div>
    <p class="text-xs opacity-60 mb-3">
      Connects you directly to other people so polls, posts and votes keep syncing even when
      the relays are unreachable. Connections form automatically while a relay is up; use the
      invite below for a total blackout — just share a link.
    </p>

    <div class="manual-signal glass-inset p-3">
      <h4 class="font-semibold mb-1 text-sm">Connect with no relay</h4>
      <p class="text-xs opacity-60 mb-3">Share a link or QR with someone nearby — no server needed.</p>

      <!-- Mode switch -->
      <div class="seg mb-3">
        <button :class="['seg-btn', mode === 'invite' && 'seg-on']" @click="setMode('invite')">Invite someone</button>
        <button :class="['seg-btn', mode === 'join' && 'seg-on']" @click="setMode('join')">I have an invite</button>
      </div>

      <!-- ── Mode: invite someone ───────────────────────── -->
      <template v-if="mode === 'invite'">
        <p v-if="!offerText" class="text-xs opacity-70 mb-2">
          Generate a one-time code to share with the person you want to connect with.
          They open it, send back a reply, and you're linked directly.
        </p>
        <ion-button v-if="!offerText" size="small" expand="block" :disabled="busy" @click="startOffer">
          <ion-spinner v-if="busy" name="dots" class="mr-2" /> Create invite link
        </ion-button>

        <template v-if="offerText">
          <p class="text-xs opacity-70 mb-1 font-medium">Step 1 — send this invite to your peer:</p>
          <ShareBlock :link="offerLink" :qr="offerQr" :raw="offerText" label="invite" @copied="flash" />

          <p class="text-xs opacity-70 mt-3 mb-1 font-medium">Step 2 — paste their reply, then connect:</p>
          <textarea class="signal-box" v-model="answerInput" placeholder="Paste reply link or code…"></textarea>
          <div class="flex gap-2">
            <ion-button size="small" color="success" :disabled="busy || !answerInput" @click="completeOffer">
              Connect
            </ion-button>
            <ion-button size="small" fill="clear" :disabled="busy" @click="reset">Start over</ion-button>
          </div>
        </template>
      </template>

      <!-- ── Mode: I have an invite ─────────────────────── -->
      <template v-else>
        <template v-if="!generatedAnswer">
          <p class="text-xs opacity-70 mb-1 font-medium">Paste the invite link or code you received:</p>
          <textarea class="signal-box" v-model="incomingOffer" placeholder="Paste invite link or code…"></textarea>
          <ion-button size="small" expand="block" :disabled="busy || !incomingOffer" @click="generateAnswer">
            <ion-spinner v-if="busy" name="dots" class="mr-2" /> Generate reply
          </ion-button>
        </template>

        <template v-if="generatedAnswer">
          <p class="text-xs opacity-70 mb-1 font-medium">Send this reply back to them to finish connecting:</p>
          <ShareBlock :link="answerLink" :qr="answerQr" :raw="generatedAnswer" label="reply" @copied="flash" />
          <ion-button size="small" fill="clear" :disabled="busy" class="mt-2" @click="reset">Start over</ion-button>
        </template>
      </template>

      <p v-if="statusMsg" class="text-xs mt-3" :class="statusOk ? 'text-green-400' : 'text-red-400'">
        {{ statusMsg }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, h, defineComponent } from 'vue';
import { IonButton, IonToggle, IonBadge, IonSpinner } from '@ionic/vue';
import QRCode from 'qrcode';
import { WebRTCService } from '../services/webrtcService';
import { MeshService } from '../services/meshService';

const props = defineProps<{ prefill?: string }>();

const meshEnabled = ref(WebRTCService.isEnabled());
const peerCount = ref(0);
const busy = ref(false);
const mode = ref<'invite' | 'join'>('invite');

const offerText = ref('');
const offerLink = ref('');
const offerQr = ref('');
const answerInput = ref('');
const incomingOffer = ref('');
const generatedAnswer = ref('');
const answerLink = ref('');
const answerQr = ref('');
const statusMsg = ref('');
const statusOk = ref(true);

let unsubscribePeers: (() => void) | null = null;

// Compact share block: link copy, QR, and a collapsible raw code — reused for offer & reply.
const ShareBlock = defineComponent({
  props: { link: String, qr: String, raw: String, label: String },
  emits: ['copied'],
  setup(p, { emit }) {
    const showRaw = ref(false);
    const doCopy = async (text: string) => {
      try { await navigator.clipboard.writeText(text); emit('copied', `Copied ${p.label} link.`); }
      catch { emit('copied', 'Copy failed — select the code manually.'); }
    };
    return () => h('div', { class: 'share-block' }, [
      p.qr ? h('img', { src: p.qr, class: 'qr', alt: `${p.label} QR code` }) : null,
      h('div', { class: 'flex gap-2 mt-1 flex-wrap' }, [
        h(IonButton, { size: 'small', fill: 'outline', onClick: () => doCopy(p.link || p.raw || '') }, () => 'Copy link'),
        h(IonButton, { size: 'small', fill: 'clear', onClick: () => { showRaw.value = !showRaw.value; } },
          () => showRaw.value ? 'Hide code' : 'Show code'),
      ]),
      showRaw.value
        ? h('textarea', { class: 'signal-box', readonly: true, value: p.raw })
        : null,
    ]);
  },
});

onMounted(async () => {
  unsubscribePeers = WebRTCService.onPeersChange((peers) => {
    peerCount.value = peers.length;
  });
  if (props.prefill) await loadIncomingInvite(props.prefill);
});

onUnmounted(() => {
  if (unsubscribePeers) unsubscribePeers();
});

watch(meshEnabled, (val) => {
  MeshService.setEnabled(val);
});

// An invite link can arrive after mount (e.g. router updates the query) — react to it.
watch(() => props.prefill, (val) => {
  if (val) void loadIncomingInvite(val);
});

function setMode(m: 'invite' | 'join') {
  mode.value = m;
  setStatus('');
}

function flash(msg: string) {
  setStatus(msg, !/fail/i.test(msg));
}

function setStatus(msg: string, ok = true) {
  statusMsg.value = msg;
  statusOk.value = ok;
}

async function qr(text: string): Promise<string> {
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 200, errorCorrectionLevel: 'L' });
  } catch {
    return ''; // bundle too large for a QR — link/code still work.
  }
}

async function startOffer() {
  busy.value = true;
  setStatus('');
  try {
    meshEnabled.value = true;
    offerText.value = await WebRTCService.createManualOffer();
    offerLink.value = WebRTCService.buildSignalLink(offerText.value);
    offerQr.value = await qr(offerLink.value);
    setStatus('Invite ready — share the link, then paste their reply.');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Failed to create invite', false);
  } finally {
    busy.value = false;
  }
}

async function completeOffer() {
  busy.value = true;
  try {
    await WebRTCService.acceptManualAnswer(answerInput.value);
    setStatus('Connecting… the peer should appear shortly.');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Failed to complete connection', false);
  } finally {
    busy.value = false;
  }
}

async function generateAnswer() {
  busy.value = true;
  setStatus('');
  try {
    meshEnabled.value = true;
    generatedAnswer.value = await WebRTCService.acceptManualOffer(incomingOffer.value);
    answerLink.value = WebRTCService.buildSignalLink(generatedAnswer.value);
    answerQr.value = await qr(answerLink.value);
    setStatus('Reply ready — send it back to complete the connection.');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Failed to generate reply', false);
  } finally {
    busy.value = false;
  }
}

/** Auto-load an invite that arrived via a shared link. */
async function loadIncomingInvite(raw: string) {
  mode.value = 'join';
  incomingOffer.value = raw;
  await generateAnswer();
}

function reset() {
  offerText.value = '';
  offerLink.value = '';
  offerQr.value = '';
  answerInput.value = '';
  incomingOffer.value = '';
  generatedAnswer.value = '';
  answerLink.value = '';
  answerQr.value = '';
  setStatus('');
}
</script>

<style scoped>
.signal-box {
  width: 100%;
  min-height: 64px;
  margin: 4px 0;
  padding: 8px;
  font-family: monospace;
  font-size: 11px;
  word-break: break-all;
  resize: vertical;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.seg {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 3px;
}
.seg-btn {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 8px;
  border-radius: 8px;
  color: var(--ion-text-color, inherit);
  opacity: 0.75;
  transition: all 0.15s ease;
}
.seg-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.06);
}
.seg-on,
.seg-on:hover {
  background: var(--ion-color-primary, #4f7cff);
  color: #fff;
  opacity: 1;
}
.share-block .qr {
  display: block;
  width: 160px;
  height: 160px;
  border-radius: 10px;
  background: #fff;
  padding: 6px;
  margin: 6px 0;
}
</style>
