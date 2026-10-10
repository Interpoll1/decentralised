<template>
  <div class="ct">

    <!-- Header: title, unread pill, and a compact "New chat" action (replaces the big card) -->
    <header class="ct-head">
      <div class="ct-search" role="search">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input
          v-model="query"
          class="ct-search__input"
          placeholder="Search by message or name"
          aria-label="Search by message or name"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
        <button v-if="query" class="link-clear" aria-label="Clear search" @click="query = ''">
          <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <button
        class="ct-new"
        :class="{ 'ct-new--open': composerOpen }"
        :aria-expanded="composerOpen"
        :aria-label="composerOpen ? 'Close new chat' : 'New chat'"
        @click="toggleComposer"
      >
        <svg v-if="!composerOpen" class="ct-new__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M20.5 11.6a8.1 8.1 0 01-.9 3.7 8.2 8.2 0 01-7.3 4.5 8.1 8.1 0 01-3.7-.9L3.5 20.5l1.6-4.9a8.1 8.1 0 01-.9-3.7A8.2 8.2 0 018.7 4.6a8.1 8.1 0 013.6-.9h.5a8.2 8.2 0 017.7 7.7v.2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 8.6v6M9 11.6h6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
        </svg>
        <svg v-else class="ct-new__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        <span class="ct-new__label">{{ composerOpen ? 'Close' : 'New' }}</span>
      </button>
    </header>

    <!-- New chat: paste a link someone shared, or share your own -->
    <Transition name="ct-slide">
      <section v-if="composerOpen" class="ct-composer">
        <label class="ct-composer__label" for="ct-link">Paste a chat link someone shared with you</label>
        <div class="link-input-wrap" :class="{ focused: linkFocused, error: linkError }">
          <svg viewBox="0 0 24 24" fill="none" class="link-prefix-icon" aria-hidden="true"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input
            id="ct-link"
            ref="linkEl"
            v-model="inviteLinkInput"
            class="link-input"
            placeholder="Paste chat link here…"
            autocomplete="off"
            spellcheck="false"
            @focus="linkFocused = true; linkError = ''"
            @blur="linkFocused = false"
            @keydown.enter="openFromLink"
            @paste="onLinkPaste"
          />
          <button v-if="inviteLinkInput" class="link-clear" aria-label="Clear" @click="inviteLinkInput = ''; linkError = ''">
            <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <p v-if="linkError" class="link-error">{{ linkError }}</p>
        <div class="ct-composer__actions">
          <button class="open-btn" :disabled="!inviteLinkInput.trim() || openingLink" @click="openFromLink">
            <span v-if="openingLink" class="mini-spinner"></span>
            <span v-else>Open chat</span>
          </button>
          <button class="ct-linkbtn" @click="router.push('/profile')">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            Share my link
          </button>
        </div>
      </section>
    </Transition>

    <!-- The list: ONE continuous surface, rows separated by hairlines (WhatsApp-style) -->
    <ul v-if="filteredChats.length" class="ct-list">
      <li
        v-for="chat in filteredChats"
        :key="chat.userId"
        class="ct-row"
        :class="{ 'ct-row--unread': chat.unreadCount > 0 }"
        role="button"
        tabindex="0"
        @click="onRowClick(chat)"
        @keydown="onRowKey($event, chat)"
      >
        <div class="avatar" :class="chatTone(chat.userId)">
          <template v-if="hasRealName(chat)">{{ displayName(chat).charAt(0).toUpperCase() }}</template>
          <svg v-else class="avatar__ghost" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.5" r="4"/><path d="M4 20.5c0-3.9 3.6-6.5 8-6.5s8 2.6 8 6.5c0 .55-.45 1-1 1H5c-.55 0-1-.45-1-1z"/></svg>
        </div>
        <div class="ct-row__main">
          <div class="ct-row__top">
            <div v-if="editingId === chat.userId" class="ct-edit" @click.stop>
              <input
                :ref="setEditInput"
                v-model="draft"
                class="ct-edit__input"
                :placeholder="baseName(chat)"
                :maxlength="MAX_NICKNAME"
                enterkeyhint="done"
                autocomplete="off"
                spellcheck="false"
                aria-label="Chat name"
                @keydown="onEditKey($event, chat)"
              />
              <button type="button" class="ct-edit__btn ct-edit__btn--ok" aria-label="Save name" @click.stop="commitEdit(chat)">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <button type="button" class="ct-edit__btn" aria-label="Cancel" @click.stop="cancelEdit">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
              </button>
            </div>
            <template v-else>
              <span class="ct-row__name"><template v-for="(p, i) in nameParts(chat)" :key="i"><mark v-if="p.hit" class="ct-hit">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template></span>
              <button
                type="button"
                class="ct-row__edit"
                :aria-label="`Rename ${displayName(chat)}`"
                title="Rename"
                @click.stop="startEdit(chat)"
                @keydown.stop
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 7l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
              <span class="ct-row__time">{{ formatChatTime(chat.lastMessageTime) }}</span>
            </template>
          </div>
          <div class="ct-row__bottom">
            <span class="ct-row__preview" :class="{ 'ct-row__preview--empty': !previewShown(chat) }">
              <span v-if="previewMine(chat)" class="ct-row__you">You:</span><template v-for="(p, i) in previewParts(chat)" :key="i"><mark v-if="p.hit" class="ct-hit">{{ p.t }}</mark><template v-else>{{ p.t }}</template></template><template v-if="!previewShown(chat)">No messages yet</template>
            </span>
            <span v-if="matchCount(chat) > 1" class="ct-row__matches">{{ matchCount(chat) > 99 ? '99+' : matchCount(chat) }} matches</span>
            <span v-if="chat.unreadCount > 0" class="ct-row__badge">{{ chat.unreadCount > 99 ? '99+' : chat.unreadCount }}</span>
          </div>
        </div>
      </li>
    </ul>

    <p v-else-if="trimmed && chatList.length" class="ct-nomatch">{{ searchPending ? 'Searching messages…' : `No chats or messages match “${trimmed}”.` }}</p>

    <!-- Loading: skeleton in the same surface so the layout doesn't jump -->
    <div v-else-if="loading" class="ct-list ct-skel" aria-hidden="true">
      <div v-for="n in 5" :key="n" class="ct-row ct-skel__row">
        <div class="ct-skel__avatar"></div>
        <div class="ct-skel__lines"><span></span><span></span></div>
      </div>
    </div>

    <!-- Empty -->
    <div v-else class="ct-empty">
      <div class="ct-empty__icon">
        <svg viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      </div>
      <p class="ct-empty__title">No chats yet</p>
      <p class="ct-empty__sub">Paste a chat link someone shared with you, or share yours so people can message you directly.</p>
      <button class="open-btn ct-empty__cta" @click="toggleComposer(true)">Start a chat</button>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { chatPath } from '../utils/privateRoute';
import { cleanNickname, MAX_NICKNAME } from '../utils/nicknameText';
import { findMatch, splitHighlight, MIN_MESSAGE_QUERY, type MessageHit } from '../utils/chatSearch';

interface ChatEntry {
  userId: string;
  name: string;
  /** What the user calls this person (local only); wins over `name`. */
  nickname?: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  publicKey: string;
}

interface UserResult {
  id: string;
  name: string;
  username: string;
  publicKey: string;
}

const props = defineProps<{
  chatList: ChatEntry[];
  totalUnread: number;
  userSearchResults: UserResult[];
  searchingUsers: boolean;
  loading?: boolean;
  /** Result of the message search the parent ran for `query` (ignored if it is for an older query). */
  messageSearch?: { query: string; hits: Record<string, MessageHit> } | null;
}>();

const emit = defineEmits<{
  (e: 'openChat', chat: ChatEntry): void;
  (e: 'rename', payload: { userId: string; nickname: string }): void;
  /** The (debounced) search text; the parent looks through stored messages and answers via `messageSearch`. */
  (e: 'search', query: string): void;
  (e: 'openFromLink', url: string): void;
  // keep legacy emits so HomePage doesn't break
  (e: 'searchUsers', query: string): void;
  (e: 'clearUserSearch'): void;
  (e: 'startChat', user: UserResult): void;
}>();

// Until Gun resolves a profile the stored name is the raw 64-char id; don't show that.
function resolvedName(chat: ChatEntry): string {
  const n = (chat.name || '').trim();
  return n && n !== chat.userId ? n : '';
}
/** What the network calls them (or the short fallback). Shown as the rename placeholder. */
function baseName(chat: ChatEntry): string { return resolvedName(chat) || `User ${chat.userId.slice(0, 6)}`; }
/** A custom name always wins. */
function displayName(chat: ChatEntry): string { return (chat.nickname || '').trim() || baseName(chat); }
function hasRealName(chat: ChatEntry): boolean { return !!((chat.nickname || '').trim() || resolvedName(chat)); }

// ── Rename (inline, local only) ────────────────────────────────────────────
const editingId = ref('');
const draft = ref('');
let editInput: HTMLInputElement | null = null;
function setEditInput(el: unknown) { editInput = (el as HTMLInputElement) || null; }

function startEdit(chat: ChatEntry) {
  editingId.value = chat.userId;
  draft.value = (chat.nickname || '').trim() || resolvedName(chat);
  void nextTick(() => { editInput?.focus(); editInput?.select(); });
}
function cancelEdit() { editingId.value = ''; draft.value = ''; }
function commitEdit(chat: ChatEntry) {
  if (editingId.value !== chat.userId) return;
  const next = cleanNickname(draft.value);
  const prev = (chat.nickname || '').trim();
  cancelEdit();
  if (next !== prev) emit('rename', { userId: chat.userId, nickname: next });   // empty = remove the custom name
}
function onEditKey(e: KeyboardEvent, chat: ChatEntry) {
  e.stopPropagation();                                   // typing must never trigger the row's open-chat keys
  if (e.key === 'Enter')  { e.preventDefault(); commitEdit(chat); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
}

function onRowClick(chat: ChatEntry) {
  if (editingId.value) cancelEdit();                     // tapping elsewhere abandons an edit in progress
  emit('openChat', chat);
}
function onRowKey(e: KeyboardEvent, chat: ChatEntry) {
  if (e.target !== e.currentTarget) return;              // keys from the pencil / editor are theirs, not ours
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); emit('openChat', chat); }
}

// "You: hey" is how the list stores our own last message; show the prefix as a muted label.
function isMine(chat: ChatEntry): boolean { return (chat.lastMessage || '').startsWith('You: '); }
function previewText(chat: ChatEntry): string {
  const m = chat.lastMessage || '';
  return isMine(chat) ? m.slice(5) : m;
}

const router = useRouter();
const inviteLinkInput = ref('');
const linkFocused = ref(false);
const linkError = ref('');
const openingLink = ref(false);
const linkEl = ref<HTMLInputElement | null>(null);

const composerOpen = ref(false);
function toggleComposer(force?: boolean | Event) {
  composerOpen.value = typeof force === 'boolean' ? force : !composerOpen.value;
  if (composerOpen.value) void nextTick(() => linkEl.value?.focus());
}

const query = ref('');
const trimmed = computed(() => query.value.trim());

// Tell the parent what to look for (debounced), so it can search the stored messages.
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(query, (v) => {
  if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
  const q = v.trim();
  if (!q) { emit('search', ''); return; }
  searchTimer = setTimeout(() => { searchTimer = null; emit('search', q); }, 180);
});
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer); });

/** Message hits, but only if they answer the CURRENT text (never show results for an older query). */
const hits = computed<Record<string, MessageHit>>(() =>
  props.messageSearch && props.messageSearch.query === trimmed.value ? props.messageSearch.hits : {});
const searchPending = computed(() =>
  Array.from(trimmed.value).length >= MIN_MESSAGE_QUERY && props.messageSearch?.query !== trimmed.value);

function nameMatches(c: ChatEntry): boolean {
  return !!findMatch(displayName(c), trimmed.value) || !!findMatch(baseName(c), trimmed.value);
}
const filteredChats = computed(() => {
  const q = trimmed.value;
  if (!q) return props.chatList;
  return props.chatList.filter(c => nameMatches(c) || !!hits.value[c.userId] || !!findMatch(c.lastMessage || '', q));
});

// What each row shows while searching. When not searching these collapse to the normal name / preview.
function nameParts(c: ChatEntry) {
  const n = displayName(c);
  if (!trimmed.value) return [{ t: n, hit: false }];
  if (findMatch(n, trimmed.value)) return splitHighlight(n, trimmed.value);
  return [{ t: n, hit: false }];
}
function matchCount(c: ChatEntry): number { return hits.value[c.userId]?.count ?? 0; }
function previewMine(c: ChatEntry): boolean { const h = hits.value[c.userId]; return h ? h.mine : isMine(c); }
function previewParts(c: ChatEntry): { t: string; hit: boolean }[] {
  const h = hits.value[c.userId];
  if (h) return [{ t: h.before, hit: false }, { t: h.hit, hit: true }, { t: h.after, hit: false }].filter(p => p.t);
  const text = previewText(c);
  return trimmed.value ? splitHighlight(text, trimmed.value) : (text ? [{ t: text, hit: false }] : []);
}
function previewShown(c: ChatEntry): boolean { return previewParts(c).length > 0; }

function extractChatPath(raw: string): { userId: string; name: string } | null {
  const s = raw.trim();
  try {
    // Try as full URL first
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    // Fragment format from ProfilePage: /chat#id=<userId>&name=<name>
    if (url.pathname === '/chat' && url.hash) {
      const frag = new URLSearchParams(url.hash.slice(1));
      const id = frag.get('id');
      if (id) return { userId: id, name: frag.get('name') || 'User' };
    }
    const match = url.pathname.match(/^\/chat\/([^/?#]+)/);
    if (match) {
      return {
        userId: decodeURIComponent(match[1]),
        name: url.searchParams.get('name') ? decodeURIComponent(url.searchParams.get('name')!) : 'User',
      };
    }
  } catch { /* not a URL */ }
  // Try as bare path /chat/userid
  const pathMatch = s.match(/\/chat\/([^/?#\s]+)(?:\?name=([^&\s]+))?/);
  if (pathMatch) {
    return {
      userId: decodeURIComponent(pathMatch[1]),
      name: pathMatch[2] ? decodeURIComponent(pathMatch[2]) : 'User',
    };
  }
  return null;
}

async function openFromLink() {
  const raw = inviteLinkInput.value.trim();
  if (!raw) return;
  linkError.value = '';
  const parsed = extractChatPath(raw);
  if (!parsed || !parsed.userId) {
    linkError.value = 'That doesn\'t look like a valid chat link.';
    return;
  }
  openingLink.value = true;
  try {
    await router.push(chatPath(parsed.userId, parsed.name));
    inviteLinkInput.value = '';
    composerOpen.value = false;
  } finally {
    openingLink.value = false;
  }
}

function onLinkPaste(e: ClipboardEvent) {
  // Auto-open on paste after a tick so v-model is updated
  setTimeout(() => { if (inviteLinkInput.value.trim()) openFromLink(); }, 50);
}

const TONES = ['tone-violet','tone-blue','tone-teal','tone-amber','tone-rose'];
function chatTone(id: string) {
  const code = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}

/** WhatsApp-style: a clock time for today, then "Yesterday", the weekday, then a date. */
function formatChatTime(timestamp: number): string {
  if (!timestamp) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  const d = new Date(timestamp);
  if (timestamp >= startToday)            return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (timestamp >= startToday - DAY)      return 'Yesterday';
  if (timestamp >= startToday - 6 * DAY)  return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], {
    day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}
</script>

<style scoped>
.ct {
  display: flex; flex-direction: column; gap: 12px; padding: 2px 0 12px;
  /* Everything below derives from the app's theme tokens, so light and dark both work. */
  --ct-hover:  rgba(var(--app-accent-rgb), 0.07);
  --ct-press:  rgba(var(--app-accent-rgb), 0.14);
  --ct-tint:   rgba(var(--app-accent-rgb), 0.14);
}

/* ── Header: pill search + "New chat" button ───────────────────────── */
/* A little inset so the search doesn't sit flush against the screen edge. */
.ct-head { display: flex; align-items: center; gap: 8px; padding: 2px 0 0; margin: 0 6px; }
.ct-new {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex-shrink: 0;
  height: 46px; padding: 0 14px 0 11px; border: none; border-radius: 999px; white-space: nowrap;
  background: linear-gradient(135deg, var(--app-accent-bright), #8b5cf6); color: #fff;
  font: inherit; font-size: 13px; font-weight: 700; letter-spacing: -0.005em; line-height: 1;
  cursor: pointer; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
  transition: transform 140ms, box-shadow 140ms; -webkit-tap-highlight-color: transparent;
}
.ct-new:active { transform: scale(0.96); }
.ct-new__icon { width: 19px; height: 19px; flex-shrink: 0; }
.ct-new--open { background: rgba(var(--app-accent-rgb), 0.18); color: var(--app-text); box-shadow: none; }
/* Phones: the label would squeeze the placeholder ("Search by message or name") off the pill, so the
   icon sits ABOVE a small caption in a compact tile. The label stays visible at every width. */
@media (max-width: 399px) {
  .ct-new { flex-direction: column; gap: 3px; width: 58px; padding: 0; border-radius: 16px; font-size: 10.5px; }
}
/* The very smallest phones (320px): trim a little more so the placeholder still fits. */
@media (max-width: 339px) {
  .ct .ct-new { width: 52px; }
  .ct .ct-search__input { font-size: 13px; }   /* .ct prefix: this block comes before the base rule, so it needs the extra specificity */
}
/* Larger screens: a little breathing room above the search. */
@media (min-width: 768px) {
  .ct { padding-top: 18px; }
}

/* ── New-chat panel ─────────────────────────────────────────────────── */
.ct-composer {
  margin: 0 6px;
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  background: rgba(var(--app-accent-rgb), 0.07); border: 1px solid rgba(var(--app-accent-rgb), 0.18); border-radius: 18px;
}
.ct-composer__label { font-size: 12.5px; color: var(--app-text-subtle); }
.ct-composer__actions { display: flex; gap: 10px; align-items: stretch; }
.ct-composer__actions .open-btn { flex: 1; }
.ct-linkbtn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px;
  border-radius: 12px; border: 1px solid var(--app-border-strong); background: transparent;
  color: var(--app-text-muted); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer;
}
.ct-linkbtn svg { width: 15px; height: 15px; color: #34d399; flex-shrink: 0; }
.ct-linkbtn:hover { background: var(--app-pill-surface); }
.ct-slide-enter-active, .ct-slide-leave-active { transition: opacity 180ms, transform 180ms; }
.ct-slide-enter-from, .ct-slide-leave-to { opacity: 0; transform: translateY(-6px); }

/* ── Link input ────────────────────────────── */
.link-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--app-accent-rgb), 0.09);
  border: 1px solid rgba(var(--app-accent-rgb), 0.24);
  transition: border-color 180ms, box-shadow 180ms;
}
.link-input-wrap.focused {
  border-color: rgba(99,102,241,0.45);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.link-input-wrap.error { border-color: rgba(239,68,68,0.5); }

.link-prefix-icon {
  width: 15px; height: 15px;
  flex-shrink: 0;
  color: #818cf8;
  opacity: 0.7;
}

.link-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 13.5px;
  font-family: monospace;
  color: var(--app-text);
  min-width: 0;
}
.link-input::placeholder { color: var(--app-text-subtle); font-family: inherit; }

.link-clear {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--app-pill-surface); border: none;
  color: var(--app-text-subtle); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.link-clear svg { width: 10px; height: 10px; }

.link-error {
  margin: -4px 0 0;
  font-size: 12px;
  color: #f87171;
}

/* ── Open button ───────────────────────────── */
.open-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px;
  border-radius: 12px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border: none;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 160ms, transform 160ms;
}
.open-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.open-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.open-btn svg { width: 16px; height: 16px; }

/* ── Search (pill) ──────────────────────────────────────────────────── */
.ct-search {
  flex: 1; min-width: 0; height: 46px; box-sizing: border-box; padding: 0 6px 0 14px;
  display: flex; align-items: center; gap: 8px; border-radius: 999px;
  background: rgba(var(--app-accent-rgb), 0.08); border: 1px solid rgba(var(--app-accent-rgb), 0.2);
  color: var(--app-text-subtle); transition: border-color 140ms, box-shadow 140ms, background 140ms;
}
.ct-search:focus-within {
  border-color: rgba(var(--app-accent-rgb), 0.55); background: rgba(var(--app-accent-rgb), 0.12);
  box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.14);
}
.ct-search > svg { width: 17px; height: 17px; flex-shrink: 0; }
.ct-search__input { flex: 1; min-width: 0; height: 100%; background: transparent; border: none; outline: none; font: inherit; font-size: 14px; color: var(--app-text); }
.ct-search__input::placeholder { color: var(--app-text-subtle); text-overflow: ellipsis; }
.ct-nomatch { text-align: center; color: var(--app-text-muted); font-size: 13.5px; margin: 22px 0; }
.ct-hit { background: rgba(var(--app-accent-rgb), 0.3); color: inherit; border-radius: 4px; padding: 0 1px; }
.ct-row__matches {
  flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--app-accent-bright);
  background: rgba(var(--app-accent-rgb), 0.14); border-radius: 999px; padding: 2px 8px; white-space: nowrap;
}

/* ── Avatars ────────────────────────────────────────────────────────── */
.avatar {
  width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 19px; font-weight: 800; color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}
.avatar__ghost { width: 60%; height: 60%; opacity: 0.92; }
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); }


/* ── The list: one continuous surface ───────────────────────────────── */
.ct-list {
  list-style: none; margin: 0; padding: 0; overflow: hidden;
  /* Fully transparent: the rows sit directly on the body/aurora, like the other tabs. */
  border-radius: 18px; background: transparent; border: none;
}
.ct-row {
  position: relative; display: flex; align-items: center; gap: 14px; padding: 12px 16px;
  cursor: pointer; transition: background 140ms; -webkit-tap-highlight-color: transparent; outline: none;
}
/* hairline between rows, starting after the avatar (16 padding + 52 avatar + 14 gap) */
.ct-row + .ct-row::before {
  content: ''; position: absolute; top: 0; left: 82px; right: 16px; height: 1px; background: rgba(var(--app-accent-rgb), 0.16);
}
.ct-row:hover { background: var(--ct-hover); }
.ct-row:active { background: var(--ct-press); }
.ct-row:focus-visible { background: var(--ct-tint); box-shadow: inset 0 0 0 2px rgba(var(--app-accent-rgb), 0.55); }

.ct-row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ct-row__top, .ct-row__bottom { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ct-row__top { justify-content: flex-start; gap: 4px; }
.ct-row__name {
  font-size: 16px; font-weight: 600; letter-spacing: -0.01em; color: var(--app-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
.ct-row__time { font-size: 12px; color: var(--app-text-subtle); white-space: nowrap; flex-shrink: 0; margin-left: auto; padding-left: 8px; }

/* Rename pencil: always visible (there is no hover on a phone), quiet until used */
.ct-row__edit {
  flex-shrink: 0; width: 28px; height: 28px; margin: -4px 0 -4px 0; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; background: transparent; color: var(--app-text-subtle); opacity: 0.75;
  cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background 120ms, color 120ms, opacity 120ms;
}
.ct-row__edit svg { width: 15px; height: 15px; }
.ct-row__edit:hover, .ct-row__edit:focus-visible { opacity: 1; color: var(--app-accent-bright); background: rgba(var(--app-accent-rgb), 0.16); outline: none; }
.ct-row__edit:active { background: rgba(var(--app-accent-rgb), 0.26); }

.ct-edit { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; margin: -3px 0; }
.ct-edit__input {
  flex: 1; min-width: 0; height: 32px; box-sizing: border-box; padding: 0 11px;
  border-radius: 10px; border: 1px solid rgba(var(--app-accent-rgb), 0.55); outline: none;
  background: rgba(var(--app-accent-rgb), 0.12); color: var(--app-text);
  font: inherit; font-size: 15px; font-weight: 600;
  box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb), 0.15);
}
.ct-edit__input::placeholder { color: var(--app-text-subtle); font-weight: 500; }
.ct-edit__btn {
  flex-shrink: 0; width: 32px; height: 32px; padding: 0; border: none; border-radius: 10px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(var(--app-accent-rgb), 0.14); color: var(--app-text-muted); -webkit-tap-highlight-color: transparent;
}
.ct-edit__btn svg { width: 16px; height: 16px; }
.ct-edit__btn--ok { background: linear-gradient(135deg, var(--app-accent-bright), #8b5cf6); color: #fff; }
.ct-edit__btn:active { transform: scale(0.94); }
.ct-row__preview {
  font-size: 14px; color: var(--app-text-muted); min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ct-row__preview--empty { font-style: italic; opacity: 0.7; }
.ct-row__you { color: var(--app-text-subtle); margin-right: 4px; }
.ct-row__badge {
  flex-shrink: 0; min-width: 21px; height: 21px; padding: 0 6px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--app-accent-bright), #8b5cf6); color: #fff; font-size: 11.5px; font-weight: 800;
}
/* unread: heavier name, bright accent time, brighter preview */
.ct-row--unread { background: rgba(var(--app-accent-rgb), 0.07); }
.ct-row--unread:hover { background: rgba(var(--app-accent-rgb), 0.12); }
.ct-row--unread .ct-row__name { font-weight: 800; }
.ct-row--unread .ct-row__time { color: var(--app-accent-bright); font-weight: 700; }
.ct-row--unread .ct-row__preview { color: var(--app-text); font-weight: 500; }

/* ── Spinner ───────────────────────────────── */
.mini-spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }


/* ── Skeleton (same surface as the list) ────────────────────────────── */
.ct-skel__avatar, .ct-skel__lines span {
  background: linear-gradient(90deg, rgba(var(--app-accent-rgb), .10), rgba(var(--app-accent-rgb), .24), rgba(var(--app-accent-rgb), .10));
  background-size: 200% 100%; animation: ct-skel 1.2s ease-in-out infinite;
}
.ct-skel__avatar { width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0; }
.ct-skel__lines { flex: 1; display: flex; flex-direction: column; gap: 9px; }
.ct-skel__lines span { height: 12px; border-radius: 6px; width: 62%; }
.ct-skel__lines span + span { width: 40%; height: 10px; }
.ct-skel__row { cursor: default; }
@keyframes ct-skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── Empty ──────────────────────────────────────────────────────────── */
.ct-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 40px 24px; }
.ct-empty__icon {
  width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); color: #818cf8;
}
.ct-empty__icon svg { width: 28px; height: 28px; }
.ct-empty__title { margin: 6px 0 0; font-size: 17px; font-weight: 700; color: var(--app-text); }
.ct-empty__sub { margin: 0; max-width: 300px; font-size: 13.5px; line-height: 1.5; color: var(--app-text-muted); }
.ct-empty__cta { margin-top: 10px; padding: 11px 26px; }

@media (prefers-reduced-motion: reduce) {
  .ct-skel__avatar, .ct-skel__lines span, .mini-spinner { animation: none; }
  .ct-new, .ct-row, .ct-slide-enter-active, .ct-slide-leave-active { transition: none; }
}
</style>