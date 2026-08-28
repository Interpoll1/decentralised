<template>
  <div
    class="ttb"
    :class="'ttb--' + tier"
    :title="tierMeta.desc"
    @click.stop="showTooltip = !showTooltip"
    role="button"
    :aria-label="tierMeta.name + ' trust tier'"
  >
    <!-- icon -->
    <svg v-if="tier === 'pow'" class="ttb-icon" viewBox="0 0 24 24" fill="none" width="11" height="11">
      <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
      <path d="M8 12h2l1-2 2 4 1-2h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <svg v-else-if="tier === 'relay'" class="ttb-icon" viewBox="0 0 24 24" fill="none" width="11" height="11">
      <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
    <svg v-else-if="tier === 'issuer'" class="ttb-icon" viewBox="0 0 24 24" fill="none" width="11" height="11">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <svg v-else class="ttb-icon" viewBox="0 0 24 24" fill="none" width="11" height="11">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>

    <span class="ttb-label">{{ compact ? tierMeta.short : tierMeta.name }}</span>

    <!-- inline tooltip -->
    <transition name="ttb-tip">
      <div v-if="showTooltip" class="ttb-tooltip" @click.stop>
        <strong>{{ tierMeta.name }}</strong>
        <p>{{ tierMeta.desc }}</p>
        <p class="ttb-tooltip-extra">{{ tierMeta.extra }}</p>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

type Tier = 'anonymous' | 'pow' | 'relay' | 'issuer';

const props = defineProps<{
  tier: Tier;
  compact?: boolean;
}>();

const showTooltip = ref(false);

const META: Record<Tier, { name: string; short: string; desc: string; extra: string }> = {
  anonymous: {
    name:  'Open',
    short: 'Open',
    desc:  'Anyone can vote. Keypair-signed but no Sybil resistance.',
    extra: 'Suitable for opinion polls. Not resistant to vote farming.',
  },
  pow: {
    name:  'PoW required',
    short: 'PoW',
    desc:  'Each vote required solving a ~50ms hashcash puzzle before submission.',
    extra: 'Sybil attacks cost real CPU. The work nonce is attached to every vote and verifiable offline.',
  },
  relay: {
    name:  'Relay attested',
    short: 'Relay',
    desc:  'The relay cryptographically vouched that each voter came from a distinct device.',
    extra: 'Votes carry a relay signature alongside the voter\'s Schnorr sig. Stronger Sybil resistance, but relay-dependent.',
  },
  issuer: {
    name:  'Issuer certified',
    short: 'Cert',
    desc:  'Each voter holds a TrustService certificate binding their keypair to a verified identity.',
    extra: 'The most Sybil-resistant. Certs are verifiable entirely offline — no relay needed.',
  },
};

const tierMeta = computed(() => META[props.tier] || META.anonymous);
</script>

<style scoped>
.ttb {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  position: relative;
  border: 0.5px solid transparent;
  transition: opacity 0.15s;
  user-select: none;
  white-space: nowrap;
}
.ttb:hover { opacity: 0.85; }

.ttb--anonymous {
  background: rgba(107, 114, 128, 0.12);
  border-color: rgba(107, 114, 128, 0.2);
  color: var(--app-text-muted, #9ca3af);
}
.ttb--pow {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.22);
  color: #fbbf24;
}
.ttb--relay {
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.12);
  border-color: rgba(var(--app-accent-rgb, 94 106 210), 0.24);
  color: var(--app-accent-bright, #a5b4fc);
}
.ttb--issuer {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.22);
  color: var(--app-success, #34d399);
}

.ttb-icon { flex-shrink: 0; }
.ttb-label { line-height: 1; }

/* tooltip */
.ttb-tooltip {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 200;
  min-width: 220px;
  background: var(--app-bg-elevated, #1e1e32);
  border: 0.5px solid rgba(255,255,255,0.12);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.5);
  cursor: default;
}
.ttb-tooltip strong { font-size: 12px; font-weight: 700; color: var(--app-text, #f1f5f9); display: block; margin-bottom: 4px; }
.ttb-tooltip p { margin: 0 0 4px; font-size: 11px; color: var(--app-text-muted, #9ca3af); line-height: 1.45; font-weight: 400; }
.ttb-tooltip-extra { color: var(--app-text-subtle, #6b7280) !important; font-style: italic; }

.ttb-tip-enter-active { transition: opacity 0.14s ease, transform 0.14s ease; }
.ttb-tip-leave-active { transition: opacity 0.1s ease; }
.ttb-tip-enter-from  { opacity: 0; transform: translateY(-4px); }
.ttb-tip-leave-to    { opacity: 0; }
</style>
