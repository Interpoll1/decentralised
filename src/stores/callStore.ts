import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';
import { CallService, type CallSnapshot, type CallLogEntry } from '@/services/callService';
import { SignalingService } from '@/services/signalingService';
import { StorageService } from '@/services/storageService';

export interface CallHistoryEntry extends CallLogEntry { at: number }

const HISTORY_KEY = 'interpoll_call_log';
const HISTORY_MAX = 200;

function loadHistory(): CallHistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(-HISTORY_MAX) : [];
  } catch { return []; }
}

/**
 * 1:1 call state for the UI. Mirrors CallService snapshots (shallow — MediaStreams
 * must not become deeply reactive), gates incoming rings to known DM contacts,
 * and keeps a LOCAL call log rendered in the DM thread (never sent to the peer).
 */
export const useCallStore = defineStore('call', () => {
  const snapshot = shallowRef<CallSnapshot>(CallService.getSnapshot());
  const history = shallowRef<CallHistoryEntry[]>(loadHistory());
  const known = new Set<string>();

  const isRinging = computed(() => snapshot.value.state === 'incoming-ringing' || snapshot.value.state === 'outgoing-ringing');
  const isActive = computed(() => snapshot.value.state !== 'idle' && snapshot.value.state !== 'ended');
  const supported = computed(() => CallService.isSupported());

  /** Peers with an existing DM thread may ring us; anyone else is dropped silently. */
  function markKnown(peer: string) {
    if (peer) known.add(peer);
  }

  async function loadKnownPeers() {
    try {
      const me = SignalingService.getMyPubkey();
      const snap = me ? await StorageService.getMetadata(`chat-list-cache:${me}`) : null;
      for (const e of (snap?.entries ?? [])) {
        if (e && typeof e.userId === 'string') known.add(e.userId);
        if (e && typeof e.publicKey === 'string') known.add(e.publicKey);
      }
    } catch { /* best-effort; ChatView marks peers as they're opened */ }
  }

  CallService.allowIncoming = (peer) => known.has(peer);
  CallService.onCallLogged = (entry) => {
    const next = [...history.value, { ...entry, at: Date.now() }].slice(-HISTORY_MAX);
    history.value = next;
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  CallService.init();
  CallService.subscribe((s) => { snapshot.value = s; });
  void loadKnownPeers();

  function historyFor(peer: string): CallHistoryEntry[] {
    return history.value.filter(h => h.peer === peer);
  }

  async function start(peer: string, video: boolean) {
    markKnown(peer);
    await CallService.start(peer, { video });
  }
  const accept = () => CallService.accept();
  const decline = () => CallService.decline();
  const end = () => CallService.end();
  const toggleMute = () => CallService.toggleMute();
  const toggleCamera = () => CallService.toggleCamera();

  return {
    snapshot, history, isRinging, isActive, supported,
    markKnown, historyFor, start, accept, decline, end, toggleMute, toggleCamera,
  };
});
