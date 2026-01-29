// src/services/auditService.ts
// Lightweight backend integration for receipts and vote authorization

export type ReceiptKind = 'vote' | 'comment';

export interface CloudUser {
  provider: string;
  sub: string;
  email?: string;
  name?: string;
}

interface VoteAuthorizeResponse {
  allowed: boolean;
  reason?: string;
}

export class AuditService {
  // Reuse the relay server HTTP port
  private static readonly API_BASE = 'http://localhost:8080';

  static async logReceipt(type: ReceiptKind, payload: any): Promise<void> {
    try {
      await fetch(`${this.API_BASE}/api/receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, payload }),
      });
    } catch (error) {
      // Backend is optional; fail open and stay silent in UI
      console.warn('AuditService.logReceipt failed (non-fatal):', error);
    }
  }

  /**
   * Ask backend if this device is allowed to vote on a poll.
   * If the backend is unreachable or returns an unexpected response,
   * we default to allowing the vote so offline mode still works.
   */
  static async authorizeVote(pollId: string, deviceId: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.API_BASE}/api/vote-authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pollId, deviceId }),
      });

      if (!res.ok) {
        // Fail open: keep app usable even if backend misbehaves
        return true;
      }

      const data = (await res.json()) as VoteAuthorizeResponse;
      if (typeof data.allowed === 'boolean') {
        return data.allowed;
      }

      return true;
    } catch (error) {
      console.warn('AuditService.authorizeVote failed (offline or backend down):', error);
      return true;
    }
  }

  /**
   * Check if the current browser session is authenticated with Google/Microsoft.
   * Uses the HTTP-only session cookie set by the relay server.
   */
  static async getCloudUser(): Promise<CloudUser | null> {
    try {
      const res = await fetch(`${this.API_BASE}/api/me`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { user?: CloudUser | null };
      return data.user ?? null;
    } catch (error) {
      console.warn('AuditService.getCloudUser failed:', error);
      return null;
    }
  }
}
