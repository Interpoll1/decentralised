<template>
  <div class="gp">
    <section v-if="store.isOwner && store.pendingJoins.length" class="gp-section">
      <h3 class="gp-h">Waiting to join <span class="gp-count">{{ store.pendingJoins.length }}</span></h3>
      <div v-for="req in store.pendingJoins" :key="req.id" class="gp-row">
        <ChatAvatar :name="req.name" :seed="req.binding.accountId" size="lg" />
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
        <ChatAvatar :name="store.displayName(m.accountId)" :seed="m.accountId" size="lg" :online="store.onlineAccounts.has(m.accountId)" />
        <div class="gp-info">
          <span class="gp-name">{{ m.isSelf ? `${store.me.name || 'You'} (you)` : store.displayName(m.accountId) }}</span>
          <span class="gp-sub">
            {{ store.onlineAccounts.has(m.accountId) ? 'online' : 'offline' }}<template v-if="m.devices > 1"> · {{ m.devices }} devices</template>
          </span>
        </div>
        <span v-if="m.isOwner" class="gp-badge">Created the group</span>
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
import ChatAvatar from './ChatAvatar.vue';

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
.gp { padding: 4px 0 0; }
.gp-section { padding-top: 6px; }
.gp-h { display: flex; align-items: center; gap: 8px; margin: 14px 2px 6px; font-size: 13px; font-weight: 650; color: var(--app-text-muted); }
.gp-count { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--app-warning, #f59e0b); color: #111; font-size: 11.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.gp-row { display: flex; align-items: center; gap: 12px; padding: 8px 2px; }
.gp-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.gp-name { font-size: 15px; font-weight: 600; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gp-sub { font-size: 12.5px; color: var(--app-text-subtle); }
.gp-badge { font-size: 12px; color: var(--app-text-muted); }
.gp-btn { flex-shrink: 0; padding: 7px 14px; border-radius: 999px; border: none; background: rgba(var(--app-accent-rgb), 0.1); color: var(--app-text); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
.gp-btn:focus-visible { outline: none; box-shadow: var(--app-focus-ring); }
.gp-btn:disabled { opacity: 0.5; cursor: wait; }
.gp-btn--ok { background: var(--app-accent); color: #fff; }
.gp-btn--danger { background: transparent; color: var(--app-danger); }
.gp-note { margin: 14px 2px 0; font-size: 13px; line-height: 1.5; color: var(--app-text-subtle); }
</style>
