import { ref } from 'vue';
import { PowService } from '@/services/powService';
import type { PowProof } from '@/services/powService';

/**
 * Vue composable wrapping PowService for reactive PoW state in views.
 * Use this when a component needs to show PoW-solving progress or errors to the user.
 * For transparent PoW (no UI), WebSocketService.broadcast handles it automatically.
 */
export function useProofOfWork() {
  const solving = ref(false);
  const error = ref<string | null>(null);

  async function getProof(action: string): Promise<PowProof | null> {
    if (solving.value) {
      error.value = 'Already solving a PoW challenge';
      return null;
    }
    solving.value = true;
    error.value = null;
    try {
      const proof = await PowService.getProof(action);
      return proof;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'PoW failed';
      return null;
    } finally {
      solving.value = false;
    }
  }

  return { solving, error, getProof };
}
