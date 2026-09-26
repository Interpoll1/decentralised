import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Execute actual writer bodies with local doubles, without booting app/network.
// Optional source root also runs these regressions on a pinned before-copy.
function writer(file: string, name: string, globals: Record<string, unknown>) {
  const root = process.env.REACTION_WRITER_SOURCE_ROOT ?? resolve(__dirname, '../src/services');
  const text = readFileSync(resolve(root, file), 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let selected: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(tree) === name) selected = n;
    ts.forEachChild(n, visit);
  }; visit(tree);
  if (!selected) throw new Error('Writer missing');
  let body = selected.getText(tree).replace(/^export /, '').replace(/^(private |public )?static async /, 'async function ');
  body = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`(${body.trim().replace(/;$/, '')})`, globals);
}
function dependencies() {
  const action = { id: 'synthetic-action' };
  const enqueueReaction = vi.fn(async () => ({ id: action.id, status: 'pending' }));
  const publishReaction = vi.fn(() => new Promise(() => {}));
  const g: Record<string, any> = { createPublicAction: async () => action, enqueueReaction, publishReaction,
    setTimeout, Date, console, fetch: publishReaction, config: { relay: { api: 'https://offline.invalid' } },
    gunPut: async () => {}, gunOnce: async () => null, postNode: () => ({}), postVotesNode: () => ({ get: () => ({}) }),
    parseVote: () => null, parseBaselineType: () => null, PostVoteService: { readLegacyVote: async () => null },
    foldVotes: () => ({ upvotes: 1, downvotes: 0, score: 1 }), getUserVote: async () => null,
    getCommentTally: async () => ({ upvotes: 1, downvotes: 0, score: 1 }), commentNode: () => ({}),
    StorageService: { getComment: async () => null, saveComment: async () => {} },
  };
  return { g, enqueueReaction, publishReaction };
}
async function completes(promise: Promise<any>) {
  let timeout: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Writer blocked on remote evidence')), 250); })]); }
  finally { clearTimeout(timeout!); }
}
it('post writer does not wait for unavailable HTTP and reports pending', async () => {
  const { g, enqueueReaction, publishReaction } = dependencies();
  const result = await completes(writer('postVoteService.ts', 'writeVote', g)('post-1', 'actor', 'up'));
  expect(result.delivery).toBe('pending'); expect(enqueueReaction).toHaveBeenCalledOnce(); expect(publishReaction).not.toHaveBeenCalled();
});
it('comment writer queues signed intent without waiting for unavailable HTTP', async () => {
  const { g, enqueueReaction, publishReaction } = dependencies();
  const result = await completes(writer('commentService.ts', 'voteOnComment', g)('comment-1', 'up', 'actor'));
  expect(result.delivery).toBe('pending'); expect(enqueueReaction).toHaveBeenCalledOnce(); expect(publishReaction).not.toHaveBeenCalled();
});
it('poll-content writer queues signed intent without waiting for unavailable HTTP', async () => {
  const { g, enqueueReaction, publishReaction } = dependencies();
  const node = { put: (_: unknown, cb: () => void) => cb() };
  const owner = { gun: {}, getPollPath: () => node, sanitizeForGun: (x: unknown) => x };
  const result = await completes(writer('pollService.ts', 'voteOnPollContent', g).call(owner, 'poll-1', 'up', 'actor', undefined,
    { upvotes: 0, downvotes: 0, previous: null }));
  expect(result.delivery).toBe('pending'); expect(enqueueReaction).toHaveBeenCalledOnce(); expect(publishReaction).not.toHaveBeenCalled();
});
