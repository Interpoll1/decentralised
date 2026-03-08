import type { InviteLinkData } from '../types/encryption';

export class InviteLinkService {
  /**
   * Generate an invite link with the encryption key in the URL fragment.
   * The fragment (#) is never sent to the server, keeping the key private.
   *
   * Format: {origin}/join/{type}/{id}#{base64url-key}
   *
   * @param id - communityId or chatRoomId
   * @param type - 'community' | 'chatroom' | 'server'
   * @param base64urlKey - base64url-encoded AES-256 key
   * @returns full invite URL
   */
  static generateInviteLink(id: string, type: InviteLinkData['type'], base64urlKey: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/join/${type}/${encodeURIComponent(id)}#${base64urlKey}`;
  }

  /**
   * Parse an invite link URL to extract the community/room ID and key.
   * Handles both full URLs and path-only strings.
   *
   * @param url - invite URL string (e.g. "https://example.com/join/community/c-bitcoin#abc123")
   * @returns InviteLinkData or null if the URL is not a valid invite link
   */
  static parseInviteLink(url: string): InviteLinkData | null {
    try {
      // Handle path-only (e.g. from router) or full URL
      let pathname: string;
      let hash: string;

      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        pathname = parsed.pathname;
        hash = parsed.hash;
      } else {
        // Path-only: extract hash manually
        const hashIndex = url.indexOf('#');
        if (hashIndex >= 0) {
          pathname = url.substring(0, hashIndex);
          hash = url.substring(hashIndex);
        } else {
          pathname = url;
          hash = '';
        }
      }

      // Expected format: /join/{type}/{id}
      const match = pathname.match(/^\/join\/(community|chatroom|server)\/(.+)$/);
      if (!match) return null;

      const type = match[1] as InviteLinkData['type'];
      const id = decodeURIComponent(match[2]);
      const key = hash.startsWith('#') ? hash.substring(1) : '';

      if (!id || !key) return null;

      return { id, type, key };
    } catch {
      return null;
    }
  }

  /**
   * Extract key from the current page's URL fragment (for use in the JoinPrivatePage).
   * Returns the base64url key string, or null if no fragment.
   */
  static getKeyFromCurrentUrl(): string | null {
    if (typeof window === 'undefined') return null;
    const hash = window.location.hash;
    if (!hash || hash === '#') return null;
    return hash.substring(1);
  }

  /**
   * Copy invite link to clipboard.
   * @returns true if successful
   */
  static async copyToClipboard(link: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch {
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = link;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      } catch {
        return false;
      }
    }
  }
}
