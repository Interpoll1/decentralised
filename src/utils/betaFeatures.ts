import { ref } from 'vue';

const STORAGE_KEY = 'interpoll_beta_features';

export type BetaFeature = 'resilience';

const defaults: Record<BetaFeature, boolean> = {
  resilience: false,
};

function load(): Record<BetaFeature, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    }
  } catch { /* ignore corrupt data */ }
  return { ...defaults };
}

function save(state: Record<BetaFeature, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const betaFeatures = ref<Record<BetaFeature, boolean>>(load());

export function setBetaFeature(feature: BetaFeature, enabled: boolean) {
  betaFeatures.value = { ...betaFeatures.value, [feature]: enabled };
  save(betaFeatures.value);
}

export function isBetaEnabled(feature: BetaFeature): boolean {
  return betaFeatures.value[feature] ?? false;
}
