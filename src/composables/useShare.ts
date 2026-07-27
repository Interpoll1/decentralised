import { toastController } from '@ionic/vue';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import config from '@/config';

/**
 * Shares a URL via the native share sheet (Capacitor Share on device, Web Share
 * API in the browser) and otherwise copies it to the clipboard. Used on
 * poll/post cards so users can invite others — the primary organic growth loop
 * for a peer-replicated app with no ads budget.
 */
export async function shareLink(url: string, title: string, text?: string): Promise<void> {
  const isNative = Capacitor.isNativePlatform();
  // In the native shell window.location.origin is `https://localhost`, which is
  // not an openable link — use the canonical public web origin instead.
  const origin = isNative ? config.web.origin : window.location.origin;
  const absoluteUrl = url.startsWith('http') ? url : `${origin}${url}`;

  // Native share sheet via Capacitor.
  if (isNative) {
    try {
      const canShare = await Share.canShare();
      if (canShare.value) {
        await Share.share({ title, text, url: absoluteUrl, dialogTitle: title });
        return;
      }
    } catch (err) {
      if ((err as Error)?.message?.includes('cancel')) return;
      // fall through to clipboard copy
    }
  } else if (navigator.share) {
    // Browser Web Share API.
    try {
      await navigator.share({ title, text, url: absoluteUrl });
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      // fall through to clipboard copy
    }
  }

  try {
    if (isNative) {
      await Clipboard.write({ string: absoluteUrl });
    } else {
      await navigator.clipboard.writeText(absoluteUrl);
    }
    const toast = await toastController.create({
      message: 'Link copied to clipboard',
      duration: 1800,
      position: 'bottom',
      color: 'success',
    });
    await toast.present();
  } catch {
    const toast = await toastController.create({
      message: 'Could not copy link',
      duration: 1800,
      position: 'bottom',
      color: 'danger',
    });
    await toast.present();
  }
}
