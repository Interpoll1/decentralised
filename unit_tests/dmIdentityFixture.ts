import { KeyService } from '../src/services/keyService';
import { getOrCreateAuthenticatedIdentityBundle } from '../src/services/signalProtocol';
import { authorizeLocalBundle } from '../src/services/dmIdentity';
const secrets = ['01','02','03','04'].map(n=>n.padStart(64,'0'));
export const [ALICE,BOB,MEDIA_ALICE,MEDIA_BOB] = secrets.map(s=>KeyService.getPublicKey(s));
const privateKeys = new Map(secrets.map(s=>[KeyService.getPublicKey(s),s]));
export async function getOrCreateIdentityBundle(accountId: string) {
  return getOrCreateAuthenticatedIdentityBundle(accountId,privateKeys.get(accountId)!);
}
export async function selectedBundle(local: Awaited<ReturnType<typeof getOrCreateIdentityBundle>>, entry: {id:string;pubB64:string}) {
  return authorizeLocalBundle(local.bundle.binding.accountId,local.bundle,local.ikSign.priv,[entry],privateKeys.get(local.bundle.binding.accountId)!);
}
