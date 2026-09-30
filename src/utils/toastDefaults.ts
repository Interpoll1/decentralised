import { toastController } from '@ionic/vue';
import { checkmarkCircle, alertCircle, closeCircle, informationCircle } from 'ionicons/icons';

type ToastOpts = Parameters<typeof toastController.create>[0];

const ICONS: Record<string, string> = {
  success: checkmarkCircle,
  warning: alertCircle,
  danger: closeCircle,
};

/** Bottom nav element, only if it is actually on screen. */
function visibleBottomNav(): HTMLElement | undefined {
  const el = document.querySelector<HTMLElement>('.bottom-nav-footer:not(.footer-hidden)');
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.top < window.innerHeight ? el : undefined;
}

/**
 * Apply consistent, polished defaults to every toast in the app:
 * compact pill, status icon, swipe-to-dismiss, and never overlapping the bottom nav.
 */
export function installToastDefaults() {
  const original = toastController.create.bind(toastController);
  toastController.create = (opts: ToastOpts = {}) => {
    const kind = typeof opts.color === 'string' ? opts.color : 'default';
    const position = opts.position ?? 'bottom';
    const anchor = position === 'bottom' && !opts.positionAnchor ? visibleBottomNav() : undefined;
    return original({
      duration: 2000,
      swipeGesture: 'vertical',
      icon: opts.icon ?? ICONS[kind] ?? (kind === 'default' ? undefined : informationCircle),
      ...opts,
      color: undefined, // styling handled by app-toast--<kind>
      position,
      positionAnchor: opts.positionAnchor ?? anchor,
      cssClass: ['app-toast', `app-toast--${kind}`, ...([] as string[]).concat(opts.cssClass ?? [])],
    });
  };
}
