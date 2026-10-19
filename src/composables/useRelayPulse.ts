import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RelayManager } from '../services/relayManager';
import { GunService } from '../services/gunService';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';

export interface PulseActivity {
  id: string;
  label: string;
  detail: string;
  at: number;
}

/**
 * Live relay health for the "Relay pulse" panel: connection, Gun peers, round-trip latency and the
 * newest content this client has synced. Polls only while a consumer is mounted.
 */
export function useRelayPulse() {
  const postStore = usePostStore();
  const pollStore = usePollStore();

  const relay = ref(RelayManager.getActiveRelay());
  const peers = ref(0);
  const latency = ref<number | null>(null);
  const connected = ref(false);
  const checked = ref(false);

  let cleanup: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let probeTimer: ReturnType<typeof setInterval> | null = null;

  async function probe() {
    const r = relay.value;
    if (!r) { connected.value = false; checked.value = true; return; }
    const base = r.api || r.ws.replace(/\/gun\/?$/, '');
    const started = performance.now();
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) });
      connected.value = res.ok;
      latency.value = res.ok ? Math.round(performance.now() - started) : null;
    } catch {
      connected.value = false;
      latency.value = null;
    } finally {
      checked.value = true;
    }
  }

  function readPeers() {
    try {
      const stats = GunService.getPeerStats();
      peers.value = stats.connectedCount;
      if (latency.value == null && stats.avgLatencyMs) latency.value = Math.round(stats.avgLatencyMs);
    } catch { /* non-fatal */ }
  }

  function refresh() {
    relay.value = RelayManager.getActiveRelay();
    void probe();
  }

  onMounted(() => {
    cleanup = RelayManager.onChange?.(refresh) ?? null;
    readPeers();
    void probe();
    timer = setInterval(() => { readPeers(); }, 4000);
    probeTimer = setInterval(probe, 20_000);
  });
  onUnmounted(() => {
    cleanup?.();
    if (timer) clearInterval(timer);
    if (probeTimer) clearInterval(probeTimer);
  });

  const relayName = computed(() => {
    const r = relay.value;
    if (!r) return 'No relay';
    try { return new URL(r.ws).hostname.replace(/^www\./, ''); }
    catch { return (r.label || r.ws).slice(0, 24); }
  });

  /** Items this client holds right now (posts + public polls). */
  const synced = computed(() => postStore.sortedPosts.length + pollStore.sortedPolls.filter(p => !p.isPrivate).length);

  const status = computed<'healthy' | 'degraded' | 'offline' | 'checking'>(() => {
    if (!checked.value) return 'checking';
    if (connected.value && peers.value > 0) return 'healthy';
    if (connected.value || peers.value > 0) return 'degraded';
    return 'offline';
  });

  /** Newest synced items, newest first — the timeline in the panel. */
  const activity = computed<PulseActivity[]>(() => {
    const rows: PulseActivity[] = [];
    for (const p of postStore.sortedPosts.slice(0, 6) as any[]) {
      rows.push({ id: `post-${p.id}`, label: 'New post synced', detail: `“${clip(p.title || p.content || 'Untitled')}”`, at: p.createdAt });
    }
    for (const p of pollStore.sortedPolls.filter(x => !x.isPrivate).slice(0, 6) as any[]) {
      rows.push({ id: `poll-${p.id}`, label: 'New poll synced', detail: `“${clip(p.question || 'Untitled')}”`, at: p.createdAt });
    }
    return rows.sort((a, b) => b.at - a.at).slice(0, 6);
  });

  return { relay, relayName, peers, latency, synced, status, activity, connected };
}

function clip(text: string, max = 34): string {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
