// src/services/dbWarmup.ts
// Strategy:
//   1. INSTANT   — Nuxt API for posts + polls (fast, structured, always fresh)
//   2. LIVE      — Gun subscriptions (real-time updates only, not initial load)
//
// Key changes from previous version:
//   - Gun localStorage cache REMOVED — it was the source of stale-data flash
//   - API is now primary; Gun is live-updates-only
//   - postsMap/pollsMap overwrite guard flipped: API always wins over stale cache
//   - stale-while-revalidate Cache-Control on all fetches
//   - Communities fetched in parallel with posts+polls (not blocking)

import { isVersionEnabled } from '../utils/dataVersionSettings'
import { GUN_NAMESPACE } from './gunService'

const NUXT_API = 'https://interpoll.endless.sbs'

let warmupDone = false

// ── Shared fetch with stale-while-revalidate ──────────────────────────────────
async function apiFetch(path: string): Promise<any> {
  const res = await fetch(`${NUXT_API}${path}`, {
    headers: { 'Cache-Control': 'stale-while-revalidate=30' },
  })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

export async function warmupFromDB(): Promise<void> {
  if (warmupDone) return
  warmupDone = true

  try {
    const { useCommunityStore } = await import('../stores/communityStore')
    const { usePostStore }      = await import('../stores/postStore')
    const { usePollStore }      = await import('../stores/pollStore')

    const communityStore = useCommunityStore()
    const postStore      = usePostStore()
    const pollStore      = usePollStore()

    // ── Fetch everything in parallel — no sequential blocking ────────────────
    const [postsResult, pollsResult, communitiesResult] = await Promise.allSettled([
      apiFetch('/api/posts?limit=500'),
      apiFetch('/api/polls?limit=100'),
      apiFetch('/api/communities'),
    ])

    // ── Communities ───────────────────────────────────────────────────────────
    if (communitiesResult.status === 'fulfilled') {
      const { communities } = communitiesResult.value
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
      }
    }

    // ── Posts — API always overwrites stale Gun cache ─────────────────────────
    if (postsResult.status === 'fulfilled') {
      const { posts } = postsResult.value
      let n = 0
      for (const d of posts || []) {
        if (!d?.id || !d?.title || !d?.communityId) continue
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
      if (n > 0) { postStore.saveSeenNow(); console.log(`⚡ API: ${n} posts`) }
    } else {
      console.warn('Posts fetch failed:', postsResult.reason)
    }

    // ── Polls — always overwrite, attach options inline ───────────────────────
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
      if (n > 0) { pollStore.saveSeenNow(); console.log(`⚡ API: ${n} polls`) }
    } else {
      console.warn('Polls fetch failed:', pollsResult.reason)
    }

    // ── v1 posts from Gun relay (only if flag enabled) ────────────────────────
    if (isVersionEnabled('v1')) {
      fetchV1Posts(postStore).catch(() => {})
    }

  } catch (err) {
    console.warn('⚠️ Warmup failed:', err)
  }
}

// ── v1 legacy posts — Gun relay search, non-blocking ─────────────────────────
async function fetchV1Posts(postStore: any) {
  try {
    const { default: config } = await import('../config')
    const base = config.relay.gun.replace(/\/gun$/, '')
    const res = await fetch(`${base}/db/search?prefix=posts&limit=500`)
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