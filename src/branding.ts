/**
 * The one place the product's name lives.
 *
 * A self-hosted build sets `VITE_APP_NAME` and every user-visible string follows
 * — page titles, share text, the consent banner, the relay report. With the env
 * var unset this is the production name, so the default build is unchanged.
 *
 * Deliberately *not* covered: the `interpoll_*` localStorage keys and the
 * `com.interpoll.app://` deep-link scheme. Those are identifiers, not branding;
 * renaming them would orphan the data of every existing install.
 */
export const APP_NAME: string = import.meta.env.VITE_APP_NAME || 'InterPoll';

/** True when this build is a self-hosted instance (see selfhost/README.md). */
export const IS_SELFHOST: boolean = import.meta.env.VITE_SELFHOST === '1';
