import config from '../config';

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

const STORAGE_KEY = 'interpoll_cloud_user';
const RETURN_URL_KEY = 'interpoll_auth_return';

export class AuditService {
  private static cachedUser: CloudUser | null | undefined = undefined;

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

  /**
   * Check if the current browser session is authenticated with Google/Microsoft.
   * Uses the HTTP-only session cookie set by the relay server.
   * Caches the result in localStorage so the user stays logged in across refreshes.
   */
  static async getCloudUser(): Promise<CloudUser | null> {
    try {
      const res = await fetch(`${config.relay.api}/api/me`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        this.clearCachedUser();
        return null;
      }

      const data = (await res.json()) as { user?: CloudUser | null };
      const user = data.user ?? null;

      if (user) {
        this.setCachedUser(user);
      } else {
        this.clearCachedUser();
      }

      return user;
    } catch (_error) {
      // Backend unreachable — fall back to cached user
      return this.getCachedUser();
    }
  }

  /**
   * Get the cached user from localStorage (synchronous).
   * Returns null if no cached user exists.
   */
  static getCachedUser(): CloudUser | null {
    if (this.cachedUser !== undefined) {
      return this.cachedUser ?? null;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.cachedUser = JSON.parse(raw) as CloudUser;
        return this.cachedUser;
      }
    } catch {
      // Corrupted data
    }

    this.cachedUser = null;
    return null;
  }

  private static setCachedUser(user: CloudUser) {
    this.cachedUser = user;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  }

  private static clearCachedUser() {
    this.cachedUser = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Initiate OAuth login by redirecting the current tab.
   * Saves the current URL so AuthCallbackPage can redirect back after login.
   */
  static login(provider: 'google' | 'microsoft') {
    localStorage.setItem(RETURN_URL_KEY, window.location.pathname + window.location.search);

    const url = provider === 'google'
      ? config.auth.googleStart
      : config.auth.microsoftStart;

    window.location.href = url;
  }

  /**
   * Log out: clear the server session and local cache.
   */
  static async logout(): Promise<void> {
    try {
      await fetch(`${config.relay.api}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Backend unreachable; still clear local state
    }

    this.clearCachedUser();
  }

  /**
   * Consume the saved return URL after OAuth callback.
   * Returns the URL to navigate to, defaulting to '/home'.
   */
  static consumeReturnUrl(): string {
    const url = localStorage.getItem(RETURN_URL_KEY) || '/home';
    localStorage.removeItem(RETURN_URL_KEY);
    return url;
  }
}
