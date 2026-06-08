// searchService.ts — full-text search over GenosDB.
//
// The former service queried a relay REST endpoint (/api/search) and pushed a
// sealed index to /api/index. GenosDB holds the data locally and syncs it P2P,
// so search is a direct reactive query over `post` and `poll` nodes — no backend,
// no separate index to maintain.
import { db } from './gdbServices'

export interface SearchResult {
  id: string
  type: 'post' | 'poll'
  title: string
  content: string
  author: string
  community: string
  created_at: number
  relevance?: number
}

export interface SearchOptions {
  type?: 'post' | 'poll'
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
    const q = query.toLowerCase()
    const results: SearchResult[] = []

    if (!options.type || options.type === 'post') {
      const { results: posts } = await db.map({ query: { type: 'post' } })
      for (const node of posts) {
        const p: any = node.value
        if (options.community && p.communityId !== options.community) continue
        if ((p.title || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q)) {
          results.push({ id: p.id, type: 'post', title: p.title || '', content: p.content || '', author: p.authorName || '', community: p.communityId || '', created_at: p.createdAt || 0 })
        }
      }
    }

    if (!options.type || options.type === 'poll') {
      const { results: polls } = await db.map({ query: { type: 'poll' } })
      for (const node of polls) {
        const p: any = node.value
        if (options.community && p.communityId !== options.community) continue
        if ((p.question || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)) {
          results.push({ id: p.id, type: 'poll', title: p.question || '', content: p.description || '', author: p.authorName || '', community: p.communityId || '', created_at: p.createdAt || 0 })
        }
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
