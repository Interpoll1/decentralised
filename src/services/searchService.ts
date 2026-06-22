// searchService.ts — full-text search over GenosDB.
//
// The former service queried a relay REST endpoint (/api/search) and pushed a
// sealed index to /api/index. GenosDB holds the data locally and syncs it P2P,
// so search is a direct reactive query over `post` and `poll` nodes — no backend,
// no separate index to maintain.
import { db } from './gdbServices'

export interface SearchResult {
  id: string
  type: 'post' | 'poll' | 'community'
  title: string
  content: string
  author: string
  community: string
  created_at: number
  relevance?: number
}

export interface SearchOptions {
  type?: 'post' | 'poll' | 'community'
  community?: string
  limit?: number
  offset?: number
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
}

class SearchService {
  // apiUrl kept for constructor compatibility; unused (search is local).
  constructor(_apiUrl: string = '') {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    if (!query || query.length < 2) throw new Error('Query must be at least 2 characters')
    const results: SearchResult[] = []
    const want = (t: SearchOptions['type']) => !options.type || options.type === t

    // GenosDB native text search (`$text`) — the query filters server-side instead
    // of fetching every node and matching in JS.
    if (want('post')) {
      const q: Record<string, unknown> = { type: 'post', $text: query }
      if (options.community) q.communityId = options.community
      const { results: posts } = await db.map({ query: q })
      for (const node of posts) {
        const p: any = node.value
        results.push({ id: p.id, type: 'post', title: p.title || '', content: p.content || '', author: p.authorName || '', community: p.communityId || '', created_at: p.createdAt || 0 })
      }
    }

    if (want('poll')) {
      const q: Record<string, unknown> = { type: 'poll', $text: query }
      if (options.community) q.communityId = options.community
      const { results: polls } = await db.map({ query: q })
      for (const node of polls) {
        const p: any = node.value
        results.push({ id: p.id, type: 'poll', title: p.question || '', content: p.description || '', author: p.authorName || '', community: p.communityId || '', created_at: p.createdAt || 0 })
      }
    }

    // Communities — match by name/description (skipped when scoped to one community).
    if (want('community') && !options.community) {
      const { results: communities } = await db.map({ query: { type: 'community', $text: query } })
      for (const node of communities) {
        const c: any = node.value
        results.push({ id: c.id, type: 'community', title: c.displayName || c.name || '', content: c.description || '', author: '', community: c.id || '', created_at: c.createdAt || 0 })
      }
    }

    results.sort((a, b) => b.created_at - a.created_at)
    const offset = options.offset || 0
    const limit = options.limit ?? results.length
    return { results: results.slice(offset, offset + limit), total: results.length }
  }

  async searchPaginated(query: string, page = 1, perPage = 20, options: SearchOptions = {}): Promise<SearchResponse> {
    return this.search(query, { ...options, limit: perPage, offset: (page - 1) * perPage })
  }

  clearCache(): void {}

  /** No-op — GenosDB search queries live data, so there is no separate index to write. */
  async indexContent(_type: 'post' | 'poll', _id: string, _data: any): Promise<{ ok: boolean }> {
    return { ok: true }
  }

  getTotalPages(total: number, perPage = 20): number {
    return Math.ceil(total / perPage)
  }

  hasNextPage(currentPage: number, total: number, perPage = 20): boolean {
    return currentPage < this.getTotalPages(total, perPage)
  }

  hasPreviousPage(currentPage: number): boolean {
    return currentPage > 1
  }
}

export default SearchService
