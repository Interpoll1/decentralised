<template>
  <Teleport to="body">
    <Transition name="heart-burst">
      <div v-if="burstActive" class="burst-overlay-global" :class="burstType">

        <!-- Heart for upvote -->
        <svg v-if="burstType === 'heart'" class="burst-icon" viewBox="0 0 24 24">
          <path
            d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
            fill="#c4b5fd"
          />
        </svg>

        <!-- Rotated thumb-down for dislike -->
        <svg v-else class="burst-icon" viewBox="0 0 24 24" style="transform: rotate(-20deg) scaleX(-1)">
          <path
            d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"
            fill="#ef4444"
          />
        </svg>

        <!-- Particles -->
        <div class="burst-particles-ring">
          <span
            v-for="i in 8" :key="i"
            class="burst-dot"
            :style="`--i:${i}; background:${burstType === 'heart' ? '#c4b5fd' : '#ef4444'}`"
          ></span>
        </div>

      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useBurst } from '../composables/useBurst';
const { burstActive, burstType } = useBurst();
</script>

<style>
/* ── Global — NOT scoped (teleported outside component tree) ── */
.burst-overlay-global {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.burst-icon {
  width: 160px;
  height: 160px;
  animation: burst-pop 0.75s cubic-bezier(0.17, 0.89, 0.32, 1.28) forwards;
  filter: drop-shadow(0 0 36px rgba(196, 181, 253, 0.85));
}
.burst-overlay-global.dislike .burst-icon {
  filter: drop-shadow(0 0 36px rgba(239, 68, 68, 0.85));
}

@keyframes burst-pop {
  0%   { transform: scale(0.08) rotate(-12deg); opacity: 0; }
  30%  { transform: scale(1.45) rotate(6deg);   opacity: 1; }
  52%  { transform: scale(0.92) rotate(-3deg);  opacity: 1; }
  72%  { transform: scale(1.12) rotate(1deg);   opacity: 0.95; }
  100% { transform: scale(1.18) rotate(0deg);   opacity: 0; }
}

/* Particles */
.burst-particles-ring {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.burst-dot {
  position: absolute;
  top: 50%; left: 50%;
  width: 11px; height: 11px;
  border-radius: 50%;
  animation: burst-dot-fly 0.85s ease-out forwards;
  animation-delay: calc(var(--i) * 0.03s);
  transform-origin: 0 0;
}
@keyframes burst-dot-fly {
  0%   { transform: translate(-50%,-50%) rotate(calc(var(--i)*45deg)) translateY(0px)    scale(1);   opacity: 1; }
  60%  { opacity: 0.8; }
  100% { transform: translate(-50%,-50%) rotate(calc(var(--i)*45deg)) translateY(-120px) scale(0.2); opacity: 0; }
}

/* Vue transition */
.heart-burst-enter-active { animation: burst-pop 0.75s cubic-bezier(0.17,0.89,0.32,1.28); }
.heart-burst-leave-active  { transition: opacity 0.12s ease; }
.heart-burst-leave-to      { opacity: 0; }
</style>
