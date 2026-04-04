import config from '../config';

export type ReceiptKind = 'vote' | 'comment';

interface VoteAuthorizeResponse {
  allowed: boolean;
  reason?: string;
}

const AUTHORIZE_TIMEOUT_MS = 8_000;

export class AuditService {
  static async logReceipt(type: ReceiptKind, payload: any): Promise<void> {
    try {
      await fetch(`${config.relay.api}/api/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, payload }),
      });
    } catch (_error) {
      // Backend is optional; fail silently
    }
  }

  /**
   * Ask backend if this device is allowed to vote on a poll.
   * CHECK-ONLY: does NOT register the vote. Call confirmVote() after
   * the vote succeeds on-chain.
   * If the backend is unreachable, times out, or returns an unexpected
   * response, we default to allowing the vote so offline mode still works.
   */
  static async authorizeVote(pollId: string, deviceId: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUTHORIZE_TIMEOUT_MS);

      const res = await fetch(`${config.relay.api}/api/vote-authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pollId, deviceId }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return true;
      }

      const data = (await res.json()) as VoteAuthorizeResponse;
      if (typeof data.allowed === 'boolean') {
        return data.allowed;
      }

      return true;
    } catch (_error) {
      return true;
    }
  }

  /**
   * Register a successful vote with the backend so it blocks future
   * duplicate attempts from the same device.
   * Non-blocking — failure here doesn't affect the vote.
   */
  static async confirmVote(pollId: string, deviceId: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), AUTHORIZE_TIMEOUT_MS);

      await fetch(`${config.relay.api}/api/vote-confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pollId, deviceId }),
        signal: controller.signal,
      });

      clearTimeout(timer);
    } catch (_error) {
      // Backend is optional; fail silently
    }
  }
}
