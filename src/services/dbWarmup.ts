// src/services/dbWarmup.ts
// Fetches all data from MySQL REST API and injects directly into Pinia stores.
// Uses injectPost/injectPoll so seen-IDs are tracked and the "new posts" banner
// never fires for content the user has already loaded before.

const GUN_RELAY_URL = import.meta.env.VITE_GUN_URL?.replace('/gun', '')
  || 'https://interpoll2.onrender.com';

let warmupDone = false;

export async function warmupFromDB(): Promise<void> {
  if (warmupDone) return;
  warmupDone = true;

  try {
    const { useCommunityStore } = await import('../stores/communityStore');
    const { usePostStore }      = await import('../stores/postStore');
    const { usePollStore }      = await import('../stores/pollStore');

    const communityStore = useCommunityStore();
    const postStore      = usePostStore();
    const pollStore      = usePollStore();

    // ── Communities ──────────────────────────────────────────────────────────
    const commRes = await fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/communities&limit=200`);
    if (commRes.ok) {
      const { results } = await commRes.json();
      let count = 0;
      for (const row of results || []) {
        const d = row.data;
        if (!d?.id || !d?.displayName) continue;
        const exists = communityStore.communities.find((c: any) => c.id === d.id);
        if (!exists) {
          communityStore.communities.push({
            id:          d.id,
            name:        d.name        || d.id,
            displayName: d.displayName,
            description: d.description || '',
            creatorId:   d.creatorId   || '',
            memberCount: d.memberCount || 0,
            postCount:   d.postCount   || 0,
            createdAt:   d.createdAt   || Date.now(),
            rules:       Array.isArray(d.rules) ? d.rules : [],
          });
          count++;
        }
      }
      if (count > 0) console.log(`🔥 DB warmup: injected ${count} communities`);
    }

    // ── Posts ────────────────────────────────────────────────────────────────
    const postsRes = await fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/posts&limit=500`);
    if (postsRes.ok) {
      const { results } = await postsRes.json();
      let count = 0;
      for (const row of results || []) {
        const d = row.data;
        if (!d?.id || !d?.title || !d?.communityId) continue;
        // injectPost marks the ID as seen so it won't trigger the banner on refresh
        postStore.injectPost({
          id:             d.id,
          communityId:    d.communityId,
          authorId:       d.authorId     || '',
          authorName:     d.authorName   || 'Anonymous',
          title:          d.title,
          content:        d.content      || '',
          imageIPFS:      d.imageIPFS    || '',
          imageThumbnail: d.imageThumbnail || '',
          createdAt:      d.createdAt    || Date.now(),
          upvotes:        d.upvotes      || 0,
          downvotes:      d.downvotes    || 0,
          score:          d.score        || 0,
          commentCount:   d.commentCount || 0,
        });
        count++;
      }
      // Persist all seen IDs in one go
      postStore.saveSeenNow();
      if (count > 0) console.log(`🔥 DB warmup: injected ${count} posts`);
    }

    // ── Polls ────────────────────────────────────────────────────────────────
    const pollsRes = await fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/polls&limit=300`);
    if (pollsRes.ok) {
      const { results } = await pollsRes.json();

      const pollShells:  Record<string, any>    = {};
      const pollOptions: Record<string, any[]>  = {};

      for (const row of results || []) {
        const d    = row.data;
        const soul = row.soul as string;

        if (d?.id && d?.question && d?.communityId) {
          pollShells[d.id] = d;
          continue;
        }

        const optMatch = soul.match(/\/(poll-[^/]+)\/options\/\d+$/);
        if (optMatch && d?.id && d?.text !== undefined) {
          const pollId = optMatch[1];
          if (!pollOptions[pollId]) pollOptions[pollId] = [];
          pollOptions[pollId].push({ id: d.id, text: d.text, votes: d.votes || 0, voters: [] });
        }
      }

      let count = 0;
      for (const [pollId, shell] of Object.entries(pollShells)) {
        const options    = pollOptions[pollId] || [];
        const totalVotes = options.reduce((s: number, o: any) => s + (o.votes || 0), 0);

        // injectPoll marks the ID as seen
        pollStore.injectPoll({
          id:                      shell.id,
          communityId:             shell.communityId,
          authorId:                shell.authorId    || '',
          authorName:              shell.authorName  || 'Anonymous',
          question:                shell.question,
          description:             shell.description || '',
          options,
          createdAt:               shell.createdAt   || Date.now(),
          expiresAt:               shell.expiresAt   || Date.now() + 86400000,
          allowMultipleChoices:    !!shell.allowMultipleChoices,
          showResultsBeforeVoting: !!shell.showResultsBeforeVoting,
          requireLogin:            !!shell.requireLogin,
          isPrivate:               !!shell.isPrivate,
          totalVotes,
          isExpired:               Date.now() > (shell.expiresAt || 0),
        });
        count++;
      }
      pollStore.saveSeenNow();
      if (count > 0) console.log(`🔥 DB warmup: injected ${count} polls`);
    }

    // Warm Gun graph in background for live updates (fire and forget)
    warmupGunGraph();

  } catch (err) {
    console.warn('⚠️  DB warmup failed (non-critical):', err);
  }
}

async function warmupGunGraph(): Promise<void> {
  try {
    const { GunService } = await import('./gunService');
    const gun = GunService.getGun();

    const [postsRes, pollsRes, commRes] = await Promise.all([
      fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/posts&limit=500`),
      fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/polls&limit=300`),
      fetch(`${GUN_RELAY_URL}/db/search?prefix=v2/communities&limit=200`),
    ]);

    if (commRes.ok) {
      const { results } = await commRes.json();
      for (const row of results || []) {
        const d = row.data;
        if (!d?.id || !d?.displayName) continue;
        gun.get('communities').get(d.id).put(d);
        gun.get('communities').put({ [d.id]: { '#': `v2/communities/${d.id}` } });
      }
    }
    if (postsRes.ok) {
      const { results } = await postsRes.json();
      for (const row of results || []) {
        const d = row.data;
        if (!d?.id || !d?.title || !d?.communityId) continue;
        gun.get('posts').get(d.id).put(d);
        gun.get('communities').get(d.communityId).get('posts').get(d.id).put(d);
        gun.get('communities').get(d.communityId).get('posts')
          .put({ [d.id]: { '#': `v2/communities/${d.communityId}/posts/${d.id}` } });
      }
    }
    if (pollsRes.ok) {
      const { results } = await pollsRes.json();
      for (const row of results || []) {
        const d = row.data;
        if (!d?.id || !d?.question || !d?.communityId) continue;
        gun.get('polls').get(d.id).put(d);
        gun.get('communities').get(d.communityId).get('polls').get(d.id).put(d);
        gun.get('communities').get(d.communityId).get('polls')
          .put({ [d.id]: { '#': `v2/communities/${d.communityId}/polls/${d.id}` } });
      }
    }
  } catch { /* non-critical */ }
}