import { ref } from 'vue';
import { CryptoService } from '../services/cryptoService';

export function useFingerprint() {
  const fingerprint = ref<string>('');
  const isLoading = ref(false);

  const generateFingerprint = async () => {
    isLoading.value = true;
    try {
      fingerprint.value = await CryptoService.generateFingerprint();
    } catch (error) {
      console.error('Error generating fingerprint:', error);
    } finally {
      isLoading.value = false;
    }
  };

  return {
    fingerprint,
    isLoading,
    generateFingerprint
  };
}