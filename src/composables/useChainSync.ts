import { ref, onMounted, onUnmounted } from 'vue';
import { useChainStore } from '../stores/chainStore';
import { SupabaseService } from '../services/supabaseService';

export function useChainSync() {
  const chainStore = useChainStore();
  const downgradeDetected = ref(false);
  const peerCount = ref(0);
  const lastSync = ref(null);

  const startSync = () => {
    // Subscribe to remote chain heads
    SupabaseService.subscribeToChainHeads(async (payload) => {
      peerCount.value++;
      lastSync.value = new Date();

      // Check for downgrade
      const isDowngrade = await chainStore.checkForDowngrade(
        payload.hash,
        payload.index
      );

      if (isDowngrade) {
        downgradeDetected.value = true;
        console.error('CHAIN DOWNGRADE DETECTED!', payload);
      }
    });

    // Broadcast our chain head every 10 seconds
    const broadcastInterval = setInterval(async () => {
      const head = chainStore.chainHead;
      if (head) {
        await SupabaseService.broadcastChainHead(head.hash, head.index);
      }
    }, 10000);

    // Cleanup
    onUnmounted(() => {
      clearInterval(broadcastInterval);
      SupabaseService.unsubscribe();
    });
  };

  const resetDowngradeAlert = () => {
    downgradeDetected.value = false;
  };

  onMounted(() => {
    startSync();
  });

  return {
    downgradeDetected,
    peerCount,
    lastSync,
    resetDowngradeAlert
  };
}