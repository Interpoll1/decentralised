import { openDB, IDBPDatabase } from 'idb';
import type { DatabaseBackend } from '../types';

/**
 * Web durable store: IndexedDB via `idb`.
 *
 * Moved verbatim out of `storageService.ts` — same DB name, same version, same
 * upgrade path, so existing installs open their existing data with no migration.
 * `StorageService` now asks this module for a handle and is otherwise unchanged;
 * the desktop build supplies a handle backed by SQLite instead.
 */

// How long to wait for IndexedDB to open before assuming it is blocked and
// falling back to the in-memory store. On some mobile browsers (notably iOS
// Safari in Private mode) `openDB` never resolves or rejects — it just hangs,
// which surfaces to the user as the whole app "freezing" on load.
const IDB_OPEN_TIMEOUT_MS = 4_000;

let ephemeral = false;

async function open(): Promise<IDBPDatabase> {
  // Feature-detect: some restricted/mobile contexts expose no IndexedDB at all.
  const hasIndexedDB = typeof indexedDB !== 'undefined' && indexedDB !== null;
  if (hasIndexedDB) {
    try {
      const opening = openDB('interpoll-db', 5, {
        // Declared by store rather than by version step, and applied
        // idempotently. A version number alone is not trustworthy here: installs
        // exist that reached v4 without ever getting the `vote-index` store (an
        // earlier build shipped the bump without the creation), and an
        // `oldVersion < N` guard can never heal those — it just skips. Checking
        // what the database actually contains repairs any such install on open.
        upgrade(db, _oldVersion, _newVersion, tx) {
          const ensureStore = (
            name: string,
            options: IDBObjectStoreParameters | undefined,
            storeIndexes: Record<string, string> = {},
          ) => {
            // `tx` is the active versionchange transaction, the only handle
            // through which an existing store can be reopened to add indexes.
            const store: any = db.objectStoreNames.contains(name)
              ? (tx as any).objectStore(name)
              : db.createObjectStore(name as never, options);
            for (const [indexName, keyPath] of Object.entries(storeIndexes)) {
              if (!store.indexNames.contains(indexName)) store.createIndex(indexName, keyPath);
            }
          };

          ensureStore('blocks', { keyPath: 'index' }, { 'by-hash': 'currentHash' });
          ensureStore('votes', { keyPath: 'timestamp' }, { 'by-poll': 'pollId' });
          ensureStore('receipts', { keyPath: 'mnemonic' }, { 'by-block': 'blockIndex' });
          ensureStore('polls', { keyPath: 'id' });
          // `metadata` is a generic bag with out-of-line (explicit) keys.
          ensureStore('metadata', undefined);
          ensureStore('encryption-keys', { keyPath: 'id' });
          // Durable mirrors for the social layer. Gun runs with
          // `localStorage:false, radisk:false`, so without these a comment or
          // message exists only in a volatile in-memory graph that the memory
          // watchdog is free to evict.
          ensureStore('comments', { keyPath: 'id' }, { 'by-post': 'postId' });
          ensureStore('chat-messages', { keyPath: 'id' }, { 'by-room': 'roomId' });
          // O(1) duplicate-vote check. Without it `StorageService.hasVoted`
          // throws NotFoundError and every vote fails before reaching the chain.
          ensureStore('vote-index', { keyPath: ['pollId', 'deviceId'] });
        },
        // An older tab holding a v3 connection would stall this upgrade until
        // the timeout dropped us to the in-memory store. Close ours as soon as
        // a newer tab needs to upgrade, and say so when we are the one waiting.
        blocking(_current, _blocked, event) {
          console.warn('[Storage] Newer version needs to upgrade — closing this connection. Reload the page.');
          (event.target as IDBDatabase | null)?.close();
        },
        blocked() {
          console.warn('[Storage] Upgrade blocked by another open tab of this app — close it and reload.');
        },
      });
      // Race the open against a timeout so a hung request can't freeze the app.
      return await Promise.race([
        opening,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('IndexedDB open timed out')), IDB_OPEN_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.warn('[Storage] IndexedDB unavailable — using in-memory fallback (data will not persist):', err);
    }
  } else {
    console.warn('[Storage] IndexedDB not present — using in-memory fallback (data will not persist)');
  }
  ephemeral = true;
  return createInMemoryDB();
}

export const platformDB: DatabaseBackend = {
  open,
  get ephemeral() {
    return ephemeral;
  },
};

export default platformDB;

/**
 * Minimal in-memory stand-in for the subset of the `idb` API that
 * `StorageService` uses. Activated only when IndexedDB is missing, throws, or
 * hangs (e.g. iOS Safari Private mode). Keeps the app functional for the
 * session — data simply does not persist across reloads.
 */
function createInMemoryDB(): IDBPDatabase {
  const stores: Record<string, Map<any, any>> = {
    blocks: new Map(),
    votes: new Map(),
    receipts: new Map(),
    polls: new Map(),
    metadata: new Map(),
    'encryption-keys': new Map(),
    comments: new Map(),
    'chat-messages': new Map(),
    'vote-index': new Map(),
  };
  // Stores with an inline keyPath derive their key from the value; `metadata`
  // uses out-of-line (explicit) keys. An array keyPath is a compound key.
  const keyPaths: Record<string, string | string[] | null> = {
    blocks: 'index',
    votes: 'timestamp',
    receipts: 'mnemonic',
    polls: 'id',
    metadata: null,
    'encryption-keys': 'id',
    comments: 'id',
    'chat-messages': 'id',
    'vote-index': ['pollId', 'deviceId'],
  };
  const indexes: Record<string, Record<string, string>> = {
    blocks: { 'by-hash': 'currentHash' },
    votes: { 'by-poll': 'pollId' },
    receipts: { 'by-block': 'blockIndex' },
    comments: { 'by-post': 'postId' },
    'chat-messages': { 'by-room': 'roomId' },
  };

  // A Map keyed by an array would compare by identity, so compound keys are
  // flattened to a string — the same shape on both put and get.
  const normalizeKey = (key: any) => (Array.isArray(key) ? JSON.stringify(key) : key);
  const resolveKey = (name: string, value: any, explicitKey?: any) => {
    const kp = keyPaths[name];
    if (!kp) return normalizeKey(explicitKey);
    return normalizeKey(Array.isArray(kp) ? kp.map((p) => value?.[p]) : value?.[kp]);
  };
  const store = (name: string): Map<any, any> => stores[name] ?? (stores[name] = new Map());

  const objectStore = (name: string) => ({
    async put(value: any, key?: any) { store(name).set(resolveKey(name, value, key), value); },
    async get(key: any) { return store(name).get(normalizeKey(key)); },
    async delete(key: any) { store(name).delete(normalizeKey(key)); },
    async clear() { store(name).clear(); },
    async getAllKeys() { return [...store(name).keys()]; },
    async getAll() { return [...store(name).values()]; },
    async openCursor(_query?: any, direction?: 'next' | 'prev') {
      const entries = [...store(name).entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      );
      if (direction === 'prev') entries.reverse();
      return entries.length ? { value: entries[0][1], key: entries[0][0] } : null;
    },
  });

  const db: any = {
    async put(name: string, value: any, key?: any) { store(name).set(resolveKey(name, value, key), value); },
    async get(name: string, key: any) { return store(name).get(normalizeKey(key)); },
    async delete(name: string, key: any) { store(name).delete(normalizeKey(key)); },
    async getAll(name: string) { return [...store(name).values()]; },
    async getAllFromIndex(name: string, index: string, query: any) {
      const kp = indexes[name]?.[index];
      const all = [...store(name).values()];
      return kp ? all.filter((v) => v?.[kp] === query) : all;
    },
    transaction(_names: string | string[], _mode?: string) {
      return { objectStore, done: Promise.resolve() };
    },
  };
  return db as IDBPDatabase;
}
