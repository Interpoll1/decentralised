import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { CryptoService } from '../src/services/cryptoService';

const fixture = vi.hoisted(() => ({ records: [] as any[], pubkey: '' }));
vi.mock('../src/services/keyService', () => ({ KeyService: { getPublicKeyHex: async () => fixture.pubkey } }));
vi.mock('../src/services/gunService', () => ({ GunService: { getGun: () => {
  const node = { get: () => node, map: () => node, once: (cb: (record: any) => void) => {
    fixture.records.forEach(cb); return node;
  } }; return node;
} } }));
import { TrustService, type TrustCertificate } from '../src/services/trustService';

const issuerKey = '03'.padStart(64, '0'); // Synthetic issuer only.
const issuerPub = bytesToHex(schnorr.getPublicKey(hexToBytes(issuerKey)));
function certificate(changes = {}): TrustCertificate {
  const payload = { issuerDomain: 'issuer.test', username: 'fixture', userPubkey: fixture.pubkey,
    issuedAt: Date.now() - 1000, expiresAt: Date.now() + 60_000, ...changes };
  return { ...payload, signature: CryptoService.sign(JSON.stringify(payload), issuerKey) };
}
beforeEach(() => {
  vi.useFakeTimers(); fixture.records = [];
  fixture.pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes('04'.padStart(64, '0'))));
  (TrustService as any).certCache.clear();
  vi.spyOn(TrustService, 'getIssuers').mockResolvedValue([{ domain: 'issuer.test', publicKey: issuerPub } as any]);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function level() {
  const pending = TrustService.getMyTrustLevel();
  await vi.advanceTimersByTimeAsync(2100); return pending;
}
it('rejects a claimed verified level without a valid issuer signature', async () => {
  fixture.records = [{ pubkey: fixture.pubkey, level: 'verified', certificate: { ...certificate(), signature: '00'.repeat(64) } }];
  expect(await level()).toBe('none');
});
it('accepts a real issuer certificate bound to the local public key', async () => {
  fixture.records = [{ pubkey: fixture.pubkey, level: 'verified', certificate: JSON.stringify(certificate()) }];
  expect(await level()).toBe('verified');
});
it('rejects a genuine certificate issued to another identity', async () => {
  fixture.records = [{ pubkey: fixture.pubkey, level: 'verified', certificate: certificate({ userPubkey: '11'.repeat(32) }) }];
  expect(await level()).toBe('none');
});
it('rejects expired certificates and revalidates a previously cached certificate', async () => {
  const cert = certificate(); fixture.records = [{ pubkey: fixture.pubkey, level: 'verified', certificate: cert }];
  expect(await level()).toBe('verified');
  vi.setSystemTime(cert.expiresAt + 1);
  expect(await level()).toBe('none');
});
