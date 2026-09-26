import { StorageService } from './storageService';
import { publishReaction, ReactionPublishError } from './publicEngagementService';
import { ACTION_MAX_AGE_MS, verifyAction, type PublicAction } from '../../shared-validation/engagement.js';
import { GUN_NAMESPACE } from '../utils/namespace';

export type ReactionDelivery = 'pending' | 'accepted' | 'rejected' | 'expired';
export interface QueuedReaction { action: PublicAction; status: ReactionDelivery; }
const LIMIT = 128;
const KEY = 'public-reaction-outbox:v1:';
// CAS uses the existing durable metadata transaction; independent tabs cannot
// overwrite each other's enqueue/status changes. Duplicate network sends are
// permitted: the relay must deduplicate the identical signed action ID.
export class ReactionOutbox {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private send: typeof publishReaction;
  private automatic: boolean;
  constructor(send = publishReaction, automatic = true) { this.send = send; this.automatic = automatic; }

  async entries(actor: string): Promise<QueuedReaction[]> {
    return (await StorageService.getMetadata(KEY + actor))?.entries ?? [];
  }
  private async update(actor: string, change: (entries: QueuedReaction[]) => void) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const before = await StorageService.getMetadata(KEY + actor);
      const entries: QueuedReaction[] = structuredClone(before?.entries ?? []);
      for (const e of entries) if (e.status === 'pending' && e.action.createdAt < Date.now() - ACTION_MAX_AGE_MS) e.status = 'expired';
      change(entries);
      if (await StorageService.compareAndSwapMetadata([{ key: KEY + actor, before, after: { version: 1, entries } }])) return;
    }
    throw new Error('REACTION_QUEUE_BUSY');
  }
  async enqueue(action: PublicAction): Promise<{ id: string; status: ReactionDelivery }> {
    if (action.kind !== 'reaction' || !verifyAction(action, { namespace: GUN_NAMESPACE })) throw new Error('INVALID_REACTION');
    const account = await StorageService.getMetadata('nostr-keypair');
    if (account?.publicKey !== action.actor) throw new Error('ACTION_IDENTITY_UNAVAILABLE');
    let status: ReactionDelivery = 'pending';
    await this.update(action.actor, entries => {
      const previous = entries.find(e => e.action.id === action.id);
      status = previous?.status ?? 'pending';
      if (previous) return;
      while (entries.length >= LIMIT) {
        const removable = entries.findIndex(e => e.status !== 'pending');
        if (removable < 0) throw new Error('REACTION_QUEUE_FULL');
        entries.splice(removable, 1);
      }
      entries.push({ action, status: 'pending' });
    });
    this.schedule(0);
    return { id: action.id, status };
  }
  private schedule(delay = 10_000) {
    if (!this.automatic || this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => this.schedule()); }, delay);
  }
  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let actor: string | undefined;
    try {
      actor = (await StorageService.getMetadata('nostr-keypair'))?.publicKey;
      if (!actor) return;
      await this.update(actor, () => {});
      for (const entry of (await this.entries(actor)).filter(e => e.status === 'pending').slice(0, 16)) {
        if ((await StorageService.getMetadata('nostr-keypair'))?.publicKey !== actor) break;
        const a = entry.action;
        let status: ReactionDelivery = 'pending';
        if (a.createdAt < Date.now() - ACTION_MAX_AGE_MS) status = 'expired';
        else if (!verifyAction(a, { namespace: GUN_NAMESPACE, actor }) || a.kind !== 'reaction') status = 'rejected';
        else try { await this.send(a); status = 'accepted'; }
        catch (error) { if (error instanceof ReactionPublishError && error.terminal) status = 'rejected'; }
        await this.update(actor, entries => {
          const e = entries.find(e => e.action.id === a.id);
          // Another tab's exact acceptance cannot be erased by a failed retry.
          if (e && e.status !== 'accepted' && status !== 'pending') e.status = status;
        });
      }
    } finally {
      this.running = false;
      if (actor && (await this.entries(actor)).some(e => e.status === 'pending')) this.schedule();
    }
  }
  stop() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
}
export const reactionOutbox = new ReactionOutbox();
export const enqueueReaction = (action: PublicAction) => reactionOutbox.enqueue(action);
// Call after application startup and on reconnect. Restart resumes identical
// persisted envelopes; expired actions require a new explicit user action.
export function resumeReactions() { void reactionOutbox.flush().catch(() => {}); }
