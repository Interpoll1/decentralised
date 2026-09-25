import { StorageService } from './storageService';
import { GunService } from './gunService';
import { GUN_NAMESPACE } from '../utils/namespace';
import config from '../config';
import { gunPut } from '../utils/gunAsync';
import { signAction, readAction, type PublicAction } from '../../shared-validation/engagement.js';

export async function createPublicAction(
  actor: string, kind: 'reaction' | 'view', targetType: PublicAction['targetType'],
  targetId: string, value: PublicAction['value'], createdAt = Date.now(),
): Promise<PublicAction> {
  // Signing a public observation must never generate/replace an account key.
  const stored = await StorageService.getMetadata('nostr-keypair');
  if (!stored?.privateKey || stored.publicKey !== actor) throw new Error('ACTION_IDENTITY_UNAVAILABLE');
  const key = stored.privateKey;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  return signAction({ namespace: GUN_NAMESPACE, actor, kind, targetType, targetId, value, createdAt, nonce }, key);
}

// Display compatibility only. Legacy records are never detector observations.
// Once an envelope exists, invalid authentication cannot fall back to raw type.
export function readReaction(raw: any, actor: string, targetType: 'post' | 'comment', targetId: string) {
  if (!raw || typeof raw !== 'object') return null;
  if ('envelope' in raw) {
    const a = readAction(raw.envelope, { namespace: GUN_NAMESPACE, actor, targetType, targetId, fresh: false });
    return a?.kind === 'reaction' ? a.value as 'up' | 'down' | 'none' : null;
  }
  return ['up', 'down', 'none'].includes(raw.type) ? raw.type as 'up' | 'down' | 'none' : null;
}

export async function publishReaction(action: PublicAction): Promise<void> {
  const body = JSON.stringify({ action });
  const node = GunService.getGun().get(action.targetType === 'comment' ? 'commentVotes' : 'postVotes')
    .get(action.targetId).get(action.actor);
  // Peer sync is advisory; a local Gun ACK is not durable relay acceptance.
  void gunPut(node, { envelope: JSON.stringify(action) }).catch(() => {});
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${config.relay.api}/api/content-vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: AbortSignal.timeout(8000),
      });
      const result = await response.json();
      if (response.ok && result.id === action.id && ['accepted', 'duplicate'].includes(result.status)) return;
      if (response.status < 500) throw new Error('ENGAGEMENT_REJECTED');
    } catch (error) {
      if ((error as Error).message === 'ENGAGEMENT_REJECTED' || attempt === 1) throw error;
    }
  }
  throw new Error('ENGAGEMENT_STORAGE_UNAVAILABLE');
}
