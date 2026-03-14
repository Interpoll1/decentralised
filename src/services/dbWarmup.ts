// src/services/dbWarmup.ts
// Strategy:
//   1. INSTANT  — Gun localStorage cache (< 5ms)
//   2. BACKGROUND — /api/polls endpoint for options (1.5s, non-blocking)

import { isVersionEnabled } from '../utils/dataVersionSettings'
import { GUN_NAMESPACE } from './gunService'
import config from '../config'

function getGunRelayBase(): string {
  return config.relay.gun.replace(/\/gun$/, '')
}

const NUXT_API = 'https://interpoll.endless.sbs'

let warmupDone = false

function readGunLocalCache() {
  const posts: any[]       = []
  const polls: any[]       = []
  const communities: any[] = []
  const pollOptions: Record<string, any[]> = {}

  try {
    const raw = localStorage.getItem('gun/')
    if (!raw) return { posts, polls, communities, pollOptions }
    const graph = JSON.parse(raw)
    if (!graph || typeof graph !== 'object') return { posts, polls, communities, pollOptions }

    // First pass: collect poll options keyed by bare poll-xxx id
    for (const [soul, node] of Object.entries(graph)) {
      if (!node || typeof node !== 'object') continue
      const d = node as any
      if (d.text === undefined || !d.id) continue
      const optMatch = soul.match(/\/(poll-[^/]+)\/options\/\d+$/)
      if (optMatch) {
        const pollId = optMatch[1]
        if (!pollOptions[pollId]) pollOptions[pollId] = []
        if (!pollOptions[pollId].find((o: any) => o.id === d.id)) {
          pollOptions[pollId].push({ id: d.id, text: d.text, votes: d.votes || 0, voters: [] })
        }
      }
    }

    // Second pass: communities, posts, polls
    for (const [soul, node] of Object.entries(graph)) {
      if (!node || typeof node !== 'object') continue
      const d = node as any

      if (d.displayName && d.id && /c-[^/]+$/.test(soul) && !soul.includes('/posts/') && !soul.includes('/polls/')) {
        communities.push(d); continue
      }

      if (d.title && d.communityId && d.id && soul.includes('post-') && !soul.includes('/options')) {
        const isV1 = /^(communities\/[^/]+\/posts\/|posts\/)/.test(soul) && !/^v2\//.test(soul)
        const isV2 = /^v2\//.test(soul)
        if (isV1 || isV2) posts.push({ ...d, _isV1: isV1 && !isV2 })
        continue
      }

      if (d.question && d.communityId && d.id && soul.includes('poll-') && !soul.includes('/options')) {
        const isV1 = /^(communities\/[^/]+\/polls\/|polls\/)/.test(soul) && !/^v2\//.test(soul)
        const isV2 = /^v2\//.test(soul)
        if (isV1 || isV2) polls.push({ ...d, _isV1: isV1 && !isV2 })
      }
    }
  } catch (err) {
    console.warn('Gun cache read error:', err)
  }

  return { posts, polls, communities, pollOptions }
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

    // ── STEP 1: Gun localStorage cache (instant, no network) ─────────────────
    const cache = readGunLocalCache()
    let cPost = 0, cPoll = 0, cComm = 0

    for (const d of cache.communities) {
      if (!d?.id || !d?.displayName) continue
      if (!communityStore.communities.find((c: any) => c.id === d.id)) {
        communityStore.communities.push({
          id: d.id, name: d.name || d.id, displayName: d.displayName,
          description: d.description || '', creatorId: d.creatorId || '',
          memberCount: d.memberCount || 0, postCount: d.postCount || 0,
          createdAt: d.createdAt || Date.now(),
          rules: Array.isArray(d.rules) ? d.rules : [],
        })
        cComm++
      }
    }

    for (const d of cache.posts) {
      if (!d?.id || !d?.title || !d?.communityId) continue
      if (d._isV1 && !isVersionEnabled('v1')) continue
      postStore.injectPost({
        id: d.id, communityId: d.communityId,
        authorId: d.authorId || '', authorName: d.authorName || 'Anonymous',
        title: d.title, content: d.content || '',
        imageIPFS: d.imageIPFS || '', imageThumbnail: d.imageThumbnail || '',
        createdAt: d.createdAt || Date.now(),
        upvotes: d.upvotes || 0, downvotes: d.downvotes || 0,
        score: d.score || 0, commentCount: d.commentCount || 0,
        dataVersion: d._isV1 ? 'v1' : GUN_NAMESPACE,
      })
      cPost++
    }
    if (cPost > 0) postStore.saveSeenNow()

    // Inject poll shells from cache (options patched in background)
    for (const d of cache.polls) {
      if (!d?.id || !d?.question || !d?.communityId) continue
      if (d._isV1 && !isVersionEnabled('v1')) continue
      const options    = cache.pollOptions[d.id] || []
      const totalVotes = options.reduce((s: number, o: any) => s + (o.votes || 0), 0)
      pollStore.injectPoll({
        id: d.id, communityId: d.communityId,
        authorId: d.authorId || '', authorName: d.authorName || 'Anonymous',
        question: d.question, description: d.description || '',
        options, createdAt: d.createdAt || Date.now(),
        expiresAt: d.expiresAt || Date.now() + 86400000,
        allowMultipleChoices: !!d.allowMultipleChoices,
        showResultsBeforeVoting: !!d.showResultsBeforeVoting,
        requireLogin: !!d.requireLogin, isPrivate: !!d.isPrivate,
        totalVotes, isExpired: Date.now() > (d.expiresAt || 0),
      })
      cPoll++
    }
    if (cPoll > 0) pollStore.saveSeenNow()

    console.log(`⚡ Cache: ${cComm} communities, ${cPost} posts, ${cPoll} polls`)

    // ── STEP 2: Background fetches — all non-blocking ─────────────────────────
    Promise.all([
      fetchPollsWithOptions(pollStore),
      fetchPostsFromRelay(communityStore, postStore),
      fetchCommunitiesFromRelay(communityStore),
    ]).catch(() => {})

  } catch (err) {
    console.warn('⚠️ Warmup failed:', err)
  }
}

// ── Fetch all polls with options in one fast request ──────────────────────────
async function fetchPollsWithOptions(pollStore: any) {
  try {
    const res = await fetch(`${NUXT_API}/api/polls?limit=100`)
    if (!res.ok) return
    const { polls } = await res.json()
    let n = 0
    for (const p of polls || []) {
      if (!p?.id || !p?.question) continue
      const existing = pollStore.pollsMap.get(p.id)
      // Update if missing or has no options
      if (!existing || existing.options.length === 0) {
        pollStore.injectPoll({
          id: p.id, communityId: p.communityId,
          authorId: '', authorName: p.authorName || 'Anonymous',
          question: p.question, description: p.description || '',
          options: p.options || [],
          createdAt: p.createdAt || Date.now(),
          expiresAt: p.expiresAt || Date.now() + 86400000,
          allowMultipleChoices: !!p.allowMultipleChoices,
          showResultsBeforeVoting: !!p.showResultsBeforeVoting,
          requireLogin: false, isPrivate: false,
          totalVotes: p.totalVotes || 0,
          isExpired: !!p.isExpired,
        })
        n++
      }
    }
    if (n > 0) { pollStore.saveSeenNow(); console.log(`🔥 API: patched options for ${n} polls`) }
  } catch (err) {
    console.warn('Poll options fetch failed:', err)
  }
}

// ── Fetch posts from gun relay ────────────────────────────────────────────────
async function fetchPostsFromRelay(communityStore: any, postStore: any) {
  const BASE = getGunRelayBase()
  try {
    const res = await fetch(`${BASE}/db/search?prefix=v2/posts&limit=500`)
    if (!res.ok) return
    const { results } = await res.json()
    let n = 0
    for (const row of results || []) {
      const d = row.data
      if (!d?.id || !d?.title || !d?.communityId || postStore.postsMap.has(d.id)) continue
      postStore.injectPost({
        id: d.id, communityId: d.communityId,
        authorId: d.authorId || '', authorName: d.authorName || 'Anonymous',
        title: d.title, content: d.content || '',
        imageIPFS: d.imageIPFS || '', imageThumbnail: d.imageThumbnail || '',
        createdAt: d.createdAt || Date.now(),
        upvotes: d.upvotes || 0, downvotes: d.downvotes || 0,
        score: d.score || 0, commentCount: d.commentCount || 0,
        dataVersion: GUN_NAMESPACE,
      })
      n++
    }
    if (n > 0) { postStore.saveSeenNow(); console.log(`🔥 Relay: +${n} posts`) }
  } catch {}

  // v1 posts
  if (isVersionEnabled('v1')) {
    try {
      const res = await fetch(`${BASE}/db/search?prefix=posts&limit=500`)
      if (!res.ok) return
      const { results } = await res.json()
      for (const row of results || []) {
        const d = row.data
        if (!d?.id || !d?.title || !d?.communityId || postStore.postsMap.has(d.id)) continue
        postStore.injectPost({
          id: d.id, communityId: d.communityId,
          authorId: d.authorId || '', authorName: d.authorName || 'Anonymous',
          title: d.title, content: d.content || '',
          imageIPFS: d.imageIPFS || '', imageThumbnail: d.imageThumbnail || '',
          createdAt: d.createdAt || Date.now(),
          upvotes: d.upvotes || 0, downvotes: d.downvotes || 0,
          score: d.score || 0, commentCount: d.commentCount || 0,
          dataVersion: 'v1',
        })
      }
      postStore.saveSeenNow()
    } catch {}
  }
}

// ── Fetch communities from gun relay ──────────────────────────────────────────
async function fetchCommunitiesFromRelay(communityStore: any) {
  const BASE = getGunRelayBase()
  try {
    const res = await fetch(`${BASE}/db/search?prefix=v2/communities&limit=200`)
    if (!res.ok) return
    const { results } = await res.json()
    let n = 0
    for (const row of results || []) {
      const d = row.data
      if (!d?.id || !d?.displayName) continue
      if (!communityStore.communities.find((c: any) => c.id === d.id)) {
        communityStore.communities.push({
          id: d.id, name: d.name || d.id, displayName: d.displayName,
          description: d.description || '', creatorId: d.creatorId || '',
          memberCount: d.memberCount || 0, postCount: d.postCount || 0,
          createdAt: d.createdAt || Date.now(),
          rules: Array.isArray(d.rules) ? d.rules : [],
        })
        n++
      }
    }
    if (n > 0) console.log(`🔥 Relay: +${n} communities`)
  } catch {}
}