import { ref } from 'vue';
import { GUN_NAMESPACE } from '../services/gunService';

export type DataVersion = string;

const STORAGE_KEY = 'interpoll_data_versions';

function load(): DataVersion[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [GUN_NAMESPACE];
}

// Reactive state — views/stores can watch this
export const enabledVersions = ref<DataVersion[]>(load());

// Versions discovered by probing GunDB
export const availableVersions = ref<DataVersion[]>([]);

export function getEnabledVersions(): DataVersion[] {
  return enabledVersions.value;
}

export function setEnabledVersions(versions: DataVersion[]) {
  if (versions.length === 0) versions = [GUN_NAMESPACE];
  enabledVersions.value = [...versions];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
}

export function isVersionEnabled(v: DataVersion): boolean {
  return enabledVersions.value.includes(v);
}

/**
 * Probe GunDB for which data versions actually contain content.
 * v1 data lives at the root level; v2+ are namespaced under their version key.
 */
export async function probeForVersions(rawGun: any, currentNamespace: string): Promise<DataVersion[]> {
  const currentNum = parseInt(currentNamespace.replace('v', ''), 10) || 2;
  const versionsToProbe: DataVersion[] = [];
  for (let i = 1; i <= currentNum; i++) versionsToProbe.push(`v${i}`);

  const probes = versionsToProbe.map(v =>
    new Promise<DataVersion | null>((resolve) => {
      let resolved = false;
      // v1 data is at root level; v2+ are namespaced
      const node = v === 'v1'
        ? rawGun.get('posts')
        : rawGun.get(v).get('posts');
      const timer = setTimeout(() => {
        if (!resolved) { resolved = true; resolve(null); }
      }, 3000);
      node.once((data: any) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        const keys = data ? Object.keys(data).filter((k: string) => k !== '_') : [];
        resolve(keys.length > 0 ? v : null);
      });
    })
  );

  const results = await Promise.all(probes);
  const found = results.filter(Boolean) as DataVersion[];

  // Current namespace is always shown even if empty
  if (!found.includes(currentNamespace)) found.push(currentNamespace);
  found.sort();

  availableVersions.value = found;
  return found;
}
