// src/utils/markdown.ts — shared Markdown helpers.
//
// Posts are authored and stored as plain Markdown text; rendering happens at
// display time. Because content can come from untrusted peers, the rendered
// HTML is ALWAYS sanitized with DOMPurify before it reaches v-html.
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

/** Render Markdown to sanitized HTML safe to inject via v-html. */
export function renderMarkdown(md?: string | null): string {
  if (!md) return ''
  const html = marked.parse(md) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

/** Flatten Markdown to plain text for snippets/previews (e.g. feed cards). */
export function stripMarkdown(md?: string | null): string {
  if (!md) return ''
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links -> their text
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')    // inline/code fences
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')       // headings
    .replace(/^\s{0,3}[-+*]\s+/gm, '')        // list bullets
    .replace(/[*_~>#]/g, '')                  // leftover emphasis/quote marks
    .replace(/\s+/g, ' ')
    .trim()
}
