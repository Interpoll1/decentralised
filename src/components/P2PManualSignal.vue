<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <ion-toggle v-model="meshEnabled">Peer-to-peer mesh</ion-toggle>
      <ion-badge :color="peerCount > 0 ? 'success' : 'medium'">
        {{ peerCount }} peer{{ peerCount === 1 ? '' : 's' }}
      </ion-badge>
    </div>
    <p class="text-xs opacity-60 mb-3">
      Connects you directly to other users so polls, posts and votes keep syncing even when
      the WebSocket and GunDB relays are unreachable. Connections form automatically while a
      relay is up; use manual exchange below for a total blackout.
    </p>

    <div class="manual-signal glass-inset p-3">
      <h4 class="font-semibold mb-2 text-sm">Manual connection (offline)</h4>

      <!-- Step A: start an offer -->
      <ion-button size="small" fill="outline" :disabled="busy" @click="startOffer">
        1 · Create invite
      </ion-button>
      <ion-button size="small" fill="clear" :disabled="busy" @click="reset">Reset</ion-button>

      <template v-if="offerText">
        <p class="text-xs opacity-70 mt-2">Send this invite to your peer:</p>
        <textarea class="signal-box" readonly :value="offerText"></textarea>
        <ion-button size="small" fill="outline" @click="copy(offerText)">Copy invite</ion-button>

        <p class="text-xs opacity-70 mt-3">Paste their reply here, then complete:</p>
        <textarea class="signal-box" v-model="answerInput" placeholder="Paste reply bundle…"></textarea>
        <ion-button size="small" color="success" :disabled="busy || !answerInput" @click="completeOffer">
          3 · Complete connection
        </ion-button>
      </template>

      <!-- Step B: respond to an offer -->
      <div class="mt-4 pt-3 border-t border-gray-600/30">
        <p class="text-xs opacity-70">Received an invite instead? Paste it to generate a reply:</p>
        <textarea class="signal-box" v-model="incomingOffer" placeholder="Paste invite bundle…"></textarea>
        <ion-button size="small" fill="outline" :disabled="busy || !incomingOffer" @click="generateAnswer">
          2 · Generate reply
        </ion-button>

        <template v-if="generatedAnswer">
          <p class="text-xs opacity-70 mt-2">Send this reply back to them:</p>
          <textarea class="signal-box" readonly :value="generatedAnswer"></textarea>
          <ion-button size="small" fill="outline" @click="copy(generatedAnswer)">Copy reply</ion-button>
        </template>
      </div>

      <p v-if="statusMsg" class="text-xs mt-2 signal-status" :class="statusOk ? 'signal-status--ok' : 'signal-status--error'">
        {{ statusMsg }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { IonButton, IonToggle, IonBadge } from '@ionic/vue';
import { WebRTCService } from '../services/webrtcService';
import { MeshService } from '../services/meshService';

const meshEnabled = ref(WebRTCService.isEnabled());
const peerCount = ref(0);
const busy = ref(false);

const offerText = ref('');
const answerInput = ref('');
const incomingOffer = ref('');
const generatedAnswer = ref('');
const statusMsg = ref('');
const statusOk = ref(true);

let unsubscribePeers: (() => void) | null = null;

onMounted(() => {
  unsubscribePeers = WebRTCService.onPeersChange((peers) => {
    peerCount.value = peers.length;
  });
});

onUnmounted(() => {
  if (unsubscribePeers) unsubscribePeers();
});

watch(meshEnabled, (val) => {
  MeshService.setEnabled(val);
});

function setStatus(msg: string, ok = true) {
  statusMsg.value = msg;
  statusOk.value = ok;
}

async function startOffer() {
  busy.value = true;
  setStatus('');
  try {
    meshEnabled.value = true;
    offerText.value = await WebRTCService.createManualOffer();
    setStatus('Invite ready — share it, then paste their reply.');
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
    setStatus('Reply ready — send it back to complete the connection.');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Failed to generate reply', false);
  } finally {
    busy.value = false;
  }
}

function reset() {
  offerText.value = '';
  answerInput.value = '';
  incomingOffer.value = '';
  generatedAnswer.value = '';
  setStatus('');
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied to clipboard.');
  } catch {
    setStatus('Copy failed — select and copy manually.', false);
  }
}
</script>

<style scoped>
.signal-status--ok {
  color: var(--app-success);
}
.signal-status--error {
  color: var(--app-danger);
}
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
</style>
