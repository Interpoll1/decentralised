<template>
  <div class="gm" :class="`gm--${kind}`">
    <div v-if="state === 'loading'" class="gm-placeholder">
      <div class="gm-spinner"></div>
      <span>{{ label }}</span>
    </div>
    <div v-else-if="state === 'error'" class="gm-placeholder gm-error">
      <span>⚠ {{ label }} unavailable</span>
      <button class="gm-retry" @click.stop="load">Retry</button>
    </div>
    <template v-else>
      <img v-if="kind === 'image'" :src="url" :alt="media.mediaName" class="gm-img" @click.stop="emit('open', url)" />
      <video v-else-if="kind === 'video'" :src="url" controls playsinline class="gm-video"></video>
      <audio v-else-if="kind === 'audio'" :src="url" controls class="gm-audio"></audio>
      <a v-else :href="url" :download="media.mediaName || 'file'" class="gm-file" @click.stop>
        <span class="gm-file-icon">📄</span>
        <span class="gm-file-info">
          <span class="gm-file-name">{{ media.mediaName || 'File' }}</span>
          <span class="gm-file-size">{{ size }}</span>
        </span>
      </a>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import type { GroupMedia } from '@/types/social';

const props = defineProps<{ media: GroupMedia }>();
const emit = defineEmits<{ (e: 'open', url: string): void }>();
const store = useChatRoomStore();

const url = ref('');
const state = ref<'loading' | 'ready' | 'error'>('loading');
const kind = computed(() => {
  const t = props.media.mediaType;
  return t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'file';
});
const label = computed(() => ({ image: 'Photo', video: 'Video', audio: 'Voice message', file: props.media.mediaName || 'File' })[kind.value]);
const size = computed(() => {
  const b = props.media.mediaSize;
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
});

async function load() {
  state.value = 'loading';
  try {
    url.value = await store.loadMedia(props.media);
    state.value = 'ready';
  } catch {
    state.value = 'error';
  }
}
onMounted(load);
</script>

<style scoped>
.gm { margin-bottom: 4px; max-width: 100%; }
.gm-placeholder { display: flex; align-items: center; gap: 8px; padding: 18px 16px; border-radius: 12px; background: rgba(0,0,0,.18); font-size: 13px; color: var(--app-text-muted); min-width: 180px; }
.gm-error { color: #fbbf24; }
.gm-retry { margin-left: auto; background: none; border: 1px solid currentColor; color: inherit; border-radius: 999px; padding: 2px 10px; font-size: 12px; cursor: pointer; }
.gm-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.2); border-top-color: #818cf8; border-radius: 50%; animation: gmspin .7s linear infinite; }
@keyframes gmspin { to { transform: rotate(360deg); } }
.gm-img { display: block; max-width: min(320px, 100%); max-height: 360px; border-radius: 12px; cursor: zoom-in; object-fit: cover; }
.gm-video { display: block; max-width: min(320px, 100%); max-height: 360px; border-radius: 12px; background: #000; }
.gm-audio { display: block; width: 240px; max-width: 100%; height: 40px; }
.gm-file { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,.18); color: inherit; text-decoration: none; min-width: 200px; }
.gm-file-icon { font-size: 24px; }
.gm-file-info { display: flex; flex-direction: column; min-width: 0; }
.gm-file-name { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gm-file-size { font-size: 11.5px; opacity: .7; }
</style>
