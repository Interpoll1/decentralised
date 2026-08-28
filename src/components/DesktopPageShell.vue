<template>
  <div class="dps-root">
    <!-- Left sidebar — desktop only, hidden on mobile -->
    <DesktopSideNav
      class="dps-sidenav"
      :active-tab="activeTab"
      :selected-category="selectedCategory"
    />

    <!-- Page content -->
    <main class="dps-main surface-card">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import DesktopSideNav from './DesktopSideNav.vue';

defineProps<{
  activeTab?: string;
  selectedCategory?: string;
  hideSidebar?: boolean; // kept for API compat, ignored — sidebar always shows on desktop
}>();
</script>

<style scoped>
.dps-root {
  display: block;
  width: 100%;
}

.dps-sidenav {
  display: none; /* hidden on mobile */
}

.dps-main {
  width: 100%;
  min-width: 0;
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

  .dps-sidenav {
    display: flex !important; /* override DesktopSideNav's own display:none-on-mobile */
    flex-direction: column;
    width: 220px;
    flex-shrink: 0;
    position: sticky;
    top: 24px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
  }

  .dps-main {
    flex: 1;
    min-width: 0;
    padding: 24px 28px;
    border-radius: var(--app-radius-lg);
    overflow: hidden;
  }
}

@media (min-width: 1024px) {
  .dps-root { gap: 28px; }
  .dps-sidenav { width: 230px; }
}
</style>
