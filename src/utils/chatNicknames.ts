import { StorageService } from '../services/storageService';
import { cleanNickname, MAX_NICKNAME } from './nicknameText';

/**
 * Custom names for chats ("nicknames"): purely local, per account, per device.
 *
 * They are what YOU call someone. Nothing here is published or sent to the other person, and a
 * nickname always wins over whatever name the network resolves for that user (which can change
 * under you) and over the "User d48db3" fallback.
 */
export { MAX_NICKNAME, cleanNickname };

const key = (me: string) => `chat-nicknames:${me}`;

export async function loadNicknames(me: string): Promise<Record<string, string>> {
  if (!me) return {};
  try {
    const raw = await StorageService.getMetadata(key(me));
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || typeof raw.names !== 'object' || !raw.names) return {};
    const out: Record<string, string> = {};
    for (const [id, name] of Object.entries(raw.names as Record<string, unknown>)) {
      const clean = cleanNickname(name);
      if (clean) out[id] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Set (or, with an empty name, remove) one nickname. Returns the full updated map. */
export async function saveNickname(me: string, peerId: string, nickname: string): Promise<Record<string, string>> {
  if (!me || !peerId) return {};
  const all = await loadNicknames(me);
  const clean = cleanNickname(nickname);
  if (clean) all[peerId] = clean; else delete all[peerId];
  await StorageService.setMetadata(key(me), { v: 1, names: all });
  return all;
}

export async function getNickname(me: string, peerId: string): Promise<string> {
  return (await loadNicknames(me))[peerId] ?? '';
}