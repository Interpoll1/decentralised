<template>
  <div ref="rootEl" class="video-player" :class="{ 'video-player--expanded': isExpanded, 'video-player--compact': props.compact }" :style="{ '--ar': String(aspect) }" @click.stop>

    <!-- Thumbnail / poster state (before play) -->
    <div
      v-if="!isExpanded && !isPlaying"
      class="video-player__poster"
      @click="expand"
    >
      <!-- No stored thumbnail: the poster is the video's own first frame (metadata + a seek to ~0.1s) -->
      <video
        v-if="!posterFailed && posterSrc"
        :src="posterSrc"
        :poster="thumbnailSrc || undefined"
        class="video-player__thumbnail"
        muted
        playsinline
        preload="metadata"
        @loadedmetadata="onPosterMeta"
        @error="onPosterError"
      ></video>
      <img
        v-else-if="thumbnailSrc"
        :src="thumbnailSrc"
        class="video-player__thumbnail"
        @error="thumbnailSrc = null"
      />
      <div v-else class="video-player__thumbnail-placeholder">
        <ion-icon :icon="videocamOutline" />
      </div>

      <div class="video-player__overlay">
        <button class="video-player__play-btn" aria-label="Play video">
          <svg viewBox="0 0 48 48" fill="none" class="play-icon-svg">
            <circle cx="24" cy="24" r="24" fill="rgba(0,0,0,0.55)" />
            <polygon points="19,14 37,24 19,34" fill="#fff" />
          </svg>
        </button>
        <span v-if="duration" class="video-player__duration">
          {{ formatDuration(duration) }}
        </span>
      </div>

      <div v-if="fileSize" class="video-player__meta">
        <ion-icon :icon="cloudOutline" />
        {{ formatFileSize(fileSize) }} · IPFS
      </div>
    </div>

    <!-- Expanded video player -->
    <div v-else class="video-player__embed">
      <div v-if="isLoading" class="video-player__loading">
        <ion-spinner name="crescent" />
        <p>Loading from IPFS…</p>
      </div>

      <div v-if="loadError && !isLoading" class="video-player__error">
        <ion-icon :icon="alertCircleOutline" />
        <p>{{ loadError }}</p>
        <button class="vp-btn vp-btn--outline" @click="tryNextGateway">
          Try another gateway
        </button>
      </div>

      <!-- Video element — no native controls -->
      <video
        v-show="!isLoading && !loadError"
        ref="videoEl"
        class="video-player__video"
        :poster="thumbnailSrc || undefined"
        playsinline
        preload="metadata"
        @loadedmetadata="onLoadedMetadata"
        @error="onVideoError"
        @canplay="onCanPlay"
        @timeupdate="onTimeUpdate"
        @play="isPlaying = true"
        @pause="onPause"
        @ended="isPlaying = false"
        @click="togglePlay"
      >
        <source
          v-for="url in gatewayUrls"
          :key="url"
          :src="url"
          :type="mimeType"
        />
        Your browser does not support HTML5 video.
      </video>

      <!-- Custom controls -->
      <div v-if="!isLoading && !loadError" class="vp-controls">
        <!-- Progress bar -->
        <div class="vp-progress" @click="seek" @mousemove="onProgressHover" @mouseleave="hoverTime = null">
          <div class="vp-progress__track">
            <div class="vp-progress__fill" :style="{ width: progressPercent + '%' }"></div>
            <div class="vp-progress__thumb" :style="{ left: progressPercent + '%' }"></div>
          </div>
          <!-- Hover time tooltip -->
          <div v-if="hoverTime !== null" class="vp-progress__tooltip" :style="{ left: hoverX + 'px' }">
            {{ formatDuration(hoverTime) }}
          </div>
        </div>

        <!-- Controls row -->
        <div class="vp-controls__row">
          <!-- Left: play/pause + time -->
          <div class="vp-controls__left">
            <button class="vp-icon-btn" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'">
              <!-- Pause icon -->
              <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" class="vp-svg-icon">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
              <!-- Play icon -->
              <svg v-else viewBox="0 0 24 24" fill="currentColor" class="vp-svg-icon">
                <polygon points="5,3 19,12 5,21"/>
              </svg>
            </button>

            <!-- Volume -->
            <button class="vp-icon-btn" @click="toggleMute" :aria-label="isMuted ? 'Unmute' : 'Mute'">
              <svg v-if="isMuted || volume === 0" viewBox="0 0 24 24" fill="currentColor" class="vp-svg-icon">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                <line x1="21" y1="3" x2="3" y2="21" stroke="currentColor" stroke-width="2"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" class="vp-svg-icon">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </button>
            <input
              type="range"
              class="vp-volume-slider"
              min="0" max="1" step="0.05"
              :value="isMuted ? 0 : volume"
              @input="onVolumeChange"
              aria-label="Volume"
            />

            <span class="vp-time">{{ formatDuration(currentTime) }} / {{ formatDuration(duration) }}</span>
          </div>

          <!-- Right: fullscreen + collapse + IPFS -->
          <div class="vp-controls__right">
            <button class="vp-icon-btn" @click="toggleFullscreen" aria-label="Fullscreen">
              <svg viewBox="0 0 24 24" fill="currentColor" class="vp-svg-icon">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
              </svg>
            </button>

            <button class="vp-icon-btn vp-collapse-btn" @click="collapse" aria-label="Collapse">
              <ion-icon :icon="chevronUpOutline" />
              <span>Collapse</span>
            </button>

            <a
              :href="primaryUrl"
              target="_blank"
              rel="noopener"
              class="vp-icon-btn vp-ipfs-link"
              title="Open on IPFS"
            >
              <ion-icon :icon="openOutline" />
              <span>IPFS</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  videocamOutline, cloudOutline,
  alertCircleOutline, chevronUpOutline, openOutline,
} from 'ionicons/icons';
import {
  getAllGatewayUrls,
  formatDuration, formatFileSize,
  IPFS_GATEWAYS,
} from '../services/videoService';

// ── Props ─────────────────────────────────────────────────────────────────────
const props = defineProps<{
  cid: string;
  thumbnailUrl?: string | null;
  duration?: number;
  fileSize?: number;
  mimeType?: string;
  /** Pixel size, when known (stored on newer posts) — avoids a layout jump before the first frame loads. */
  width?: number;
  height?: number;
  autoPlay?: boolean;
  compact?: boolean;  // true in feed cards — caps poster height
}>();

// ── State ─────────────────────────────────────────────────────────────────────
const videoEl       = ref<HTMLVideoElement | null>(null);
const thumbnailSrc  = ref<string | null>(props.thumbnailUrl || null);   // legacy posts only
const rootEl        = ref<HTMLElement | null>(null);
/** width / height of the real video; defaults to 16:9 until the first frame reports its size. */
const aspect        = ref(props.width && props.height ? props.width / props.height : 16 / 9);
const inView        = ref(false);
const posterGateway = ref(0);
const posterFailed  = ref(false);
const isExpanded    = ref(props.autoPlay || false);
const isPlaying     = ref(false);
const isLoading     = ref(false);
const loadError     = ref<string | null>(null);
const gatewayIndex  = ref(0);
const duration      = ref(props.duration || 0);
const currentTime   = ref(0);
const volume        = ref(1);
const isMuted       = ref(false);
const hoverTime     = ref<number | null>(null);
const hoverX        = ref(0);

const mimeType    = computed(() => props.mimeType || 'video/mp4');
const gatewayUrls = computed(() => getAllGatewayUrls(props.cid));
const primaryUrl  = computed(() => gatewayUrls.value[gatewayIndex.value] || gatewayUrls.value[0]);
/** First-frame poster; only requested once the card is near the viewport. */
const posterSrc = computed(() => inView.value ? `${gatewayUrls.value[posterGateway.value] || gatewayUrls.value[0]}#t=0.1` : '');
function setAspect(w: number, h: number) { if (w > 0 && h > 0) aspect.value = w / h; }
function onPosterMeta(e: Event) { const v = e.target as HTMLVideoElement; setAspect(v.videoWidth, v.videoHeight); }
function onPosterError() {
  if (posterGateway.value < gatewayUrls.value.length - 1) posterGateway.value++;
  else posterFailed.value = true;
}
let io: IntersectionObserver | null = null;
const progressPercent = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
);

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !rootEl.value) { inView.value = true; return; }
  io = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) { inView.value = true; io?.disconnect(); io = null; }
  }, { rootMargin: '400px 0px' });
  io.observe(rootEl.value);
});

onUnmounted(() => {
  io?.disconnect();
  if (videoEl.value) {
    videoEl.value.pause();
    videoEl.value.src = '';
    videoEl.value.load();
  }
});

// ── Methods ───────────────────────────────────────────────────────────────────
let wantPlay = false;

function expand() {
  isExpanded.value = true;
  isLoading.value  = true;
  loadError.value  = null;
  wantPlay = true;
  // Start playback on the same click (user gesture) instead of requiring a second one
  nextTick(() => videoEl.value?.play().catch(() => { /* retried on canplay */ }));
}

function onPause() {
  isPlaying.value = false;
  wantPlay = false;
}

function onCanPlay() {
  isLoading.value = false;
  if (wantPlay && videoEl.value?.paused) {
    videoEl.value.play().catch(() => { wantPlay = false; });
  }
}

function collapse() {
  isExpanded.value = false;
  isPlaying.value  = false;
  loadError.value  = null;
  wantPlay = false;
  if (videoEl.value) videoEl.value.pause();
}

function togglePlay() {
  if (!videoEl.value) return;
  if (videoEl.value.paused) videoEl.value.play();
  else videoEl.value.pause();
}

function toggleMute() {
  if (!videoEl.value) return;
  isMuted.value = !isMuted.value;
  videoEl.value.muted = isMuted.value;
}

function onVolumeChange(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  volume.value = val;
  if (videoEl.value) videoEl.value.volume = val;
  isMuted.value = val === 0;
}

function onTimeUpdate() {
  if (videoEl.value) currentTime.value = videoEl.value.currentTime;
}

function seek(e: MouseEvent) {
  const bar = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - bar.left) / bar.width));
  if (videoEl.value && duration.value) {
    videoEl.value.currentTime = ratio * duration.value;
    currentTime.value = videoEl.value.currentTime;
  }
}

function onProgressHover(e: MouseEvent) {
  const bar = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - bar.left) / bar.width));
  hoverTime.value = ratio * duration.value;
  hoverX.value = e.clientX - bar.left;
}

function toggleFullscreen() {
  const el = videoEl.value;
  if (!el) return;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}

function onLoadedMetadata() {
  isLoading.value = false;
  if (videoEl.value && !duration.value) duration.value = videoEl.value.duration;
  if (videoEl.value) setAspect(videoEl.value.videoWidth, videoEl.value.videoHeight);
}

function onVideoError() {
  if (gatewayIndex.value < IPFS_GATEWAYS.length - 1) {
    gatewayIndex.value++;
    isLoading.value = true;
    loadError.value = null;
    videoEl.value?.load();
  } else {
    isLoading.value = false;
    loadError.value = 'Could not load video from any IPFS gateway. The content may still be propagating.';
  }
}

function tryNextGateway() {
  gatewayIndex.value = gatewayIndex.value < IPFS_GATEWAYS.length - 1 ? gatewayIndex.value + 1 : 0;
  loadError.value = null;
  isLoading.value = true;
  videoEl.value?.load();
}

watch(() => props.cid, () => {
  isExpanded.value   = false;
  isPlaying.value    = false;
  isLoading.value    = false;
  loadError.value    = null;
  gatewayIndex.value = 0;
  currentTime.value  = 0;
  thumbnailSrc.value = props.thumbnailUrl || null;
  posterGateway.value = 0;
  posterFailed.value  = false;
  aspect.value = props.width && props.height ? props.width / props.height : 16 / 9;
});
</script>

<style scoped>
/* ── Compact (feed card) mode ─────────────────────────────────────────── */
/* Feed cards cap the height a little lower than the full player. */
.video-player.video-player--compact { --vp-max-h: min(340px, 46vh); }

/* ── Shell ───────────────────────────────────────────────────────────────── */
.video-player {
  /* The player takes the video's own shape: wide videos fill the width, tall ones get a narrower box
     (capped at --vp-max-h tall) instead of being squeezed into a 16:9 frame. */
  --vp-max-h: min(520px, 62vh);
  width: min(100%, calc(var(--vp-max-h) * var(--ar, 1.7778)));
  max-width: 100%;
  margin-inline: auto;
  border-radius: 12px;
  overflow: hidden;
  background: #121212;
  position: relative;
  border: 1px solid rgba(255,255,255,0.07);
}

/* ── Poster ──────────────────────────────────────────────────────────────── */
.video-player__poster {
  position: relative;
  cursor: pointer;
  aspect-ratio: var(--ar, 1.7778);
  background: #121212;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.video-player__thumbnail {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  background: #121212;
}

.video-player__thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #181818 0%, #282828 100%);
}
.video-player__thumbnail-placeholder ion-icon {
  font-size: 3rem;
  color: rgba(255,255,255,0.2);
}

.video-player__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.25);
  transition: background 0.2s;
}
.video-player__poster:hover .video-player__overlay {
  background: rgba(0,0,0,0.1);
}

.video-player__play-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s;
}
.video-player__play-btn:hover { transform: scale(1.08); }
.play-icon-svg {
  width: 64px;
  height: 64px;
  filter: drop-shadow(0 4px 16px rgba(0,0,0,0.7));
}
.video-player__poster:hover .play-icon-svg circle {
  fill: rgba(230, 230, 230,0.75);
}

.video-player__duration {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background: rgba(0,0,0,0.72);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
}

.video-player__meta {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0,0,0,0.65);
  color: rgba(255,255,255,0.8);
  font-size: 0.68rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  gap: 4px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.video-player__meta ion-icon { font-size: 0.75rem; }

/* ── Embed ───────────────────────────────────────────────────────────────── */
.video-player__embed {
  position: relative;
  background: #000;
}

.video-player__video {
  width: 100%;
  display: block;
  height: auto;
  max-height: var(--vp-max-h);
  object-fit: contain;
  background: #000;
  cursor: pointer;
}

.video-player__loading,
.video-player__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 16px;
  color: rgba(255,255,255,0.45);
  text-align: center;
}
.video-player__loading ion-icon,
.video-player__error ion-icon { font-size: 2rem; }
.video-player__loading p,
.video-player__error p { margin: 0; font-size: 0.88rem; }

.vp-btn--outline {
  background: none;
  border: 1px solid rgba(230, 230, 230,0.5);
  color: #e6e6e6;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.vp-btn--outline:hover {
  background: rgba(230, 230, 230,0.12);
  border-color: #e6e6e6;
}

/* ── Custom controls ─────────────────────────────────────────────────────── */
.vp-controls {
  background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(14,14,14,0.97) 100%);
  padding: 4px 12px 10px;
}

/* Progress bar */
.vp-progress {
  position: relative;
  padding: 8px 0 4px;
  cursor: pointer;
}
.vp-progress__track {
  position: relative;
  height: 3px;
  background: rgba(255,255,255,0.15);
  border-radius: 3px;
  overflow: visible;
}
.vp-progress__fill {
  height: 100%;
  background: var(--app-accent);
  border-radius: 3px;
  transition: width 0.1s linear;
}
.vp-progress__thumb {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%) scale(0);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e6e6e6;
  box-shadow: 0 0 0 2px rgba(230, 230, 230,0.35);
  transition: transform 0.15s;
}
.vp-progress:hover .vp-progress__thumb { transform: translate(-50%, -50%) scale(1); }
.vp-progress:hover .vp-progress__track { height: 4px; }

.vp-progress__tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  background: rgba(22,22,22,0.95);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e2e8f0;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  pointer-events: none;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* Controls row */
.vp-controls__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.vp-controls__left,
.vp-controls__right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.vp-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255,255,255,0.65);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 0.72rem;
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-decoration: none;
  transition: color 0.15s, background 0.15s;
}
.vp-icon-btn:hover {
  color: #fff;
  background: rgba(255,255,255,0.07);
}

.vp-svg-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* Volume slider */
.vp-volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 60px;
  height: 3px;
  background: rgba(255,255,255,0.18);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
  margin: 0 4px;
}
.vp-volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #e6e6e6;
  cursor: pointer;
}
.vp-volume-slider::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #e6e6e6;
  border: none;
  cursor: pointer;
}

.vp-time {
  font-size: 0.71rem;
  font-weight: 600;
  color: rgba(255,255,255,0.55);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.03em;
  padding-left: 4px;
  white-space: nowrap;
}

.vp-collapse-btn ion-icon,
.vp-ipfs-link ion-icon { font-size: 0.85rem; }

.vp-ipfs-link {
  color: #e6e6e6;
}
.vp-ipfs-link:hover { color: #e6e6e6; background: rgba(230, 230, 230,0.1); }

/* Phones: never a narrow strip on the left. Always full width; very tall videos sit letterboxed in a 4:5 frame. */
@media (max-width: 767px) {
  .video-player, .video-player.video-player--compact { width: 100%; }
  .video-player__poster { aspect-ratio: clamp(0.8, var(--ar, 1.7778), 1.7778); }
  .video-player__video { aspect-ratio: clamp(0.8, var(--ar, 1.7778), 1.7778); height: auto; max-height: none; }
}
</style>