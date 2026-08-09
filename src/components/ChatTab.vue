<template>
  <div class="chat-tab">

    <!-- Unread banner -->
    <div v-if="totalUnread > 0" class="unread-banner">
      <div class="unread-dot"></div>
      <span>{{ totalUnread }} unread message{{ totalUnread > 1 ? 's' : '' }}</span>
    </div>

    <!-- Search bar -->
    <div class="search-wrap" :class="{ focused: searchFocused }">
      <svg class="search-icon" viewBox="0 0 24 24" fill="none">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
        <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <input
        v-model="userSearchQuery"
        class="search-input"
        type="search"
        placeholder="Search users to chat…"
        autocomplete="off"
        @focus="searchFocused = true"
        @blur="searchFocused = false"
        @input="$emit('searchUsers', userSearchQuery)"
      />
      <button v-if="userSearchQuery" class="clear-btn" @click="clearSearch">
        <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>

    <!-- Searching spinner -->
    <div v-if="searchingUsers" class="state-row">
      <div class="mini-spinner"></div>
      <span>Searching…</span>
    </div>

    <!-- Search results -->
    <div v-else-if="userSearchQuery && userSearchResults.length > 0" class="results-list">
      <p class="list-label">Users</p>
      <div
        v-for="user in userSearchResults"
        :key="user.id"
        class="user-row"
        @click="$emit('startChat', user)"
      >
        <div class="avatar avatar-user">
          {{ (user.name || user.username || 'U').charAt(0).toUpperCase() }}
        </div>
        <div class="row-info">
          <span class="row-name">{{ user.name }}</span>
          <span class="row-sub">u/{{ user.username }}</span>
        </div>
        <div class="start-chat-btn">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
          Chat
        </div>
      </div>
    </div>

    <!-- No results -->
    <div v-else-if="userSearchQuery && !searchingUsers" class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </div>
      <p class="empty-title">No users found</p>
      <p class="empty-sub">No results for "{{ userSearchQuery }}"</p>
    </div>

    <!-- Conversation list -->
    <template v-if="!userSearchQuery">
      <p class="list-label">Recent Conversations</p>

      <div v-if="chatList.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </div>
        <p class="empty-title">No conversations yet</p>
        <p class="empty-sub">Search for a user above to start chatting</p>
      </div>

      <div v-else class="chat-list">
        <div
          v-for="chat in chatList"
          :key="chat.userId"
          class="chat-row"
          @click="$emit('openChat', chat)"
        >
          <div class="avatar avatar-chat" :class="chatTone(chat.userId)">
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
    </template>

  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

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
  (e: 'searchUsers', query: string): void;
  (e: 'clearUserSearch'): void;
  (e: 'startChat', user: UserResult): void;
  (e: 'openChat', chat: ChatEntry): void;
}>();

const userSearchQuery = ref('');
const searchFocused = ref(false);

function clearSearch() {
  userSearchQuery.value = '';
  emit('clearUserSearch');
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
  gap: 12px;
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

/* ── Search ────────────────────────────────── */
.search-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  outline: none;
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.search-wrap.focused {
  border-color: rgba(99,102,241,0.45);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.search-icon {
  width: 16px; height: 16px;
  color: var(--app-text-subtle);
  flex-shrink: 0;
}
.search-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 14px; font-family: inherit; color: var(--ion-text-color);
  -webkit-appearance: none; appearance: none;
}
.search-input::placeholder { color: var(--app-text-subtle); }
.search-input::-webkit-search-cancel-button,
.search-input::-webkit-search-decoration { -webkit-appearance: none; }

.clear-btn {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(255,255,255,0.08); border: none;
  color: var(--app-text-subtle); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: background 160ms ease;
}
.clear-btn:hover { background: rgba(255,255,255,0.14); }
.clear-btn svg { width: 12px; height: 12px; }

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
.avatar-user {
  background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(139,92,246,0.3));
  border: 1px solid rgba(99,102,241,0.3);
  color: #a5b4fc;
  font-size: 22px;
}
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 3px 10px rgba(99,102,241,.28); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); box-shadow: 0 3px 10px rgba(59,130,246,.28); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); box-shadow: 0 3px 10px rgba(20,184,166,.28); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); box-shadow: 0 3px 10px rgba(245,158,11,.28); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); box-shadow: 0 3px 10px rgba(236,72,153,.28); }

/* ── User search results ───────────────────── */
.results-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.user-row:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.12);
  transform: translateY(-1px);
}
.user-row:active { transform: translateY(0); }

/* ── Row info ──────────────────────────────── */
.row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.row-name {
  font-size: 14.5px; font-weight: 700;
  letter-spacing: -0.02em; color: var(--app-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.row-sub { font-size: 12px; color: var(--app-text-subtle); }

.start-chat-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 999px;
  background: rgba(99,102,241,0.12);
  border: 1px solid rgba(99,102,241,0.22);
  color: #818cf8; font-size: 12px; font-weight: 700;
  flex-shrink: 0; white-space: nowrap;
}
.start-chat-btn svg { width: 13px; height: 13px; }

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
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  -webkit-tap-highlight-color: transparent;
}
.chat-row:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.12);
  transform: translateY(-1px);
}
.chat-row:active { transform: translateY(0); }

.chat-header-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.chat-time {
  font-size: 11px;
  color: var(--app-text-subtle);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.chat-preview {
  font-size: 13px;
  color: var(--app-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  margin-top: 2px;
  display: block;
}

.unread-badge {
  flex-shrink: 0;
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  box-shadow: 0 2px 8px rgba(99,102,241,0.4);
}

/* ── States ────────────────────────────────── */
.state-row {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 4px; color: var(--app-text-muted); font-size: 13.5px;
}
.mini-spinner {
  width: 18px; height: 18px;
  border: 2px solid rgba(99,102,241,0.2);
  border-top-color: #6366f1; border-radius: 50%;
  animation: spin 0.7s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 40px 24px; text-align: center; gap: 10px;
}
.empty-icon {
  width: 52px; height: 52px; border-radius: 50%;
  background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
  display: flex; align-items: center; justify-content: center;
  color: #818cf8;
}
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 15px; font-weight: 700; color: var(--app-text); margin: 0; }
.empty-sub   { font-size: 13px; color: var(--app-text-muted); margin: 0; }
</style>