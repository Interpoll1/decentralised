/**
 * Gun graph namespace constant, isolated in its own module so lightweight,
 * entry-path code (e.g. dbWarmup) can read it WITHOUT statically importing the
 * full gunService module — which would otherwise pull the gun vendor chunk into
 * the critical first-paint bundle.
 */
export const GUN_NAMESPACE = 'v3';
