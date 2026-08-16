// useSearch.ts - Vue Composable for Full-Text Search
//
// Drop-in replacement for the original useSearch.ts.
// All original return values preserved + new additions:
//   - indexSource: 'local' | 'remote' | null   (shows where results came from)
//   - isIndexReady: boolean                     (true once IDB index is loaded)
//   - searchDebounced(query, options?, delay?)  (debounced live-as-you-type search)
//
// On mount, subscribes to Gun 'posts' and 'polls' to auto-index arriving content,
// so the local Flexsearch index stays current without manual calls to indexContent.

import { ref, Ref, onMounted, onUnmounted } from 'vue';
import SearchService, { SearchResult, SearchOptions, SearchResponse } from '../services/searchService';
import { GunService } from '../services/gunService';

interface UseSearchReturn {
  // Original API (unchanged)
  searchService: InstanceType<typeof SearchService>;
  results: Ref<SearchResult[]>;
  total: Ref<number>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  currentPage: Ref<number>;
  perPage: Ref<number>;
  search: (query: string, options?: SearchOptions) => Promise<void>;
  searchPosts: (query: string, options?: Omit<SearchOptions, 'type'>) => Promise<void>;
  searchPolls: (query: string, options?: Omit<SearchOptions, 'type'>) => Promise<void>;
  searchInCommunity: (query: string, communitySlug: string, options?: Omit<SearchOptions, 'community'>) => Promise<void>;
  searchPage: (query: string, page: number, options?: SearchOptions) => Promise<void>;
  nextPage: (query: string, options?: SearchOptions) => Promise<void>;
  previousPage: (query: string, options?: SearchOptions) => Promise<void>;
  clearResults: () => void;
  indexContent: (type: 'post' | 'poll', id: string, data: any) => Promise<void>;
  // New additions
  indexSource: Ref<'local' | 'remote' | null>;
  isIndexReady: Ref<boolean>;
  searchDebounced: (query: string, options?: SearchOptions, delayMs?: number) => void;
  browseCategory: (category: string, options?: Omit<SearchOptions, 'category'>) => Promise<void>;
}

export function useSearch(_apiUrl: string = ''): UseSearchReturn {
  // Keep a single instance per composable call (compatible with original usage)
  const searchService = new SearchService();

  const results      = ref<SearchResult[]>([]);
  const total        = ref<number>(0);
  const loading      = ref<boolean>(false);
  const error        = ref<string | null>(null);
  const currentPage  = ref<number>(1);
  const perPage      = ref<number>(20);
  const indexSource  = ref<'local' | 'remote' | null>(null);
  const isIndexReady = ref<boolean>(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let gunIndexFlushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingGunDocs = new Map<string, { type: 'post' | 'poll'; data: any }>();

  // ── On mount: warm index + subscribe to Gun for live auto-indexing ─────────
  onMounted(async () => {
    await SearchService.init();
    isIndexReady.value = true;

    // Subscribe to Gun data — batch incoming docs and index them together
    // to avoid hammering IndexedDB on every single Gun update
    const scheduleGunFlush = () => {
      if (gunIndexFlushTimer) return;
      gunIndexFlushTimer = setTimeout(async () => {
        gunIndexFlushTimer = null;
        for (const [id, { type, data }] of pendingGunDocs) {
          await SearchService.indexContent(type, id, data);
        }
        pendingGunDocs.clear();
      }, 1_500);
    };

    try {
      const gun = GunService.getGun();

      gun.get('posts').map().on((data: any, key: string) => {
        if (!data || key === '_' || !data.title) return;
        pendingGunDocs.set(key, { type: 'post', data });
        scheduleGunFlush();
      });

      gun.get('polls').map().on((data: any, key: string) => {
        if (!data || key === '_' || !(data.title || data.question)) return;
        pendingGunDocs.set(key, { type: 'poll', data });
        scheduleGunFlush();
      });
    } catch {
      // Gun not yet available — index will be populated on next search or manual indexContent call
    }
  });

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (gunIndexFlushTimer) clearTimeout(gunIndexFlushTimer);
  });

  // ── Core search helper ─────────────────────────────────────────────────────

  const _runSearch = async (query: string, options: SearchOptions = {}) => {
    loading.value = true;
    error.value = null;
    try {
      const response: SearchResponse = await SearchService.search(query, options);
      results.value = response.results;
      total.value   = response.total;
      indexSource.value = response.source;
    } catch (err: any) {
      error.value   = err.message || 'Search failed';
      results.value = [];
      total.value   = 0;
    } finally {
      loading.value = false;
    }
  };

  // ── Public methods (original API) ──────────────────────────────────────────

  const search = async (query: string, options: SearchOptions = {}) => {
    currentPage.value = 1;
    await _runSearch(query, { ...options, limit: perPage.value, offset: 0 });
  };

  const searchPosts = async (query: string, options: Omit<SearchOptions, 'type'> = {}) => {
    await search(query, { ...options, type: 'post' });
  };

  const searchPolls = async (query: string, options: Omit<SearchOptions, 'type'> = {}) => {
    await search(query, { ...options, type: 'poll' });
  };

  const searchInCommunity = async (
    query: string,
    communitySlug: string,
    options: Omit<SearchOptions, 'community'> = {},
  ) => {
    await search(query, { ...options, community: communitySlug });
  };

  const searchPage = async (query: string, page: number, options: SearchOptions = {}) => {
    currentPage.value = page;
    loading.value = true;
    error.value = null;
    try {
      const response: SearchResponse = await SearchService.search(query, {
        ...options,
        limit: perPage.value,
        offset: (page - 1) * perPage.value,
      });
      results.value = response.results;
      total.value   = response.total;
      indexSource.value = response.source;
    } catch (err: any) {
      error.value   = err.message || 'Search failed';
      results.value = [];
      total.value   = 0;
    } finally {
      loading.value = false;
    }
  };

  const nextPage = async (query: string, options: SearchOptions = {}) => {
    const totalPages = Math.ceil(total.value / perPage.value);
    if (currentPage.value < totalPages) {
      await searchPage(query, currentPage.value + 1, options);
    }
  };

  const previousPage = async (query: string, options: SearchOptions = {}) => {
    if (currentPage.value > 1) {
      await searchPage(query, currentPage.value - 1, options);
    }
  };

  const clearResults = () => {
    results.value     = [];
    total.value       = 0;
    error.value       = null;
    currentPage.value = 1;
    indexSource.value = null;
    SearchService.cache.clear();
  };

  const indexContent = async (type: 'post' | 'poll', id: string, data: any) => {
    try {
      await SearchService.indexContent(type, id, data);
    } catch (err: any) {
      console.error('Failed to index content:', err);
    }
  };

  // ── New: debounced search (live-as-you-type) ───────────────────────────────
  const searchDebounced = (query: string, options: SearchOptions = {}, delayMs = 300) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(query, options), delayMs);
  };

  // ── New: browse by category without requiring a text query ─────────────────
  // Passes an empty query so Flexsearch returns all docs, then filters by category.
  // Use this for category landing pages / sidebar category links.
  const browseCategory = async (category: string, options: Omit<SearchOptions, 'category'> = {}) => {
    await search('', { ...options, category });
  };

  return {
    searchService,
    results,
    total,
    loading,
    error,
    currentPage,
    perPage,
    search,
    searchPosts,
    searchPolls,
    searchInCommunity,
    searchPage,
    nextPage,
    previousPage,
    clearResults,
    indexContent,
    // New
    indexSource,
    isIndexReady,
    searchDebounced,
    browseCategory,
  };
}
