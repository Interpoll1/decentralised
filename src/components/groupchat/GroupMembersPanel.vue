<template>
  <div class="gp">
    <section v-if="store.isOwner && store.pendingJoins.length" class="gp-section">
      <h3 class="gp-h">Join requests <span class="gp-count">{{ store.pendingJoins.length }}</span></h3>
      <div v-for="req in store.pendingJoins" :key="req.id" class="gp-row">
        <div class="gp-avatar" :style="{ background: senderColor(req.binding.accountId) }">{{ initial(req.name) }}</div>
        <div class="gp-info">
          <span class="gp-name">{{ req.name || 'Unnamed' }}</span>
          <span class="gp-sub">{{ req.binding.accountId.slice(0, 12) }}… · {{ ago(req.ts) }}</span>
        </div>
        <button class="gp-btn gp-btn--ok" :disabled="busy === req.id" @click="act(req.id, () => store.approveJoin(req))">Approve</button>
        <button class="gp-btn" :disabled="busy === req.id" @click="act(req.id, () => store.declineJoin(req))">Decline</button>
      </div>
    </section>

    <section class="gp-section">
      <h3 class="gp-h">{{ accounts.length }} {{ accounts.length === 1 ? 'member' : 'members' }}</h3>
      <div v-for="m in accounts" :key="m.accountId" class="gp-row">
        <div class="gp-avatar" :style="{ background: senderColor(m.accountId) }">
          {{ initial(store.displayName(m.accountId)) }}
          <span v-if="store.onlineAccounts.has(m.accountId)" class="gp-online"></span>
        </div>
        <div class="gp-info">
          <span class="gp-name">{{ m.isSelf ? `${store.me.name || 'You'} (you)` : store.displayName(m.accountId) }}</span>
          <span class="gp-sub">
            {{ store.onlineAccounts.has(m.accountId) ? 'online' : 'offline' }}<template v-if="m.devices > 1"> · {{ m.devices }} devices</template>
          </span>
        </div>
        <span v-if="m.isOwner" class="gp-badge">Creator</span>
        <button v-else-if="store.isOwner && !m.isSelf" class="gp-btn gp-btn--danger" :disabled="busy === m.accountId" @click="remove(m.accountId)">Remove</button>
      </div>
    </section>

    <p v-if="store.isOwner" class="gp-note">Members chat directly, even while you are offline. Your device is needed only to admit or remove members.</p>
    <p v-else class="gp-note">Members chat directly with each other. New members are admitted by the creator's device when it is online.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { toastController } from '@ionic/vue';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { senderColor } from '@/utils/chatFormat';

const store = useChatRoomStore();
const busy = ref('');

/** One row per account; devices of the same account collapse together. */
const accounts = computed(() => {
  const map = new Map<string, { accountId: string; isOwner: boolean; isSelf: boolean; devices: number }>();
  for (const m of store.members) {
    const row = map.get(m.accountId) ?? { accountId: m.accountId, isOwner: false, isSelf: false, devices: 0 };
    row.isOwner ||= m.isOwner; row.isSelf ||= m.isSelf; row.devices++;
    map.set(m.accountId, row);
  }
  return [...map.values()].sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || store.displayName(a.accountId).localeCompare(store.displayName(b.accountId)));
});

const initial = (name: string) => (name || '?').trim().charAt(0).toUpperCase() || '?';
function ago(ts: number) {
  const m = Math.floor((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
}

async function act(key: string, fn: () => Promise<unknown>) {
  busy.value = key;
  try { await fn(); }
  catch (err: any) {
    const t = await toastController.create({ message: err?.message || 'Action failed', duration: 2500, color: 'danger', position: 'top' });
    await t.present();
  } finally { busy.value = ''; }
}
function remove(accountId: string) {
  // Removing an account removes each of its devices (one epoch change each).
  return act(accountId, async () => {
    for (const m of store.members.filter(x => x.accountId === accountId)) await store.removeMember(m);
  });
}
</script>

<style scoped>
.gp { padding: 8px 16px 24px; }
.gp-section { margin-bottom: 18px; }
.gp-h { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--app-text-muted); margin: 10px 0 8px; display: flex; align-items: center; gap: 6px; }
.gp-count { background: #f59e0b; color: #111; border-radius: 999px; padding: 0 7px; font-size: 11px; }
.gp-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
.gp-avatar { position: relative; width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #111; }
.gp-online { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #22c55e; border: 2px solid var(--app-bg-base, #0b0b12); }
.gp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.gp-name { font-size: 14.5px; font-weight: 600; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-sub { font-size: 12px; color: var(--app-text-subtle); }
.gp-badge { font-size: 11px; font-weight: 700; color: #a5b4fc; border: 1px solid rgba(165,180,252,.4); border-radius: 999px; padding: 2px 8px; }
.gp-btn { border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.05); color: var(--app-text); border-radius: 999px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.gp-btn:disabled { opacity: .5; cursor: wait; }
.gp-btn--ok { background: #6366f1; border-color: #6366f1; color: #fff; }
.gp-btn--danger { color: #f87171; border-color: rgba(248,113,113,.4); }
.gp-note { font-size: 12.5px; color: var(--app-text-subtle); line-height: 1.5; }
</style>
