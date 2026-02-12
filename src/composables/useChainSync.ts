import { ref, onMounted } from 'vue';
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

  onMounted(() => {
    startSync();
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
