import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyService as RealKeyService } from '../src/services/keyService';
import { CryptoService } from '../src/services/cryptoService';

// A swappable "device key", an in-memory metadata store and an in-memory event store.
const device = { priv: '', pub: '' };
const meta = new Map<string, any>();

vi.mock('../src/services/gunService', () => ({ GunService: { getGun: () => ({}) } }));
vi.mock('../src/services/storageService', () => ({
  StorageService: {
    setMetadata: async (k: string, v: any) => { meta.set(k, v); },
    getMetadata: async (k: string) => meta.get(k),
  },
}));
vi.mock('../src/services/keyService', async () => {
  const real = await vi.importActual<typeof import('../src/services/keyService')>('../src/services/keyService');
  return {
    KeyService: {
      generatePrivateKey: real.KeyService.generatePrivateKey,
      getPublicKey: real.KeyService.getPublicKey,
      getPublicKeyHex: async () => device.pub,
      getPrivateKeyHex: async () => device.priv,
      importPrivateKey: async (priv: string) => { device.priv = priv; device.pub = real.KeyService.getPublicKey(priv); return { privateKey: priv, publicKey: device.pub }; },
    },
  };
});
vi.mock('../src/services/trustService', () => ({ TrustService: { resolveUsernameOwner: async () => null, getIssuers: async () => [], verifyCertificate: () => false } }));

import { NameRecoveryService, type EventStore } from '../src/services/nameRecoveryService';
import { DEFAULT_TIMELOCK_MS } from '../src/utils/usernameEvents';

function memoryStore(): EventStore {
  const rows = new Map<string, Map<string, string>>();
  return {
    async put(u, id, json) { (rows.get(u) ?? rows.set(u, new Map()).get(u)!).set(id, json); return true; },
    async list(u) { return [...(rows.get(u)?.values() ?? [])]; },
  };
}
function useNewDevice() {
  device.priv = RealKeyService.generatePrivateKey();
  device.pub = RealKeyService.getPublicKey(device.priv);
}

beforeEach(() => {
  meta.clear();
  NameRecoveryService.store = memoryStore();
  NameRecoveryService.relayEnabled = false; // never touch a real relay from tests
  useNewDevice();
});

describe('NameRecoveryService flows', () => {
  it('publishes a signed claim and resolves this device as holder', async () => {
    expect(await NameRecoveryService.publishClaim('Alice', 'none')).toBe(true);
    const st = await NameRecoveryService.status('alice');
    expect(st.isHolder).toBe(true);
    expect(st.hasRecovery).toBe(false);
    expect(st.resolved.owner).toBe(device.pub);
  });

  it('full recovery: claim → recovery key → lost device → recover on a new key → time lock → ownership moves', async () => {
    await NameRecoveryService.publishClaim('bob', 'none');
    const holderPub = device.pub;
    const { phrase } = await NameRecoveryService.setupRecovery('bob');
    expect(phrase.split(' ')).toHaveLength(24);
    expect((await NameRecoveryService.status('bob')).hasRecovery).toBe(true);

    useNewDevice(); // wiped device, fresh key
    const newPub = device.pub;
    const pending = await NameRecoveryService.requestRecovery('bob', phrase);
    expect(pending.pendingForMe?.kind).toBe('recovery');
    expect(pending.resolved.owner).toBe(holderPub); // still the old key during the lock

    expect((await NameRecoveryService.status('bob', Date.now() + DEFAULT_TIMELOCK_MS - 60_000)).resolved.owner).toBe(holderPub);
    const after = await NameRecoveryService.status('bob', Date.now() + DEFAULT_TIMELOCK_MS + 60_000);
    expect(after.resolved.owner).toBe(newPub);
    expect(after.isHolder).toBe(true);
  });

  it('the original holder sees the pending recovery and can cancel it', async () => {
    await NameRecoveryService.publishClaim('cleo', 'none');
    const holderPriv = device.priv;
    const { phrase } = await NameRecoveryService.setupRecovery('cleo');

    useNewDevice();
    await NameRecoveryService.requestRecovery('cleo', phrase);

    device.priv = holderPriv; device.pub = RealKeyService.getPublicKey(holderPriv); // back on the original device
    const seen = await NameRecoveryService.status('cleo');
    expect(seen.pendingAgainstMe?.kind).toBe('recovery');
    expect(await NameRecoveryService.cancelPending('cleo')).toBe(true);
    const later = await NameRecoveryService.status('cleo', Date.now() + 30 * 24 * 3600_000);
    expect(later.resolved.owner).toBe(device.pub);
    expect(later.pendingAgainstMe).toBeNull();
  });

  it('rejects a name with no recovery key, and a wrong phrase', async () => {
    await NameRecoveryService.publishClaim('dora', 'none');
    useNewDevice();
    await expect(NameRecoveryService.requestRecovery('dora', CryptoService.privateKeyToMnemonic(RealKeyService.generatePrivateKey())))
      .rejects.toThrow(/no recovery key/);

    useNewDevice();
    await NameRecoveryService.publishClaim('eli', 'none');
    await NameRecoveryService.setupRecovery('eli');
    useNewDevice();
    await expect(NameRecoveryService.requestRecovery('eli', CryptoService.privateKeyToMnemonic(RealKeyService.generatePrivateKey())))
      .rejects.toThrow(/does not match/);
  });

  it('refuses garbage phrases and unclaimed names', async () => {
    await expect(NameRecoveryService.requestRecovery('ghost', 'not a real phrase')).rejects.toThrow();
    await expect(NameRecoveryService.requestRecovery('ghost', CryptoService.privateKeyToMnemonic(RealKeyService.generatePrivateKey())))
      .rejects.toThrow(/not been claimed/);
  });

  it('a later claim by another key cannot take a claimed name', async () => {
    await NameRecoveryService.publishClaim('finn', 'none');
    const owner = device.pub;
    useNewDevice();
    await NameRecoveryService.publishClaim('finn', 'none');
    const st = await NameRecoveryService.status('finn');
    expect(st.resolved.owner).toBe(owner);
    expect(st.isHolder).toBe(false);
  });

  it('only the holder can set recovery', async () => {
    await NameRecoveryService.publishClaim('hugo', 'none');
    useNewDevice();
    await expect(NameRecoveryService.setupRecovery('hugo')).rejects.toThrow(/does not hold/);
  });

  it('voluntary rotation parks the new key; it cannot activate before the notice window', async () => {
    await NameRecoveryService.publishClaim('gwen', 'none');
    const oldPub = device.pub;
    const r = await NameRecoveryService.startKeyRotation('gwen');
    expect(device.pub).toBe(oldPub);
    expect((await NameRecoveryService.pendingRotationKey('gwen'))?.publicKey).toBe(r.newPubkey);
    await expect(NameRecoveryService.activateRotatedKey('gwen')).rejects.toThrow(/not taken effect/);
  });
});
