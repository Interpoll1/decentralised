/**
 * useModeration.ts
 *
 * Moderation onboarding modal state and handlers extracted from HomePage.vue.
 * Only loaded after first paint — the modal only shows once per user on first visit.
 */

import { ref } from 'vue';
import { ModerationService, MODERATION_API_DEFAULT_BASE_URL } from '../services/moderationService';

const MODERATION_ONBOARDING_KEY = 'interpoll_moderation_onboarding_complete';

export function useModeration() {
  const moderationOnboardingOpen   = ref(false);
  const moderationChoice           = ref<'default' | 'custom'>('default');
  const moderationCustomApiUrl     = ref('');
  const moderationCustomApiInput   = ref<HTMLInputElement | null>(null);
  const moderationCustomApiError   = ref('');
  const moderationSaving           = ref(false);

  function isValidModerationApiUrl(url: string): boolean {
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function openModerationOnboarding() {
    moderationOnboardingOpen.value = true;
  }

  function closeModerationOnboarding() {
    moderationOnboardingOpen.value = false;
  }

  function saveModerationChoiceEnabled(provider: 'interpoll' | 'custom', baseUrl: string) {
    // Use saveSettings() — the real API. enable() doesn't exist on ModerationService.
    ModerationService.saveSettings({
      moderateHomeFeed: true,
      moderationProvider: provider,
      moderationApiBaseUrl: baseUrl,
    });
    localStorage.setItem(MODERATION_ONBOARDING_KEY, 'true');
    closeModerationOnboarding();
  }

  function skipModerationOnboarding() {
    // disable() doesn't exist — use saveSettings to turn off home-feed moderation.
    ModerationService.saveSettings({ moderateHomeFeed: false });
    localStorage.setItem(MODERATION_ONBOARDING_KEY, 'skipped');
    closeModerationOnboarding();
  }

  function handleModerationModalDismiss() {
    if (localStorage.getItem(MODERATION_ONBOARDING_KEY)) return;
    skipModerationOnboarding();
  }

  async function confirmModerationOnboarding() {
    moderationSaving.value = true;
    try {
      if (moderationChoice.value === 'custom') {
        const url = moderationCustomApiUrl.value.trim();
        if (!isValidModerationApiUrl(url)) {
          moderationCustomApiError.value = 'Please enter a valid URL (http:// or https://)';
          return;
        }
        saveModerationChoiceEnabled('custom', url);
      } else {
        saveModerationChoiceEnabled('interpoll', MODERATION_API_DEFAULT_BASE_URL);
      }
    } finally {
      moderationSaving.value = false;
    }
  }

  function maybeShowOnboarding() {
    const done = localStorage.getItem(MODERATION_ONBOARDING_KEY);
    if (!done) {
      // Defer so it doesn't block first paint
      setTimeout(() => { moderationOnboardingOpen.value = true; }, 2000);
    }
  }

  return {
    moderationOnboardingOpen, moderationChoice,
    moderationCustomApiUrl, moderationCustomApiInput,
    moderationCustomApiError, moderationSaving,
    openModerationOnboarding, closeModerationOnboarding,
    skipModerationOnboarding, handleModerationModalDismiss,
    confirmModerationOnboarding, maybeShowOnboarding,
  };
}