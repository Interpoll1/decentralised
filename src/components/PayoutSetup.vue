<template>
  <div v-if="enabled && userId" class="payout">
    <h3 class="po-title">Creator payouts</h3>
    <p class="po-muted">
      Get your share of tips on works you're credited on. Payouts run through Stripe — your legal and bank
      details stay with Stripe, never on Interpoll or your public profile.
    </p>
    <p v-if="status?.reservedCents" class="po-reserved">{{ formatCents(status.reservedCents) }} is reserved for you — finish setup to receive it.</p>
    <p v-if="status?.payoutsEnabled" class="po-ok">✓ Payouts active</p>
    <button v-else type="button" class="po-btn" :disabled="busy" @click="start">
      {{ status?.linked ? 'Finish payout setup' : 'Set up payouts' }}
    </button>
    <p v-if="error" class="po-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { PaymentsService, type PayoutStatus } from '../services/paymentsService';
import { formatCents } from '../utils/contributionSplit';

const props = defineProps<{ userId: string }>();
const enabled = PaymentsService.enabled;
const status = ref<PayoutStatus | null>(null);
const busy = ref(false);
const error = ref('');

onMounted(async () => {
  if (!enabled || !props.userId) return;
  try { status.value = await PaymentsService.payoutStatus(props.userId); } catch { /* service down */ }
});

async function start() {
  busy.value = true; error.value = '';
  try { await PaymentsService.startPayoutOnboarding(props.userId); }
  catch (err: any) { error.value = err?.message || 'Could not start setup.'; busy.value = false; }
}
</script>

<style scoped>
.payout { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 12px; border: 1px solid var(--ion-color-step-150, rgba(127,127,127,.2)); margin: 12px 0; }
.po-title { margin: 0; font-size: 16px; }
.po-muted { margin: 0; font-size: 13px; color: var(--ion-color-medium); }
.po-reserved { margin: 0; font-weight: 600; }
.po-ok { margin: 0; color: var(--ion-color-success); }
.po-btn { align-self: flex-start; padding: 8px 16px; border-radius: 8px; border: 0; background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); font-weight: 600; cursor: pointer; }
.po-btn:disabled { opacity: .5; }
.po-error { margin: 0; color: var(--ion-color-danger); font-size: 13px; }
</style>
