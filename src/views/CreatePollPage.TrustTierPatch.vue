<template>
  <!--
    ╔══════════════════════════════════════════════════════════════════════╗
    ║  PATCH — Add these two form-card blocks to CreatePollPage.vue       ║
    ║  Insert them AFTER the existing "Settings" form-card and BEFORE     ║
    ║  the "Privacy" / "Submit" section.                                  ║
    ╚══════════════════════════════════════════════════════════════════════╝
  -->

  <!-- ── Trust tier card ───────────────────────────────────────────── -->
  <div class="form-card">
    <div class="card-section-label">
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
      </svg>
      Sybil resistance
      <span class="card-section-sub">Who can vote?</span>
    </div>

    <div class="tier-option-list">
      <button
        v-for="opt in TIER_OPTIONS"
        :key="opt.value"
        class="tier-option"
        :class="{ active: trustTier === opt.value }"
        @click="trustTier = opt.value"
        type="button"
      >
        <div class="tier-option-icon" :class="'tier-icon--' + opt.value" aria-hidden="true">
          <component :is="opt.icon" />
        </div>
        <div class="tier-option-body">
          <strong>{{ opt.label }}</strong>
          <span>{{ opt.desc }}</span>
        </div>
        <div class="tier-option-check" v-if="trustTier === opt.value" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>
    </div>

    <div v-if="trustTier !== 'anonymous'" class="tier-info-row">
      <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0;color:var(--app-text-subtle)">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      <span>{{ TIER_OPTIONS.find(o => o.value === trustTier)?.detail }}</span>
    </div>
  </div>

  <!-- ── Time-lock card ─────────────────────────────────────────────── -->
  <div class="form-card">
    <div class="card-section-label">
      <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      Time-locked results
      <span class="card-section-sub">optional</span>
    </div>

    <div class="toggle-row">
      <div class="toggle-info">
        <strong>Hide results until poll ends</strong>
        <p>Nobody sees tallies — including the creator — until the reveal condition is met. Enforced cryptographically, not by the server.</p>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" v-model="timeLockEnabled" />
        <span class="toggle-track"></span>
      </label>
    </div>

    <div v-if="timeLockEnabled" class="timelock-options">
      <div class="field-group">
        <label class="field-label">Reveal condition</label>
        <div class="reveal-choice-row">
          <button
            class="reveal-choice"
            :class="{ active: timeLockMode === 'poll-end' }"
            @click="timeLockMode = 'poll-end'"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            When poll ends
          </button>
          <button
            class="reveal-choice"
            :class="{ active: timeLockMode === 'block' }"
            @click="timeLockMode = 'block'"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            At block #
          </button>
          <button
            class="reveal-choice"
            :class="{ active: timeLockMode === 'datetime' }"
            @click="timeLockMode = 'datetime'"
            type="button"
          >
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
              <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8"/>
              <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Date/time
          </button>
        </div>
      </div>

      <div v-if="timeLockMode === 'block'" class="field-group">
        <label class="field-label">Reveal at chain block</label>
        <div class="field-wrap">
          <input
            v-model="timeLockBlock"
            class="field-native"
            type="number"
            :placeholder="`Current: ${currentBlock} — enter future block`"
            min="0"
          />
        </div>
        <p class="field-hint">Blocks are added roughly every 10 minutes. Results become visible when this block is reached.</p>
      </div>

      <div v-if="timeLockMode === 'datetime'" class="field-group">
        <label class="field-label">Reveal at</label>
        <div class="field-wrap">
          <input v-model="timeLockDate" class="field-native" type="datetime-local" />
        </div>
      </div>

      <div class="timelock-info-row">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0;color:var(--app-text-subtle)">
          <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
          <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <span>
          Results are encrypted with AES-256 on your device. The decryption key is released only when the reveal condition is met.
          <strong>Not even the relay can read results early.</strong>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  INSTRUCTIONS — How to integrate this patch into CreatePollPage.vue ║
 * ╠══════════════════════════════════════════════════════════════════════╣
 * ║                                                                      ║
 * ║  1. Copy the two <div class="form-card"> blocks from the template   ║
 * ║     above into CreatePollPage.vue, after the settings card.         ║
 * ║                                                                      ║
 * ║  2. Add these refs to the <script setup> section:                   ║
 * ║                                                                      ║
 * ║     const trustTier    = ref<'anonymous'|'pow'|'relay'|'issuer'>    ║
 * ║                           ('anonymous')                             ║
 * ║     const timeLockEnabled = ref(false)                              ║
 * ║     const timeLockMode  = ref<'poll-end'|'block'|'datetime'>        ║
 * ║                            ('poll-end')                             ║
 * ║     const timeLockBlock = ref<number|null>(null)                    ║
 * ║     const timeLockDate  = ref('')                                   ║
 * ║     const currentBlock  = computed(() =>                            ║
 * ║       chainStore.blocks.length                                      ║
 * ║     )                                                               ║
 * ║                                                                      ║
 * ║  3. Add these fields to the poll object passed to pollService       ║
 * ║     when createPoll() submits:                                       ║
 * ║                                                                      ║
 * ║     voteTrustPolicy: {                                              ║
 * ║       requiredTier: trustTier.value,                                ║
 * ║     },                                                              ║
 * ║     resultsLockedUntil: computeRevealTs(),                          ║
 * ║     timeLockMode: timeLockEnabled.value ? timeLockMode.value : null,║
 * ║     timeLockBlock: timeLockBlock.value,                             ║
 * ║                                                                      ║
 * ║  4. Add computeRevealTs() helper:                                   ║
 * ║                                                                      ║
 * ║     function computeRevealTs(): number | null {                     ║
 * ║       if (!timeLockEnabled.value) return null;                      ║
 * ║       if (timeLockMode.value === 'poll-end') return poll.expiresAt; ║
 * ║       if (timeLockMode.value === 'datetime' && timeLockDate.value)  ║
 * ║         return new Date(timeLockDate.value).getTime();              ║
 * ║       return null; // block mode handled server-side                ║
 * ║     }                                                               ║
 * ║                                                                      ║
 * ║  5. Add the CSS from the <style> section below to                   ║
 * ║     CreatePollPage.vue's existing <style scoped> block.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { ref, computed, markRaw } from 'vue';
import { useChainStore } from '../stores/chainStore';

const chainStore = useChainStore();

type TrustTier = 'anonymous' | 'pow' | 'relay' | 'issuer';
const trustTier      = ref<TrustTier>('anonymous');
const timeLockEnabled = ref(false);
const timeLockMode   = ref<'poll-end' | 'block' | 'datetime'>('poll-end');
const timeLockBlock  = ref<number | null>(null);
const timeLockDate   = ref('');
const currentBlock   = computed(() => chainStore.blocks.length);

// SVG icon render helpers (inline — no ionicons dependency)
const PowIcon = markRaw({
  template: `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 12h2l1-2 2 4 1-2h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
});
const ShieldIcon = markRaw({
  template: `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
});
const CertIcon = markRaw({
  template: `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
});
const AnonIcon = markRaw({
  template: `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
});

const TIER_OPTIONS: Array<{
  value: TrustTier;
  label: string;
  desc: string;
  detail: string;
  icon: any;
}> = [
  {
    value:  'anonymous',
    label:  'Open',
    desc:   'Anyone with a keypair can vote.',
    detail: 'No Sybil resistance. Good for informal opinion polls.',
    icon:   AnonIcon,
  },
  {
    value:  'pow',
    label:  'Proof-of-Work',
    desc:   'Each voter solves a ~50ms CPU puzzle.',
    detail: 'Sybil attacks cost real computation. The work nonce is attached to every vote and verifiable offline by anyone.',
    icon:   PowIcon,
  },
  {
    value:  'relay',
    label:  'Relay attested',
    desc:   'Relay vouches for each voter\'s device.',
    detail: 'The relay signs a per-vote attestation. Votes carry both the voter\'s Schnorr sig and the relay signature. Stronger Sybil resistance but relay-dependent.',
    icon:   ShieldIcon,
  },
  {
    value:  'issuer',
    label:  'Issuer certified',
    desc:   'Verified credential required to vote.',
    detail: 'Each voter must hold a TrustService certificate binding their keypair to a verified real-world identity. Certs are verifiable entirely offline.',
    icon:   CertIcon,
  },
];
</script>

<style scoped>
/* ── Sybil resistance / trust tier card ──── */
.tier-option-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tier-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(0,0,0,0.03);
  border: 1px solid var(--app-border, rgba(255,255,255,0.07));
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: all 0.15s ease;
}
.tier-option:hover { border-color: rgba(var(--app-accent-rgb),0.3); }
.tier-option.active {
  border-color: rgba(var(--app-accent-rgb),0.5);
  background: rgba(var(--app-accent-rgb),0.07);
}

.tier-option-icon {
  width: 38px; height: 38px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tier-icon--anonymous { background: rgba(107,114,128,0.12); color: var(--app-text-muted); }
.tier-icon--pow       { background: rgba(251,191,36,0.12);  color: #fbbf24; }
.tier-icon--relay     { background: rgba(var(--app-accent-rgb),0.12); color: var(--app-accent-bright); }
.tier-icon--issuer    { background: rgba(52,211,153,0.12);  color: var(--app-success, #34d399); }

.tier-option-body { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.tier-option-body strong { font-size: 14px; font-weight: 700; color: var(--app-text); }
.tier-option-body span   { font-size: 12px; color: var(--app-text-muted); }
.tier-option-check { color: var(--app-accent-bright); flex-shrink: 0; }

.tier-info-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(0,0,0,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  font-size: 12px; color: var(--app-text-muted); line-height: 1.5;
}

/* ── Time-lock card ──── */
.toggle-row {
  display: flex; align-items: flex-start;
  justify-content: space-between; gap: 12px;
}
.toggle-info { flex: 1; }
.toggle-info strong { font-size: 14px; font-weight: 700; color: var(--app-text); display: block; margin-bottom: 3px; }
.toggle-info p { margin: 0; font-size: 12px; color: var(--app-text-muted); line-height: 1.5; }

.toggle-switch { flex-shrink: 0; }
.toggle-switch input { display: none; }
.toggle-track {
  display: block; width: 44px; height: 24px; border-radius: 12px;
  background: var(--app-border-strong, rgba(255,255,255,0.15));
  cursor: pointer; position: relative; transition: background 0.2s;
}
.toggle-track::after {
  content: ''; position: absolute; top: 3px; left: 3px;
  width: 18px; height: 18px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.25); transition: transform 0.2s;
}
.toggle-switch input:checked + .toggle-track { background: var(--app-accent, #5e6ad2); }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(20px); }

.timelock-options { display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }

.reveal-choice-row { display: flex; gap: 6px; flex-wrap: wrap; }
.reveal-choice {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(0,0,0,0.04);
  border: 1px solid var(--app-border, rgba(255,255,255,0.07));
  font-size: 13px; font-weight: 600; color: var(--app-text-muted);
  cursor: pointer; transition: all 0.15s;
}
.reveal-choice.active {
  background: rgba(var(--app-accent-rgb),0.1);
  border-color: rgba(var(--app-accent-rgb),0.4);
  color: var(--app-accent-bright);
}

.timelock-info-row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(251,191,36,0.06);
  border: 1px solid rgba(251,191,36,0.15);
  font-size: 12px; color: var(--app-text-muted); line-height: 1.5;
}
.timelock-info-row strong { color: var(--app-text); }

.card-section-sub {
  font-size: 11px; font-weight: 500;
  color: var(--app-text-subtle);
  margin-left: 4px; text-transform: none; letter-spacing: 0;
}
.field-hint { font-size: 11px; color: var(--app-text-subtle); margin: 4px 0 0; }
</style>
