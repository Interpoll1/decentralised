import { protectedReactionSoul, actionForSoul } from './engagement.js';

export function isReactionIndexLink(put, namespace) {
  const parts = String(put?.['#']).split('/');
  if (parts[0] !== namespace || !['postVotes', 'commentVotes'].includes(parts[1])) return false;
  const field = put['.'], value = put[':'];
  const valid = parts.length === 2 ? /^[a-zA-Z0-9_.:-]{1,128}$/.test(field)
    : parts.length === 3 && /^[a-zA-Z0-9_.:-]{1,128}$/.test(parts[2]) && /^[0-9a-f]{64}$/.test(field);
  return valid && value && typeof value === 'object' && Object.keys(value).length === 1
    && value['#'] === `${put['#']}/${field}`;
}

// Install before universe/HAM, not in the late storage hook. Validate the whole
// graph first; a mutable Gun timestamp must never grant write authority.
export function installEngagementFirewall(Gun, { namespace, accept }) {
  Gun.on('opt', function(root) {
    if (!root.engagementV1) {
      root.engagementV1 = true;
      const admitted = new WeakSet();
      function gate(msg) {
        const graph = msg?.put;
        if (!graph || admitted.has(msg) || !Object.keys(graph).some(protectedReactionSoul)) { this.to.next(msg); return; }
        const reject = () => root.on('in', { '@': msg['#'], err: 'AUTHENTICATED_REACTION_V1_REQUIRED' });
        const actions = [];
        let count = 0;
        for (const [soul, node] of Object.entries(graph)) {
          if (!protectedReactionSoul(soul)) continue;
          if (++count > 64 || !node || typeof node !== 'object') { reject(); return; }
          for (const [field, value] of Object.entries(node)) {
            if (field === '_') continue;
            if (++count > 128) { reject(); return; }
            if (isReactionIndexLink({ '#': soul, '.': field, ':': value }, namespace)) continue;
            const a = field === 'envelope' && actionForSoul(soul, value, namespace, { fresh: false });
            if (!a || actions.length >= 32) { reject(); return; }
            actions.push([a, soul]);
          }
        }
        const next = this.to;
        (async () => {
          for (const [a, soul] of actions) {
            const result = await accept(a);
            if (!['accepted', 'duplicate'].includes(result.status)) throw new Error('REJECTED');
            if (!Number.isFinite(result.gunState)) throw new Error('MISSING_DURABLE_GUN_STATE');
            graph[soul]._ = { '#': soul, '>': { envelope: result.gunState } };
          }
          admitted.add(msg); next.next(msg);
        })().catch(reject);
      }
      root.on('in', gate);
      root.on('out', gate);
    }
    this.to.next(root);
  });
}
