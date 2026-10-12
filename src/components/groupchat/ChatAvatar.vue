<template>
  <!-- Groups are rounded squares, people are circles: the shape alone tells you which is which. -->
  <span
    class="cav"
    :class="[group ? 'cav--group' : 'cav--person', `cav--${size}`]"
    :style="{ '--cav-hue': hue }"
    aria-hidden="true"
  >
    <svg v-if="group && !initials" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="9" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c.7-3 2.9-4.6 5.5-4.6s4.8 1.6 5.5 4.6M15.5 6a3 3 0 010 6M17 14.6c1.7.5 2.9 2 3.4 4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    <svg v-else-if="!initials" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c0-3.9 3.6-6.5 8-6.5s8 2.6 8 6.5c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1z"/></svg>
    <template v-else>{{ initials }}</template>
    <span v-if="online" class="cav__dot"></span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { senderHue } from '@/utils/chatFormat';

const props = withDefaults(defineProps<{
  name: string;
  /** Stable seed for the colour (an id), so renames don't recolour. */
  seed: string;
  group?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
}>(), { group: false, size: 'md', online: false });

const initials = computed(() => {
  const words = (props.name || '').trim().split(/\s+/).filter(w => /\p{L}|\p{N}/u.test(w));
  if (!words.length || /^(User|Member) [0-9a-f]+$/i.test(props.name)) return '';
  return (words.length > 1 && props.group ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
});
const hue = computed(() => senderHue(props.seed));
</script>

<style scoped>
.cav {
  position: relative; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; letter-spacing: -0.01em; color: #fff; user-select: none;
  background: hsl(var(--cav-hue) 55% 48%);
}
.cav svg { width: 58%; height: 58%; }
.cav--person { border-radius: 50%; }
.cav--group { border-radius: 30%; background: linear-gradient(150deg, hsl(var(--cav-hue) 60% 52%), hsl(var(--cav-hue) 55% 38%)); }
.cav--sm { width: 30px; height: 30px; font-size: 12px; }
.cav--md { width: 46px; height: 46px; font-size: 17px; }
.cav--lg { width: 40px; height: 40px; font-size: 15px; }
.cav--xl { width: 88px; height: 88px; font-size: 32px; }
.cav__dot { position: absolute; right: -1px; bottom: -1px; width: 28%; height: 28%; min-width: 9px; min-height: 9px; border-radius: 50%; background: var(--app-success, #34d399); border: 2px solid var(--app-bg-base); }
</style>
