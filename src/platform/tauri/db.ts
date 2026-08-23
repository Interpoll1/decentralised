/**
 * Desktop durable store.
 *
 * Phase 0 deliberately reuses the browser's IndexedDB implementation: the whole
 * point of the walking skeleton is to prove the Vue UI runs unmodified in the
 * webview, and swapping the storage engine at the same time would confound that.
 * WebView2/WKWebView/WebKitGTK all ship IndexedDB, so this works today.
 *
 * Phase 1 replaces this with a SQLite-backed facade over the same `idb` shape
 * (`invoke('kv_*')` → rusqlite + FTS5), which is what removes the storage quota
 * and enables full history plus offline search. `StorageService` and its 25
 * importers do not change when that happens — only this file does.
 */
export { platformDB, default } from '../web/db';
