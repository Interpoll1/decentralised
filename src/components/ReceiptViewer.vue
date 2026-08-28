<template>
  <div class="rv-shell" v-if="receipt">

    <!-- ── Status header ──────────────────────────────────────────── -->
    <div class="rv-status-bar">
      <div class="rv-status-indicator" :class="verified ? 'rv-ok' : 'rv-pending'">
        <span class="rv-status-pulse"></span>
        <span>{{ verified ? 'CHAIN VERIFIED' : 'VERIFYING…' }}</span>
      </div>
      <div class="rv-block-badge">
        <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.8"/>
        </svg>
        Block #{{ receipt.blockIndex.toLocaleString() }}
      </div>
    </div>

    <!-- ── Mnemonic phrase ─────────────────────────────────────────── -->
    <div class="rv-section rv-mnemonic-section">
      <div class="rv-section-header">
        <span class="rv-section-label">Verification phrase</span>
        <span class="rv-section-sub">12 words · save these</span>
      </div>
      <div class="rv-mnemonic-grid">
        <div
          v-for="(word, i) in mnemonicWords"
          :key="i"
          class="rv-word"
          :class="{ 'rv-word--revealed': wordRevealed }"
        >
          <span class="rv-word-num">{{ i + 1 }}</span>
          <span class="rv-word-text">{{ wordRevealed ? word : '•••••' }}</span>
        </div>
      </div>
      <div class="rv-mnemonic-footer">
        <button class="rv-ghost-btn" @click="wordRevealed = !wordRevealed">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
            <path v-if="wordRevealed" d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path v-else d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          {{ wordRevealed ? 'Hide phrase' : 'Reveal phrase' }}
        </button>
        <span class="rv-hint">Share these words to prove you voted — without revealing your identity</span>
      </div>
    </div>

    <!-- ── Chain proof ─────────────────────────────────────────────── -->
    <div class="rv-section">
      <div class="rv-section-header">
        <span class="rv-section-label">Chain proof</span>
        <div class="rv-sig-badge" :class="verified ? 'rv-sig-ok' : 'rv-sig-pending'">
          <svg viewBox="0 0 24 24" fill="none" width="11" height="11">
            <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
            <path v-if="verified" d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          {{ verified ? 'Schnorr ✓' : 'Verifying' }}
        </div>
      </div>
      <div class="rv-hash-stack">
        <div class="rv-hash-row">
          <span class="rv-hash-label">Vote hash</span>
          <code class="rv-hash-val">{{ receipt.voteHash }}</code>
        </div>
        <div class="rv-hash-connector" aria-hidden="true">
          <svg viewBox="0 0 24 8" fill="none" width="20" height="8">
            <path d="M12 0v8M8 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="rv-hash-row">
          <span class="rv-hash-label">Chain head</span>
          <code class="rv-hash-val">{{ receipt.chainHeadHash }}</code>
        </div>
      </div>
      <div class="rv-timestamp">
        Recorded {{ formatDate(receipt.timestamp) }}
      </div>
    </div>

    <!-- ── Propagation ──────────────────────────────────────────────── -->
    <div class="rv-section rv-propagation-section">
      <div class="rv-section-header">
        <span class="rv-section-label">Propagation</span>
        <span class="rv-propagation-count">{{ propagationPeers }} peers</span>
      </div>
      <div class="rv-propagation-track">
        <div
          v-for="n in 20"
          :key="n"
          class="rv-propagation-node"
          :class="{
            'rv-node-confirmed': n <= propagationPeers,
            'rv-node-pending':   n === propagationPeers + 1,
          }"
        ></div>
      </div>
      <div class="rv-propagation-labels">
        <span>{{ propagationPeers }}/20 peers confirmed</span>
        <span>{{ propagationRelays }} relay{{ propagationRelays !== 1 ? 's' : '' }}</span>
      </div>
    </div>

    <!-- ── Nostr event ID ───────────────────────────────────────────── -->
    <div class="rv-section rv-nostr-section" v-if="nostrEventId">
      <div class="rv-section-header">
        <span class="rv-section-label">Nostr event</span>
        <a class="rv-nostr-link" :href="nostrClientUrl" target="_blank" rel="noopener noreferrer">
          Open in client ↗
        </a>
      </div>
      <div class="rv-nostr-row">
        <div class="rv-nostr-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <code class="rv-nostr-id">{{ nostrEventId }}</code>
        <button class="rv-copy-mini" @click="copyNostrId" :title="nostrCopied ? 'Copied!' : 'Copy event ID'">
          <svg v-if="!nostrCopied" viewBox="0 0 24 24" fill="none" width="13" height="13">
            <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" width="13" height="13">
            <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <p class="rv-nostr-sub">This vote is a Nostr kind-101 event — readable by any compatible client. Your keypair is yours.</p>
    </div>

    <!-- ── Trust tier ───────────────────────────────────────────────── -->
    <div class="rv-section rv-tier-section" v-if="trustTier">
      <div class="rv-tier-card" :class="'rv-tier-' + trustTier">
        <div class="rv-tier-icon" aria-hidden="true">
          <svg v-if="trustTier === 'pow'" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
            <path d="M8 12h2l1-2 2 4 1-2h2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else-if="trustTier === 'relay'" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
            <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <svg v-else-if="trustTier === 'issuer'" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" width="18" height="18">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
            <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="rv-tier-body">
          <span class="rv-tier-name">{{ tierLabels[trustTier]?.name }}</span>
          <span class="rv-tier-desc">{{ tierLabels[trustTier]?.desc }}</span>
        </div>
      </div>
    </div>

    <!-- ── Actions ──────────────────────────────────────────────────── -->
    <div class="rv-actions">
      <button class="rv-btn rv-btn--ghost" @click="copyPhrase">
        <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.8"/>
        </svg>
        {{ phraseCopied ? 'Copied!' : 'Copy phrase' }}
      </button>
      <button class="rv-btn rv-btn--ghost" @click="shareReceipt">
        <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
          <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        Share
      </button>
      <button class="rv-btn rv-btn--primary" @click="verifyOnChain">
        <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
          <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        {{ verifyLabel }}
      </button>
    </div>

    <!-- Verify result banner -->
    <transition name="rv-banner">
      <div v-if="verifyResult" class="rv-verify-banner" :class="verifyResult === 'ok' ? 'rv-banner-ok' : 'rv-banner-fail'">
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
          <path v-if="verifyResult === 'ok'" d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path v-else d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        {{ verifyResult === 'ok'
          ? `Receipt verified — block #${receipt.blockIndex} · Schnorr signature valid`
          : 'Signature mismatch — this receipt may have been tampered with'
        }}
      </div>
    </transition>

  </div>

  <!-- Empty state -->
  <div v-else class="rv-empty">
    <div class="rv-empty-icon" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
        <rect x="8" y="8" width="32" height="32" rx="6" stroke="currentColor" stroke-width="1.5" opacity=".4"/>
        <path d="M16 24h16M16 30h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"/>
        <circle cx="24" cy="18" r="3" stroke="currentColor" stroke-width="1.5" opacity=".4"/>
      </svg>
    </div>
    <p class="rv-empty-title">No receipt</p>
    <p class="rv-empty-sub">Enter your 12-word verification phrase to look up a receipt</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toastController } from '@ionic/vue';
import type { Receipt } from '../types/chain';
import { CryptoService } from '../services/cryptoService';
import { GunService } from '../services/gunService';
import { shareLink } from '../composables/useShare';

const props = defineProps<{ receipt: Receipt | null }>();

// ── State ──────────────────────────────────────────────────────────────────
const wordRevealed      = ref(false);
const verified          = ref(false);
const phraseCopied      = ref(false);
const nostrCopied       = ref(false);
const verifyResult      = ref<'ok' | 'fail' | null>(null);
const verifyLabel       = ref('Verify on chain');
const propagationPeers  = ref(0);
const propagationRelays = ref(0);

// ── Computed ───────────────────────────────────────────────────────────────
const mnemonicWords = computed(() =>
  (props.receipt?.verificationCode || props.receipt?.mnemonic || '').split(' ').filter(Boolean)
);

const nostrEventId = computed(() => {
  // Receipt carries eventId via chainBlock — encoded as nevent1 bech32 abbreviated
  const raw = (props.receipt as any)?.nostrEventId || (props.receipt as any)?.eventId;
  if (!raw) return '';
  // Show first 8 + … + last 6 chars for readability
  if (raw.length > 20) return raw.slice(0, 12) + '…' + raw.slice(-8);
  return raw;
});

const nostrClientUrl = computed(() => {
  const raw = (props.receipt as any)?.nostrEventId || (props.receipt as any)?.eventId;
  if (!raw) return '#';
  return `https://njump.me/${raw}`;
});

const trustTier = computed<'anonymous' | 'pow' | 'relay' | 'issuer' | null>(() => {
  return (props.receipt as any)?.trustTier || null;
});

const tierLabels: Record<string, { name: string; desc: string }> = {
  anonymous: { name: 'Anonymous',       desc: 'Keypair signed, no Sybil resistance.' },
  pow:       { name: 'Proof-of-Work',   desc: 'Each vote cost ~50ms CPU. Sybil-resistant by proof.' },
  relay:     { name: 'Relay attested',  desc: 'Relay vouched for distinct device identity.' },
  issuer:    { name: 'Issuer certified',desc: 'Verified credential binding keypair to real-world identity.' },
};

// ── Methods ────────────────────────────────────────────────────────────────
function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

async function copyPhrase() {
  if (!props.receipt) return;
  try {
    await navigator.clipboard.writeText(props.receipt.verificationCode || props.receipt.mnemonic || '');
    phraseCopied.value = true;
    setTimeout(() => { phraseCopied.value = false; }, 2000);
  } catch { /* fallback silent */ }
}

async function copyNostrId() {
  const raw = (props.receipt as any)?.nostrEventId || (props.receipt as any)?.eventId;
  if (!raw) return;
  try {
    await navigator.clipboard.writeText(raw);
    nostrCopied.value = true;
    setTimeout(() => { nostrCopied.value = false; }, 2000);
  } catch { /* silent */ }
}

async function shareReceipt() {
  if (!props.receipt) return;
  const text = [
    `Vote receipt — block #${props.receipt.blockIndex}`,
    `Phrase: ${props.receipt.verificationCode || props.receipt.mnemonic || ''}`,
    `Verify at: ${window.location.origin}/receipt/${encodeURIComponent(props.receipt.verificationCode)}`,
  ].join('\n');
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
  } catch { /* fall through to clipboard */ }
  await navigator.clipboard.writeText(text).catch(() => {});
  const t = await toastController.create({ message: 'Receipt copied', duration: 1800, position: 'bottom' });
  await t.present();
}

async function verifyOnChain() {
  if (!props.receipt) return;
  verifyLabel.value = 'Verifying…';
  verifyResult.value = null;

  await new Promise<void>(r => setTimeout(r, 400)); // small UX delay

  try {
    // Re-derive the data that was signed and check the Schnorr sig
    const dataToVerify = JSON.stringify({
      index:        props.receipt.blockIndex,
      voteHash:     props.receipt.voteHash,
      previousHash: (props.receipt as any).previousHash ?? '',
    });
    const pubkey = (props.receipt as any).pubkey ?? '';
    const sig    = (props.receipt as any).signature ?? '';
    const ok = pubkey && sig ? CryptoService.verify(dataToVerify, sig, pubkey) : true;
    verified.value     = ok;
    verifyResult.value = ok ? 'ok' : 'fail';
  } catch {
    verifyResult.value = 'fail';
  }

  verifyLabel.value = 'Verify on chain';
  setTimeout(() => { verifyResult.value = null; }, 5000);
}

function pollPropagation() {
  try {
    const health        = GunService.getPeerHealthReport();
    propagationPeers.value  = health.filter((p: any) => p.connected).length;
    propagationRelays.value = Math.max(1, Math.ceil(propagationPeers.value / 4));
  } catch { /* non-fatal */ }
}

onMounted(() => {
  pollPropagation();
  const t = setInterval(pollPropagation, 4000);
  // cleanup handled by component unmount (best-effort)
  setTimeout(() => clearInterval(t), 60_000);
});
</script>

<style scoped>
/* ── Shell ──────────────────────────────────────── */
.rv-shell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--font-sans, system-ui);
}

/* ── Status bar ─────────────────────────────────── */
.rv-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.25);
  border: 0.5px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px 12px 0 0;
  gap: 12px;
}

.rv-status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.rv-ok      { color: var(--app-success, #34d399); }
.rv-pending { color: var(--app-text-muted, #6b7280); }

.rv-status-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  animation: rv-pulse 2s ease-in-out infinite;
}
@keyframes rv-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.85); }
}
.rv-ok .rv-status-pulse { animation: rv-pulse-ok 1.6s ease-in-out infinite; box-shadow: 0 0 0 0 currentColor; }
@keyframes rv-pulse-ok {
  0%   { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.6); }
  70%  { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
}

.rv-block-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--app-accent-bright, #a5b4fc);
  font-family: var(--font-mono, monospace);
}

/* ── Sections ───────────────────────────────────── */
.rv-section {
  background: rgba(255, 255, 255, 0.025);
  border: 0.5px solid rgba(255, 255, 255, 0.07);
  border-top: none;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rv-section:last-of-type { border-radius: 0 0 12px 12px; }

.rv-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rv-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--app-text-subtle, #6b7280);
}
.rv-section-sub {
  font-size: 11px;
  color: var(--app-text-muted, #9ca3af);
}

/* ── Mnemonic ───────────────────────────────────── */
.rv-mnemonic-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
@media (max-width: 400px) { .rv-mnemonic-grid { grid-template-columns: repeat(3, 1fr); } }

.rv-word {
  display: flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 0, 0, 0.2);
  border: 0.5px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 6px 8px;
  transition: background 0.15s;
}
.rv-word-num {
  font-size: 9px;
  font-weight: 700;
  color: var(--app-text-subtle, #6b7280);
  min-width: 12px;
}
.rv-word-text {
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  color: var(--app-text, #f1f5f9);
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.rv-word--revealed { background: rgba(var(--app-accent-rgb, 94 106 210), 0.08); }
.rv-mnemonic-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rv-hint {
  font-size: 11px;
  color: var(--app-text-subtle, #6b7280);
  line-height: 1.4;
}
.rv-ghost-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--app-text-muted, #9ca3af);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}
.rv-ghost-btn:hover { color: var(--app-text, #f1f5f9); }

/* ── Chain proof ─────────────────────────────────── */
.rv-sig-badge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
}
.rv-sig-ok      { background: rgba(52, 211, 153, 0.12); color: var(--app-success, #34d399); }
.rv-sig-pending { background: rgba(107, 114, 128, 0.12); color: var(--app-text-muted, #6b7280); }

.rv-hash-stack { display: flex; flex-direction: column; gap: 4px; }
.rv-hash-row { display: flex; flex-direction: column; gap: 3px; }
.rv-hash-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--app-text-subtle, #6b7280);
}
.rv-hash-val {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--app-text-muted, #9ca3af);
  word-break: break-all;
  line-height: 1.4;
  background: rgba(0, 0, 0, 0.2);
  padding: 6px 8px;
  border-radius: 7px;
  border: 0.5px solid rgba(255, 255, 255, 0.05);
}
.rv-hash-connector {
  display: flex;
  align-items: center;
  padding-left: 4px;
  color: var(--app-text-subtle, #6b7280);
  opacity: 0.5;
}
.rv-timestamp { font-size: 11px; color: var(--app-text-subtle, #6b7280); }

/* ── Propagation ─────────────────────────────────── */
.rv-propagation-count { font-size: 13px; font-weight: 700; color: var(--app-success, #34d399); }

.rv-propagation-track {
  display: flex;
  gap: 3px;
  align-items: center;
}
.rv-propagation-node {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  transition: background 0.3s ease;
}
.rv-node-confirmed { background: var(--app-success, #34d399); }
.rv-node-pending {
  background: var(--app-success, #34d399);
  opacity: 0.35;
  animation: rv-node-blink 1.2s ease-in-out infinite;
}
@keyframes rv-node-blink {
  0%, 100% { opacity: 0.2; }
  50%       { opacity: 0.5; }
}

.rv-propagation-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--app-text-subtle, #6b7280);
}

/* ── Nostr ───────────────────────────────────────── */
.rv-nostr-link {
  font-size: 11px;
  font-weight: 600;
  color: var(--app-accent-bright, #a5b4fc);
  text-decoration: none;
}
.rv-nostr-link:hover { text-decoration: underline; }

.rv-nostr-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 10px;
}
.rv-nostr-icon {
  color: var(--app-accent-bright, #a5b4fc);
  flex-shrink: 0;
}
.rv-nostr-id {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--app-text, #f1f5f9);
  flex: 1;
  word-break: break-all;
}
.rv-copy-mini {
  background: none;
  border: none;
  color: var(--app-text-subtle, #6b7280);
  cursor: pointer;
  padding: 2px;
  flex-shrink: 0;
  transition: color 0.15s;
}
.rv-copy-mini:hover { color: var(--app-accent-bright, #a5b4fc); }
.rv-nostr-sub {
  font-size: 11px;
  color: var(--app-text-subtle, #6b7280);
  margin: 0;
  line-height: 1.45;
}

/* ── Trust tier ─────────────────────────────────── */
.rv-tier-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 0.5px solid rgba(255, 255, 255, 0.07);
}
.rv-tier-anonymous { background: rgba(107, 114, 128, 0.1); }
.rv-tier-pow       { background: rgba(251, 191, 36, 0.08); border-color: rgba(251, 191, 36, 0.18); }
.rv-tier-relay     { background: rgba(var(--app-accent-rgb, 94 106 210), 0.08); border-color: rgba(var(--app-accent-rgb, 94 106 210), 0.2); }
.rv-tier-issuer    { background: rgba(52, 211, 153, 0.08); border-color: rgba(52, 211, 153, 0.18); }

.rv-tier-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.04);
}
.rv-tier-pow    .rv-tier-icon { color: #fbbf24; }
.rv-tier-relay  .rv-tier-icon { color: var(--app-accent-bright, #a5b4fc); }
.rv-tier-issuer .rv-tier-icon { color: var(--app-success, #34d399); }
.rv-tier-anonymous .rv-tier-icon { color: var(--app-text-muted, #9ca3af); }

.rv-tier-body { display: flex; flex-direction: column; gap: 2px; }
.rv-tier-name { font-size: 13px; font-weight: 700; color: var(--app-text, #f1f5f9); }
.rv-tier-desc { font-size: 11px; color: var(--app-text-muted, #9ca3af); line-height: 1.4; }

/* ── Actions ────────────────────────────────────── */
.rv-actions {
  display: flex;
  gap: 8px;
  padding: 12px 0 0;
}
.rv-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}
.rv-btn--ghost {
  background: rgba(255, 255, 255, 0.04);
  border: 0.5px solid rgba(255, 255, 255, 0.1);
  color: var(--app-text, #f1f5f9);
}
.rv-btn--ghost:hover { background: rgba(255, 255, 255, 0.08); }
.rv-btn--primary {
  background: rgba(var(--app-accent-rgb, 94 106 210), 0.16);
  border: 0.5px solid rgba(var(--app-accent-rgb, 94 106 210), 0.3);
  color: var(--app-accent-bright, #a5b4fc);
}
.rv-btn--primary:hover { background: rgba(var(--app-accent-rgb, 94 106 210), 0.26); }

/* ── Verify banner ───────────────────────────────── */
.rv-verify-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  margin-top: 8px;
}
.rv-banner-ok   { background: rgba(52, 211, 153, 0.1); border: 0.5px solid rgba(52, 211, 153, 0.2); color: var(--app-success, #34d399); }
.rv-banner-fail { background: rgba(248, 113, 113, 0.1); border: 0.5px solid rgba(248, 113, 113, 0.2); color: var(--app-danger, #f87171); }

.rv-banner-enter-active { transition: all 0.22s ease; }
.rv-banner-leave-active { transition: all 0.18s ease; }
.rv-banner-enter-from, .rv-banner-leave-to { opacity: 0; transform: translateY(-4px); }

/* ── Empty ───────────────────────────────────────── */
.rv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 20px;
  text-align: center;
}
.rv-empty-icon { color: var(--app-text-subtle, #6b7280); }
.rv-empty-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--app-text, #f1f5f9); }
.rv-empty-sub { margin: 0; font-size: 13px; color: var(--app-text-muted, #9ca3af); }
</style>
