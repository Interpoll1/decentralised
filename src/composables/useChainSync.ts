import { ref, onMounted, onUnmounted } from 'vue';
import { useChainStore } from '../stores/chainStore';

export function useChainSync() {
  const chainStore = useChainStore();

  const downgradeDetected = ref(false);
  const peerCount = ref(0);
  const lastSync = ref<Date | null>(null); // ✅ proper typing

  const startSync = () => {
    // Since Supabase was removed,
    // this is now local-only chain monitoring.

    const interval = setInterval(async () => {
      const head = chainStore.chainHead;

      if (!head) return;

      lastSync.value = new Date();

      const isDowngrade = await chainStore.checkForDowngrade(
        head.hash,
        head.index
      );

      if (isDowngrade) {
        downgradeDetected.value = true;
        console.error('CHAIN DOWNGRADE DETECTED!', head);
      }
    }, 10000);

    return interval;
  };

  // The handle was previously discarded, so every mount of a consuming component
  // left a 10 s timer running for the life of the tab, each pinning the chain
  // store closure.
  let syncInterval: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    syncInterval = startSync();
  });

  onUnmounted(() => {
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  });

  const resetDowngradeAlert = () => {
    downgradeDetected.value = false;
  };

  return {
    downgradeDetected,
    peerCount,
    lastSync,
    resetDowngradeAlert
  };
}
