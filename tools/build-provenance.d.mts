import type { Plugin } from 'vite';
export function sourceIdentity(): { commit: string | null; dirty: boolean };
export function buildProvenancePlugin(): Plugin;
