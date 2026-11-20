import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { StorageService } from './storageService';
import type { SignalPublicBundle } from './signalProtocol';

export type IdentityState = 'UNKNOWN' | 'LEGACY_UNAUTHENTICATED' | 'FIRST_SEEN_VALIDATED' | 'TRUSTED' | 'IDENTITY_CHANGED' | 'UNKNOWN_DEVICE' | 'REVOKED' | 'STALE_PREKEY';
export class DMIdentityError extends Error {
  constructor(public readonly state: IdentityState, message: string) { super(message); this.name = 'DMIdentityError'; }
}
export interface DeviceBinding {
  version: 1; accountId: string; deviceId: string; generation: number;
  ik: string; ikSignPub: string; capabilities: 'dm-auth-v1'; signature: string;
}
export interface PublicOPK { id: string; pub: string; signature: string }
export interface AuthenticatedBundle extends SignalPublicBundle {
  version: 1; binding: DeviceBinding; spkId: string; spkGeneration: number; spkAuthorization: string;
  opks: PublicOPK[]; selectedOPK: PublicOPK | null;
}
export interface MetadataChange { key: string; before: unknown; after: unknown }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const account = /^[0-9a-f]{64}$/;
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const canonical = (fields: unknown[]) => JSON.stringify(fields);
export const bindingBytes = (b: DeviceBinding) => canonical(['interpoll/dm/device-binding',1,b.accountId,b.deviceId,b.generation,b.ik,b.ikSignPub,'dm-auth-v1']);
export const spkBytes = (b: AuthenticatedBundle) => canonical(['interpoll/dm/spk',1,b.binding.accountId,b.binding.deviceId,b.binding.generation,b.ik,b.ikSignPub,b.spkId,b.spkGeneration,b.spk]);
export const opkBytes = (b: AuthenticatedBundle, opk: PublicOPK) => canonical(['interpoll/dm/opk',1,b.binding.accountId,b.binding.deviceId,b.binding.generation,b.ik,b.spkId,b.spkGeneration,opk.id,opk.pub]);
function bytes(value: string, length: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string') throw new DMIdentityError('UNKNOWN','Missing key/signature encoding');
  const result = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (result.length !== length || btoa(String.fromCharCode(...result)) !== value) throw new DMIdentityError('UNKNOWN','Noncanonical key/signature encoding');
  return result;
}
export async function verifyBinding(b: DeviceBinding, expectedAccount: string, expectedDevice?: string): Promise<void> {
  if (!b || b.version !== 1 || !account.test(expectedAccount) || b.accountId !== expectedAccount ||
    !uuid.test(b.deviceId) || !integer(b.generation) || b.capabilities !== 'dm-auth-v1' || !/^[0-9a-f]{128}$/.test(b.signature))
    throw new DMIdentityError('UNKNOWN','Invalid account/device binding');
  if (expectedDevice && b.deviceId !== expectedDevice) throw new DMIdentityError('UNKNOWN_DEVICE','Requested device mismatch');
  await crypto.subtle.importKey('raw',bytes(b.ik,65),{name:'ECDH',namedCurve:'P-256'},false,[]);
  await crypto.subtle.importKey('raw',bytes(b.ikSignPub,65),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if (!CryptoService.verify(bindingBytes(b),b.signature,expectedAccount)) throw new DMIdentityError('UNKNOWN','Account did not authorize messaging identity');
}
async function verifySignature(pub: string, payload: string, signature: string): Promise<void> {
  const key = await crypto.subtle.importKey('raw',bytes(pub,65),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if (!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes(signature,64),new TextEncoder().encode(payload)))
    throw new DMIdentityError('UNKNOWN','Unauthorized prekey');
}
async function sign(key: CryptoKey, payload: string): Promise<string> {
  const value = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}
// Cache only immutable signature-verification inputs, never continuity/authorization state.
const verifiedEncodings = new Set<string>();
export async function verifyAuthenticatedBundle(candidate: SignalPublicBundle, expectedAccount: string, expectedDevice?: string): Promise<AuthenticatedBundle> {
  const b = structuredClone(candidate) as AuthenticatedBundle;
  const cacheKey = JSON.stringify([expectedAccount,expectedDevice??null,b]);
  if (verifiedEncodings.has(cacheKey)) return b;
  if (b?.version !== 1 || !b.binding) throw new DMIdentityError('LEGACY_UNAUTHENTICATED','Authenticated bundle required');
  await verifyBinding(b.binding,expectedAccount,expectedDevice);
  if (b.ik !== b.binding.ik || b.ikSignPub !== b.binding.ikSignPub || !uuid.test(b.spkId) || !integer(b.spkGeneration))
    throw new DMIdentityError('UNKNOWN','SPK subject mismatch');
  await crypto.subtle.importKey('raw',bytes(b.spk,65),{name:'ECDH',namedCurve:'P-256'},false,[]);
  await verifySignature(b.ikSignPub,spkBytes(b),b.spkAuthorization);
  if (!Array.isArray(b.opks) || b.opks.length > 1000 || !('selectedOPK' in b)) throw new DMIdentityError('UNKNOWN','Explicit OPK choice required');
  const ids = new Set<string>();
  for (const opk of b.opks) {
    if (!opk || !uuid.test(opk.id) || ids.has(opk.id)) throw new DMIdentityError('UNKNOWN','Invalid OPK identity');
    ids.add(opk.id);
    await crypto.subtle.importKey('raw',bytes(opk.pub,65),{name:'ECDH',namedCurve:'P-256'},false,[]);
    await verifySignature(b.ikSignPub,opkBytes(b,opk),opk.signature);
  }
  if (b.selectedOPK !== null) {
    const opk = b.opks.find(p => p.id === b.selectedOPK?.id);
    if (!opk || opk.pub !== b.selectedOPK.pub || opk.signature !== b.selectedOPK.signature || b.opkId !== opk.id || b.opk !== opk.pub)
      throw new DMIdentityError('UNKNOWN','OPK selection mismatch');
  } else if (b.opkId || b.opk) throw new DMIdentityError('UNKNOWN','No-OPK transcript mismatch');
  if (verifiedEncodings.size >= 200) verifiedEncodings.clear();
  verifiedEncodings.add(cacheKey);
  return b;
}
export async function continuityChange(localAccount: string, b: AuthenticatedBundle): Promise<MetadataChange> {
  const key = `dm-trust-v1:${localAccount}:${b.binding.accountId}`;
  const before = await StorageService.getMetadata(key);
  if (before?.state === 'REVOKED') throw new DMIdentityError('REVOKED','Device revoked locally');
  if (before) {
    if (before.binding.deviceId !== b.binding.deviceId) throw new DMIdentityError('UNKNOWN_DEVICE','Device approval required');
    if (bindingBytes(before.binding) !== bindingBytes(b.binding)) throw new DMIdentityError('IDENTITY_CHANGED','Identity approval required');
    if ((b.spkId === before.spkId && (b.spk !== before.spk || b.spkGeneration !== before.spkGeneration)) || b.spkGeneration < before.spkGeneration || (b.spkGeneration === before.spkGeneration && (b.spkId !== before.spkId || b.spk !== before.spk)))
      throw new DMIdentityError('STALE_PREKEY','SPK rollback/replacement rejected');
  }
  return {key,before,after:{state:before?'TRUSTED':'FIRST_SEEN_VALIDATED',binding:b.binding,spkId:b.spkId,spkGeneration:b.spkGeneration,spk:b.spk}};
}
export async function authorizeLocalBundle(
  accountId: string, bundle: SignalPublicBundle, signingKey: CryptoKey,
  pool: {id:string;pubB64:string}[], accountPrivateKey?: string,
): Promise<AuthenticatedBundle> {
  const privateKey = accountPrivateKey ?? await KeyService.getPrivateKeyHex();
  if (!account.test(accountId) || KeyService.getPublicKey(privateKey) !== accountId)
    throw new DMIdentityError('UNKNOWN','Local account signer does not match ChatService identity');
  const key = `dm-local-identity-v1:${accountId}`;
  let saved = await StorageService.getMetadata(key);
  if (!saved) {
    const binding: DeviceBinding = {version:1,accountId,deviceId:crypto.randomUUID(),generation:1,
      ik:bundle.ik,ikSignPub:bundle.ikSignPub,capabilities:'dm-auth-v1',signature:''};
    binding.signature = CryptoService.sign(bindingBytes(binding),privateKey);
    const value = {binding,spkId:crypto.randomUUID(),spkGeneration:1,spk:bundle.spk};
    await StorageService.compareAndSwapMetadata([{key,before:saved,after:value}]);
    saved = await StorageService.getMetadata(key);
  }
  if (saved.binding.ik !== bundle.ik || saved.binding.ikSignPub !== bundle.ikSignPub || saved.spk !== bundle.spk)
    throw new DMIdentityError('IDENTITY_CHANGED','Local key replacement requires explicit approval');
  await verifyBinding(saved.binding,accountId);
  const result: AuthenticatedBundle = {...bundle,version:1,...saved,spkAuthorization:'',opks:[],selectedOPK:null,opk:undefined,opkId:undefined};
  result.spkAuthorization = await sign(signingKey,spkBytes(result));
  for (const entry of pool) {
    const opk = {id:entry.id,pub:entry.pubB64,signature:''};
    opk.signature = await sign(signingKey,opkBytes(result,opk)); result.opks.push(opk);
  }
  result.selectedOPK = result.opks[0] ?? null;
  if (result.selectedOPK) {result.opkId=result.selectedOPK.id;result.opk=result.selectedOPK.pub;}
  return result;
}

function transcriptBundle(b: AuthenticatedBundle, includeOPK: boolean): AuthenticatedBundle {
  const selectedOPK = includeOPK ? b.selectedOPK : null;
  return {...b,opks:selectedOPK?[selectedOPK]:[],selectedOPK,
    opk:selectedOPK?.pub,opkId:selectedOPK?.id};
}
export function bootstrapContext(sender: AuthenticatedBundle, recipient: AuthenticatedBundle): string {
  return JSON.stringify(['interpoll/dm/bootstrap',1,transcriptBundle(sender,false),transcriptBundle(recipient,true)]);
}
export async function verifyContext(context: string, myId: string, theirId: string, own: AuthenticatedBundle): Promise<{peer:AuthenticatedBundle;receiver:AuthenticatedBundle}> {
  let parsed: unknown;
  try { parsed=JSON.parse(context); } catch { throw new DMIdentityError('UNKNOWN','Malformed bootstrap context'); }
  if (!Array.isArray(parsed) || parsed.length!==4 || parsed[0]!=='interpoll/dm/bootstrap' || parsed[1]!==1 || JSON.stringify(parsed)!==context)
    throw new DMIdentityError('UNKNOWN','Unsupported bootstrap context');
  const sender=parsed[2] as AuthenticatedBundle,receiver=parsed[3] as AuthenticatedBundle;
  const localIsSender=sender?.binding?.accountId===myId;
  const local=await verifyAuthenticatedBundle(localIsSender?sender:receiver,myId,own.binding.deviceId);
  const peer=await verifyAuthenticatedBundle(localIsSender?receiver:sender,theirId);
  if (bindingBytes(local.binding)!==bindingBytes(own.binding) || local.spk!==own.spk || local.spkId!==own.spkId)
    throw new DMIdentityError('IDENTITY_CHANGED','Bootstrap local identity mismatch');
  if (sender.selectedOPK!==null) throw new DMIdentityError('UNKNOWN','Unexpected sender OPK');
  return {peer,receiver};
}
