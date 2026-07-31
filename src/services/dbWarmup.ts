// src/services/dbWarmup.ts
// Strategy:
//   1. INSTANT   — API warmup for active namespace feeds
//   2. LIVE      — Gun subscriptions (real-time updates only, not initial load)
//
// Key changes from previous version:
//   - Gun localStorage cache REMOVED — it was the source of stale-data flash
//   - API warmup is namespace-aware and only hydrates entries matching active namespace
//   - stale-while-revalidate Cache-Control on all fetches
//   - communities API warmup is enabled; rows are still validated before hydration

import { isVersionEnabled } from '../utils/dataVersionSettings'
import { GUN_NAMESPACE } from './gunService'
import config from '../config'

const WARMUP_POST_LIMIT = 50
const WARMUP_POLL_LIMIT = 50
const WARMUP_V1_POST_LIMIT = 50
const WARMUP_DEBUG = localStorage.getItem('interpoll_warmup_debug') === 'true'

function getApiBase(): string {
  return config.relay.api
}

function getNamespaceVersion(namespace: string): number {
  const parsed = Number.parseInt(namespace.replace(/^v/i, ''), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

let warmupDone = false

function warmupLog(label: string, data?: Record<string, unknown>) {
  if (!WARMUP_DEBUG) return
  if (data) console.log(`⚡ ${label}`, data)
  else console.log(`⚡ ${label}`)
}

// ── Shared fetch with stale-while-revalidate ──────────────────────────────────
async function apiFetch(path: string): Promise<any> {
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { 'Cache-Control': 'stale-while-revalidate=30' },
  })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

export async function warmupFromDB(): Promise<void> {
  if (warmupDone) return
  warmupDone = true
  const startedAt = Date.now()
  warmupLog('Warmup start', {
    apiBase: getApiBase(),
    postLimit: WARMUP_POST_LIMIT,
    pollLimit: WARMUP_POLL_LIMIT,
  })

  try {
    const { useCommunityStore } = await import('../stores/communityStore')
    const { usePostStore }      = await import('../stores/postStore')
    const { usePollStore }      = await import('../stores/pollStore')

    const communityStore = useCommunityStore()
    const postStore      = usePostStore()
    const pollStore      = usePollStore()

    // Eradicate legacy posts when running v3+: remove any cached posts whose
    // dataVersion does not match the active namespace to avoid importing v2.
    try {
      if (getNamespaceVersion(GUN_NAMESPACE) >= 3 && typeof postStore.purgeLegacyPosts === 'function') {
        const removed = await postStore.purgeLegacyPosts();
        if (removed > 0) warmupLog('Purged legacy posts', { removed });
      }
    } catch (err) {
      warmupLog('Purge legacy posts failed', { err: String(err) });
    }

    // Warm active namespace feed data; per-row version checks below still reject mismatches.
    const shouldWarmApiFeeds = getNamespaceVersion(GUN_NAMESPACE) <= 3
    const shouldWarmApiCommunities = shouldWarmApiFeeds

    // ── Fetch everything in parallel — no sequential blocking ────────────────
    const [postsResult, pollsResult, communitiesResult] = await Promise.allSettled([
      shouldWarmApiFeeds
        ? apiFetch(`/api/posts?limit=${WARMUP_POST_LIMIT}`)
        : Promise.resolve({ posts: [] }),
      shouldWarmApiFeeds
        ? apiFetch(`/api/polls?limit=${WARMUP_POLL_LIMIT}`)
        : Promise.resolve({ polls: [] }),
      shouldWarmApiCommunities
        ? apiFetch('/api/communities')
        : Promise.resolve({ communities: [] }),
    ])

    // ── Communities ───────────────────────────────────────────────────────────
    if (communitiesResult.status === 'fulfilled') {
      const { communities } = communitiesResult.value
      let communityCount = 0
      for (const d of communities || []) {
        if (!d?.id || !d?.displayName) continue
        const existing = communityStore.communities.find((c: any) => c.id === d.id)
        if (existing) {
          // Always overwrite with fresh API data
          Object.assign(existing, {
            name:        d.name        || d.id,
            displayName: d.displayName,
            description: d.description || '',
            memberCount: d.memberCount || 0,
            postCount:   d.postCount   || 0,
          })
        } else {
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
          })
        }
        communityCount++
      }
      warmupLog('Warmup communities', { count: communityCount })
      if (!shouldWarmApiCommunities) warmupLog('API communities warmup skipped for clean-slate namespace')
    } else {
      console.warn('Communities fetch failed:', communitiesResult.reason)
    }

    // ── Posts — v2 API warmup only; v3+ stays Gun-namespace-only ─────────────
    if (postsResult.status === 'fulfilled') {
      const { posts } = postsResult.value
      let n = 0
      for (const d of posts || []) {
        if (!d?.id || !d?.title || !d?.communityId) continue
        // Skip posts from other namespace versions (avoid importing v2 posts into v3 clients)
        const postDataVersion = typeof d.dataVersion === 'string' ? d.dataVersion : null
        const namespaceVersion = getNamespaceVersion(GUN_NAMESPACE)
        if (postDataVersion && postDataVersion !== GUN_NAMESPACE) continue
        // If running v3+ and the post lacks dataVersion, be conservative and skip it
        if (!postDataVersion && namespaceVersion >= 3) continue

        // Always inject — overwrite stale if present
        postStore.injectPost({
          id:            d.id,
          communityId:   d.communityId,
          authorId:      d.authorId      || '',
          authorName:    d.authorName    || 'Anonymous',
          title:         d.title,
          content:       d.content       || '',
          imageIPFS:     d.imageIPFS     || '',
          imageThumbnail: d.imageThumbnail || '',
          createdAt:     d.createdAt     || Date.now(),
          upvotes:       d.upvotes       || 0,
          downvotes:     d.downvotes     || 0,
          score:         d.score         || 0,
          commentCount:  d.commentCount  || 0,
          dataVersion:   GUN_NAMESPACE,
        })
        n++
      }
      if (n > 0) { postStore.saveSeenNow(); warmupLog(`API: ${n} posts`) }
      if (!shouldWarmApiFeeds) warmupLog('API posts warmup skipped for clean-slate namespace')
      warmupLog('Warmup posts complete', {
        fetched: n,
        storePosts: postStore.postsMap.size,
      })
    } else {
      console.warn('Posts fetch failed:', postsResult.reason)
    }

    // ── Polls — v2 API warmup only; v3+ stays Gun-namespace-only ─────────────
    if (pollsResult.status === 'fulfilled') {
      const { polls } = pollsResult.value
      let n = 0
      for (const p of polls || []) {
        if (!p?.id || !p?.question) continue
        // Always inject — never skip based on existing entry
        pollStore.injectPoll({
          id:                    p.id,
          communityId:           p.communityId,
          authorId:              p.authorId      || '',
          authorName:            p.authorName    || 'Anonymous',
          question:              p.question,
          description:           p.description   || '',
          options:               p.options        || [],
          createdAt:             p.createdAt      || Date.now(),
          expiresAt:             p.expiresAt      || Date.now() + 86400000,
          allowMultipleChoices:  !!p.allowMultipleChoices,
          showResultsBeforeVoting: !!p.showResultsBeforeVoting,
          requireLogin:          !!p.requireLogin,
          isPrivate:             !!p.isPrivate,
          totalVotes:            p.totalVotes     || 0,
          isExpired:             !!p.isExpired,
        })
        n++
      }
      if (n > 0) { pollStore.saveSeenNow(); warmupLog(`API: ${n} polls`) }
      if (!shouldWarmApiFeeds) warmupLog('API polls warmup skipped for clean-slate namespace')
      warmupLog('Warmup polls complete', {
        fetched: n,
        storePolls: pollStore.pollsMap.size,
      })
    } else {
      console.warn('Polls fetch failed:', pollsResult.reason)
    }

    // ── v1 posts from Gun relay (only if flag enabled) ────────────────────────
    if (isVersionEnabled('v1')) {
      fetchV1Posts(postStore).catch(() => {})
    }

    warmupLog('Warmup done', {
      durationMs: Date.now() - startedAt,
      postsInStore: postStore.postsMap.size,
      pollsInStore: pollStore.pollsMap.size,
      communitiesInStore: communityStore.communities.length,
    })

  } catch (err) {
    console.warn('⚠️ Warmup failed:', err)
  }
}

// ── v1 legacy posts — Gun relay search, non-blocking ─────────────────────────
async function fetchV1Posts(postStore: any) {
  try {
    const { default: config } = await import('../config')
    const base = config.relay.gun.replace(/\/gun$/, '')
    const res = await fetch(`${base}/db/search?prefix=posts&limit=${WARMUP_V1_POST_LIMIT}`)
    if (!res.ok) return
    const { results } = await res.json()
    for (const row of results || []) {
      const d = row.data
      if (!d?.id || !d?.title || !d?.communityId) continue
      // Only inject v1 posts not already covered by the main API
      if (!postStore.postsMap.has(d.id)) {
        postStore.injectPost({
          id:            d.id,
          communityId:   d.communityId,
          authorId:      d.authorId    || '',
          authorName:    d.authorName  || 'Anonymous',
          title:         d.title,
          content:       d.content     || '',
          imageIPFS:     d.imageIPFS   || '',
          imageThumbnail: '',
          createdAt:     d.createdAt   || Date.now(),
          upvotes:       d.upvotes     || 0,
          downvotes:     d.downvotes   || 0,
          score:         d.score       || 0,
          commentCount:  d.commentCount || 0,
          dataVersion:   'v1',
        })
      }
    }
    postStore.saveSeenNow()
  } catch (err) {
    console.warn('v1 posts fetch failed:', err)
  }
}
