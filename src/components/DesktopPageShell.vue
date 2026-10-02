<template>
  <div class="dps-root">
    <AppSideNav @open-relay="relaySheetOpen = true" />

    <main class="dps-main surface-card">
      <slot />
    </main>

    <AppRightSidebar />

    <RelaySheet v-model="relaySheetOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import AppSideNav      from './AppSideNav.vue';
import AppRightSidebar from './AppRightSidebar.vue';
import RelaySheet      from './RelaySheet.vue';

defineProps<{ activeTab?: string; selectedCategory?: string; hideSidebar?: boolean; }>();

const relaySheetOpen = ref(false);
</script>

<style scoped>
.dps-root { display: block; width: 100%; }
.dps-main { width: 100%; min-width: 0; }

/* Phones: no card chrome — the curved, bordered panel wastes width and leaves
   visible edges against the page background. */
@media (max-width: 767px) {
  .dps-main {
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (min-width: 768px) {
  .dps-root {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    width: min(1320px, calc(100% - 32px));
    margin: 0 auto;
    padding: 24px 0 80px;
  }
  .dps-main {
    flex: 1;
    min-width: 0;
    padding: 28px 32px;
    border-radius: var(--app-radius-lg);
    /* No overflow:hidden — it clips Teleported burst overlays */
  }
}
@media (min-width: 1024px) { .dps-root { gap: 28px; } }
</style>
