<template>
  <div class="chat-tab">

    <!-- Unread banner -->
    <div v-if="totalUnread > 0" class="unread-banner">
      <div class="unread-dot"></div>
      <span>{{ totalUnread }} unread message{{ totalUnread > 1 ? 's' : '' }}</span>
    </div>

    <!-- ── Start new chat ─────────────────────────── -->
    <div class="section-card">
      <p class="card-title">
        <svg viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        New Message
      </p>
      <p class="card-desc">Paste a chat link shared by someone, or share your own link from your Profile.</p>

      <!-- Paste invite link -->
      <div class="link-input-wrap" :class="{ focused: linkFocused, error: linkError }">
        <svg viewBox="0 0 24 24" fill="none" class="link-prefix-icon"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input
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
        <button v-if="inviteLinkInput" class="link-clear" @click="inviteLinkInput = ''; linkError = ''">
          <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <p v-if="linkError" class="link-error">{{ linkError }}</p>

      <button class="open-btn" :disabled="!inviteLinkInput.trim() || openingLink" @click="openFromLink">
        <span v-if="openingLink" class="mini-spinner"></span>
        <svg v-else viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Open Chat
      </button>

      <div class="divider-row">
        <span class="divider-line"></span>
        <span class="divider-text">or</span>
        <span class="divider-line"></span>
      </div>

      <button class="share-own-btn" @click="$router.push('/profile')">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="18" cy="5" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="19" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        Get My Chat Link
      </button>
    </div>

    <!-- ── Recent conversations ───────────────────── -->
    <div v-if="chatList.length > 0">
      <p class="list-label">Recent Conversations</p>
      <div class="chat-list">
        <div
          v-for="chat in chatList"
          :key="chat.userId"
          class="chat-row"
          @click="$emit('openChat', chat)"
        >
          <div class="avatar" :class="chatTone(chat.userId)">
            {{ (chat.name || '?').charAt(0).toUpperCase() }}
          </div>
          <div class="row-info">
            <div class="chat-header-row">
              <span class="row-name">{{ chat.name }}</span>
              <span class="chat-time">{{ formatChatTime(chat.lastMessageTime) }}</span>
            </div>
            <span class="chat-preview">{{ chat.lastMessage }}</span>
          </div>
          <div v-if="chat.unreadCount > 0" class="unread-badge">
            {{ chat.unreadCount > 99 ? '99+' : chat.unreadCount }}
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state when no conversations -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      </div>
      <p class="empty-title">No conversations yet</p>
      <p class="empty-sub">Share your chat link with someone and they can message you directly.</p>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

interface ChatEntry {
  userId: string;
  name: string;
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
}>();

const emit = defineEmits<{
  (e: 'openChat', chat: ChatEntry): void;
  (e: 'openFromLink', url: string): void;
  // keep legacy emits so HomePage doesn't break
  (e: 'searchUsers', query: string): void;
  (e: 'clearUserSearch'): void;
  (e: 'startChat', user: UserResult): void;
}>();

const router = useRouter();
const inviteLinkInput = ref('');
const linkFocused = ref(false);
const linkError = ref('');
const openingLink = ref(false);

function extractChatPath(raw: string): { userId: string; name: string } | null {
  const s = raw.trim();
  try {
    // Try as full URL first
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
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
    await router.push(`/chat/${encodeURIComponent(parsed.userId)}?name=${encodeURIComponent(parsed.name)}`);
    inviteLinkInput.value = '';
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

function formatChatTime(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60_000)      return 'Just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>

<style scoped>
.chat-tab {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}

/* ── Unread banner ─────────────────────────── */
.unread-banner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-radius: 999px;
  background: rgba(99,102,241,0.1);
  border: 1px solid rgba(99,102,241,0.22);
  color: #a5b4fc;
  font-size: 13px;
  font-weight: 600;
  align-self: flex-start;
}
.unread-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #6366f1;
  box-shadow: 0 0 8px rgba(99,102,241,0.7);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%,100% { box-shadow: 0 0 6px rgba(99,102,241,0.5); }
  50%      { box-shadow: 0 0 14px rgba(99,102,241,0.9); }
}

/* ── New message card ──────────────────────── */
.section-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--app-text);
  margin: 0;
}
.card-title svg { width: 16px; height: 16px; color: #818cf8; flex-shrink: 0; }

.card-desc {
  font-size: 12.5px;
  color: var(--app-text-subtle);
  margin: 0;
  line-height: 1.5;
}

/* ── Link input ────────────────────────────── */
.link-input-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
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
  background: rgba(255,255,255,0.08); border: none;
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

/* ── Divider ───────────────────────────────── */
.divider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.divider-line {
  flex: 1;
  height: 1px;
  background: rgba(255,255,255,0.08);
}
.divider-text {
  font-size: 11.5px;
  color: var(--app-text-subtle);
  font-weight: 600;
}

/* ── Share own link button ─────────────────── */
.share-own-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background: transparent;
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--app-text-muted);
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}
.share-own-btn:hover {
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.16);
}
.share-own-btn svg { width: 15px; height: 15px; color: #34d399; flex-shrink: 0; }

/* ── Section label ─────────────────────────── */
.list-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--app-text-subtle);
  margin: 4px 2px 0;
}

/* ── Avatars ───────────────────────────────── */
.avatar {
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800; color: #fff; flex-shrink: 0;
}
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); }

/* ── Chat list rows ────────────────────────── */
.chat-list { display: flex; flex-direction: column; gap: 6px; }

.chat-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer;
  transition: background 160ms, border-color 160ms, transform 160ms;
  -webkit-tap-highlight-color: transparent;
}
.chat-row:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.12); transform: translateY(-1px); }
.chat-row:active { transform: translateY(0); }

.row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.chat-header-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.row-name { font-size: 14.5px; font-weight: 700; letter-spacing: -0.02em; color: var(--app-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-time { font-size: 11px; color: var(--app-text-subtle); font-weight: 500; white-space: nowrap; flex-shrink: 0; }
.chat-preview { font-size: 13px; color: var(--app-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; margin-top: 2px; }

.unread-badge {
  flex-shrink: 0; min-width: 22px; height: 22px; border-radius: 999px;
  background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
  font-size: 11px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  padding: 0 6px; box-shadow: 0 2px 8px rgba(99,102,241,0.4);
}

/* ── Spinner ───────────────────────────────── */
.mini-spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Empty state ───────────────────────────── */
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 24px; text-align: center; gap: 10px; }
.empty-icon { width: 52px; height: 52px; border-radius: 50%; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); display: flex; align-items: center; justify-content: center; color: #818cf8; }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 15px; font-weight: 700; color: var(--app-text); margin: 0; }
.empty-sub { font-size: 13px; color: var(--app-text-muted); margin: 0; line-height: 1.5; }
</style>