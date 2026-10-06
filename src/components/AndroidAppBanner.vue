<template>
  <section v-if="visible" class="apk-card surface-card" aria-label="Get the Android app">
    <div class="apk-card__copy">
      <p class="apk-card__title">Get InterPoll for Android</p>
      <p class="apk-card__body">Install the app for faster loading and notifications.</p>
    </div>
    <div class="apk-card__actions">
      <a class="apk-card__download" :href="apkUrl" download>Download APK</a>
      <button class="apk-card__dismiss" @click="dismiss">Not now</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Capacitor } from '@capacitor/core';

const DISMISS_KEY = 'interpoll_apk_banner_dismissed';

const apkUrl: string =
  import.meta.env.VITE_ANDROID_APK_URL ||
  'https://github.com/Interpoll1/decentralised/releases/download/android-latest/interpoll.apk';

function shouldShow(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (typeof navigator === 'undefined' || !/Android/i.test(navigator.userAgent)) return false;
  try {
    return localStorage.getItem(DISMISS_KEY) !== '1';
  } catch {
    return true;
  }
}

const visible = ref(shouldShow());

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // banner reappears next visit
  }
  visible.value = false;
}
</script>

<style scoped>
.apk-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.apk-card__title { margin: 0; font-weight: 700; }
.apk-card__body { margin: 2px 0 0; opacity: 0.75; font-size: 0.875rem; }
.apk-card__actions { display: flex; align-items: center; gap: 12px; }
.apk-card__download {
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--ion-color-primary, #6366f1);
  color: #fff;
  font-weight: 600;
  text-decoration: none;
}
.apk-card__dismiss {
  background: none;
  border: 0;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
}
</style>
