import { StorageService } from './storageService';
import { GunService } from './gunService';
import { verifySoulOnRelay } from '../utils/gunAsync';
import type { OutboxEntry } from '../types/outbox';

export type OutboxSendResult = 'sent' | 'unreachable' | 'permanent';
type Handler = (entry: OutboxEntry) => Promise<OutboxSendResult>;
const TTL = 7 * 24 * 60 * 60_000;
const MAX_ATTEMPTS = 8;

/** Compatibility queue for explicitly registered public Gun writers.
 * Signed engagement and encrypted DM writers retain their existing dedicated outboxes.
 * Nothing is published until its owner registers a handler and enqueues a write.
 */
export class OutboxService {
  private static handlers = new Map<string, Handler>();
  private static serial: Promise<unknown> = Promise.resolve();
  private static timer: ReturnType<typeof setInterval> | undefined;
  private static unsubscribe: (() => void) | undefined;

  private static exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work);
    this.serial = next.catch(() => {});
    return next;
  }

  static registerHandler(kind: string, handler: Handler): void { this.handlers.set(kind, handler); }

  static async enqueue(input: Pick<OutboxEntry, 'id' | 'kind' | 'payload'> & { soul?: string; sendNow?: boolean }): Promise<void> {
    const snapshot = structuredClone(input);
    return this.exclusive(async () => {
      const previous = await StorageService.getOutboxEntry(snapshot.id);
      await StorageService.saveOutboxEntry({
        ...snapshot, state: 'pending', attempts: previous?.attempts ?? 0,
        createdAt: previous?.createdAt ?? Date.now(), nextAttemptAt: 0,
      });
      if (snapshot.sendNow !== false) await this.attempt((await StorageService.getOutboxEntry(snapshot.id))!);
    });
  }

  private static async attempt(entry: OutboxEntry): Promise<void> {
    if (entry.createdAt < Date.now() - TTL || entry.attempts >= MAX_ATTEMPTS) {
      await StorageService.deleteOutboxEntry(entry.id); return;
    }
    if (entry.nextAttemptAt > Date.now()) return;
    const handler = this.handlers.get(entry.kind);
    if (!handler) return;
    let result: OutboxSendResult = 'unreachable';
    // Confirm an inline write before resending it.
    if (entry.state === 'attempted' && entry.soul) {
      const confirmed = await verifySoulOnRelay(entry.soul).catch(() => null);
      if (confirmed === true) { await StorageService.deleteOutboxEntry(entry.id); return; }
    }
    try { result = await handler(entry); } catch { /* transient transport failure */ }
    if (result === 'permanent') { await StorageService.deleteOutboxEntry(entry.id); return; }
    if (result === 'sent') {
      if (!entry.soul) { await StorageService.deleteOutboxEntry(entry.id); return; }
      const confirmed = await verifySoulOnRelay(entry.soul).catch(() => null);
      if (confirmed === true) { await StorageService.deleteOutboxEntry(entry.id); return; }
      entry.state = 'attempted';
      if (confirmed === false) entry.attempts++;
    }
    entry.nextAttemptAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(entry.attempts, 6));
    await StorageService.saveOutboxEntry(entry);
  }

  static drain(): Promise<void> {
    return this.exclusive(async () => {
      for (const entry of await StorageService.getAllOutboxEntries()) await this.attempt(entry);
    });
  }

  static markSent(id: string): Promise<void> {
    return this.exclusive(async () => {
      const entry = await StorageService.getOutboxEntry(id);
      if (entry) await StorageService.saveOutboxEntry({ ...entry, state: 'attempted', nextAttemptAt: 0 });
    });
  }

  static cancel(id: string): Promise<void> { return this.exclusive(() => StorageService.deleteOutboxEntry(id)); }
  static start(): void {
    if (this.timer) return;
    this.unsubscribe = GunService.onReconnect(() => { void this.drain().catch(() => {}); });
    this.timer = setInterval(() => { void this.drain().catch(() => {}); }, 10_000);
    void this.drain().catch(() => {});
  }
  static stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined; this.unsubscribe?.(); this.unsubscribe = undefined;
  }
  static reset(): void { this.stop(); this.handlers.clear(); }
}
