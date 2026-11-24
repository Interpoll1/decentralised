import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'crypto';

// In-memory "relay": soul path -> stored node.
const relay = new Map<string, any>();
const chain = (path: string[]): any => ({
  get: (k: string) => chain([...path, k]),
  _path: path.join('/'),
});
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: () => chain([]) } }));
vi.mock('../src/utils/gunAsync', () => ({
  gunPut: async (node: any, data: any) => { relay.set(node._path, data); return { ok: true }; },
  gunOnce: async (node: any) => relay.get(node._path) ?? null,
}));

const { DeviceVaultService } = await import('../src/services/deviceVaultService');
const { KeyService } = await import('../src/services/keyService');
const { KeyVaultService } = await import('../src/services/keyVaultService');
const { StorageService } = await import('../src/services/storageService');

/** A fake platform authenticator: one resident credential with a hmac-secret style PRF. */
function installAuthenticator() {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const rawId = crypto.getRandomValues(new Uint8Array(16));
  let userHandle: Uint8Array | null = null;
  const prf = (salt: ArrayBuffer) => new Uint8Array(createHmac('sha256', secret).update(new Uint8Array(salt)).digest()).buffer;
  (globalThis as any).window = { isSecureContext: true, PublicKeyCredential: function () {} };
  (globalThis as any).navigator.credentials = {
    async create({ publicKey }: any) {
      userHandle = new Uint8Array(publicKey.user.id);
      return { rawId: rawId.buffer, getClientExtensionResults: () => ({ prf: { enabled: true } }) };
    },
    async get({ publicKey }: any) {
      return {
        rawId: rawId.buffer,
        response: { userHandle: userHandle?.buffer ?? null },
        getClientExtensionResults: () => ({ prf: { results: { first: prf(publicKey.extensions.prf.eval.first) } } }),
      };
    },
  };
}

async function wipeBrowser() {
  const db = await StorageService.getDB();
  for (const store of ['metadata', 'encryption-keys'] as const) await db.clear(store);
  KeyService.clearCache();
}

describe('DeviceVaultService', () => {
  beforeEach(async () => { relay.clear(); await wipeBrowser(); });

  it('survives a wipe via passkey + relay, including community keys', async () => {
    installAuthenticator();
    const original = await KeyService.getPublicKeyHex();
    await KeyVaultService.storeKey({ id: 'c1', type: 'community', key: 'AAAA', method: 'invite', label: 'Secret club', joinedAt: 1 });

    await DeviceVaultService.enrollPasskey('alice');
    const [[, node]] = [...relay.entries()];
    expect(node.json).not.toContain(await KeyService.getPrivateKeyHex()); // only ciphertext leaves

    await wipeBrowser();
    expect(await KeyService.getPublicKeyHex()).not.toBe(original); // wipe really lost it
    await wipeBrowser();

    const r = await DeviceVaultService.restoreWithPasskey();
    KeyService.clearCache();
    expect(r.publicKey).toBe(original);
    expect(await KeyService.getPublicKeyHex()).toBe(original);
    expect((await KeyVaultService.getKey('c1'))?.label).toBe('Secret club');
  });

  it('refuses a vault a relay swapped for a different identity', async () => {
    installAuthenticator();
    await DeviceVaultService.enrollPasskey('alice');
    const [[soul, node]] = [...relay.entries()];
    const rec = JSON.parse(node.json);
    // Attacker re-signs a record under their own key at the same locator.
    const evil = KeyService.generatePrivateKey();
    rec.pub = KeyService.getPublicKey(evil);
    relay.set(soul, { json: JSON.stringify(rec) });
    await wipeBrowser();
    await expect(DeviceVaultService.restoreWithPasskey()).rejects.toThrow(/does not belong|signature/);
  });

  it('round-trips the device file and rejects a wrong passphrase', async () => {
    const original = await KeyService.getPrivateKeyHex();
    const text = await DeviceVaultService.buildFile('correct horse');
    expect(text).not.toContain(original);
    await expect(DeviceVaultService.readFile(text, 'wrong horse')).rejects.toThrow(/Wrong passphrase/);
    expect((await DeviceVaultService.readFile(text, 'correct horse')).privateKey).toBe(original);
  });
});
