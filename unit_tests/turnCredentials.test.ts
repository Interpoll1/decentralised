import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
// @ts-ignore JS helper
import { makeTurnCredentials } from '../relay-server/turn.js';

describe('makeTurnCredentials', () => {
  it('username is expiry:subject and credential is base64 HMAC-SHA1', () => {
    const c = makeTurnCredentials('s3cret', 'abcd', 1_000_000, 3600);
    expect(c.username).toBe(`${1000 + 3600}:abcd`);
    const exp = crypto.createHmac('sha1', 's3cret').update(c.username).digest('base64');
    expect(c.credential).toBe(exp);
    expect(c.ttl).toBe(3600);
  });
  it('different subjects give different credentials', () => {
    expect(makeTurnCredentials('k', 'a', 0, 60).credential).not.toBe(makeTurnCredentials('k', 'b', 0, 60).credential);
  });
});

describe('config.getTurnServers', () => {
  it('maps relay response, drops non-turn urls, caches, and returns [] in Anonymity Mode', async () => {
    const { default: config } = await import('@/config');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ urls: ['turn:t:3478', 'http://evil'], username: 'u', credential: 'c', ttl: 3600 }) }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await config.getTurnServers()).toEqual([{ urls: ['turn:t:3478'], username: 'u', credential: 'c' }]);
    await config.getTurnServers();
    expect(fetchMock).toHaveBeenCalledOnce();
    config.setAnonymityMode(true);
    expect(await config.getTurnServers()).toEqual([]);
    config.setAnonymityMode(false);
    vi.unstubAllGlobals();
  });

  it('fetch failure → []', async () => {
    vi.resetModules();
    const { default: config } = await import('@/config');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await config.getTurnServers()).toEqual([]);
    vi.unstubAllGlobals();
  });
});
