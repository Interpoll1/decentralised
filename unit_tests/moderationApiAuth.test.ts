import { describe, it, expect, beforeEach, vi } from 'vitest';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('vue', () => ({
  ref: (val: any) => ({ value: val }),
}));

import { ModerationService, MODERATION_API_DEFAULT_BASE_URL } from '../src/services/moderationService';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function respond(status: number, body: unknown = {}) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

describe('ModerationService.authenticateModerationApiKey', () => {
  beforeEach(() => {
    storage.clear();
    fetchMock.mockReset();
    (ModerationService as any).settings = null;
  });

  it('probes the deployed /moderation/v1 route with the key as a bearer token', async () => {
    respond(200, []);
    await ModerationService.authenticateModerationApiKey('mod_sk_admin');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MODERATION_API_DEFAULT_BASE_URL}/v1/api-keys`);
    expect(url).toBe('https://interpoll.endless.sbs/moderation/v1/api-keys');
    expect(init.headers.Authorization).toBe('Bearer mod_sk_admin');
  });

  it('accepts an admin key (200) and stores it', async () => {
    respond(200, []);
    const r = await ModerationService.authenticateModerationApiKey('mod_sk_admin');
    expect(r.ok).toBe(true);
    expect(ModerationService.getSettings().moderationApiKey).toBe('mod_sk_admin');
  });

  it('accepts a valid non-admin key (403 insufficient_scope)', async () => {
    respond(403, { error: { code: 'insufficient_scope' } });
    const r = await ModerationService.authenticateModerationApiKey('mod_sk_writer');
    expect(r.ok).toBe(true);
  });

  it('rejects a 403 that is not moderation-api scope error (e.g. proxy/WAF)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Forbidden</html>', { status: 403 }));
    const r = await ModerationService.authenticateModerationApiKey('mod_sk_x');
    expect(r.ok).toBe(false);
    expect(ModerationService.getSettings().moderationApiKey).toBe('');
  });

  it('rejects an unknown or revoked key (401)', async () => {
    respond(401, { error: { code: 'invalid_api_key' } });
    const r = await ModerationService.authenticateModerationApiKey('mod_sk_bad');
    expect(r).toEqual({ ok: false, message: 'Invalid API key' });
  });

  it('migrates a saved legacy site-root base URL to the /moderation prefix', () => {
    storage.set('moderation_settings', JSON.stringify({ moderationApiBaseUrl: 'https://interpoll.endless.sbs/' }));
    expect(ModerationService.getSettings().moderationApiBaseUrl).toBe(MODERATION_API_DEFAULT_BASE_URL);
  });

  it('leaves a custom base URL alone', () => {
    storage.set('moderation_settings', JSON.stringify({ moderationApiBaseUrl: 'https://mod.example.com' }));
    expect(ModerationService.getSettings().moderationApiBaseUrl).toBe('https://mod.example.com');
  });
});
