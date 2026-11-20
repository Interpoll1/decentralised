import { Capacitor } from '@capacitor/core';
import config from '../config';
import router from '../router';
import { notifyChatMessage } from '../services/notificationService';
import { currentUserId, signForRelay } from './relayIdentity';

/**
 * Native remote push (Capacitor + FCM).
 *
 * This is the "app is closed and you still get pinged" path. It complements
 * `src/services/notificationService.ts`, which covers everything while the app
 * process is alive and needs no backend at all.
 *
 * Enabling it needs three things outside this file:
 *   1. A Firebase project: drop `google-services.json` into `android/app/` and
 *      apply the Google Services Gradle plugin (see docs/push-notifications.md).
 *   2. Relay endpoints `POST /api/push/register` and `POST /api/push/unregister`,
 *      plus an FCM sender that fires when a chat frame is relayed to a user who
 *      has no live socket. A drop-in implementation lives in
 *      `relay-push/push-notifications.js`.
 *   3. The flag: localStorage `interpoll_push_enabled = 'true'`.
 *
 * Until the flag is set, `initPushNotifications` is a no-op, so it stays safe
 * to call unconditionally from app startup on devices with no FCM config.
 */
export function isPushEnabled(): boolean {
  try {
    return localStorage.getItem('interpoll_push_enabled') === 'true';
  } catch {
    return false;
  }
}

export function setPushEnabled(on: boolean): void {
  try {
    localStorage.setItem('interpoll_push_enabled', on ? 'true' : 'false');
  } catch { /* private mode — the flag just won't stick */ }
}

/** Device id the relay keys tokens by, so re-registering replaces rather than duplicates. */
function deviceId(): string {
  const KEY = 'interpoll_push_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral';
  }
}

let registeredToken = '';

export async function initPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !isPushEnabled()) return;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  // Request permission (Android 13+ requires the runtime POST_NOTIFICATIONS grant).
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') {
    console.info('[Push] Notification permission not granted');
    return;
  }

  await PushNotifications.addListener('registration', (token) => {
    registeredToken = token.value;
    void registerTokenWithRelay(token.value);
  });

  await PushNotifications.addListener('registrationError', (err) => {
    console.warn('[Push] Registration error', err);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Foreground receipt. Android does not draw a tray notification for a
    // foreground push, so re-present it through the local path — same look,
    // same tap target, and it collapses with the in-app notifications.
    const data = (notification.data ?? {}) as Record<string, string>;
    const fromUserId = data.fromUserId || '';
    if (!fromUserId) return;
    void notifyChatMessage({
      fromUserId,
      senderName: notification.title || data.senderName || 'New message',
      preview: notification.body || 'You have a new message',
      path: data.path || `/chat/${encodeURIComponent(fromUserId)}`,
    });
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action.notification?.data ?? {}) as Record<string, string>;
    if (typeof data.path === 'string' && data.path.startsWith('/')) {
      void router.push(data.path);
    }
  });

  await PushNotifications.register();
}

/**
 * Canonical strings signed for the relay's push endpoints.
 * Keep in sync with `relay-push/push-notifications.js`.
 */
function registerMessage(userId: string, deviceId: string, token: string, ts: number): string {
  return `interpoll-push-register-1:${userId}:${deviceId}:${token}:${ts}`;
}
function unregisterMessage(userId: string, deviceId: string, ts: number): string {
  return `interpoll-push-unregister-1:${userId}:${deviceId}:${ts}`;
}

/** Send the FCM token to the relay so it can target this device. */
async function registerTokenWithRelay(token: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) {
    // Profile not ready yet — `refreshPushRegistration` picks this up later.
    return;
  }
  try {
    const device = deviceId();
    const ts     = Date.now();
    const sig    = await signForRelay(registerMessage(userId, device, token, ts));

    await fetch(`${config.relay.api}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token, deviceId: device, platform: 'android', ts, sig }),
    });
  } catch (err) {
    console.warn('[Push] Token registration failed', err);
  }
}

/** Re-send the current token, e.g. after sign-in or a relay URL change. */
export async function refreshPushRegistration(): Promise<void> {
  if (!registeredToken) return;
  await registerTokenWithRelay(registeredToken);
}

/** Stop this device receiving pushes — call on sign-out. */
export async function unregisterPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const userId = await currentUserId();
    if (!userId) return;
    const device = deviceId();
    const ts     = Date.now();
    const sig    = await signForRelay(unregisterMessage(userId, device, ts));

    await fetch(`${config.relay.api}/api/push/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, deviceId: device, ts, sig }),
    });
  } catch { /* best effort — the relay prunes dead tokens on send failure too */ }
  registeredToken = '';
}
