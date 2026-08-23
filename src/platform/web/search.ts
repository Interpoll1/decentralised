import type { SearchBackend } from '../types';

/**
 * Web search backend: none.
 *
 * The browser holds only a quota-limited slice of history, so there is nothing
 * worth indexing locally — `searchLocal` returns null and `searchService` falls
 * through to the relay's `/api/search`. Desktop overrides this with SQLite FTS5
 * over the complete archive.
 */
export const platformSearch: SearchBackend = {
  async searchLocal() {
    return null;
  },

  async index() {
    /* No local index in the browser. */
  },
};

export default platformSearch;
