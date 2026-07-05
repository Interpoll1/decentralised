import config from '../config';
import { IntegrityService } from '@/services/integrityService';

export type ReceiptKind = 'vote' | 'comment';

interface VoteAuthorizeResponse {
  allowed: boolean;
  reservationToken?: string;
  reason?: string;
  requireLogin?: boolean;
}

interface VoteConfirmResponse {
  ok: boolean;
  alreadyRecorded?: boolean;
  reason?: string;
}

export class AuditService {
  private static readonly CLOUD_USER_KEY = 'interpoll_cloud_user';
  private static readonly RETURN_URL_KEY = 'interpoll_auth_return_url';

  private static getTrustedApiBase(): string {
    return config.auth.api;
  }

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
   * For decentralized resilience, soft backend failures fall back to local/Gun voting
   * unless auth is explicitly required or backend explicitly reports an already-voted denial.
   */
  static async authorizeVote(
    pollId: string,
    deviceId: string,
    requireLogin = false,
  ): Promise<{ allowed: boolean; reservationToken: string | null; reason: string | null; requiresAuth: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const body = await IntegrityService.seal(
        { pollId, deviceId, requireLogin } as Record<string, unknown>,
        'vote-authorize',
      );
      const res = await fetch(`${this.getTrustedApiBase()}/api/vote-authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let backendReason: string | null = null;
        try {
          const parsed = await res.json() as VoteAuthorizeResponse;
          backendReason = typeof parsed?.reason === 'string' ? parsed.reason : null;
        } catch {
          backendReason = null;
        }
        const normalizedReason = backendReason?.toLowerCase() || '';
        const alreadyVotedDenied = normalizedReason.includes('already');
        const backendUnavailable = res.status === 409 || res.status >= 500;
        if (res.status === 401) {
          return {
            allowed: false,
            reservationToken: null,
            reason: 'authentication required',
            requiresAuth: true,
          };
        }
        if (!alreadyVotedDenied && backendUnavailable) {
          return {
            allowed: true,
            reservationToken: null,
            reason: 'relay authorization unavailable; continuing decentralized vote',
            requiresAuth: false,
          };
        }
        return {
          allowed: false,
          reservationToken: null,
          reason: backendReason || 'authorization failed',
          requiresAuth: false,
        };
      }

      const data = (await res.json()) as VoteAuthorizeResponse;
      if (data.allowed === true && typeof data.reservationToken === 'string' && data.reservationToken.length > 0) {
        return { allowed: true, reservationToken: data.reservationToken, reason: null, requiresAuth: false };
      }

      const reason = typeof data.reason === 'string' ? data.reason : 'authorization denied';
      return {
        allowed: false,
        reservationToken: null,
        reason,
        requiresAuth: data.requireLogin === true && reason === 'authentication required',
      };
    } catch (_error) {
      return {
        allowed: true,
        reservationToken: null,
        reason: 'relay authorization unavailable; continuing decentralized vote',
        requiresAuth: false,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  static async confirmVote(
    pollId: string,
    deviceId: string,
    reservationToken: string,
    requireLogin = false,
  ): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const body = await IntegrityService.seal(
        { pollId, deviceId, reservationToken, requireLogin } as Record<string, unknown>,
        'vote-confirm',
      );
      const res = await fetch(`${this.getTrustedApiBase()}/api/vote-confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        return false;
      }

      const data = (await res.json()) as VoteConfirmResponse;
      return data.ok === true;
    } catch (_error) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  static async registerPollPolicy(pollId: string, requireLogin: boolean): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const body = await IntegrityService.seal(
        { pollId, requireLogin } as Record<string, unknown>,
        'poll-policy',
      );
      const res = await fetch(`${this.getTrustedApiBase()}/api/poll-policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  static async getCloudUser(): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${this.getTrustedApiBase()}/api/me`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        this.clearCachedCloudUser();
        return null;
      }
      const body = (await res.json()) as { user?: Record<string, unknown> | null };
      const user = body?.user ?? null;
      if (user) {
        localStorage.setItem(this.CLOUD_USER_KEY, JSON.stringify(user));
      } else {
        this.clearCachedCloudUser();
      }
      return user;
    } catch {
      this.clearCachedCloudUser();
      return null;
    }
  }

  static getCachedCloudUser(): Record<string, unknown> | null {
    try {
      const raw = localStorage.getItem(this.CLOUD_USER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
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
      if (raw && raw.startsWith('/')) {
        return raw;
      }
      return '/home';
    } catch {
      return '/home';
    }
  }

  static startOAuthLogin(provider: 'google' | 'microsoft' = 'google'): void {
    window.location.href = `${this.getTrustedApiBase()}/auth/${provider}/start`;
  }

  private static clearCachedCloudUser(): void {
    localStorage.removeItem(this.CLOUD_USER_KEY);
  }
}
