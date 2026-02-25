// searchService.ts - Full-Text Search Service for Vue

export interface SearchResult {
  id: string;
  type: 'post' | 'poll';
  title: string;
  content: string;
  author: string;
  community: string;
  created_at: number;
  relevance?: number;
}

export interface SearchOptions {
  type?: 'post' | 'poll';
  community?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

class SearchService {
  private apiUrl: string;
  private cache: Map<string, { data: SearchResponse; timestamp: number }>;
  private cacheTTL: number = 60000; // 1 minute

  constructor(apiUrl: string = '') {
    this.apiUrl = apiUrl;
    this.cache = new Map();
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    if (!query || query.length < 2) {
      throw new Error('Query must be at least 2 characters');
    }

    // Check cache
    const cacheKey = JSON.stringify({ query, ...options });
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    // Build URL
    const params = new URLSearchParams({ q: query });
    if (options.type) params.append('type', options.type);
    if (options.community) params.append('community', options.community);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    try {
      const response = await fetch(`${this.apiUrl}/api/search?${params}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data: SearchResponse = await response.json();
      
      // Cache result
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now(),
      });

      return data;
    } catch (err) {
      console.error('❌ Search error:', err);
      throw err;
    }
  }

  async searchPosts(query: string, options: Omit<SearchOptions, 'type'> = {}): Promise<SearchResponse> {
    return this.search(query, { ...options, type: 'post' });
  }

  async searchPolls(query: string, options: Omit<SearchOptions, 'type'> = {}): Promise<SearchResponse> {
    return this.search(query, { ...options, type: 'poll' });
  }

  async searchInCommunity(
  query: string,
  communitySlug: string,
  options: Omit<SearchOptions, 'community'> = {}
): Promise<SearchResponse> {
    return this.search(query, { ...options, community: communitySlug });
  }

  async searchPage(
    query: string,
    page: number = 1,
    perPage: number = 20,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const offset = (page - 1) * perPage;
    return this.search(query, { ...options, limit: perPage, offset });
  }

  clearCache(): void {
    this.cache.clear();
  }

  async indexContent(type: 'post' | 'poll', id: string, data: any): Promise<{ ok: boolean }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type, id, data }),
      });

      if (!response.ok) {
        throw new Error(`Indexing failed: ${response.statusText}`);
      }

      // Clear cache when new content is indexed
      this.clearCache();
      
      return await response.json();
    } catch (err) {
      console.error('❌ Indexing error:', err);
      throw err;
    }
  }

  /**
   * Get total pages for pagination
   */
  getTotalPages(total: number, perPage: number = 20): number {
    return Math.ceil(total / perPage);
  }

  /**
   * Check if there's a next page
   */
  hasNextPage(currentPage: number, total: number, perPage: number = 20): boolean {
    return currentPage < this.getTotalPages(total, perPage);
  }

  /**
   * Check if there's a previous page
   */
  hasPreviousPage(currentPage: number): boolean {
    return currentPage > 1;
  }
}

export default SearchService;
