import { ref } from 'vue';
import { GUN_NAMESPACE } from '../services/gunService';

export type DataVersion = string;

const STORAGE_KEY = 'interpoll_data_versions';

function versionNumber(v: DataVersion): number {
  const parsed = Number.parseInt(String(v).replace(/^v/i, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Drop stored versions that the active namespace has left behind.
 *
 * `v1`/`v2` stay opt-in — they are the legacy roots the Settings toggle is for.
 * Anything from `v3` up is a former *current* namespace, and once we have moved
 * past it the clean-slate rule in dbWarmup means it must never be hydrated
 * again. Without this, an install upgraded from v3 keeps `["v3"]` in
 * localStorage forever and reports v3 as enabled.
 */
export function reconcileVersions(stored: DataVersion[]): DataVersion[] {
  const current = versionNumber(GUN_NAMESPACE);
  const kept = stored.filter((v) => {
    const n = versionNumber(v);
    if (n <= 0) return false;
    if (n >= 3 && v !== GUN_NAMESPACE) return false;
    return n < current || v === GUN_NAMESPACE;
  });
  if (!kept.includes(GUN_NAMESPACE)) kept.push(GUN_NAMESPACE);
  return kept;
}

function load(): DataVersion[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const reconciled = reconcileVersions(parsed as DataVersion[]);
        // Write back so the stale entry does not resurface on the next load.
        if (reconciled.length !== parsed.length) {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
          } catch { /* ignore */ }
        }
        return reconciled;
      }
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
  const reconciled = reconcileVersions(versions);
  enabledVersions.value = [...reconciled];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
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
