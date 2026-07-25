# Scalability & Performance Fixes

## Fix 1 — Surgical per-leaf vote writes (race condition + payload bloat)
**Files:** `src/services/pollService.ts` → `vote()`

**Before:** Every vote serialised and rewrote the *entire* options map for every
option, including the full `voters[]` array. Under concurrent voters this was a
classic lost-update: two clients read the same baseline, both wrote back, and one
write silently overwrote the other. The retry loop just replayed the same race.
On a busy poll the options write grew with O(total voters) on every single vote.

**After:** Each vote now writes only two leaves per affected option:
```
polls/{id}/options/{optionIndex}/voters/{voterId}  = true   ← one tiny leaf
polls/{id}/options/{optionIndex}/votes             = N      ← updated count
```
Because each voter gets their own named leaf in the Gun graph, concurrent voters
can no longer overwrite each other — Gun's last-write-wins is now scoped to one
voter at a time. The write payload is constant-size regardless of how many people
have voted. The old all-retry loop is replaced by a lightweight leaf-read
confirmation check.

The community-path writes follow the same pattern in parallel.

---

## Fix 2 — Gun-native voter set replaces voters array
**Files:** `src/services/pollService.ts` → `parseVoters`, `buildVotersSet`, `buildOptionsMap`

**Before:** `voters` was stored as a numeric-indexed object `{ "0": "voter-id", "1": ... }`,
requiring a full serialise+deserialise round-trip of all voter IDs on every read and write.

**After:** `voters` is now stored as a named-key set `{ "voter-id": true }`.
- Reads: `parseVoters` handles both the old format (backward-compatible) and the new format.
- Writes: `buildVotersSet` produces `{ [voterId]: true }` so adding a voter is
  a single Gun leaf write rather than reindexing the whole array.

Old `buildVotersMap` is kept but marked `@deprecated` for any legacy code paths
that haven't been migrated yet.

---

## Fix 3 — Parallel Gun fetches in `loadPollFromGun`
**Files:** `src/services/pollService.ts` → `loadPollFromGun`

**Before:** Root poll data and options were fetched sequentially:
1. `onceNode(root, 300ms)` — wait
2. If miss → `waitForNode(root, 1500ms)` — wait
3. `onceNode(options, 300ms)` — wait
4. If miss → `waitForNode(options, 1500ms)` — wait

Worst case per poll: **3.6 s**. On a community page load that hydrates 40 polls
concurrently, this created 40 × 3.6s cascades of Gun traffic.

**After:** Root and options are fetched simultaneously with `Promise.all`:
```js
const [pollData, optionsData] = await Promise.all([
  onceNode(root, 300).then(d => d?.id ? d : waitForNode(root, 1500)),
  onceNode(options, 300).then(d => parsed.length > 0 ? d : waitForNode(options, 1500)),
]);
```
Worst case per poll is now **max(root, options)** ≈ **1.8 s** — a ~50% reduction.
The fallback chain (community-path → API) is preserved.

---

## Fix 4 — Rate-limiter: bounded map + dump/restore across restarts
**Files:** `rate-limiter.js`, `peer.js`

**Before:** The `RateLimiter.peers` Map grew unbounded — a sustained scan/attack
could exhaust heap. State was also entirely in-memory: every relay restart reset
all bans, giving abusers a clean slate.

**After (rate-limiter.js):**
- `MAX_PEERS = 50_000` cap with LRU-style eviction of the oldest entry when full.
- New `dump()` method serialises active bans/violations (not timestamps, which
  expire naturally) to a plain JSON object.
- New `restore(snapshot)` method re-hydrates that state on the next startup,
  skipping entries whose cooldown already expired.

**After (peer.js):**
- `RateLimiter` is now imported and instantiated at startup.
- On startup: `rateLimiter.restore(loadJSON('rate-limiter-state.json'))` — bans survive.
- On `SIGINT`/`SIGTERM`: `saveJSON('rate-limiter-state.json', rateLimiter.dump())` — state is persisted.
- `gracefulShutdown()` function now handles both signals.

---

## Fix 5 — Images: IndexedDB for full-res, Gun only for thumbnails
**Files:** `src/services/ipfsService.ts`

**Before:** Full base64 images (up to 1 MB after compression) were stored
directly as Gun graph nodes. Gun syncs all node changes to every connected peer,
so every relay that touched the community graph had to store and re-propagate
multi-megabyte image blobs. This multiplied storage and sync costs across all peers.

**After:**
- **Full image** → stored in IndexedDB via `StorageService.setMetadata()` (local
  only, zero Gun propagation cost).
- **Thumbnail (~100 KB)** → stored in Gun as before (small enough to sync).
- **Metadata pointer** → stored in Gun: `{ id, size, uploadedAt, hasFull: true }`.

`downloadImage()` tries IndexedDB first (instant on the uploader's device), then
falls back to the Gun thumbnail. `getThumbnail()` is a new lightweight method
for feed cards that only need the small version.

Legacy nodes (with `data.data` field) are handled transparently in the fallback.

---

## Backward compatibility

All changes are backward-compatible with existing Gun graph data:
- `parseVoters` handles both the old numeric-indexed format and the new named-key set.
- `downloadImage` falls back to `data.data` for legacy image nodes.
- `loadPollFromGun` retains all existing fallback chains (community path, API, local backup).
- The old `buildVotersMap` is still exported for any paths not yet updated.
