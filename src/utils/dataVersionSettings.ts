import { ref } from 'vue';

export type DataVersion = 'v1' | 'v2';

const STORAGE_KEY = 'interpoll_data_versions';

function load(): DataVersion[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return ['v2'];
}

// Reactive state — views/stores can watch this
export const enabledVersions = ref<DataVersion[]>(load());

export function getEnabledVersions(): DataVersion[] {
  return enabledVersions.value;
}

export function setEnabledVersions(versions: DataVersion[]) {
  if (versions.length === 0) versions = ['v2'];
  enabledVersions.value = [...versions];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
}

export function isVersionEnabled(v: DataVersion): boolean {
  return enabledVersions.value.includes(v);
}
