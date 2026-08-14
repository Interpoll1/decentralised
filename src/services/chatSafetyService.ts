// src/services/chatSafetyService.ts — Local-first DM blocking and muting
//
// DMs in InterPoll are open to any stranger whose public key (userId) you know.
// There is no server to ask permission: blocking happens locally, before
// decryption, to deny the sender any read-receipt or typing signal. Reports
// carry a content hash plus the signed envelope (verifiable) rather than
// plaintext, so moderation can proceed without publishing the message.

import { StorageService } from './storageService';
import { CryptoService } from './cryptoService';
import config from '@/config';

export type DmPolicy = 'everyone' | 'verified-only';

export interface ChatSafetyState {
  /** userIds whose messages are dropped before decryption. */
  blocked: string[];
  /** userIds whose messages arrive but raise no notification or unread badge. */
  muted: string[];
  updatedAt: number;
}

export interface ReportInput {
  /** Message id being reported. */
  messageId: string;
  /** Claimed author of the message. */
  senderId: string;
  /** Plaintext of the reported message — hashed, never transmitted verbatim by default. */
  text: string;
  /** The signed envelope as it appeared on the wire, if the message carried one. */
  envelope?: Record<string, unknown>;
  reason: 'spam' | 'harassment' | 'threats' | 'csam' | 'scam' | 'other';
  /** Only sent when the user explicitly opts in on the report dialog. */
  includePlaintext?: boolean;
}

const STORAGE_KEY = 'chat-safety';
const DM_POLICY_KEY = 'chat-dm-policy';
const DEFAULT_DM_POLICY: DmPolicy = 'everyone';

export class ChatSafetyService {
  private static cachedState: ChatSafetyState | null = null;

  static async load(): Promise<ChatSafetyState> {
    try {
      const stored = await StorageService.getMetadata(STORAGE_KEY);
      if (stored && stored.blocked && stored.muted) {
        this.cachedState = stored as ChatSafetyState;
        return this.cachedState;
      }
    } catch {
      // Degrade to safe defaults on any storage error
    }
    const defaultState: ChatSafetyState = { blocked: [], muted: [], updatedAt: 0 };
    this.cachedState = defaultState;
    return defaultState;
  }

  static async prime(): Promise<void> {
    await this.load();
  }

  static isBlocked(userId: string): boolean {
    if (!this.cachedState) return false;
    return this.cachedState.blocked.includes(userId);
  }

  static isMuted(userId: string): boolean {
    if (!this.cachedState) return false;
    return this.cachedState.muted.includes(userId);
  }

  static async block(userId: string): Promise<ChatSafetyState> {
    try {
      const state = await this.load();
      if (!state.blocked.includes(userId)) {
        state.blocked.push(userId);
        state.updatedAt = Date.now();
        await StorageService.setMetadata(STORAGE_KEY, state);
        this.cachedState = state;
      }
      return state;
    } catch {
      return this.cachedState || { blocked: [], muted: [], updatedAt: 0 };
    }
  }

  static async unblock(userId: string): Promise<ChatSafetyState> {
    try {
      const state = await this.load();
      const idx = state.blocked.indexOf(userId);
      if (idx !== -1) {
        state.blocked.splice(idx, 1);
        state.updatedAt = Date.now();
        await StorageService.setMetadata(STORAGE_KEY, state);
        this.cachedState = state;
      }
      return state;
    } catch {
      return this.cachedState || { blocked: [], muted: [], updatedAt: 0 };
    }
  }

  static async mute(userId: string): Promise<ChatSafetyState> {
    try {
      const state = await this.load();
      if (!state.muted.includes(userId)) {
        state.muted.push(userId);
        state.updatedAt = Date.now();
        await StorageService.setMetadata(STORAGE_KEY, state);
        this.cachedState = state;
      }
      return state;
    } catch {
      return this.cachedState || { blocked: [], muted: [], updatedAt: 0 };
    }
  }

  static async unmute(userId: string): Promise<ChatSafetyState> {
    try {
      const state = await this.load();
      const idx = state.muted.indexOf(userId);
      if (idx !== -1) {
        state.muted.splice(idx, 1);
        state.updatedAt = Date.now();
        await StorageService.setMetadata(STORAGE_KEY, state);
        this.cachedState = state;
      }
      return state;
    } catch {
      return this.cachedState || { blocked: [], muted: [], updatedAt: 0 };
    }
  }

  static getDmPolicy(): DmPolicy {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(DM_POLICY_KEY) : null;
      return (stored as DmPolicy) || DEFAULT_DM_POLICY;
    } catch {
      return DEFAULT_DM_POLICY;
    }
  }

  static setDmPolicy(policy: DmPolicy): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(DM_POLICY_KEY, policy);
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  static async report(input: ReportInput): Promise<{ ok: boolean; message: string }> {
    try {
      const baseUrl = config.relay.api;
      if (!baseUrl) {
        return { ok: false, message: 'Relay API base URL not configured' };
      }

      const contentHash = CryptoService.hash(input.text);
      const body: Record<string, unknown> = {
        messageId: input.messageId,
        senderId: input.senderId,
        reason: input.reason,
        contentHash,
        reportedAt: Date.now(),
      };

      if (input.envelope) {
        body.envelope = input.envelope;
      }

      if (input.includePlaintext === true) {
        body.text = input.text;
      }

      const res = await fetch(`${baseUrl}/api/moderation/chat-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });

      if (res.ok) {
        return { ok: true, message: 'Report submitted successfully' };
      }
      if (res.status === 400) {
        return { ok: false, message: 'Invalid report data' };
      }
      if (res.status === 429) {
        return { ok: false, message: 'Too many reports — please wait before reporting again' };
      }
      return { ok: false, message: `Server error: ${res.status}` };
    } catch (err: any) {
      const errorMsg = err?.message ?? 'Network error';
      return { ok: false, message: `Report failed: ${errorMsg}` };
    }
  }

  static async blockAndReport(input: ReportInput): Promise<{ ok: boolean; message: string }> {
    try {
      await this.block(input.senderId);
      return await this.report(input);
    } catch (err: any) {
      const errorMsg = err?.message ?? 'Unknown error';
      return { ok: false, message: `Block and report failed: ${errorMsg}` };
    }
  }
}
