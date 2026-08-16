/**
 * searchService.ts — Offline-first full-text search with Flexsearch
 *
 * Replaces the MySQL-backed /api/search endpoint.
 * Requires: npm install flexsearch @types/flexsearch
 *
 * Architecture:
 *   - Flexsearch Document index in memory (rebuilt from IndexedDB on page load)
 *   - _docStore: Map mirrors the index so persistence is accurate
 *   - New content indexed synchronously when created (zero latency)
 *   - Gun subscription in useSearch.ts auto-indexes arriving peer content
 *   - Falls back to /api/search when local index is empty (fresh install)
 *   - LRU cache avoids redundant Flexsearch runs for the same query within 60s
 */

import FlexSearch from 'flexsearch';
const FlexDocument = FlexSearch.Document ?? (FlexSearch as any).default?.Document ?? (FlexSearch as any).Document;
import config from '../config';
import { StorageService } from './storageService';

// ── Public types (drop-in compatible with original searchService.ts) ──────────

export interface SearchResult {
  id: string;
  type: 'post' | 'poll';
  title: string;
  content: string;
  author: string;
  community: string;
  created_at: number;
  relevance?: number;
  category?: string;
}

export interface SearchOptions {
  type?: 'post' | 'poll';
  community?: string;
  category?: string;   // filter to a specific category (e.g. 'technology')
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  /** 'local' = Flexsearch in browser, 'remote' = server /api/search fallback */
  source: 'local' | 'remote';
}

// ── Internal document shape ───────────────────────────────────────────────────

interface IndexedDoc {
  id: string;
  type: 'post' | 'poll';
  title: string;
  excerpt: string;   // first 300 chars of content/body/description
  author: string;
  community: string;
  created_at: number;
  category: string | null;  // e.g. 'technology', 'politics'
  tags: string;             // space-separated tag string for Flexsearch tokenisation
}

const INDEX_STORE_KEY = 'search-index-docs';
const INDEX_VERSION = 'v2'; // bumped: added category + tags fields to IndexedDoc

// ── Flexsearch index factory ──────────────────────────────────────────────────
// tokenize: 'forward' = prefix matching. Change to 'full' for substring at ~3× memory cost.
function buildFlexIndex(): any {
  return new FlexDocument({
    document: {
      id: 'id',
      index: [
        { field: 'title',   tokenize: 'forward', resolution: 9 },
        { field: 'excerpt', tokenize: 'forward', resolution: 5 },
        { field: 'author',  tokenize: 'forward', resolution: 3 },
        { field: 'tags',    tokenize: 'forward', resolution: 4 },
      ],
      store: ['id', 'type', 'title', 'excerpt', 'author', 'community', 'created_at', 'category', 'tags'],
    },
  });
}

// ── LRU cache ─────────────────────────────────────────────────────────────────

interface CacheEntry { data: SearchResponse; ts: number }
const CACHE_TTL_MS = 60_000;
const MAX_CACHE = 50;

class LRUCache {
  private map = new Map<string, CacheEntry>();

  get(key: string): SearchResponse | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() - e.ts > CACHE_TTL_MS) { this.map.delete(key); return null; }
    // Move to end (LRU)
    this.map.delete(key);
    this.map.set(key, e);
    return e.data;
  }

  set(key: string, data: SearchResponse): void {
    if (this.map.size >= MAX_CACHE) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { data, ts: Date.now() });
  }

  clear(): void { this.map.clear(); }
}

// ── SearchService ─────────────────────────────────────────────────────────────

export class SearchService {
  private static index: any | null = null;
  private static initPromise: Promise<void> | null = null;

  /** Master doc store — source of truth for persistence. Parallel to Flexsearch. */
  private static _docStore = new Map<string, IndexedDoc>();

  static cache = new LRUCache();
  private static _persistTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Exposed count for UI ──────────────────────────────────────────────────
  static get docCount(): number { return this._docStore.size; }
  static getDocCount(): number { return this._docStore.size; }

  // ── Initialisation ─────────────────────────────────────────────────────────

  /** Call once at app start (or lazily on first search). Idempotent. */
  static async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._buildFromStorage();
    return this.initPromise;
  }

  private static async _buildFromStorage(): Promise<void> {
    this.index = buildFlexIndex();
    try {
      const stored = await StorageService.getMetadata(INDEX_STORE_KEY);
      if (stored?.version === INDEX_VERSION && Array.isArray(stored.docs)) {
        for (const doc of stored.docs as IndexedDoc[]) {
          this.index.add(doc);
          this._docStore.set(doc.id, doc);
        }
        console.info(`[Search] Loaded ${this._docStore.size} docs from IndexedDB`);
      }
    } catch (e) {
      console.warn('[Search] Could not load index from IDB:', e);
    }
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  /**
   * Add or update a document in the index.
   * Accepts both post fields (title/content) and poll fields (question/description).
   */
  static async indexContent(
    type: 'post' | 'poll',
    id: string,
    data: {
      title?: string;
      question?: string;   // polls use this
      content?: string;
      body?: string;
      description?: string;
      authorName?: string;
      author?: string;
      communityId?: string;
      communitySlug?: string;
      community?: string;
      createdAt?: number;
      created_at?: number;
      category?: string;
      tags?: string[] | string;
    },
  ): Promise<void> {
    await this.init();

    const doc: IndexedDoc = {
      id,
      type,
      title: (data.title || data.question || '').slice(0, 200),
      excerpt: (data.content || data.body || data.description || '').slice(0, 300),
      author: (data.authorName || data.author || ''),
      community: (data.communityId || data.communitySlug || data.community || ''),
      created_at: data.createdAt || data.created_at || Date.now(),
      category: data.category || null,
      // Tags stored as space-separated text so Flexsearch tokenises each tag individually.
      // Gun sends them as a comma string; Post interface normalises to string[].
      tags: Array.isArray(data.tags)
        ? data.tags.join(' ')
        : (typeof data.tags === 'string' ? data.tags.replace(/,/g, ' ') : ''),
    };

    // Update Flexsearch (remove first to handle updates)
    try { this.index!.remove(id); } catch { /* not found — fine */ }
    this.index!.add(doc);

    // Update our own store (this is what gets persisted)
    this._docStore.set(id, doc);

    this.cache.clear();
    this._schedulePersist();
  }

  /** Remove a document (e.g. deleted post) */
  static async removeFromIndex(id: string): Promise<void> {
    await this.init();
    try { this.index!.remove(id); } catch { /* not found */ }
    this._docStore.delete(id);
    this.cache.clear();
    this._schedulePersist();
  }

  // ── Searching ──────────────────────────────────────────────────────────────

  /** Main entry point — offline when local index has content, remote otherwise. */
  static async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const trimmed = query?.trim() ?? '';

    // ── Browse mode: no text query but a filter is set ────────────────────────
    // Flexsearch returns nothing for an empty query, so we scan _docStore directly
    // and apply filters. Used by browseCategory() and community landing pages.
    const isBrowse = trimmed.length < 2 && (options.category || options.community || options.type);
    if (isBrowse) {
      await this.init();
      if (this._docStore.size > 0) {
        const result = this._browseLocal(options);
        return result;
      }
      // No local index — fall through to remote with the filter params
    } else if (!trimmed) {
      return { results: [], total: 0, source: 'local' };
    }

    await this.init();

    const cacheKey = JSON.stringify({ q: trimmed.toLowerCase(), ...options });
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (this._docStore.size > 0) {
      const result = this._searchLocal(trimmed, options);
      this.cache.set(cacheKey, result);
      return result;
    }

    // Fresh install fallback: hit the server
    try {
      const result = await this._searchRemote(query, options);
      if (result.results.length > 0) this.cache.set(cacheKey, result);
      return result;
    } catch {
      return { results: [], total: 0, source: 'remote' };
    }
  }

  /** Scan the full _docStore and apply filters — used when query is empty but filters are set. */
  private static _browseLocal(options: SearchOptions): SearchResponse {
    const limit  = options.limit  ?? 20;
    const offset = options.offset ?? 0;

    const all = [...this._docStore.values()].filter(doc => {
      if (options.type      && doc.type      !== options.type)      return false;
      if (options.community && doc.community !== options.community)  return false;
      if (options.category  && doc.category  !== options.category)  return false;
      return true;
    });

    // Sort newest first
    all.sort((a, b) => b.created_at - a.created_at);

    const total = all.length;
    const page  = all.slice(offset, offset + limit);

    return {
      results: page.map(doc => ({
        id: doc.id,
        type: doc.type,
        title: doc.title,
        content: doc.excerpt,
        author: doc.author,
        community: doc.community,
        created_at: doc.created_at,
        ...(doc.category ? { category: doc.category } : {}),
      })),
      total,
      source: 'local',
    };
  }

  private static _searchLocal(query: string, options: SearchOptions): SearchResponse {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    // Search title (higher weight) and excerpt separately, then merge
    const titleHits: string[] = ((this.index!.search(query, { index: 'title', limit: limit + offset + 100 }) as any[])[0]?.result) || [];
    const excerptHits: string[] = ((this.index!.search(query, { index: 'excerpt', limit: limit + offset + 100 }) as any[])[0]?.result) || [];

    const seen = new Set<string>();
    const scored: Array<{ doc: IndexedDoc; score: number }> = [];

    for (const id of titleHits) {
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = this._docStore.get(id);
      if (doc) scored.push({ doc, score: 10 });
    }
    for (const id of excerptHits) {
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = this._docStore.get(id);
      if (doc) scored.push({ doc, score: 5 });
    }

    const filtered = scored.filter(({ doc }) => {
      if (options.type && doc.type !== options.type) return false;
      if (options.community && doc.community !== options.community) return false;
      if (options.category && doc.category !== options.category) return false;
      return true;
    });

    filtered.sort((a, b) => b.score - a.score || b.doc.created_at - a.doc.created_at);

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    const results: SearchResult[] = page.map(({ doc, score }) => ({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      content: doc.excerpt,
      author: doc.author,
      community: doc.community,
      created_at: doc.created_at,
      relevance: score,
      // Include category so search results can show CategoryBadge
      ...(doc.category ? { category: doc.category } : {}),
    }));

    return { results, total, source: 'local' };
  }

  private static async _searchRemote(query: string, options: SearchOptions): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (options.type) params.append('type', options.type);
    if (options.community) params.append('community', options.community);
    if (options.category) params.append('category', options.category);
    if (options.limit) params.append('limit', String(options.limit));
    if (options.offset) params.append('offset', String(options.offset));

    const response = await fetch(`${config.relay.api}/api/search?${params}`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`Remote search failed: ${response.statusText}`);
    const data = await response.json();
    return { ...data, source: 'remote' as const };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private static _schedulePersist(): void {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(async () => {
      try {
        await StorageService.setMetadata(INDEX_STORE_KEY, {
          version: INDEX_VERSION,
          docs: [...this._docStore.values()],
          updatedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[Search] Persist failed:', e);
      }
    }, 2_000);
  }

  // ── Instance wrappers (drop-in compatible with original SearchService) ─────

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    return SearchService.search(query, options);
  }

  async searchPosts(query: string, options: Omit<SearchOptions, 'type'> = {}): Promise<SearchResponse> {
    return SearchService.search(query, { ...options, type: 'post' });
  }

  async searchPolls(query: string, options: Omit<SearchOptions, 'type'> = {}): Promise<SearchResponse> {
    return SearchService.search(query, { ...options, type: 'poll' });
  }

  async searchInCommunity(query: string, communitySlug: string, options: Omit<SearchOptions, 'community'> = {}): Promise<SearchResponse> {
    return SearchService.search(query, { ...options, community: communitySlug });
  }

  async searchPage(query: string, page = 1, perPage = 20, options: SearchOptions = {}): Promise<SearchResponse> {
    return SearchService.search(query, { ...options, limit: perPage, offset: (page - 1) * perPage });
  }

  async indexContent(type: 'post' | 'poll', id: string, data: any): Promise<{ ok: boolean }> {
    await SearchService.indexContent(type, id, data);
    return { ok: true };
  }

  clearCache(): void { SearchService.cache.clear(); }
  getTotalPages(total: number, perPage = 20): number { return Math.ceil(total / perPage); }
  hasNextPage(currentPage: number, total: number, perPage = 20): boolean { return currentPage < this.getTotalPages(total, perPage); }
  hasPreviousPage(currentPage: number): boolean { return currentPage > 1; }
}

export default SearchService;