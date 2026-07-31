/**
 * Build hash injected at compile time
 * Shows which build is deployed — useful for debugging and knowing if you're on the latest version
 */

export const BUILD_HASH = import.meta.env.VITE_BUILD_HASH || 'development';
export const BUILD_TIME = import.meta.env.VITE_BUILD_TIME || 'unknown';
