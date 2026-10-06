// ssr.js — SSR helpers, HTML generation, sitemap, bot-only page rendering
import { DOMAIN } from './config.js';
import { queryMySQL } from './db.js';
import { NAMESPACE } from '../shared-validation/namespace.js';

// ─── SSR Cache ────────────────────────────────────────────────────────────────
export const ssrCache = new Map();
const SSR_CACHE_MAX = 10000;
export const SSR_CACHE_TTL = 3_600_000;

export function ssrCacheSet(key, value) {
  if (ssrCache.size >= SSR_CACHE_MAX) {
    const oldest = ssrCache.keys().next().value;
    ssrCache.delete(oldest);
  }
  ssrCache.set(key, value);
}

// ─── HTML utilities ───────────────────────────────────────────────────────────
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function buildHtmlShell(head, initData = '') {
  const ASSET_JS  = process.env.ASSET_JS  || '/assets2/index.js';
  const ASSET_CSS = process.env.ASSET_CSS || '/assets2/index.css';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${head}
    <link rel="stylesheet" crossorigin href="${DOMAIN}${ASSET_CSS}">
  </head>
  <body>
    <div id="app"${initData}></div>
    <script type="module" crossorigin src="${DOMAIN}${ASSET_JS}"></script>
  </body>
</html>`;
}

export function generatePostHTML(post) {
  const desc     = escapeHtml((post.content || '').replace(/\n/g, ' ').slice(0, 160));
  const title    = escapeHtml(post.title);
  const imageUrl = post.imageIPFS ? `https://ipfs.io/ipfs/${post.imageIPFS}` : `${DOMAIN}/og-default.png`;
  const postUrl  = `${DOMAIN}/community/${post.communityId || 'general'}/post/${post.id}`;
  return buildHtmlShell(`
    <title>${title} — Interpoll</title>
    <meta name="description" content="${desc}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${postUrl}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Interpoll" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:url" content="${postUrl}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${desc}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta property="article:author" content="${escapeHtml(post.authorName)}" />
    <meta property="article:published_time" content="${new Date(post.createdAt).toISOString()}" />`,
    ` data-initial-post-id="${escapeHtml(post.id)}"`
  );
}

export function generatePollHTML(poll) {
  const desc     = escapeHtml((poll.description || `Vote now: ${poll.question}`).slice(0, 160));
  const question = escapeHtml(poll.question);
  const pollUrl  = `${DOMAIN}/community/${poll.communityId || 'general'}/poll/${poll.id}`;
  return buildHtmlShell(`
    <title>${question} — Interpoll</title>
    <meta name="description" content="${desc}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${pollUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Interpoll" />
    <meta property="og:title" content="${question}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${pollUrl}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${question}" />
    <meta name="twitter:description" content="${desc}" />`,
    ` data-initial-poll-id="${escapeHtml(poll.id)}"`
  );
}

// ─── DB fetch helpers (for SSR) ────────────────────────────────────────────────
export async function fetchPostFromDB(postId) {
  const escaped = postId.replace(/[%_\\]/g, '\\$&');
  const rows = await queryMySQL(
    `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ? LIMIT 10`,
    [`v2/%/posts/${escaped}`, '\\', `communities/%/posts/${escaped}`, '\\', `v2/posts/${postId}`, `posts/${postId}`]
  );
  if (!rows) return null;
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      if (d?.title) return {
        id: d.id || postId, communityId: d.communityId || '',
        authorName: d.authorName || 'Anonymous', title: d.title,
        content: d.content || '', imageIPFS: d.imageIPFS || '', createdAt: d.createdAt || Date.now(),
      };
    } catch {}
  }
  return null;
}

export async function fetchPollFromDB(pollId) {
  const escaped = pollId.replace(/[%_\\]/g, '\\$&');
  const rows = await queryMySQL(
    `SELECT soul, data FROM gun_nodes WHERE soul LIKE ? ESCAPE ? OR soul LIKE ? ESCAPE ? OR soul = ? OR soul = ? LIMIT 10`,
    [`v2/%/polls/${escaped}`, '\\', `communities/%/polls/${escaped}`, '\\', `v2/polls/${pollId}`, `polls/${pollId}`]
  );
  if (!rows) return null;
  for (const row of rows) {
    try {
      const d = JSON.parse(row.data);
      if (d?.question) return {
        id: d.id || pollId, communityId: d.communityId || '',
        authorName: d.authorName || 'Anonymous', question: d.question,
        description: d.description || '', totalVotes: d.totalVotes || 0, createdAt: d.createdAt || Date.now(),
      };
    } catch {}
  }
  return null;
}

// ─── Sitemap ──────────────────────────────────────────────────────────────────
export async function generateSitemap() {
  try {
    const now = new Date().toISOString().split('T')[0];
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${DOMAIN}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>
  <url><loc>${DOMAIN}/search</loc><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;

    const commRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul REGEXP '^${NAMESPACE}/communities/c-[^/]+$' LIMIT 500`, []);
    for (const row of commRows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.id || !d?.displayName) continue;
        const lastmod = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : now;
        xml += `  <url><loc>${DOMAIN}/community/${d.id}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
      } catch {}
    }

    const postRows = await queryMySQL(`SELECT data FROM gun_nodes WHERE soul REGEXP '^(v2/communities|communities)/[^/]+/posts/post-[^/]+$' ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT 2000`, []);
    const seenPosts = new Set();
    for (const row of postRows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.id || !d?.title || !d?.communityId || seenPosts.has(d.id)) continue;
        seenPosts.add(d.id);
        const lastmod = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : now;
        xml += `  <url><loc>${DOMAIN}/community/${d.communityId}/post/${d.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
      } catch {}
    }

    const pollRows = await queryMySQL(
      `SELECT data FROM gun_nodes
       WHERE (soul REGEXP '^(v2/communities|communities)/[^/]+/polls/poll-[^/]+$' OR soul REGEXP '^(v2/polls|polls)/poll-[^/]+$')
         AND soul NOT REGEXP '/options'
         AND soul NOT REGEXP '/inviteCodes'
       ORDER BY JSON_EXTRACT(data, '$.createdAt') DESC LIMIT 1000`, []
    );
    const seenPolls = new Set();
    for (const row of pollRows || []) {
      try {
        const d = JSON.parse(row.data);
        if (!d?.id || !d?.question || !d?.communityId || d?.isPrivate || seenPolls.has(d.id)) continue;
        seenPolls.add(d.id);
        const lastmod = d.createdAt ? new Date(d.createdAt).toISOString().split('T')[0] : now;
        xml += `  <url><loc>${DOMAIN}/community/${d.communityId}/poll/${d.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
      } catch {}
    }

    xml += `</urlset>`;
    return xml;
  } catch (err) {
    console.error('Sitemap error:', err.message);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  }
}