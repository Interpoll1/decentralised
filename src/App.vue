<template>
  <ion-app>
    <AppLoader v-if="!appReady" />
    <ion-router-outlet v-else :animated="false" />
    <GlobalCommandPalette :is-open="globalPaletteOpen" @close="closeGlobalPalette" />
    <OnboardingModal />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import AppLoader from './components/AppLoader.vue';
import GlobalCommandPalette from './components/GlobalCommandPalette.vue';
import OnboardingModal from './components/OnboardingModal.vue';

const router = useRouter();
const appReady = ref(false);
const globalPaletteOpen = ref(false);

let visibilityHandler: (() => void) | null = null;
let internalLinkHandler: ((event: MouseEvent) => void) | null = null;
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

function isTypingTarget(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    const tag = node.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (tag === 'ion-input' || tag === 'ion-textarea' || tag === 'ion-searchbar') return true;
    if (node.isContentEditable) return true;
    const contentEditable = node.getAttribute('contenteditable');
    if (contentEditable !== null && contentEditable !== 'false') return true;
  }
  return false;
}

function closeGlobalPalette() {
  globalPaletteOpen.value = false;
}

onMounted(async () => {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme === 'dark') {
    document.documentElement?.classList.add('dark');
    document.body?.classList.add('dark');
  }

  internalLinkHandler = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target && anchor.target !== '_self') return;
    if (anchor.hasAttribute('download')) return;

    const rawHref = anchor.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(rawHref)) return;

    const url = new URL(anchor.href, window.location.origin);
    if (url.origin !== window.location.origin) return;

    const destination = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (destination === current) return;

    event.preventDefault();
    void router.push(destination);
  };
  document.addEventListener('click', internalLinkHandler);

  keydownHandler = (event: KeyboardEvent) => {
    const isPaletteShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p';
    if (isPaletteShortcut && !isTypingTarget(event)) {
      event.preventDefault();
      globalPaletteOpen.value = true;
      return;
    }

    if (event.key === 'Escape' && globalPaletteOpen.value) {
      closeGlobalPalette();
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // GenosDB is ready as soon as its module loads (top-level await); reveal the app.
  appReady.value = true;
});

onUnmounted(() => {
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  if (internalLinkHandler) {
    document.removeEventListener('click', internalLinkHandler);
  }
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
  }
});
</script>

<style>
ion-header ion-toolbar:first-of-type {
  padding-top: env(safe-area-inset-top, 0px);
}

ion-app {
  background: transparent;
}
</style>
