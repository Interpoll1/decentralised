<template>
  <aside class="rps" aria-label="Relay pulse">
    <section class="rps-card">
      <header class="rps-head">
        <h2>Relay pulse</h2>
        <svg class="rps-beat" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </header>

      <button class="rps-relay" @click="$emit('open-relay')">
        <span class="rps-relay__icon">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.7"/><rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.7"/><circle cx="7" cy="7" r=".9" fill="currentColor"/><circle cx="7" cy="17" r=".9" fill="currentColor"/></svg>
        </span>
        <span class="rps-relay__text">
          <strong>{{ relayName }}</strong>
          <span class="rps-state" :class="`rps-state--${status}`">{{ statusWord }}</span>
        </span>
      </button>

      <dl class="rps-stats">
        <div><dt><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19c.7-3 2.9-4.5 5.5-4.5s4.8 1.5 5.5 4.5M16 6.8a3 3 0 010 5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></dt><dd>{{ peers }}</dd><dd class="rps-stats__k">peers</dd></div>
        <div><dt><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 0113.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 01-13.7 5.6L4 15.5M4 20v-4.5h4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></dt><dd>{{ synced }}</dd><dd class="rps-stats__k">synced</dd></div>
        <div><dt><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></dt><dd>{{ latency == null ? '—' : `${latency} ms` }}</dd><dd class="rps-stats__k">latency</dd></div>
      </dl>
    </section>

    <section class="rps-card">
      <header class="rps-head">
        <h2>Recent activity</h2>
        <button class="rps-link" @click="router.push('/resilience')">See all</button>
      </header>
      <ol v-if="activity.length" class="rps-feed">
        <li v-for="a in activity" :key="a.id">
          <span class="rps-feed__dot"></span>
          <span class="rps-feed__body"><strong>{{ a.label }}</strong><small>{{ a.detail }}</small></span>
          <time class="rps-feed__time">{{ timeAgo(a.at) }}</time>
        </li>
      </ol>
      <p v-else class="rps-empty">Nothing synced yet — content shows up here as peers deliver it.</p>
    </section>

    <section class="rps-card rps-health" :class="`rps-health--${status}`">
      <span class="rps-health__icon">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V5l8-3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path v-if="status === 'healthy'" d="M8.5 12l2.5 2.5L15.5 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path v-else d="M12 8v5M12 16v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </span>
      <div>
        <p class="rps-health__title">Resilience status · <strong>{{ statusTitle }}</strong></p>
        <p class="rps-health__sub">{{ healthCopy }}</p>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useRelayPulse, timeAgo } from '../composables/useRelayPulse';

defineEmits<{ (e: 'open-relay'): void }>();

const router = useRouter();
const { relayName, peers, latency, synced, status, activity } = useRelayPulse();

const statusWord = computed(() => ({ healthy: 'connected', degraded: 'degraded', offline: 'disconnected', checking: 'connecting…' }[status.value]));
const statusTitle = computed(() => ({ healthy: 'Healthy', degraded: 'Degraded', offline: 'Offline', checking: 'Checking' }[status.value]));
const healthCopy = computed(() => ({
  healthy: 'Your relay is connected and syncing with the network. All systems operational.',
  degraded: 'Only part of the network is reachable. Content still syncs, but more slowly.',
  offline: 'No relay or peers reachable. You can keep reading what is already stored on this device.',
  checking: 'Checking the relay and peer connections…',
}[status.value]));
</script>

<style scoped>
.rps { display: none; }

@media (min-width: 768px) {
  .rps {
    display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; width: 232px;
    position: sticky; top: 72px; align-self: flex-start;
    max-height: calc(100vh - 88px); overflow-y: auto; scrollbar-width: none;
  }
  .rps::-webkit-scrollbar { display: none; }
}
@media (min-width: 1280px) { .rps { width: 252px; } }

.rps-card {
  padding: 14px 14px 12px; border-radius: 14px; background: var(--app-bg-elevated); border: 1px solid var(--app-border);
}
.rps-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.rps-head h2 { margin: 0; font-size: 13.5px; font-weight: 700; letter-spacing: -0.005em; color: var(--app-text); }
.rps-beat { width: 18px; height: 18px; color: var(--app-accent); }
.rps-link { background: none; border: none; padding: 0; cursor: pointer; color: var(--app-accent); font: inherit; font-size: 12px; font-weight: 600; }

.rps-relay {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; margin-bottom: 12px; text-align: left; cursor: pointer;
  border-radius: 10px; background: rgba(255, 255, 255, 0.03); border: 1px solid var(--app-border); color: inherit; font: inherit;
  transition: border-color 120ms;
}
.rps-relay:hover { border-color: var(--app-border-strong); }
.rps-relay__icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: rgba(var(--app-accent-rgb), 0.1); color: var(--app-accent); flex-shrink: 0; }
.rps-relay__icon svg { width: 17px; height: 17px; }
.rps-relay__text { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.rps-relay__text strong { font-size: 12.5px; font-weight: 650; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rps-state { font-size: 11.5px; color: var(--app-text-muted); }
.rps-state--healthy { color: var(--app-accent); }
.rps-state--degraded { color: var(--app-warning); }
.rps-state--offline { color: var(--app-danger); }

.rps-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin: 0; }
.rps-stats > div { display: grid; grid-template-columns: auto; justify-items: start; gap: 1px; min-width: 0; }
.rps-stats dt { color: var(--app-text-subtle); }
.rps-stats dt svg { width: 15px; height: 15px; }
.rps-stats dd { margin: 0; font-size: 15px; font-weight: 750; color: var(--app-text); letter-spacing: -0.01em; white-space: nowrap; }
.rps-stats .rps-stats__k { font-size: 11px; font-weight: 500; color: var(--app-text-muted); letter-spacing: 0; }

.rps-feed { list-style: none; margin: 0; padding: 0; position: relative; display: flex; flex-direction: column; gap: 12px; }
.rps-feed::before { content: ''; position: absolute; left: 3.5px; top: 8px; bottom: 8px; width: 1px; background: linear-gradient(var(--app-border-strong), transparent); }
.rps-feed li { position: relative; display: grid; grid-template-columns: 8px 1fr auto; align-items: start; gap: 9px; }
.rps-feed__dot { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: var(--app-accent); box-shadow: 0 0 0 3px #111513, 0 0 8px rgba(var(--app-accent-rgb), 0.5); }
.rps-feed__body { display: flex; flex-direction: column; min-width: 0; }
.rps-feed__body strong { font-size: 12px; font-weight: 650; color: var(--app-text); }
.rps-feed__body small { font-size: 11px; color: var(--app-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rps-feed__time { font-size: 10.5px; color: var(--app-text-subtle); white-space: nowrap; padding-top: 1px; }
.rps-empty { margin: 0; font-size: 12px; line-height: 1.5; color: var(--app-text-muted); }

.rps-health { display: flex; gap: 11px; align-items: flex-start; }
.rps-health__icon { width: 32px; height: 32px; display: grid; place-items: center; flex-shrink: 0; border-radius: 9px; background: rgba(var(--app-accent-rgb), 0.12); color: var(--app-accent); }
.rps-health__icon svg { width: 18px; height: 18px; }
.rps-health--degraded .rps-health__icon { background: rgba(var(--app-warning-rgb), 0.12); color: var(--app-warning); }
.rps-health--offline .rps-health__icon { background: rgba(var(--app-danger-rgb), 0.12); color: var(--app-danger); }
.rps-health__title { margin: 0 0 3px; font-size: 12.5px; color: var(--app-text-muted); }
.rps-health__title strong { color: var(--app-accent); font-weight: 700; }
.rps-health--degraded .rps-health__title strong { color: var(--app-warning); }
.rps-health--offline .rps-health__title strong { color: var(--app-danger); }
.rps-health__sub { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--app-text-muted); }
</style>
