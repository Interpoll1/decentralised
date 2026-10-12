// src/utils/chatFormat.ts
//
// WhatsApp/Discord-style inline formatting for chat text, rendered via v-html.
// Safety: the text is HTML-escaped FIRST and every later substitution only
// wraps already-escaped runs, so no user-controlled markup can survive.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ESC[c]);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `code`, *bold*, _italic_, ~strike~, ```blocks```, http(s) links and @mentions.
 * `mentionNames` are display names actually mentioned (from the signed ext).
 */
export function formatChatText(text: string, mentionNames: string[] = []): string {
  const blocks: string[] = [];
  // Protect code first so formatting never applies inside it.
  let out = escapeHtml(text)
    .replace(/```([\s\S]+?)```/g, (_, code) => { blocks.push(`<pre class="fmt-pre">${code.replace(/^\n/, '')}</pre>`); return `\u0000${blocks.length - 1}\u0000`; })
    .replace(/`([^`\n]+)`/g, (_, code) => { blocks.push(`<code class="fmt-code">${code}</code>`); return `\u0000${blocks.length - 1}\u0000`; });

  out = out
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,!?:;])/g, '$1<strong>$2</strong>')
    .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,!?:;])/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])~(?=\S)([^~\n]*?\S)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>')
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,!?:;)'"&]/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">${url}</a>`);

  const names = [...new Set(mentionNames.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (names.length) {
    const re = new RegExp(`(^|\\s)@(${names.map(n => escapeRe(escapeHtml(n))).join('|')})`, 'g');
    out = out.replace(re, '$1<span class="fmt-mention">@$2</span>');
  }
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]).replace(/\n/g, '<br>');
}

/** Stable per-person hue, shared by avatars and sender names so they match. */
export function senderHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  // Skip the blue-violet..purple band (225-322deg): the palette has no purple.
  const v = h % 261;
  return v > 224 ? v + 98 : v;
}

/** Stable per-user accent colour, as group chats tint sender names. */
const PALETTE = ['#e6e6e6', '#34d399', '#f472b6', '#fbbf24', '#60a5fa', '#f87171', '#e6e6e6', '#2dd4bf', '#fb923c', '#a3e635'];
export function senderColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
export const EMOJI_PICKER = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😐', '🙄', '😴', '😮', '😢', '😭', '😡',
  '🥳', '🤯', '😬', '🤗', '🙃', '😇', '🤝', '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🔥', '✨',
  '🎉', '💯', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '✅', '❌', '⚡', '⭐', '☕', '🍕',
];
