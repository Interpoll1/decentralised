<template>
  <ion-app>
    <AppErrorBoundary>
      <AppLoader v-if="!appReady" />
      <ion-router-outlet v-else :animated="true" :animation="pageTransition" />
    </AppErrorBoundary>
    <GlobalCommandPalette :is-open="globalPaletteOpen" @close="closeGlobalPalette" />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from '@ionic/vue';
import { createAnimation } from '@ionic/vue';
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useChainStore } from './stores/chainStore';
import { WebSocketService } from './services/websocketService';
import { GunService } from './services/gunService';
import { PollService } from './services/pollService';
import { PostService } from './services/postService';
import { CommentService } from './services/commentService';
import { warmupFromDB } from './services/dbWarmup';
import AppLoader from './components/AppLoader.vue';
import AppErrorBoundary from './components/AppErrorBoundary.vue';
import GlobalCommandPalette from './components/GlobalCommandPalette.vue';

const chainStore = useChainStore();
const router = useRouter();
const appReady = ref(false);
const globalPaletteOpen = ref(false);

let visibilityHandler: (() => void) | null = null;
let wireWatchdogTimer: ReturnType<typeof setInterval> | null = null;
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

function pageTransition(baseEl: HTMLElement, opts: { direction?: string }) {
  const enteringEl = baseEl.querySelector<HTMLElement>(':scope > .ion-page.ion-page-invisible, :scope > .ion-page:not(.ion-page-hidden)');
  const leavingEl = baseEl.querySelector<HTMLElement>(':scope > .ion-page.ion-page-hidden, :scope > .ion-page:not(.ion-page-invisible):not(.ion-page-hidden)');

  const enteringAnimation = createAnimation()
    .addElement(enteringEl ?? baseEl)
    .duration(220)
    .easing('cubic-bezier(0.2, 0, 0, 1)')
    .fromTo('opacity', '0.01', '1');

  const leavingAnimation = createAnimation()
    .addElement(leavingEl ?? baseEl)
    .duration(180)
    .easing('cubic-bezier(0.4, 0, 1, 1)')
    .fromTo('opacity', '1', '0');

  if (opts.direction === 'back') {
    enteringAnimation.fromTo('transform', 'translateX(-8px)', 'translateX(0)');
    leavingAnimation.fromTo('transform', 'translateX(0)', 'translateX(8px)');
  } else {
    enteringAnimation.fromTo('transform', 'translateX(8px)', 'translateX(0)');
    leavingAnimation.fromTo('transform', 'translateX(0)', 'translateX(-8px)');
  }

  return createAnimation()
    .addAnimation([leavingAnimation, enteringAnimation])
    .duration(opts.direction === 'back' ? 220 : 220);
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

  // Show loader until warmup is done — then reveal the app
  try {
    await warmupFromDB();
  } catch (_error) {
    // warmup failed, continue anyway
  } finally {
    appReady.value = true;
  }

  // Non-blocking after app is visible
  try {
    await chainStore.initialize();
  } catch (_error) {}

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      setTimeout(() => {
        if (!WebSocketService.getConnectionStatus()) WebSocketService.reconnect();
        const gunStats = GunService.getPeerStats();
        if (!gunStats.isConnected) GunService.reconnect();
      }, 500);
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  // Visibility events alone never fire while the tab stays in the foreground,
  // so also self-heal dead Gun wires on a timer.
  wireWatchdogTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (!GunService.getPeerStats().isConnected) GunService.reconnect();
  }, 60_000);

  // Re-push recent polls/posts the relay never confirmed receiving (dead wire or
  // server-side rate limiting can silently swallow writes on an open socket).
  PollService.startRepublishLoop();
  PostService.startRepublishLoop();
  CommentService.startCommentRepublishLoop();
});

onUnmounted(() => {
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  if (wireWatchdogTimer) {
    clearInterval(wireWatchdogTimer);
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
