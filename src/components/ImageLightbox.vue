<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="lb-backdrop"
      role="dialog"
      aria-modal="true"
      @click="$emit('close')"
    >
      <button class="lb-close" aria-label="Close" @click.stop="$emit('close')">✕</button>
      <button v-if="srcs.length > 1" class="lb-nav lb-prev" aria-label="Previous" @click.stop="step(-1)">‹</button>
      <img :src="srcs[index]" :alt="alt" class="lb-img" @click.stop />
      <button v-if="srcs.length > 1" class="lb-nav lb-next" aria-label="Next" @click.stop="step(1)">›</button>
      <span v-if="srcs.length > 1" class="lb-count">{{ index + 1 }} / {{ srcs.length }}</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  srcs: string[];
  start?: number;
  alt?: string;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const index = ref(0);

function step(delta: number) {
  const n = props.srcs.length;
  if (n) index.value = (index.value + delta + n) % n;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    index.value = props.start ?? 0;
    window.addEventListener('keydown', onKey);
  } else {
    window.removeEventListener('keydown', onKey);
  }
}, { immediate: true });

onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<style>
.lb-backdrop {
  position: fixed; inset: 0; z-index: 100000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.92);
}
.lb-img { max-width: 100vw; max-height: 100vh; object-fit: contain; }
.lb-close, .lb-nav {
  position: absolute; border: none; color: #fff; cursor: pointer;
  background: rgba(255, 255, 255, 0.12); border-radius: 50%;
  width: 40px; height: 40px; font-size: 22px; line-height: 1;
}
.lb-close { top: max(12px, env(safe-area-inset-top)); right: 12px; }
.lb-nav { top: 50%; transform: translateY(-50%); }
.lb-prev { left: 8px; }
.lb-next { right: 8px; }
.lb-count {
  position: absolute; bottom: max(14px, env(safe-area-inset-bottom));
  color: rgba(255, 255, 255, 0.75); font-size: 13px;
}
</style>
