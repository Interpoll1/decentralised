import config from '../config';
import { IntegrityService } from '@/services/integrityService';

export type ReceiptKind = 'vote' | 'comment';

interface VoteAuthorizeResponse {
  allowed: boolean;
  reservationToken?: string;
  reason?: string;
}

interface VoteConfirmResponse {
  ok: boolean;
  alreadyRecorded?: boolean;
}

export class AuditService {
  static async logReceipt(type: ReceiptKind, payload: any): Promise<void> {
    try {
      const body = await IntegrityService.seal(
        { type, payload } as Record<string, unknown>,
        'broadcast',
      );
      await fetch(`${config.relay.api}/api/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (_error) {
      // Backend is optional; fail silently
    }
  }

  /**
   * Ask backend if this device is allowed to vote on a poll.
   * Fail closed for all backend errors or unexpected responses.
   */
  static async authorizeVote(
    pollId: string,
    deviceId: string,
  ): Promise<{ allowed: boolean; reservationToken: string | null }> {
    try {
      const body = await IntegrityService.seal(
        { pollId, deviceId } as Record<string, unknown>,
        'vote-authorize',
      );
      const res = await fetch(`${config.relay.api}/api/vote-authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return { allowed: false, reservationToken: null };
      }

      const data = (await res.json()) as VoteAuthorizeResponse;
      if (data.allowed === true && typeof data.reservationToken === 'string' && data.reservationToken.length > 0) {
        return { allowed: true, reservationToken: data.reservationToken };
      }

      return { allowed: false, reservationToken: null };
    } catch (_error) {
      return { allowed: false, reservationToken: null };
    }
  }

  static async confirmVote(pollId: string, deviceId: string, reservationToken: string): Promise<boolean> {
    try {
      const body = await IntegrityService.seal(
        { pollId, deviceId, reservationToken } as Record<string, unknown>,
        'vote-confirm',
      );
      const res = await fetch(`${config.relay.api}/api/vote-confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return false;
      }

      const data = (await res.json()) as VoteConfirmResponse;
      return data.ok === true;
    } catch (_error) {
      return false;
    }
  }
}
