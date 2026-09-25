import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatPath, isSealedToken, receiptPath, resolveChatUserId, sealRoute, unsealRoute,
} from '../src/utils/privateRoute';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

describe('privateRoute', () => {
  beforeEach(() => store.clear());

  it('chat paths never contain the user id or name', () => {
    const id = 'a'.repeat(64);
    const path = chatPath(id, 'Alice Secret');
    expect(path).toMatch(/^\/chat\/~[a-z0-9]{8}$/);
    expect(path).not.toContain(id);
    expect(path).not.toContain('Alice');
  });

  it('round-trips a sealed chat token', () => {
    const token = chatPath('user-123', 'Bob').split('/').pop()!;
    expect(isSealedToken(token)).toBe(true);
    expect(unsealRoute('chat', token)).toEqual({ id: 'user-123', name: 'Bob' });
    expect(resolveChatUserId(token)).toBe('user-123');
  });

  it('reuses one token per target so history does not pile up', () => {
    expect(chatPath('user-1', 'A')).toBe(chatPath('user-1', 'A renamed'));
    expect(chatPath('user-1')).not.toBe(chatPath('user-2'));
  });

  it('keeps kinds separate', () => {
    const token = receiptPath('word word word').split('/').pop()!;
    expect(unsealRoute('receipt', token)).toEqual({ code: 'word word word' });
    expect(unsealRoute('chat', token)).toBeNull();
  });

  it('passes raw ids through and rejects unknown tokens', () => {
    expect(resolveChatUserId('plain-id')).toBe('plain-id');
    expect(resolveChatUserId('~zzzzzzzz')).toBe('');
    expect(resolveChatUserId(undefined)).toBe('');
  });

  it('survives unavailable storage', () => {
    const saved = (globalThis as any).localStorage;
    (globalThis as any).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    try {
      const token = sealRoute('chat', { id: 'mem-only' });
      expect(unsealRoute('chat', token)).toEqual({ id: 'mem-only' });
    } finally {
      (globalThis as any).localStorage = saved;
    }
  });
});
