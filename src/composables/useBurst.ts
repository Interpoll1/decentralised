/**
 * useBurst — shared singleton for the Instagram-style full-screen vote animation.
 * Any component can call triggerBurst('heart'|'dislike') and the nearest
 * BurstOverlay component (in HomePage or any page shell) will display it.
 */
import { ref } from 'vue';

const burstActive = ref(false);
const burstType   = ref<'heart' | 'dislike'>('heart');
let   burstTimer: ReturnType<typeof setTimeout> | null = null;

export function useBurst() {
  function triggerBurst(type: 'heart' | 'dislike') {
    if (burstTimer) clearTimeout(burstTimer);
    burstType.value   = type;
    burstActive.value = true;
    burstTimer = setTimeout(() => { burstActive.value = false; }, 900);
  }

  return { burstActive, burstType, triggerBurst };
}
