<template>
  <Teleport to="body">
    <transition name="dap-slide">
      <aside v-if="visible && offer" class="dap" role="dialog" aria-label="Download InterPoll app">
        <button class="dap__close" type="button" aria-label="Dismiss download prompt" @click="dismiss">&times;</button>
        <div class="dap__mark" aria-hidden="true">
          <span class="dap__dot" />
          <i /><i /><i />
        </div>
        <div class="dap__copy">
          <strong>{{ offer.title }}</strong>
          <span>{{ offer.body }}</span>
        </div>
        <button v-if="offer.install" class="dap__cta" type="button" @click="installPwa">Install app</button>
        <a
          v-else-if="offer.url"
          class="dap__cta"
          :href="offer.url"
          :download="offer.downloadName"
          @click="accept"
        >{{ offer.cta }}</a>
        <button v-else class="dap__cta" type="button" @click="accept">{{ offer.cta }}</button>
      </aside>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRoute } from 'vue-router';
import { useBitStore } from '../stores/bitStore';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface DownloadOffer {
  title: string;
  body: string;
  cta: string;
  url?: string;
  downloadName?: string;
  install?: boolean;
}

const INSTALLED_KEY = 'interpoll_app_installed';
const REMIND_AFTER_MS = 10 * 1000;
const QUIET_PATHS = ['/onboarding', '/claim-username', '/auth/callback'];

const route = useRoute();
const bit = useBitStore();
const visible = ref(false);
const dismissedThisPage = ref(false);
const installEvent = ref<InstallPromptEvent | null>(null);
let timer: number | undefined;

const androidUrl = import.meta.env.VITE_ANDROID_APK_URL
  || '/downloads/InterPoll-Android.apk';
const iosUrl = import.meta.env.VITE_IOS_DOWNLOAD_URL || '';
const desktopUrl = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL || '';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function platformOffer(): DownloadOffer | null {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) {
    return {
      title: 'Get InterPoll for Android',
      body: 'Use the mobile app for a focused, full-screen experience and notifications.',
      cta: 'Download APK',
      url: androidUrl,
      downloadName: 'InterPoll-Android.apk',
    };
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    if (iosUrl) {
      return {
        title: 'Download InterPoll for iPhone',
        body: 'Get the InterPoll mobile app for a focused, full-screen experience.',
        cta: 'Download for iPhone',
        url: iosUrl,
      };
    }
    return {
      title: 'Download InterPoll for iPhone',
      body: 'The native iPhone app is not published to TestFlight or the App Store yet.',
      cta: 'iPhone app unavailable',
    };
  }
  if (installEvent.value) {
    return {
      title: 'Install InterPoll on this device',
      body: 'Launch faster, keep it in your app list, and use it without browser chrome.',
      cta: 'Install app',
      install: true,
    };
  }
  if (/Windows/i.test(ua)) {
    return {
      title: 'Download InterPoll for Windows',
      body: 'Install the focused desktop app and use InterPoll without browser tabs.',
      cta: 'Download for Windows',
      url: desktopUrl || '/downloads/InterPoll-Setup.exe',
      downloadName: 'InterPoll-Setup.exe',
    };
  }
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return desktopUrl
      ? { title: 'Download InterPoll for macOS', body: 'Install the focused desktop app and use InterPoll without browser tabs.', cta: 'Download for macOS', url: desktopUrl }
      : { title: 'Download InterPoll for macOS', body: 'The macOS installer has not been published yet.', cta: 'Installer unavailable' };
  }
  if (/Linux/i.test(ua)) {
    return desktopUrl
      ? { title: 'Download InterPoll for Linux', body: 'Install the focused desktop app and use InterPoll without browser tabs.', cta: 'Download for Linux', url: desktopUrl }
      : { title: 'Download InterPoll for Linux', body: 'The Linux installer has not been published yet.', cta: 'Installer unavailable' };
  }
  return null;
}

const offer = computed(platformOffer);

function isKnownInstalled() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function canShow() {
  return !Capacitor.isNativePlatform()
    && !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    && !isStandalone()
    && document.visibilityState === 'visible'
    && !QUIET_PATHS.some(path => route.path.startsWith(path))
    && !bit.tourActive
    && !bit.reminderOpen
    && !!offer.value
    && !dismissedThisPage.value
    && !isKnownInstalled();
}

function scheduleCheck(delay = REMIND_AFTER_MS) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (dismissedThisPage.value || isKnownInstalled()) return;
    if (canShow()) {
      visible.value = true;
      return;
    }
    scheduleCheck(20_000);
  }, delay);
}

function dismiss() {
  visible.value = false;
  dismissedThisPage.value = true;
}

function accept() {
  visible.value = false;
  dismissedThisPage.value = true;
}

async function installPwa() {
  const prompt = installEvent.value;
  if (!prompt) return;
  await prompt.prompt();
  await prompt.userChoice;
  installEvent.value = null;
  visible.value = false;
  dismissedThisPage.value = true;
}

function captureInstallPrompt(event: Event) {
  event.preventDefault();
  installEvent.value = event as InstallPromptEvent;
}

function markInstalled() {
  installEvent.value = null;
  visible.value = false;
  dismissedThisPage.value = true;
  try {
    localStorage.setItem(INSTALLED_KEY, 'true');
  } catch {
    // Standalone/native detection still prevents the prompt in the installed app.
  }
}

function handleLogin() {
  visible.value = false;
  dismissedThisPage.value = false;
  scheduleCheck(REMIND_AFTER_MS);
}

function showPreview() {
  if (offer.value && !Capacitor.isNativePlatform() && !isStandalone()) {
    visible.value = true;
  }
}

onMounted(() => {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
  window.addEventListener('appinstalled', markInstalled);
  window.addEventListener('interpoll:user-logged-in', handleLogin);
  window.addEventListener('interpoll:show-download-prompt', showPreview);
  scheduleCheck();
});

onUnmounted(() => {
  window.clearTimeout(timer);
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt);
  window.removeEventListener('appinstalled', markInstalled);
  window.removeEventListener('interpoll:user-logged-in', handleLogin);
  window.removeEventListener('interpoll:show-download-prompt', showPreview);
});
</script>

<style scoped>
.dap {
  position: fixed;
  z-index: 2147483400;
  top: max(14px, env(safe-area-inset-top));
  left: 50%;
  width: min(680px, calc(100vw - 28px));
  min-height: 72px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 13px 48px 13px 14px;
  border: 1px solid rgba(61, 255, 122, 0.42);
  border-radius: 14px;
  background: rgba(5, 8, 6, 0.97);
  color: #f5fff8;
  box-shadow: 0 18px 54px rgba(0, 0, 0, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  font-family: 'Inter', system-ui, sans-serif;
}
.dap__mark { position: relative; width: 42px; height: 42px; flex: 0 0 42px; display: flex; align-items: flex-end; justify-content: center; gap: 4px; border-radius: 11px; background: #101712; border: 1px solid #223329; padding: 9px; }
.dap__mark i { display: block; width: 5px; border-radius: 3px; background: #3dff7a; }
.dap__mark i:nth-of-type(1) { height: 9px; }
.dap__mark i:nth-of-type(2) { height: 15px; }
.dap__mark i:nth-of-type(3) { height: 22px; }
.dap__dot { position: absolute; width: 5px; height: 5px; top: 5px; left: 18px; border-radius: 50%; background: #3dff7a; }
.dap__copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.dap__copy strong { color: #fff; font-size: 14px; font-weight: 650; line-height: 1.3; }
.dap__copy span { color: #aebcaf; font-size: 12.5px; line-height: 1.4; }
.dap__cta { flex: 0 0 auto; border: 1px solid #3dff7a; border-radius: 8px; background: #3dff7a; color: #020503; padding: 9px 14px; font: inherit; font-size: 12.5px; font-weight: 700; text-decoration: none; cursor: pointer; }
.dap__cta:hover { background: #67ff99; }
.dap__close { position: absolute; top: 7px; right: 9px; width: 28px; height: 28px; border: 0; background: transparent; color: #718074; font: 22px/1 system-ui; cursor: pointer; }
.dap__close:hover { color: #fff; }
.dap-slide-enter-active, .dap-slide-leave-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.16, 1, .3, 1); }
.dap-slide-enter-from, .dap-slide-leave-to { opacity: 0; transform: translate(-50%, -18px); }
@media (max-width: 560px) {
  .dap { align-items: flex-start; gap: 11px; padding: 12px 40px 12px 12px; }
  .dap__mark { width: 38px; height: 38px; flex-basis: 38px; }
  .dap__cta { align-self: center; padding: 8px 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .dap-slide-enter-active, .dap-slide-leave-active { transition: none; }
}
</style>
