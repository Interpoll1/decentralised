import config from '../config';

export type ReceiptKind = 'vote' | 'comment';

interface VoteAuthorizeResponse {
  allowed: boolean;
  reason?: string;
}

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
   * If the backend is unreachable or returns an unexpected response,
   * we default to allowing the vote so offline mode still works.
   */
  static async authorizeVote(pollId: string, deviceId: string): Promise<boolean> {
    try {
      const res = await fetch(`${config.relay.api}/api/vote-authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pollId, deviceId }),
      });

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
}
