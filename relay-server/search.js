// search.js — Full-text search indexing and categorisation
import { db, queryMySQL } from './db.js';
import { queueForCategorisation } from './auto-categorise.js';

export async function indexContent(type, id, data) {
  if (!db) return;
  try {
    const title    = type === 'post' ? data.title       : data.question;
    const content  = type === 'post' ? data.content     : data.description;
    const isVideo  = !!(data.videoCID || data.videoThumbnailCID);
    const modStatus = isVideo ? 'pending' : 'approved';
    await db.execute(
      `INSERT INTO search_index
         (id, type, title, content, author, community, created_at,
          video_cid, thumb_cid, mime_type, mod_status,
          controversial, evergreen, locale)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title), content = VALUES(content),
         author = VALUES(author), updated_at = NOW(),
         video_cid     = COALESCE(VALUES(video_cid), video_cid),
         thumb_cid     = COALESCE(VALUES(thumb_cid), thumb_cid),
         mime_type     = COALESCE(VALUES(mime_type), mime_type),
         controversial  = COALESCE(VALUES(controversial), controversial),
         evergreen      = COALESCE(VALUES(evergreen), evergreen),
         locale         = COALESCE(VALUES(locale), locale),
         view_count     = COALESCE(view_count, 0),
         unique_viewers = COALESCE(unique_viewers, 0)`,
      [
        id, type, title, content || '',
        data.authorName || 'Anonymous',
        data.communitySlug || '',
        data.createdAt || Date.now(),
        data.videoCID          || null,
        data.videoThumbnailCID || null,
        data.videoMimeType     || null,
        modStatus,
        data.controversial ? 1 : 0,
        data.evergreen === false ? 0 : 1,
        data.locale || 'global',
      ]
    );
    if (isVideo) {
      await db.execute(
        `INSERT INTO mod_queue (id, soul, content_type, content_snippet, flagged_at, status, reason)
         VALUES (?, ?, 'video', ?, ?, 'pending', 'Auto-flagged: video content requires review')
         ON DUPLICATE KEY UPDATE flagged_at = VALUES(flagged_at)`,
        [id, `posts/${id}`, (title || '').slice(0, 200), Date.now()]
      ).catch(err => console.warn('[indexContent] mod_queue insert failed:', err.message));
    }
  } catch (err) {
    console.error('❌ Indexing error:', err.message);
  }
}

export async function writeCategrisationResult(id, result) {
  if (!result) return;
  if (db) {
    try {
      await db.execute(
        `UPDATE search_index
         SET category = ?, tags = ?, sentiment = ?, nsfw = ?,
             controversial = ?, evergreen = ?, locale = ?
         WHERE id = ?`,
        [
          result.category,
          Array.isArray(result.tags) ? result.tags.join(',') : (result.tags || ''),
          result.sentiment,
          result.nsfw || 'none',
          result.controversial ? 1 : 0,
          result.evergreen === false ? 0 : 1,
          result.locale || 'global',
          id,
        ]
      );
    } catch (err) { console.warn('[auto-categorise] MySQL write failed:', err.message); }
  }
  try {
    fetch('http://127.0.0.1:8765/internal/categorise-write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, category: result.category, tags: result.tags, sentiment: result.sentiment, nsfw: result.nsfw }),
    }).catch(err => console.warn('[auto-categorise] Gun relay write failed:', err.message));
  } catch (err) {
    console.warn('[auto-categorise] Gun write request failed:', err.message);
  }
  console.info(`[auto-categorise] ✓ ${id} → ${result.category} [${result.tags.join(', ')}]${result.nsfw ? ' 🔞' : ''}`);
}

export async function searchContent(query, filters = {}) {
  if (!db) return { results: [], total: 0 };
  try {
    const limit  = Math.min(Math.max(1, parseInt(filters.limit  || '20') || 20), 100);
    const offset = Math.max(0, parseInt(filters.offset || '0') || 0);

    const q    = query.trim();
    const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';

    // ── Column list ─────────────────────────────────────────────────────────
    const COLS = `id, type, title, content, author, community, created_at,
                  category, tags, sentiment, nsfw, controversial, evergreen, locale,
                  view_count, unique_viewers`;

    // ── Scoring rationale ───────────────────────────────────────────────────
    // title match  (3×) — strongest signal: query is what the post is about
    // tag match    (2×) — high signal: author explicitly labelled it (football → sports)
    // category     (1.5×) — medium: broader label, catches related content
    // content body (1×) — weakest: noisy, large text, lots of false positives
    // recency      (0.2×) — log-decay over 30 days so fresh content gets a small lift
    //                        without burying quality evergreen posts
    //
    // For queries ≥3 chars we use MySQL NATURAL LANGUAGE MODE which applies IDF
    // weighting (rare words score higher than common ones). We add our own
    // tag/category/title signals on top via IF(LIKE) expressions.
    //
    // For short queries (<3 chars) FULLTEXT is unreliable so we fall back to
    // pure LIKE matching with the same signal weights.

    let scoreExpr, whereExpr, selectParams, whereParams;

    if (q.length >= 3) {
      scoreExpr = `(
        MATCH(title)   AGAINST(? IN NATURAL LANGUAGE MODE) * 3.0   +
        MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE) * 1.0   +
        IF(LOWER(tags)     LIKE ?, 2.0, 0)                         +
        IF(LOWER(category) LIKE ?, 1.5, 0)                         +
        IF(LOWER(title)    LIKE ?, 1.0, 0)                         +
        LOG10(1 + COALESCE(view_count, 0)) * 0.4                   +
        LOG10(1 + GREATEST(0, 30 - (UNIX_TIMESTAMP() - created_at / 1000) / 86400)) * 0.2
      )`;
      whereExpr = `(
        MATCH(title, content) AGAINST(? IN NATURAL LANGUAGE MODE)
        OR LOWER(tags)        LIKE ?
        OR LOWER(category)    LIKE ?
        OR LOWER(title)       LIKE ?
      )`;
      selectParams = [q, q, like, like, like];
      whereParams  = [q, like, like, like];
    } else {
      scoreExpr = `(
        IF(LOWER(title)    LIKE ?, 3.0, 0) +
        IF(LOWER(tags)     LIKE ?, 2.0, 0) +
        IF(LOWER(category) LIKE ?, 1.5, 0) +
        IF(LOWER(content)  LIKE ?, 0.5, 0) +
        LOG10(1 + COALESCE(view_count, 0)) * 0.4
      )`;
      whereExpr = `(
        LOWER(title)    LIKE ? OR LOWER(tags)     LIKE ?
        OR LOWER(category) LIKE ? OR LOWER(content) LIKE ?
      )`;
      selectParams = [like, like, like, like];
      whereParams  = [like, like, like, like];
    }

    // ── Static filters ──────────────────────────────────────────────────────
    const filterClauses = [];
    const filterParams  = [];
    if (filters.type)      { filterClauses.push('type = ?');      filterParams.push(filters.type); }
    if (filters.community) { filterClauses.push('community = ?'); filterParams.push(filters.community); }
    if (filters.category)  { filterClauses.push('category = ?');  filterParams.push(filters.category); }
    // Default: suppress NSFW unless caller explicitly opts in
    if (!filters.nsfw || filters.nsfw === 'none') {
      filterClauses.push(`(nsfw = 'none' OR nsfw IS NULL)`);
    }
    const filterSql = filterClauses.length ? ' AND ' + filterClauses.join(' AND ') : '';

    // ── Queries ─────────────────────────────────────────────────────────────
    const sql = `
      SELECT ${COLS}, (${scoreExpr}) AS score
      FROM search_index
      WHERE ${whereExpr} ${filterSql}
      ORDER BY score DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) AS total
      FROM search_index
      WHERE ${whereExpr} ${filterSql}
    `;

    const [results, countResult] = await Promise.all([
      queryMySQL(sql,      [...selectParams, ...whereParams, ...filterParams, limit, offset]),
      queryMySQL(countSql, [...whereParams,  ...filterParams]),
    ]);

    // Normalise output — tags → array, booleans cast, score stripped
    const normalised = (results || []).map(r => ({
      ...r,
      tags:          r.tags ? r.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      controversial: !!r.controversial,
      evergreen:     !!r.evergreen,
      score:         undefined,
    }));

    return { results: normalised, total: countResult?.[0]?.total || 0 };
  } catch (err) {
    console.error('❌ Search error:', err.message);
    return { results: [], total: 0 };
  }
}