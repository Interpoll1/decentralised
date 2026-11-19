/** Legacy public Gun writes only; private messages use their own encrypted outboxes. */
export interface OutboxEntry {
  id: string;
  kind: string;
  soul?: string;
  payload: unknown;
  state: 'pending' | 'attempted';
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
}
