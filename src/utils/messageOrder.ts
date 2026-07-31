/**
 * A total order over chat messages that every participant computes identically.
 *
 * Timestamps come from whichever device sent the message, so ordering on wall
 * clock alone rendered a conversation differently on each side whenever two
 * clocks disagreed, and left same-millisecond messages in whatever order the
 * graph happened to yield them. `seq` is a per-device counter — monotonic even
 * when that device's clock is not — and the id is the final, deterministic
 * tiebreak.
 */

export interface OrderableMessage {
  id: string;
  senderId: string;
  timestamp: number;
  seq?: number;
}

export function compareMessages(a: OrderableMessage, b: OrderableMessage): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  // `seq` only means anything within one sender's own stream.
  if (a.senderId === b.senderId
    && a.seq !== undefined && b.seq !== undefined
    && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortMessages<T extends OrderableMessage>(messages: T[]): T[] {
  return [...messages].sort(compareMessages);
}
