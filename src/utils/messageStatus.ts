// src/utils/messageStatus.ts
//
// Delivery events for one message (send routine, relay ack, peer receipt,
// retries) arrive in no guaranteed order. Merging must only move a tick
// forward: confirmed is terminal, published never falls back to pending,
// and a failure can be superseded by a retry or a later success.

import type { SyncStatus } from '../types/social';

const RANK: Record<Exclude<SyncStatus, 'failed'>, number> = { pending: 0, published: 1, confirmed: 2 };

export function mergeStatus(current?: SyncStatus, next?: SyncStatus): SyncStatus | undefined {
  if (!next) return current;
  if (!current) return next;
  if (current === 'confirmed') return 'confirmed';
  if (next === 'failed' || current === 'failed') return next;
  return RANK[next] >= RANK[current] ? next : current;
}
