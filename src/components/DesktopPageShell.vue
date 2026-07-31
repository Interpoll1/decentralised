<template>
  <div class="desktop-shell ambient-page__content">
    <DesktopSideNav :active-tab="activeTab" :selected-category="selectedCategory" />
    <main class="desktop-shell-main surface-card">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import DesktopSideNav from './DesktopSideNav.vue';

defineProps<{
  /** Which primary side-nav tab to highlight while this page is open, if any. */
  activeTab?: string;
  selectedCategory?: string;
}>();
</script>

<style scoped>
.desktop-shell {
  display: block;
}

.desktop-shell-main {
  min-width: 0;
}

@media (min-width: 768px) {
  .desktop-shell {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    padding-inline: 4px;
    padding-block: 24px 60px;
  }

  .desktop-shell-main {
    flex: 1;
    min-width: 0;
    padding: 24px 28px;
  }
}

@media (min-width: 1024px) {
  .desktop-shell { gap: 32px; }
}
</style>
