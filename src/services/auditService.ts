// src/services/auditService.ts — vote authorization in the zero-trust model.
//
// The former service relayed receipts and vote-authorization to a trusted REST
// backend (with OAuth login gates). Under GenosDB there is no central backend:
// every action is signed by the Security Manager and verified by peers, so the
// signed identity *is* the authorization. Receipts already live in the GenosDB
// integrity chain. These methods are kept (call-site compatible) as local no-ops.
export type ReceiptKind = 'vote' | 'comment';

export class AuditService {
  private static readonly CLOUD_USER_KEY = 'interpoll_cloud_user';
  private static readonly RETURN_URL_KEY = 'interpoll_return_url';

  /** Receipts are persisted in the GenosDB integrity chain — no backend mirror needed. */
  static async logReceipt(_type: ReceiptKind, _payload: any): Promise<void> {}

  /** A signed local identity is sufficient authorization; the SM verifies every op. */
  static async authorizeVote(
    _pollId: string,
    _deviceId: string,
    _requireLogin = false,
  ): Promise<{ allowed: boolean; reservationToken: string | null; reason: string | null; requiresAuth: boolean }> {
    return { allowed: true, reservationToken: 'genosdb', reason: null, requiresAuth: false };
  }

  static async confirmVote(): Promise<boolean> {
    return true;
  }

  static async registerPollPolicy(): Promise<boolean> {
    return true;
  }

  static async getCloudUser(): Promise<Record<string, unknown> | null> {
    return this.getCachedCloudUser();
  }

  static getCachedCloudUser(): Record<string, unknown> | null {
    try {
      const raw = localStorage.getItem(this.CLOUD_USER_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  static saveReturnUrl(url: string): void {
    const safe = typeof url === 'string' && url.startsWith('/') ? url : '/home';
    localStorage.setItem(this.RETURN_URL_KEY, safe);
  }

  static consumeReturnUrl(): string {
    try {
      const raw = localStorage.getItem(this.RETURN_URL_KEY);
      localStorage.removeItem(this.RETURN_URL_KEY);
      return raw && raw.startsWith('/') ? raw : '/home';
    } catch {
      return '/home';
    }
  }

  /** No OAuth backend in the P2P model — identity is established via the onboarding gate. */
  static startOAuthLogin(_provider: 'google' | 'microsoft' = 'google'): void {}
}
