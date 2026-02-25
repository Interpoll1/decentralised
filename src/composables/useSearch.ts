// useSearch.ts - Vue Composable for Full-Text Search

import { ref, Ref } from 'vue';
import SearchService, { SearchResult, SearchOptions, SearchResponse } from '../services/searchService';

interface UseSearchReturn {
  searchService: SearchService;
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
}

export function useSearch(apiUrl: string = ''): UseSearchReturn {
  const searchService = new SearchService(apiUrl);
  const results = ref<SearchResult[]>([]);
  const total = ref<number>(0);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const currentPage = ref<number>(1);
  const perPage = ref<number>(20);

  const search = async (query: string, options: SearchOptions = {}) => {
    loading.value = true;
    error.value = null;
    
    try {
      const response: SearchResponse = await searchService.search(query, options);
      results.value = response.results;
      total.value = response.total;
    } catch (err: any) {
      error.value = err.message || 'Search failed';
      results.value = [];
      total.value = 0;
    } finally {
      loading.value = false;
    }
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
    options: Omit<SearchOptions, 'community'> = {}
  ) => {
    await search(query, { ...options, community: communitySlug });
  };

  const searchPage = async (query: string, page: number, options: SearchOptions = {}) => {
    currentPage.value = page;
    loading.value = true;
    error.value = null;
    
    try {
      const response: SearchResponse = await searchService.searchPage(
        query,
        page,
        perPage.value,
        options
      );
      results.value = response.results;
      total.value = response.total;
    } catch (err: any) {
      error.value = err.message || 'Search failed';
      results.value = [];
      total.value = 0;
    } finally {
      loading.value = false;
    }
  };

  const nextPage = async (query: string, options: SearchOptions = {}) => {
    if (searchService.hasNextPage(currentPage.value, total.value, perPage.value)) {
      await searchPage(query, currentPage.value + 1, options);
    }
  };

  const previousPage = async (query: string, options: SearchOptions = {}) => {
    if (searchService.hasPreviousPage(currentPage.value)) {
      await searchPage(query, currentPage.value - 1, options);
    }
  };

  const clearResults = () => {
    results.value = [];
    total.value = 0;
    error.value = null;
    currentPage.value = 1;
  };

  const indexContent = async (type: 'post' | 'poll', id: string, data: any) => {
    try {
      await searchService.indexContent(type, id, data);
    } catch (err: any) {
      console.error('Failed to index content:', err);
    }
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
  };
}
