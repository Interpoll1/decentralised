<template>
  <ion-page class="receipt-page">
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title class="receipt-page-title">
          <span class="receipt-page-title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" stroke-width="1.8"/>
            </svg>
          </span>
          Vote Receipt
        </ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="receipt-page-content">
      <div class="rp-shell">

        <!-- ── Lookup form ───────────────────────── -->
        <div v-if="!receipt && !loading" class="rp-lookup-card surface-card">
          <div class="rp-lookup-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none" width="44" height="44">
              <rect x="6" y="6" width="36" height="36" rx="8" stroke="currentColor" stroke-width="1.5" opacity=".3"/>
              <path d="M14 20h20M14 26h14M14 32h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"/>
              <circle cx="34" cy="34" r="8" stroke="currentColor" stroke-width="1.5"/>
              <path d="M38 38l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>

          <div class="rp-lookup-copy">
            <h2 class="rp-lookup-title">Verify a receipt</h2>
            <p class="rp-lookup-sub">Enter your 12-word verification phrase or paste the verification code to look up your receipt on the chain.</p>
          </div>

          <!-- Phrase / code input -->
          <div class="rp-input-group">
            <label class="rp-label">Verification phrase or code</label>
            <textarea
              v-model="lookupInput"
              class="rp-textarea"
              :placeholder="'verb lake storm amber north cliff solar march plain frost yield river\n\nor: 7f3a9c2d…'"
              rows="3"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              @keydown.ctrl.enter="doLookup"
              @keydown.meta.enter="doLookup"
            ></textarea>
            <p class="rp-input-hint">12 words separated by spaces, or a hex verification code.</p>
          </div>

          <p v-if="lookupError" class="rp-lookup-error">{{ lookupError }}</p>

          <button class="rp-lookup-btn" :disabled="!lookupInput.trim()" @click="doLookup">
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
              <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.8"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Look up receipt
          </button>
        </div>

        <!-- ── Loading ───────────────────────────── -->
        <div v-if="loading" class="rp-loading">
          <div class="rp-loading-dots">
            <span></span><span></span><span></span>
          </div>
          <p>Searching chain blocks…</p>
        </div>

        <!-- ── Receipt ───────────────────────────── -->
        <div v-if="receipt && !loading" class="rp-receipt-wrap">
          <ReceiptViewer :receipt="receipt" />

          <button class="rp-new-lookup" @click="resetLookup">
            <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
              <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Look up another receipt
          </button>
        </div>

        <!-- ── Not found ─────────────────────────── -->
        <div v-if="notFound" class="rp-not-found surface-card">
          <svg viewBox="0 0 24 24" fill="none" width="24" height="24">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.8"/>
            <path d="M21 21l-4.35-4.35M8 11h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <div>
            <strong>Receipt not found</strong>
            <p>No matching block found for this phrase or code. Check the words are correct and in order.</p>
          </div>
          <button class="rp-retry-btn" @click="resetLookup">Try again</button>
        </div>

        <!-- ── Info footer ────────────────────────── -->
        <div class="rp-info-footer">
          <div class="rp-info-row">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0;color:var(--app-text-subtle)">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            Receipts are verified against the local chain — no server request is made.
            Your verification phrase is never transmitted.
          </div>
          <div class="rp-info-row">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0;color:var(--app-text-subtle)">
              <path d="M12 22s8-4.5 8-11V5l-8-3-8 3v6c0 6.5 8 11 8 11z" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            Each receipt contains a Schnorr signature verified against the block's public key.
            Tampering with a block invalidates its signature.
          </div>
        </div>

      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton,
} from '@ionic/vue';
import { useRoute } from 'vue-router';
import ReceiptViewer from '../components/ReceiptViewer.vue';
import { useChainStore } from '../stores/chainStore';
import type { Receipt } from '../types/chain';

const route      = useRoute();
const chainStore = useChainStore();

const lookupInput = ref('');
const loading     = ref(false);
const lookupError = ref('');
const notFound    = ref(false);
const receipt     = ref<Receipt | null>(null);

// Auto-lookup if verification code is in URL: /receipt/:verificationCode
onMounted(async () => {
  const code = route.params.verificationCode as string | undefined;
  if (code) {
    lookupInput.value = decodeURIComponent(code);
    await doLookup();
  }
});

function normaliseInput(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function doLookup() {
  lookupError.value = '';
  notFound.value    = false;
  receipt.value     = null;

  const raw = normaliseInput(lookupInput.value);
  if (!raw) { lookupError.value = 'Please enter a verification phrase or code.'; return; }

  loading.value = true;

  try {
    // Ensure chain is loaded
    if (!chainStore.blocks.length) await chainStore.initialize();

    let found: Receipt | null = null;

    // Search strategy 1: match mnemonic / verificationCode field
    for (const block of chainStore.blocks) {
      const r = block.receipt as Receipt | undefined;
      if (!r) continue;

      const code = normaliseInput(r.verificationCode || r.mnemonic || '');
      if (code && code === raw) { found = r; break; }

      // Also match hex vote hash prefix
      if (r.voteHash && r.voteHash.toLowerCase().startsWith(raw.replace(/\s/g, ''))) {
        found = r; break;
      }
    }

    // Search strategy 2: Gun lookup by verificationCode if not found locally
    if (!found) {
      found = await new Promise<Receipt | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);
        try {
          const GunService = require('../services/gunService').GunService;
          GunService.gun
            ?.get('v3/receipts')
            .get(raw.replace(/\s/g, '-'))
            .once((data: any) => {
              clearTimeout(timeout);
              resolve(data && data.voteHash ? (data as Receipt) : null);
            });
        } catch {
          clearTimeout(timeout);
          resolve(null);
        }
      });
    }

    if (found) {
      receipt.value = found;
    } else {
      notFound.value = true;
    }

  } catch (e) {
    lookupError.value = `Lookup failed: ${(e as Error).message}`;
  } finally {
    loading.value = false;
  }
}

function resetLookup() {
  receipt.value     = null;
  notFound.value    = false;
  lookupError.value = '';
  lookupInput.value = '';
}
</script>

<style scoped>
.receipt-page     { --background: var(--app-bg-base); }
.receipt-page-content { --background: var(--app-bg-base); }

.receipt-page-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 17px; font-weight: 700;
}
.receipt-page-title-icon {
  color: var(--app-accent-bright, #a5b4fc);
}

/* ── Shell ─────────────────────────────────────── */
.rp-shell {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 16px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Lookup card ────────────────────────────────── */
.rp-lookup-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 18px;
  border-radius: 16px;
}

.rp-lookup-icon {
  color: var(--app-text-subtle);
  display: flex;
  justify-content: center;
}

.rp-lookup-copy { text-align: center; }
.rp-lookup-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 800;
  color: var(--app-text);
  letter-spacing: -0.025em;
}
.rp-lookup-sub {
  margin: 0;
  font-size: 13.5px;
  color: var(--app-text-muted);
  line-height: 1.55;
}

/* ── Input ──────────────────────────────────────── */
.rp-input-group  { display: flex; flex-direction: column; gap: 6px; }
.rp-label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-text-subtle);
}
.rp-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: var(--app-text);
  font-size: 13px;
  font-family: var(--font-mono, monospace);
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.15s;
}
.rp-textarea:focus {
  border-color: rgba(var(--app-accent-rgb, 94 106 210), 0.5);
}
.rp-textarea::placeholder { color: var(--app-text-subtle); font-family: var(--font-sans, system-ui); font-size: 12.5px; }
.rp-input-hint { margin: 0; font-size: 11px; color: var(--app-text-subtle); }
.rp-lookup-error { margin: 0; font-size: 12.5px; color: var(--app-danger, #f87171); }

.rp-lookup-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 13px;
  border-radius: 12px;
  border: none;
  background: linear-gradient(180deg, var(--app-accent-bright, #a5b4fc), var(--app-accent, #5e6ad2));
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(var(--app-accent-rgb, 94 106 210), 0.28);
  transition: opacity 0.15s;
}
.rp-lookup-btn:hover:not(:disabled) { opacity: 0.9; }
.rp-lookup-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Loading ─────────────────────────────────────── */
.rp-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 20px;
  color: var(--app-text-muted);
  font-size: 13.5px;
}
.rp-loading p { margin: 0; }

.rp-loading-dots {
  display: flex;
  gap: 6px;
}
.rp-loading-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--app-accent-bright, #a5b4fc);
  animation: rp-dot-bounce 1.2s ease-in-out infinite;
}
.rp-loading-dots span:nth-child(2) { animation-delay: 0.18s; }
.rp-loading-dots span:nth-child(3) { animation-delay: 0.36s; }
@keyframes rp-dot-bounce {
  0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
  40%            { transform: scale(1);   opacity: 1;   }
}

/* ── Receipt wrap ────────────────────────────────── */
.rp-receipt-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rp-new-lookup {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: none;
  border: 1px solid var(--app-border);
  border-radius: 10px;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.rp-new-lookup:hover { color: var(--app-text); border-color: rgba(var(--app-accent-rgb),0.3); }

/* ── Not found ───────────────────────────────────── */
.rp-not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 18px;
  border-radius: 14px;
  text-align: center;
  color: var(--app-danger, #f87171);
}
.rp-not-found strong { font-size: 15px; font-weight: 700; color: var(--app-text); }
.rp-not-found p { margin: 0; font-size: 13px; color: var(--app-text-muted); line-height: 1.5; }

.rp-retry-btn {
  padding: 9px 22px;
  border-radius: 10px;
  border: 1px solid var(--app-border);
  background: none;
  color: var(--app-text);
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.rp-retry-btn:hover { background: rgba(255,255,255,0.05); }

/* ── Info footer ─────────────────────────────────── */
.rp-info-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.rp-info-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--app-text-subtle);
  line-height: 1.5;
}
</style>
