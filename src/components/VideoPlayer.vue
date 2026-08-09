<template>
  <div class="video-player" :class="{ 'video-player--expanded': isExpanded, 'video-player--compact': props.compact }">

    <!-- Thumbnail / poster state (before play) -->
    <div
      v-if="!isExpanded && !isPlaying"
      class="video-player__poster"
      @click="expand"
    >
      <img
        v-if="thumbnailSrc"
        :src="thumbnailSrc"
        class="video-player__thumbnail"
        loading="lazy"
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
        @canplay="isLoading = false"
        @timeupdate="onTimeUpdate"
        @play="isPlaying = true"
        @pause="isPlaying = false"
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
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { IonIcon, IonSpinner } from '@ionic/vue';
import {
  videocamOutline, cloudOutline,
  alertCircleOutline, chevronUpOutline, openOutline,
} from 'ionicons/icons';
import {
  getAllGatewayUrls, getVideoThumbnail,
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
  autoPlay?: boolean;
  compact?: boolean;  // true in feed cards — caps poster height
}>();

// ── State ─────────────────────────────────────────────────────────────────────
const videoEl       = ref<HTMLVideoElement | null>(null);
const thumbnailSrc  = ref<string | null>(props.thumbnailUrl || null);
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
const progressPercent = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
);

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  if (!thumbnailSrc.value && props.cid) {
    try { thumbnailSrc.value = await getVideoThumbnail(props.cid); } catch { /* no thumbnail */ }
  }
});

onUnmounted(() => {
  if (videoEl.value) {
    videoEl.value.pause();
    videoEl.value.src = '';
    videoEl.value.load();
  }
});

// ── Methods ───────────────────────────────────────────────────────────────────
function expand() {
  isExpanded.value = true;
  isLoading.value  = true;
  loadError.value  = null;
}

function collapse() {
  isExpanded.value = false;
  isPlaying.value  = false;
  loadError.value  = null;
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
});
</script>

<style scoped>
/* ── Compact (feed card) mode ─────────────────────────────────────────── */
.video-player--compact .video-player__poster {
  /* Keep the natural 16:9 ratio so nothing is cropped,
     but clamp the height so it doesn't go huge on wide screens */
  aspect-ratio: 16 / 9;
  height: auto;
  max-height: clamp(220px, 35vw, 360px);
  overflow: hidden;
}
.video-player--compact .video-player__poster .video-player__thumbnail {
  width: 100%;
  height: 100%;
  object-fit: contain;   /* never crop — letterbox if needed */
  background: #0d0d18;
}
.video-player--compact .video-player__video {
  max-height: clamp(260px, 40vw, 420px);
  object-fit: contain;
  background: #000;
}

/* ── Shell ───────────────────────────────────────────────────────────────── */
.video-player {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #0d0d18;
  position: relative;
  border: 1px solid rgba(255,255,255,0.07);
}

/* ── Poster ──────────────────────────────────────────────────────────────── */
.video-player__poster {
  position: relative;
  cursor: pointer;
  aspect-ratio: 16 / 9;
  background: #0d0d18;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.video-player__thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.video-player__thumbnail-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0f0f22 0%, #1a1a35 100%);
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
  fill: rgba(99,102,241,0.75);
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
  max-height: 60vh;
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
  border: 1px solid rgba(99,102,241,0.5);
  color: #818cf8;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.vp-btn--outline:hover {
  background: rgba(99,102,241,0.12);
  border-color: #818cf8;
}

/* ── Custom controls ─────────────────────────────────────────────────────── */
.vp-controls {
  background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(8,8,20,0.97) 100%);
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
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
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
  background: #a78bfa;
  box-shadow: 0 0 0 2px rgba(167,139,250,0.35);
  transition: transform 0.15s;
}
.vp-progress:hover .vp-progress__thumb { transform: translate(-50%, -50%) scale(1); }
.vp-progress:hover .vp-progress__track { height: 4px; }

.vp-progress__tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  background: rgba(15,15,30,0.95);
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
  background: #a78bfa;
  cursor: pointer;
}
.vp-volume-slider::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #a78bfa;
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
  color: #818cf8;
}
.vp-ipfs-link:hover { color: #a78bfa; background: rgba(99,102,241,0.1); }
</style>