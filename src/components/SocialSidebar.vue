<template>
  <aside class="social-sidebar" aria-label="Sidebar">
    <nav class="ss-primary" aria-label="Primary navigation">
      <button v-for="item in primary" :key="item.id" :class="{ selected: activeTab === item.id }" :aria-current="activeTab === item.id ? 'page' : undefined" :data-tour="item.id" @click="emit('tab', item.id)">
        <NavIcon :id="item.id" :active="activeTab === item.id" /><span>{{ item.label }}</span>
        <span v-if="item.id === 'chat' && totalUnread" class="ss-unread">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
      </button>
      <button :class="{ selected: activeTab === 'search' }" :aria-current="activeTab === 'search' ? 'page' : undefined" @click="router.push('/search')"><NavIcon id="search" /><span>Search</span></button>
    </nav>
    <section class="ss-spaces">
      <div class="ss-section-head"><h2>Spaces</h2><button aria-label="Browse all spaces" @click="emit('spaces')">+</button></div>
      <button v-for="(space, index) in spaces.slice(0, 6)" :key="space.id" class="ss-space" @click="router.push(`/community/${space.id}`)">
        <span class="ss-space-avatar" :class="`ss-tone-${index % 4}`">{{ (space.displayName || space.name || 'S').charAt(0).toUpperCase() }}</span>
        <span>{{ space.displayName || space.name }}</span>
      </button>
      <p v-if="!spaces.length">Find a community for the things you care about.</p>
      <button class="ss-discover" @click="emit('spaces')"><NavIcon id="communities" /><span>Discover spaces</span></button>
    </section>
    <nav class="ss-tools" aria-label="Account and network">
      <button :class="{ selected: activeTab === 'profile' }" @click="router.push('/profile')"><NavIcon id="profile" /><span>Your profile</span></button>
      <button @click="emit('relay')"><NavIcon id="network" /><span>Network</span></button>
      <button :class="{ selected: activeTab === 'settings' }" @click="router.push('/settings')"><NavIcon id="settings" /><span>Settings</span></button>
    </nav>
    <button class="ss-publish" @click="emit('tab', 'create')"><span>+</span>Create a post</button>
    <p class="ss-footnote">Interpoll · Public posts & polls</p>
  </aside>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import NavIcon from './NavIcon.vue';
defineProps<{ activeTab: string; totalUnread: number; spaces: readonly { id: string; displayName?: string; name?: string }[] }>();
const emit = defineEmits<{ tab: [tab: string]; spaces: []; relay: [] }>();
const router = useRouter();
const primary = [{ id: 'home', label: 'Home' }, { id: 'orbit', label: 'Explore' }, { id: 'chat', label: 'Messages' }];
</script>

<style scoped>
.social-sidebar { display: none; }
@media (min-width: 1024px) {
  .social-sidebar { display: flex; flex-direction: column; width: 210px; flex-shrink: 0; align-self: flex-start; position: sticky; top: 24px; gap: 20px; }
}
.social-sidebar button { display: flex; align-items: center; gap: 13px; width: 100%; min-height: 45px; border: 0; padding: 10px 14px; color: var(--app-text-muted); background: none; border-radius: 10px; text-align: left; cursor: pointer; font: inherit; font-size: 14px; }
.social-sidebar button:hover { background: var(--app-surface-hover); color: var(--app-text); }
.social-sidebar button.selected { background: rgba(var(--app-accent-rgb), .11); color: var(--app-text); font-weight: 650; }
.social-sidebar button.selected svg { color: var(--app-accent); }
.social-sidebar .nav-svg { width: 22px; height: 22px; flex-shrink: 0; }
.ss-primary, .ss-tools { display: flex; flex-direction: column; gap: 4px; }
.ss-spaces { padding-top: 18px; border-top: 1px solid var(--app-border); }
.ss-section-head { display: flex; align-items: center; justify-content: space-between; padding: 0 14px 8px; }
.ss-section-head h2 { color: var(--app-text-subtle); font-size: 12px; margin: 0; font-weight: 600; }
.ss-section-head button { width: 28px; min-height: 28px; padding: 0; justify-content: center; font-size: 22px; }
.social-sidebar .ss-space { min-height: 44px; font-size: 13px; gap: 10px; }
.ss-space > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ss-space-avatar { display: grid; place-items: center; width: 28px; height: 28px; flex-shrink: 0; background: #293b36; color: #99e0bd; border-radius: 9px; font-weight: 700; font-size: 12px; }
.ss-space-avatar.ss-tone-1 { color: #bdb5fa; background: #322e49; }
.ss-space-avatar.ss-tone-2 { color: #f4c58c; background: #49392b; }
.ss-space-avatar.ss-tone-3 { color: #99cff9; background: #263c4e; }
.ss-spaces p { color: var(--app-text-subtle); font-size: 12px; line-height: 1.6; margin: 4px 14px 12px; }
.social-sidebar .ss-discover { color: var(--app-text-muted); font-size: 12px; }
.social-sidebar .ss-discover svg { width: 19px; height: 19px; }
.ss-tools { border-top: 1px solid var(--app-border); padding-top: 16px; }
.social-sidebar .ss-tools button { min-height: 39px; font-size: 13px; }
.social-sidebar .ss-tools svg { width: 20px; height: 20px; }
.social-sidebar .ss-publish { justify-content: center; background: var(--app-accent); color: #052316; border-radius: 30px; font-weight: 700; margin-top: 0; min-height: 46px; }
.ss-publish > span { font-size: 23px; font-weight: 400; }
.ss-footnote { color: var(--app-text-subtle); font-size: 10px; margin: -6px 12px 0; }
.ss-unread { margin-left: auto; background: var(--app-accent); color: #052316; padding: 2px 6px; border-radius: 20px; font-size: 10px; }
button:focus-visible { outline: 2px solid var(--app-accent); outline-offset: 3px; }
</style>
