import { toastController } from '@ionic/vue';

/**
 * Shares a URL via the native Web Share API when available, otherwise copies
 * it to the clipboard. Used on poll/post cards so users can invite others —
 * the primary organic growth loop for a peer-replicated app with no ads budget.
 */
export async function shareLink(url: string, title: string, text?: string): Promise<void> {
  const absoluteUrl = url.startsWith('http') ? url : `${window.location.origin}${url}`;

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: absoluteUrl });
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      // fall through to clipboard copy
    }
  }

  try {
    await navigator.clipboard.writeText(absoluteUrl);
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
