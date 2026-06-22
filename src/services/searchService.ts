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

  /**
   * Match nodes of `type` where ANY of `fields` contains the (already escaped)
   * query. Uses GenosDB's `$regex` per field — case-insensitive in the engine —
   * and de-dupes by id. (`$text` is documented but not implemented in this
   * engine version; `$regex` on a field is, and it filters in the query.)
   */
  private async searchType(type: string, fields: string[], rx: string, community?: string): Promise<any[]> {
    const seen = new Set<string>()
    const out: any[] = []
    for (const field of fields) {
      const q: Record<string, unknown> = { type, [field]: { $regex: rx } }
      if (community) q.communityId = community
      const { results } = await db.map({ query: q })
      for (const node of results) {
        const v: any = node.value
        if (v?.id && !seen.has(v.id)) { seen.add(v.id); out.push(v) }
      }
    }
    return out
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    if (!query || query.length < 2) throw new Error('Query must be at least 2 characters')
    // Escape regex specials; GenosDB applies the `i` flag, so search is case-insensitive.
    const rx = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const results: SearchResult[] = []
    const want = (t: SearchOptions['type']) => !options.type || options.type === t

    if (want('post')) {
      for (const p of await this.searchType('post', ['title', 'content'], rx, options.community)) {
        results.push({ id: p.id, type: 'post', title: p.title || '', content: p.content || '', author: p.authorName || '', community: p.communityId || '', created_at: p.createdAt || 0 })
      }
    }

    if (want('poll')) {
      for (const p of await this.searchType('poll', ['question', 'description'], rx, options.community)) {
        results.push({ id: p.id, type: 'poll', title: p.question || '', content: p.description || '', author: p.authorName || '', community: p.communityId || '', created_at: p.createdAt || 0 })
      }
    }

    // Communities — match by name/description (skipped when scoped to one community).
    if (want('community') && !options.community) {
      for (const c of await this.searchType('community', ['displayName', 'name', 'description'], rx)) {
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
