<template>
  <aside class="ri" aria-label="Room intelligence">
    <h2 class="ri-title">Room intelligence</h2>

    <section class="ri-card">
      <header class="ri-head">
        <h3>Live peers</h3>
        <span class="ri-count"><i class="ri-pulse"></i>{{ online.length }} online</span>
      </header>
      <ul class="ri-peers">
        <li v-for="p in shownPeers" :key="p.id" :title="p.name">
          <ChatAvatar :name="p.name" :seed="p.id" size="sm" :online="p.online" />
          <span>{{ firstName(p.name) }}</span>
        </li>
        <li v-if="extraPeers > 0" class="ri-more"><span class="ri-more__chip">+{{ extraPeers }}</span></li>
      </ul>
      <p class="ri-health" :class="{ 'ri-health--warn': !linkUp || offline > 0 }">
        <i class="ri-dot"></i>
        <span>{{ healthText }}</span>
        <strong>{{ linkUp ? (offline > 0 ? 'Partial' : 'Healthy') : 'Offline' }}</strong>
      </p>
    </section>

    <section class="ri-card">
      <header class="ri-head">
        <h3>Pinned</h3>
        <span v-if="pinned.length" class="ri-count">{{ pinned.length }}</span>
      </header>
      <ul v-if="pinned.length" class="ri-pins">
        <li v-for="m in pinned.slice(0, 3)" :key="m.id">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>
          <span><strong>{{ m.senderId === store.me.id ? 'You' : m.senderName }}</strong>{{ previewText(m) }}</span>
        </li>
      </ul>
      <p v-else class="ri-empty">Nothing pinned yet. Pin a message from its menu to keep it handy.</p>
    </section>

    <section class="ri-card">
      <header class="ri-head">
        <h3>Shared files</h3>
        <span class="ri-count">{{ files.length }} {{ files.length === 1 ? 'file' : 'files' }}</span>
      </header>
      <ul v-if="files.length" class="ri-files">
        <li v-for="f in files.slice(0, 4)" :key="f.id">
          <span class="ri-file__icon">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          </span>
          <span class="ri-file__text"><strong>{{ f.name }}</strong><small>{{ f.size }}</small></span>
        </li>
      </ul>
      <p v-else class="ri-empty">Photos, documents and voice notes shared here will be listed.</p>
    </section>

    <section class="ri-card">
      <header class="ri-head"><h3>Relay path</h3></header>
      <div class="ri-path" aria-label="You to relay to peers">
        <span class="ri-node"><i><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M11 18h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></i>You</span>
        <span class="ri-link" :class="{ 'ri-link--down': !linkUp }"></span>
        <span class="ri-node"><i><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.7"/><rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.7"/></svg></i>Relay</span>
        <span class="ri-link" :class="{ 'ri-link--down': !linkUp }"></span>
        <span class="ri-node"><i><svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5M16 6.8a3 3 0 010 5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></i>Peers</span>
      </div>
      <p class="ri-e2e"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>End-to-end encrypted · {{ relayName }}</p>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ChatAvatar from './ChatAvatar.vue';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { GunService } from '@/services/gunService';
import { RelayManager } from '@/services/relayManager';
import { previewText } from '@/utils/groupTimeline';

const store = useChatRoomStore();

// ── Peers ────────────────────────────────────────────────────────────────
const accounts = computed(() => [...new Set(store.members.map(m => m.accountId))]);
const peers = computed(() => accounts.value
  .map(id => ({ id, name: store.displayName(id), online: store.onlineAccounts.has(id) }))
  .sort((a, b) => Number(b.online) - Number(a.online)));
const online = computed(() => peers.value.filter(p => p.online));
const MAX_PEERS = 6;
const shownPeers = computed(() => peers.value.slice(0, MAX_PEERS));
const extraPeers = computed(() => Math.max(0, peers.value.length - MAX_PEERS));
const offline = computed(() => peers.value.length - online.value.length);
const firstName = (n: string) => (n || '').split(/\s+/)[0] || n;

// Link health: is this device actually connected to a relay / peer right now?
const linkUp = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;
function readLink() { try { linkUp.value = GunService.getPeerStats().isConnected; } catch { /* keep last */ } }
onMounted(() => { readLink(); timer = setInterval(readLink, 4000); });
onUnmounted(() => { if (timer) clearInterval(timer); });

const healthText = computed(() => {
  if (!linkUp.value) return 'Not connected to a relay';
  if (peers.value.length <= 1) return 'Only you so far';
  return offline.value === 0 ? 'All peers connected' : `${online.value.length} of ${peers.value.length} peers reachable`;
});

// ── Pinned / files ───────────────────────────────────────────────────────
const pinned = computed(() => store.pinnedMessages);
const files = computed(() => store.timeline
  .filter(m => m.media && !m.deleted && !m.media.mediaType.startsWith('audio/'))
  .reverse()
  .map(m => ({ id: m.id, name: m.media!.mediaName || (m.media!.mediaType.startsWith('image/') ? 'Photo' : 'File'), size: formatBytes(m.media!.mediaSize) })));

function formatBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const relayName = computed(() => {
  const r = RelayManager.getActiveRelay();
  if (!r) return 'no relay';
  try { return new URL(r.ws).hostname.replace(/^www\./, ''); } catch { return r.label || 'relay'; }
});
</script>

<style scoped>
.ri { display: flex; flex-direction: column; gap: 10px; padding: 14px; overflow-y: auto; height: 100%; scrollbar-width: thin; }
.ri-title { margin: 2px 2px 2px; font-size: 14px; font-weight: 700; letter-spacing: -0.005em; color: var(--app-text); }
.ri-card { padding: 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.025); border: 1px solid var(--app-border); }
.ri-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ri-head h3 { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--app-text); }
.ri-count { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--app-text-muted); }
.ri-pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--app-accent); box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.18); }

.ri-peers { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-wrap: wrap; gap: 10px 12px; }
.ri-peers li { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 38px; font-size: 10.5px; color: var(--app-text-muted); }
.ri-peers li span { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ri-more__chip { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,0.06); font-size: 11px; font-weight: 700; color: var(--app-text-muted); }
.ri-health { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12px; color: var(--app-text-muted); }
.ri-health strong { margin-left: auto; font-size: 11.5px; font-weight: 700; color: var(--app-accent); }
.ri-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--app-accent); flex-shrink: 0; }
.ri-health--warn .ri-dot { background: var(--app-warning); }
.ri-health--warn strong { color: var(--app-warning); }

.ri-pins { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ri-pins li { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }
.ri-pins svg { width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px; color: var(--app-accent); }
.ri-pins strong { display: block; font-size: 11.5px; color: var(--app-text); }
.ri-pins span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-width: 0; }

.ri-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ri-files li { display: flex; align-items: center; gap: 9px; }
.ri-file__icon { width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0; border-radius: 8px; background: rgba(var(--app-accent-rgb), 0.1); color: var(--app-accent); }
.ri-file__icon svg { width: 16px; height: 16px; }
.ri-file__text { display: flex; flex-direction: column; min-width: 0; }
.ri-file__text strong { font-size: 12px; font-weight: 600; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ri-file__text small { font-size: 11px; color: var(--app-text-muted); }
.ri-empty { margin: 0; font-size: 12px; line-height: 1.5; color: var(--app-text-subtle); }

.ri-path { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 4px 2px 2px; }
.ri-node { display: flex; flex-direction: column; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: var(--app-text-muted); }
.ri-node i { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: rgba(var(--app-accent-rgb), 0.1); border: 1px solid rgba(var(--app-accent-rgb), 0.35); color: var(--app-accent); }
.ri-node svg { width: 17px; height: 17px; }
.ri-link { flex: 1; height: 2px; margin-bottom: 18px; border-radius: 2px; background: repeating-linear-gradient(90deg, var(--app-accent) 0 5px, transparent 5px 9px); opacity: 0.75; }
.ri-link--down { background: repeating-linear-gradient(90deg, var(--app-danger) 0 3px, transparent 3px 9px); opacity: 0.6; }
.ri-e2e { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; font-size: 11px; color: var(--app-text-muted); }
.ri-e2e svg { width: 13px; height: 13px; color: var(--app-accent); flex-shrink: 0; }
</style>
