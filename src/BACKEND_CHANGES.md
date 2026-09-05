# Backend Changes Required

## 1. Ephemeral Chat Media — `POST/GET/DELETE /api/chat-media`

### Why
The current file transfer uses WebRTC P2P data channels — both users must be online simultaneously, no async delivery, no fallback. This replaces it with relay-routed encrypted blobs that work async (recipient can be offline), require no STUN/TURN, and auto-delete after the recipient downloads them.

The relay **never sees plaintext**. The client encrypts with AES-256-GCM before uploading. The decryption key travels inside the Signal-encrypted chat message (the relay can't read that either).

---

### Database

```sql
-- In your existing MySQL schema
CREATE TABLE chat_media (
  id          VARCHAR(36)  PRIMARY KEY,          -- UUID v4
  sender_id   VARCHAR(128) NOT NULL,             -- Gun pub key of uploader
  blob_path   VARCHAR(512) NOT NULL,             -- path on disk / S3 key
  mime_type   VARCHAR(128) NOT NULL,
  byte_size   INT          NOT NULL,
  uploaded_at BIGINT       NOT NULL,             -- Unix ms
  expires_at  BIGINT       NOT NULL,             -- uploaded_at + 7 days
  downloaded  TINYINT      DEFAULT 0,            -- 1 = recipient fetched it
  deleted     TINYINT      DEFAULT 0
);

-- Cron every hour:
-- DELETE FROM chat_media WHERE expires_at < UNIX_TIMESTAMP() * 1000 OR deleted = 1;
-- Then delete corresponding files from disk/S3.
```

---

### Endpoints (Express / your relay framework)

```js
import express from 'express';
import multer  from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { db } from './db.js';

const MEDIA_DIR    = process.env.CHAT_MEDIA_DIR || './chat-media-blobs';
const MAX_BYTES    = 25 * 1024 * 1024; // 25 MB — ciphertext (client enforces same)
const TTL_MS       = 7 * 24 * 60 * 60 * 1000; // 7 days

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (_req, _file, cb) => cb(null, uuidv4() + '.bin'),
  }),
  limits: { fileSize: MAX_BYTES + 512 }, // small overhead for GCM tag
});

// ── Verify Gun public key auth ──────────────────────────────────────────────
// The client sends the Gun user's pub key as a bearer token.
// Verify it matches a known registered user in your users table.
function authMiddleware(req, res, next) {
  const pub = req.headers.authorization?.replace('Bearer ', '').trim();
  if (!pub || pub.length < 20) return res.status(401).json({ error: 'Unauthorized' });
  req.senderPub = pub;
  next();
}

// POST /api/chat-media — upload encrypted blob
router.post('/api/chat-media', authMiddleware, upload.single('blob'), async (req, res) => {
  try {
    const { mimeType, size } = req.body;
    const mediaId    = uuidv4();
    const blobPath   = req.file.path;
    const now        = Date.now();
    const expiresAt  = now + TTL_MS;

    await db.execute(
      `INSERT INTO chat_media (id, sender_id, blob_path, mime_type, byte_size, uploaded_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mediaId, req.senderPub, blobPath, mimeType || 'application/octet-stream',
       parseInt(size) || req.file.size, now, expiresAt]
    );

    res.json({ mediaId, expiresAt });
  } catch (err) {
    console.error('[chat-media] upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/chat-media/:id — download encrypted blob
router.get('/api/chat-media/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT blob_path, mime_type, deleted, expires_at FROM chat_media WHERE id = ?`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row || row.deleted || row.expires_at < Date.now()) {
      return res.status(404).json({ error: 'Media not found or expired' });
    }

    // Mark as downloaded — relay will clean up shortly
    await db.execute(
      `UPDATE chat_media SET downloaded = 1 WHERE id = ?`,
      [req.params.id]
    );

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(row.blob_path).pipe(res);
  } catch (err) {
    console.error('[chat-media] fetch error:', err);
    res.status(500).json({ error: 'Fetch failed' });
  }
});

// DELETE /api/chat-media/:id — client-triggered early deletion after decrypt
router.delete('/api/chat-media/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT blob_path FROM chat_media WHERE id = ? AND sender_id != ?`,
      [req.params.id, req.senderPub] // recipient (not sender) deletes after viewing
    );
    const row = rows[0];
    if (row) {
      await db.execute(`UPDATE chat_media SET deleted = 1 WHERE id = ?`, [req.params.id]);
      fs.unlink(row.blob_path, () => {}); // async delete from disk
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});
```

---

## 2. View Tracking — `POST /api/views`

### Why
Posts/polls currently have no view counter. The feed algorithm scores only by upvotes, downvotes, comments, and recency. Adding views lets the algo surface popular-but-not-engaged content (think tutorials or evergreen posts) and personalise by demoting already-seen items.

### Database

```sql
-- Add to search_index (already exists)
ALTER TABLE search_index ADD COLUMN view_count INT DEFAULT 0;
ALTER TABLE search_index ADD COLUMN unique_viewers INT DEFAULT 0;

-- Separate view log for deduplication and personalisation
CREATE TABLE post_views (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  content_id  VARCHAR(128) NOT NULL,
  content_type ENUM('post','poll') NOT NULL,
  viewer_pub  VARCHAR(128) NOT NULL,              -- Gun pub key (anonymous if guest)
  viewed_at   BIGINT NOT NULL,
  INDEX idx_content (content_id),
  INDEX idx_viewer  (viewer_pub),
  UNIQUE KEY uq_viewer_content (content_id, viewer_pub) -- one view per user per post
);
```

### Endpoint

```js
// POST /api/views — batch view ingestion
router.post('/api/views', async (req, res) => {
  // Auth optional — anonymous views still count
  const viewerPub = req.headers.authorization?.replace('Bearer ', '').trim() || 'anonymous';
  const { views } = req.body;

  if (!Array.isArray(views) || views.length === 0) return res.json({ ok: true });
  const batch = views.slice(0, 50); // cap at 50 per request

  try {
    // Batch upsert into post_views (ignore duplicates)
    const values = batch.map(v => [v.id, v.type || 'post', viewerPub, v.ts || Date.now()]);
    await db.query(
      `INSERT IGNORE INTO post_views (content_id, content_type, viewer_pub, viewed_at)
       VALUES ?`,
      [values]
    );

    // Update view_count and unique_viewers on search_index
    // Do this async so the response is fast
    setImmediate(async () => {
      const ids = [...new Set(batch.map(v => v.id))];
      for (const id of ids) {
        await db.execute(
          `UPDATE search_index
           SET view_count     = (SELECT COUNT(*) FROM post_views WHERE content_id = ?),
               unique_viewers = (SELECT COUNT(DISTINCT viewer_pub) FROM post_views WHERE content_id = ?)
           WHERE id = ?`,
          [id, id, id]
        ).catch(() => {});
      }
    });

    res.json({ ok: true, accepted: batch.length });
  } catch (err) {
    console.error('[views] batch error:', err.message);
    res.status(500).json({ error: 'Failed to record views' });
  }
});
```

### Feed Algorithm Update (search.js)

Add `view_count` to the scoring expression in `searchContent`:

```js
// In the scoreExpr for q.length >= 3:
scoreExpr = `(
  MATCH(title)   AGAINST(? IN NATURAL LANGUAGE MODE) * 3.0   +
  MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) * 1.0   +
  IF(LOWER(tags)     LIKE ?, 2.0, 0)                         +
  IF(LOWER(category) LIKE ?, 1.5, 0)                         +
  IF(LOWER(title)    LIKE ?, 1.0, 0)                         +
  LOG10(1 + view_count) * 0.4                                +  -- NEW: view popularity signal
  LOG10(1 + GREATEST(0, 30 - (UNIX_TIMESTAMP() - created_at / 1000) / 86400)) * 0.2
)`;
```

And expose `view_count` in the COLS list:
```js
const COLS = `id, type, title, content, author, community, created_at,
              category, tags, sentiment, nsfw, controversial, evergreen, locale,
              view_count, unique_viewers`; // ADD THESE
```

---

## Summary

| Change | File | Notes |
|--------|------|-------|
| `chat_media` table | MySQL | Stores ciphertext blob paths + TTL |
| `POST /api/chat-media` | relay server | Multer upload, 25 MB max |
| `GET /api/chat-media/:id` | relay server | Stream blob, mark downloaded |
| `DELETE /api/chat-media/:id` | relay server | Client-triggered early delete |
| Hourly cron | relay server | Delete expired + downloaded blobs |
| `post_views` table | MySQL | Per-user per-post dedup |
| `view_count` + `unique_viewers` cols | `search_index` | Updated async after view batch |
| `POST /api/views` | relay server | 50-view batches, INSERT IGNORE |
| `scoreExpr` in `search.js` | relay server | Add `LOG10(1 + view_count) * 0.4` |
