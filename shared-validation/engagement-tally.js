import { readAction } from './engagement.js';

// Display compatibility is explicitly unverified. Signed rows never fall back
// to sibling raw fields; their actor/target must match the persisted soul.
export function displayedReaction(row, namespace) {
  try {
    const parts = row.soul.split('/');
    if (parts.length !== 4 || parts[0] !== namespace || parts[1] !== 'postVotes') return null;
    const raw = JSON.parse(row.data);
    if (!raw || typeof raw !== 'object') return null;
    if ('envelope' in raw) {
      const a = readAction(raw.envelope, { namespace, actor: parts[3], targetType: 'post', targetId: parts[2], fresh: false });
      return a?.kind === 'reaction' ? { vote: a.value, baselineType: null, evidence: 'signed-action' } : null;
    }
    if (!['up', 'down', 'none'].includes(raw.type)) return null;
    return { vote: raw.type, baselineType: ['up', 'down'].includes(raw.baselineType) ? raw.baselineType : null,
      evidence: 'legacy-unverified' };
  } catch { return null; }
}
