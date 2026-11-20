import { Capacitor } from '@capacitor/core';

/**
 * Cross-platform chat notifications.
 *
 * Two delivery paths, deliberately layered:
 *
 *  - **Local** (this file): fires from the running app when ChatService
 *    receives a message. On native it uses Capacitor LocalNotifications so the
 *    alert looks and behaves like any other Android notification (channel,
 *    icon, tap-to-open). On the web it falls back to the Notification API.
 *    Requires the app process to be alive — Android will keep a Capacitor app
 *    alive in the background for a while, but a swiped-away app gets nothing.
 *
 *  - **Remote push** (`src/native/pushNotifications.ts`): FCM, delivered by the
 *    relay even when the app is dead. That is the Discord-grade path; this one
 *    covers everything before the Firebase credentials land, and keeps working
 *    as the foreground presentation afterwards.
 *
 * Both paths deep-link through the same `data.path`.
 */

export interface ChatNotification {
  /** Peer user id — also the notification tag, so repeats replace each other. */
  fromUserId: string;
  senderName: string;
  /** Already-truncated message preview. */
  preview: string;
  /** Route to open when the user taps. */
  path: string;
}

type NavigateFn = (path: string) => void;

const ANDROID_CHANNEL_ID = 'interpoll-chat';

let navigate: NavigateFn | null = null;
let initialized = false;
let nativeReady = false;
/** Stable numeric ids per peer — LocalNotifications keys on int32, not strings. */
const idsByUser = new Map<string, number>();
let nextId = 1;

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function idFor(userId: string): number {
  let id = idsByUser.get(userId);
  if (id === undefined) {
    id = nextId++;
    idsByUser.set(userId, id);
  }
  return id;
}

/**
 * Wire up permissions, the Android channel and the tap handler.
 * Safe to call repeatedly; only the first call does work.
 */
export async function initNotifications(onNavigate: NavigateFn): Promise<void> {
  navigate = onNavigate;
  if (initialized) return;
  initialized = true;

  if (!isNative()) {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch { /* blocked by the browser — notifications stay off */ }
    return;
  }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    let perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale') {
      perm = await LocalNotifications.requestPermissions();
    }
    if (perm.display !== 'granted') {
      console.info('[Notifications] Permission not granted');
      return;
    }

    // Android 8+ requires a channel before anything will make a sound.
    try {
      await LocalNotifications.createChannel({
        id: ANDROID_CHANNEL_ID,
        name: 'Messages',
        description: 'New direct messages',
        importance: 5,
        visibility: 1,
        vibration: true,
      });
    } catch { /* iOS / older Android — no channels */ }

    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const path = action.notification?.extra?.path;
      if (typeof path === 'string' && navigate) navigate(path);
    });

    nativeReady = true;
  } catch (err) {
    console.warn('[Notifications] Native init failed', err);
  }
}

/** Show (or replace) the notification for one peer's latest message. */
export async function notifyChatMessage(n: ChatNotification): Promise<void> {
  if (isNative()) {
    if (!nativeReady) return;
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [{
          id: idFor(n.fromUserId),
          title: n.senderName,
          body: n.preview,
          channelId: ANDROID_CHANNEL_ID,
          group: 'interpoll-chat',
          extra: { path: n.path, fromUserId: n.fromUserId },
        }],
      });
    } catch (err) {
      console.warn('[Notifications] schedule failed', err);
    }
    return;
  }

  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const web = new Notification(`💬 ${n.senderName}`, {
      body: n.preview,
      icon: '/favicon.ico',
      tag: `chat-${n.fromUserId}`,
    });
    web.onclick = () => {
      window.focus();
      navigate?.(n.path);
      web.close();
    };
  } catch { /* some browsers throw when constructing off a service worker */ }
}

/** Clear the notification for a peer — called when their chat is opened. */
export async function clearChatNotification(fromUserId: string): Promise<void> {
  if (!isNative() || !nativeReady) return;
  const id = idsByUser.get(fromUserId);
  if (id === undefined) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch { /* nothing to cancel */ }
}
