<template>
  <div v-if="visible" class="call-overlay" role="dialog" aria-modal="true" :aria-label="title">
    <!-- In call / connecting with media: remote full size, self-view PiP -->
    <video
      v-show="showVideo"
      ref="remoteEl"
      class="call-remote"
      autoplay
      playsinline
    ></video>
    <video
      v-show="snap.video && snap.localStream && !snap.cameraOff"
      ref="localEl"
      class="call-local"
      autoplay
      playsinline
      muted
    ></video>

    <div class="call-info" :class="{ 'call-info--over-video': showVideo }">
      <div class="call-avatar">{{ peerInitial }}</div>
      <p class="call-peer">{{ peerLabel }}</p>
      <p class="call-status" data-testid="call-status">{{ title }}</p>
    </div>

    <div class="call-controls">
      <template v-if="snap.state === 'incoming-ringing'">
        <button class="call-btn call-btn--decline" data-testid="call-decline" @click="call.decline()">Decline</button>
        <button class="call-btn call-btn--accept" data-testid="call-accept" @click="call.accept()">Accept</button>
      </template>
      <template v-else-if="snap.state !== 'ended'">
        <button
          v-if="snap.state === 'in-call' || snap.state === 'connecting'"
          class="call-btn"
          :class="{ 'call-btn--on': snap.muted }"
          data-testid="call-mute"
          @click="call.toggleMute()"
        >{{ snap.muted ? 'Unmute' : 'Mute' }}</button>
        <button
          v-if="snap.video && (snap.state === 'in-call' || snap.state === 'connecting')"
          class="call-btn"
          :class="{ 'call-btn--on': snap.cameraOff }"
          data-testid="call-camera"
          @click="call.toggleCamera()"
        >{{ snap.cameraOff ? 'Camera on' : 'Camera off' }}</button>
        <button class="call-btn call-btn--decline" data-testid="call-hangup" @click="call.end()">
          {{ snap.state === 'outgoing-ringing' ? 'Cancel' : 'Hang up' }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue';
import { useCallStore } from '@/stores/callStore';

const call = useCallStore();
const snap = computed(() => call.snapshot);

const remoteEl = ref<HTMLVideoElement | null>(null);
const localEl = ref<HTMLVideoElement | null>(null);

watchEffect(() => {
  if (remoteEl.value) remoteEl.value.srcObject = snap.value.remoteStream;
  if (localEl.value) localEl.value.srcObject = snap.value.localStream;
});

const visible = computed(() => snap.value.state !== 'idle');
const showVideo = computed(() => snap.value.state === 'in-call' && !!snap.value.remoteStream && snap.value.video);
const peerLabel = computed(() => (snap.value.peer ? `${snap.value.peer.slice(0, 8)}…` : ''));
const peerInitial = computed(() => (snap.value.peer || '?').charAt(0).toUpperCase());

// Elapsed timer for in-call.
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | null = null;
watch(() => snap.value.state, (s) => {
  if (s === 'in-call' && !tick) tick = setInterval(() => { now.value = Date.now(); }, 1000);
  if (s !== 'in-call' && tick) { clearInterval(tick); tick = null; }
}, { immediate: true });
onBeforeUnmount(() => { if (tick) clearInterval(tick); });

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const END_TEXT: Record<string, string> = {
  hangup: 'Call ended',
  declined: 'Declined',
  busy: 'Busy',
  'no-answer': 'No answer',
  cancelled: 'Cancelled',
  failed: "Couldn't connect",
  unavailable: "Can't reach this user",
  permission: 'Microphone/camera unavailable or blocked',
  disconnected: 'Connection lost',
};

const title = computed(() => {
  const s = snap.value;
  switch (s.state) {
    case 'incoming-ringing': return s.video ? 'Incoming video call' : 'Incoming call';
    case 'outgoing-ringing': return 'Calling…';
    case 'connecting': return 'Connecting…';
    case 'in-call': return s.startedAt ? fmt(now.value - s.startedAt) : 'In call';
    case 'ended': return END_TEXT[s.endReason ?? 'hangup'] ?? 'Call ended';
    default: return '';
  }
});
</script>

<style scoped>
.call-overlay {
  position: fixed; inset: 0; z-index: 10050;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  padding: calc(env(safe-area-inset-top, 0px) + 48px) 16px calc(env(safe-area-inset-bottom, 0px) + 32px);
  background: #0b0f14; color: #f5f7fa;
}
.call-remote { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
.call-local {
  position: absolute; right: 16px; top: calc(env(safe-area-inset-top, 0px) + 16px);
  width: 28vw; max-width: 160px; aspect-ratio: 3 / 4; object-fit: cover;
  border-radius: 12px; border: 2px solid rgba(255,255,255,.3); background: #000; z-index: 2;
  transform: scaleX(-1);
}
.call-info { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.call-info--over-video { text-shadow: 0 1px 4px rgba(0,0,0,.8); }
.call-info--over-video .call-avatar { display: none; }
.call-avatar {
  width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center;
  font-size: 40px; font-weight: 600; background: #2b3645;
}
.call-peer { margin: 0; font-size: 20px; font-weight: 600; }
.call-status { margin: 0; opacity: .8; font-variant-numeric: tabular-nums; }
.call-controls { position: relative; z-index: 1; display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
.call-btn {
  min-width: 96px; padding: 14px 20px; border-radius: 999px; border: none; cursor: pointer;
  font-size: 15px; font-weight: 600; color: #fff; background: rgba(255,255,255,.18);
}
.call-btn--on { background: #fff; color: #111; }
.call-btn--accept { background: #1faa59; }
.call-btn--decline { background: #e5484d; }
</style>
