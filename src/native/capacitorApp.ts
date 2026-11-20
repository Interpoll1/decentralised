import { Capacitor } from '@capacitor/core';
import type { Router } from 'vue-router';
import { InviteLinkService } from '@/services/inviteLinkService';
import config from '@/config';

/**
 * Native-shell integration for the Capacitor @capacitor/app plugin. No-op in
 * the browser build. Handles:
 *  - the Android hardware back button;
 *  - deep links (`appUrlOpen`): both the custom scheme
 *    `com.interpoll.app://…` and https App Links to the public web origin —
 *    used for invite links and the OAuth return.
 */
export async function initCapacitorApp(router: Router): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { App } = await import('@capacitor/app');

  // ── Hardware back button ────────────────────────────────────────────────
  App.addListener('backButton', ({ canGoBack }) => {
    // At a root/home route with nothing to pop, back should background the app
    // (standard Android behaviour) rather than dead-end on a blank history.
    const atRoot = router.currentRoute.value.path === '/home'
      || router.currentRoute.value.path === '/';
    if (!canGoBack || atRoot) {
      App.minimizeApp();
    } else {
      router.back();
    }
  });

  // ── Deep links ──────────────────────────────────────────────────────────
  App.addListener('appUrlOpen', async ({ url }) => {
    try {
      await handleDeepLink(url, router);
    } catch (e) {
      console.warn('[DeepLink] Failed to handle', url, e);
    }
  });
}

/**
 * Convert an opened deep-link URL into in-app navigation.
 * Exported for unit testing.
 */
export async function handleDeepLink(url: string, router: Router): Promise<void> {
  if (!url) return;

  // 1. OAuth return — custom scheme or https path ending in /auth/callback.
  //    (M4) The relay is expected to redirect here with a `token` query param.
  if (url.includes('/auth/callback') || url.startsWith('com.interpoll.app://auth')) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.close();
    } catch { /* browser may already be closed */ }

    const token = extractQueryParam(url, 'token');
    const { AuditService } = await import('@/services/auditService');
    if (token && typeof (AuditService as unknown as { completeNativeOAuth?: (t: string) => Promise<void> }).completeNativeOAuth === 'function') {
      await (AuditService as unknown as { completeNativeOAuth: (t: string) => Promise<void> }).completeNativeOAuth(token);
    }
    router.push('/auth/callback');
    return;
  }

  // 2. Invite link (custom scheme or https App Link). parseInviteLink accepts
  //    full URLs and validates shape.
  const invite = InviteLinkService.parseInviteLink(normalizeToWebUrl(url));
  if (invite) {
    router.push(`/join/${invite.type}/${encodeURIComponent(invite.id)}#${invite.key}`);
    return;
  }

  // 3. Any other App Link on our web origin → navigate to its in-app path.
  try {
    const u = new URL(url);
    const canonical = new URL(config.web.origin);
    if (u.host === canonical.host) {
      router.push(`${u.pathname}${u.search}${u.hash}`);
    }
  } catch { /* not a normal URL (bare custom scheme) — ignore */ }
}

/** Rewrite a custom-scheme invite URL to its web-URL equivalent for parsing. */
function normalizeToWebUrl(url: string): string {
  if (url.startsWith('com.interpoll.app://')) {
    return url.replace(/^com\.interpoll\.app:\/\//, `${config.web.origin}/`);
  }
  return url;
}

function extractQueryParam(url: string, name: string): string | null {
  try {
    // Works for both https and custom-scheme URLs once there is a `?`.
    const qIndex = url.indexOf('?');
    if (qIndex < 0) return null;
    const params = new URLSearchParams(url.substring(qIndex + 1));
    return params.get(name);
  } catch {
    return null;
  }
}
