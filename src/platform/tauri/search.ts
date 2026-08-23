/**
 * Desktop search.
 *
 * Phase 0 has no local index yet, so this defers to the relay exactly as the
 * browser does. Phase 1 points `searchLocal` at SQLite FTS5 over the full
 * archive and merges remote hits for content not held locally, de-duplicated
 * by id.
 */
export { platformSearch, default } from '../web/search';
