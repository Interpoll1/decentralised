import { Capacitor } from '@capacitor/core';

/**
 * Native push notifications (Capacitor + FCM). SCAFFOLD — disabled by default.
 *
 * Enabling push requires backend + Firebase work that is not yet in place:
 *   1. A Firebase project; drop `google-services.json` into
 *      `android/app/` and apply the Google Services Gradle plugin.
 *   2. Relay (relay-server/relay-server-enhanced.js, gitignored) endpoints to
 *      store device tokens (POST /api/push/register) and emit FCM messages on
 *      relevant events (new vote/comment on your polls, replies, invites).
 *   3. Flip the flag: localStorage `interpoll_push_enabled = 'true'`
 *      (or wire a real config value).
 *
 * Until then `initPushNotifications` is a no-op so it can be called
 * unconditionally from app startup without crashing on devices that have no
 * FCM config.
 */
export function isPushEnabled(): boolean {
  try {
    return localStorage.getItem('interpoll_push_enabled') === 'true';
  } catch {
    return false;
  }
}

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

  PushNotifications.addListener('registration', (token) => {
    // TODO (M5): POST token.value to the relay so it can target this device.
    console.info('[Push] Device token acquired');
    void registerTokenWithRelay(token.value);
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.warn('[Push] Registration error', err);
  });

  PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Foreground receipt — surface an in-app toast/badge as desired.
    console.info('[Push] Received', notification.title);
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    // User tapped the notification — deep-link into the relevant screen using
    // action.notification.data (e.g. { path: '/community/.../poll/...' }).
    console.info('[Push] Tapped', action.notification.data);
  });

  await PushNotifications.register();
}

/** TODO (M5 — blocked on relay endpoint): send the FCM token to the relay. */
async function registerTokenWithRelay(_token: string): Promise<void> {
  // const res = await fetch(`${config.relay.api}/api/push/register`, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ token: _token, platform: 'android' }),
  // });
  // Placeholder until the endpoint exists.
}
