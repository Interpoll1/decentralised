/**
 * Safe rendering helpers for user-generated content.
 *
 * Post/comment bodies come from Gun and from P2P peers — i.e. fully untrusted
 * input. Rendering them with `v-html` is only safe if every HTML metacharacter
 * is escaped BEFORE we inject any markup of our own. `autoLink` escapes first,
 * then linkifies, so the only tags that can reach the DOM are the `<a>` tags we
 * generate ourselves. This closes the stored-XSS vector where a crafted post
 * (e.g. `<img onerror=…>`) would otherwise execute in every viewer's browser.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// URL chars only — runs over already-escaped text, so it can never reopen a tag.
const URL_RE = /(https?:\/\/[\w\-\.\/?#&=;%+~:@,]+[\w\/])/g;

/**
 * Escape all HTML, then turn bare http(s) URLs into safe links.
 * Returns a string suitable for `v-html`.
 */
export function autoLink(text: string): string {
  if (!text) return '';
  return escapeHtml(text).replace(
    URL_RE,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
}
