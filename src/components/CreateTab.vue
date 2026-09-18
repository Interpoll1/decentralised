<template>
  <div class="ct">

    <transition name="ct-slide" mode="out-in">

      <!-- ── PICKER VIEW ─────────────────────────────────────────── -->
      <div v-if="pickerOpen" key="picker" class="ct-view">

        <button class="ct-back" @click="closePicker">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Back
        </button>

        <div class="ct-picker-head">
          <div class="ct-ph-icon" :class="pickerMode === 'post' ? 'ct-ph-icon--post' : 'ct-ph-icon--poll'">
            <svg v-if="pickerMode === 'post'" viewBox="0 0 24 24" fill="none">
              <path d="M12 20h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
              <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                    stroke="currentColor" stroke-width="1.8"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none">
              <path d="M18 20V10M12 20V4M6 20v-6"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <h2 class="ct-ph-title">
              {{ pickerMode === 'post' ? 'Post to…' : 'Poll in…' }}
            </h2>
            <p class="ct-ph-sub">Pick a community</p>
          </div>
        </div>

        <!-- Search -->
        <div class="ct-search" :class="{ 'ct-search--focus': searchFocused }">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14" class="ct-search-ico">
            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input
            ref="searchEl"
            v-model="searchQuery"
            class="ct-search-input"
            placeholder="Search communities…"
            autocomplete="off"
            spellcheck="false"
            @focus="searchFocused = true"
            @blur="searchFocused = false"
          />
          <button v-if="searchQuery" class="ct-search-clear" @click="searchQuery = ''">
            <svg viewBox="0 0 24 24" fill="none" width="10" height="10">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor"
                    stroke-width="2.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>

        <!-- List -->
        <div class="ct-list">
          <div v-if="filteredCommunities.length === 0" class="ct-list-empty">
            <p v-if="searchQuery">No communities match "{{ searchQuery }}"</p>
            <template v-else>
              <p>No communities available yet.</p>
              <button
                class="ct-empty-btn"
                @click="pickerMode === 'poll' ? $router.push('/create-poll') : $router.push('/communities')"
              >
                {{ pickerMode === 'poll' ? 'Create a poll anyway' : 'Browse Communities' }}
              </button>
            </template>
          </div>
          <button
            v-for="c in filteredCommunities"
            :key="c.id"
            class="ct-row"
            @click="pickCommunity(c)"
          >
            <span class="ct-row-av" :class="avTone(c.id)">
              {{ initial(c) }}
            </span>
            <span class="ct-row-body">
              <span class="ct-row-name">{{ c.displayName || c.name }}</span>
              <span class="ct-row-meta">
                c/{{ c.id }}
                <span class="ct-dot">·</span>
                {{ (c.memberCount ?? 0).toLocaleString() }} members
              </span>
            </span>
            <svg class="ct-row-arrow" viewBox="0 0 24 24" fill="none" width="14" height="14">
              <path d="M9 18l6-6-6-6" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>

      </div>

      <!-- ── HOME VIEW ───────────────────────────────────────────── -->
      <div v-else key="home" class="ct-view">

        <div class="ct-hero">
          <p class="ct-eyebrow">Create</p>
          <h2 class="ct-title">What are you putting out there?</h2>
        </div>

        <!-- Action rows grouped in a single glass list -->
        <div class="ct-actions">

          <button class="ct-action" @click="$router.push('/create-community')">
            <span class="ct-action-ico ct-action-ico--community">
              <!-- Two people -->
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
                      stroke="currentColor" stroke-width="1.7"
                      stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.7"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
                      stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="ct-action-text">
              <span class="ct-action-name">Community</span>
              <span class="ct-action-desc">Build a space around a topic</span>
            </span>
            <svg class="ct-action-arrow" viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M9 18l6-6-6-6" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <button class="ct-action" @click="openPicker('post')">
            <span class="ct-action-ico ct-action-ico--post">
              <!-- Pencil write -->
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M12 20h9" stroke="currentColor"
                      stroke-width="1.7" stroke-linecap="round"/>
                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
                      stroke="currentColor" stroke-width="1.7"
                      stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="ct-action-text">
              <span class="ct-action-name">Post</span>
              <span class="ct-action-desc">Share text, images or a video</span>
            </span>
            <svg class="ct-action-arrow" viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M9 18l6-6-6-6" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <button class="ct-action" @click="openPicker('poll')">
            <span class="ct-action-ico ct-action-ico--poll">
              <!-- Bar chart -->
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M18 20V10M12 20V4M6 20v-6"
                      stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="ct-action-text">
              <span class="ct-action-name">Poll</span>
              <span class="ct-action-desc">Ask the community a question</span>
            </span>
            <svg class="ct-action-arrow" viewBox="0 0 24 24" fill="none" width="15" height="15">
              <path d="M9 18l6-6-6-6" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

        </div>

        <!-- Quick-post chips -->
        <template v-if="joinedCommunities.length > 0">
          <p class="ct-section-label">Quick post to</p>
          <div class="ct-chips">
            <button
              v-for="c in joinedCommunities.slice(0, 10)"
              :key="c.id"
              class="ct-chip"
              @click="$router.push(`/community/${c.id}/create-post`)"
            >
              <span class="ct-chip-av" :class="avTone(c.id)">{{ initial(c) }}</span>
              <span class="ct-chip-name">{{ c.displayName || c.name }}</span>
            </button>
          </div>
          <p class="ct-hint">
            Showing joined only ·
            <span class="ct-link" @click="$router.push('/communities')">Browse all →</span>
          </p>
        </template>

        <div v-else class="ct-empty">
          <p class="ct-empty-text">You haven't joined any communities yet.</p>
          <button class="ct-empty-btn" @click="$router.push('/communities')">
            Browse Communities
          </button>
        </div>

      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useCommunityStore } from '../stores/communityStore';

// Keep emits so HomePage stays compatible — but we handle picker here now
defineEmits<{
  (e: 'showPostOptions'): void;
  (e: 'showPollOptions'): void;
}>();

const router = useRouter();
const communityStore = useCommunityStore();

const joinedCommunities = computed(() =>
  communityStore.communities.filter((c: any) => communityStore.isJoined(c.id)),
);

// ── Picker state ────────────────────────────────────────────────────
const pickerOpen    = ref(false);
const pickerMode    = ref<'post' | 'poll'>('post');
const searchQuery   = ref('');
const searchFocused = ref(false);
const searchEl      = ref<HTMLInputElement | null>(null);

const filteredCommunities = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const base = joinedCommunities.value.length
    ? joinedCommunities.value
    : communityStore.communities;
  if (!q) return base;
  return base.filter((c: any) =>
    (c.displayName || c.name || '').toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q),
  );
});

function openPicker(mode: 'post' | 'poll') {
  // With no communities loaded the picker has nothing to render, which reads as
  // a blank content pane. Polls have a standalone route with their own in-page
  // community picker — go straight there instead of showing an empty list.
  if (communityStore.communities.length === 0) {
    router.push(mode === 'poll' ? '/create-poll' : '/communities');
    return;
  }
  pickerMode.value  = mode;
  searchQuery.value = '';
  pickerOpen.value  = true;
}
function closePicker() { pickerOpen.value = false; }
function pickCommunity(c: any) {
  closePicker();
  router.push(pickerMode.value === 'post'
    ? `/community/${c.id}/create-post`
    : `/community/${c.id}/create-poll`);
}

watch(pickerOpen, async (open) => {
  if (open) { await nextTick(); searchEl.value?.focus(); }
});

// ── Helpers ─────────────────────────────────────────────────────────
const TONES = ['av-violet', 'av-blue', 'av-teal', 'av-amber', 'av-rose'];
function avTone(id: string) {
  const n = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return TONES[n % TONES.length];
}
function initial(c: any) {
  return (c.displayName || c.name || 'C').charAt(0).toUpperCase();
}
</script>

<style scoped>

/* ── Root — transparent, sits on the aurora body ──────────────── */
.ct {
  padding: 20px 16px 32px;
  overflow: hidden;
}

/* ── Slide transition between home ↔ picker ───────────────────── */
.ct-slide-enter-active,
.ct-slide-leave-active {
  transition: transform 240ms cubic-bezier(.22,1,.36,1), opacity 180ms ease;
}
.ct-slide-enter-from { transform: translateX(24px); opacity: 0; }
.ct-slide-leave-to   { transform: translateX(-16px); opacity: 0; }

.ct-view { display: flex; flex-direction: column; gap: 20px; }

/* ── Back button ───────────────────────────────────────────────── */
.ct-back {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px 6px 8px;
  border-radius: 999px;
  background: var(--app-item-surface);
  border: 1px solid var(--app-border);
  font-size: 13px; font-weight: 600; font-family: inherit;
  color: var(--app-text-muted);
  cursor: pointer; width: fit-content;
  transition: background 150ms, color 150ms;
}
.ct-back:hover { background: var(--app-surface-hover); color: var(--app-text); }

/* ── Picker header ─────────────────────────────────────────────── */
.ct-picker-head {
  display: flex; align-items: center; gap: 14px;
}
.ct-ph-icon {
  width: 46px; height: 46px; border-radius: 14px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.ct-ph-icon svg { width: 22px; height: 22px; }
.ct-ph-icon--post {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  box-shadow: 0 4px 14px rgba(245,158,11,.28);
}
.ct-ph-icon--poll {
  background: linear-gradient(135deg, #14b8a6, #3b82f6);
  box-shadow: 0 4px 14px rgba(20,184,166,.28);
}
.ct-ph-title {
  margin: 0 0 2px;
  font-size: 20px; font-weight: 700; letter-spacing: -0.03em;
  color: var(--app-text);
}
.ct-ph-sub {
  margin: 0;
  font-size: 12.5px; color: var(--app-text-muted);
}

/* ── Search ────────────────────────────────────────────────────── */
.ct-search {
  display: flex; align-items: center; gap: 8px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--app-item-surface);
  border: 1px solid var(--app-border);
  transition: border-color 160ms, box-shadow 160ms;
}
.ct-search--focus {
  border-color: var(--app-border-accent);
  box-shadow: 0 0 0 2px rgba(94,106,210,.18);
}
.ct-search-ico { color: var(--app-text-subtle); flex-shrink: 0; }
.ct-search-input {
  flex: 1; background: transparent; border: none; outline: none;
  padding: 10px 0; font-size: 13.5px; font-family: inherit;
  color: var(--app-text);
}
.ct-search-input::placeholder { color: var(--app-text-subtle); }
.ct-search-clear {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--app-border-strong); border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--app-text-muted); flex-shrink: 0;
  transition: background 130ms;
}
.ct-search-clear:hover { background: var(--app-text-subtle); }

/* ── Community list ────────────────────────────────────────────── */
.ct-list {
  display: flex; flex-direction: column;
  border-radius: var(--app-radius-md);
  overflow: hidden;
  border: 1px solid var(--app-border);
}
.ct-list-empty {
  padding: 40px 20px; text-align: center;
  background: var(--app-item-surface);
  color: var(--app-text-muted); font-size: 13px;
}
.ct-list-empty p { margin: 0; }

.ct-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 13px 16px;
  background: var(--app-item-surface);
  border: none; border-top: 1px solid var(--app-border);
  cursor: pointer; text-align: left;
  transition: background 140ms;
  -webkit-tap-highlight-color: transparent;
}
.ct-row:first-child { border-top: none; }
.ct-row:hover { background: var(--app-surface-hover); }

.ct-row-av {
  width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; color: #fff;
}
.ct-row-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ct-row-name {
  font-size: 14px; font-weight: 700; color: var(--app-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
}
.ct-row-meta {
  font-size: 11.5px; color: var(--app-text-muted);
  display: flex; align-items: center; gap: 4px;
}
.ct-dot { opacity: 0.4; }
.ct-row-arrow {
  color: var(--app-text-subtle); flex-shrink: 0; opacity: 0.5;
  transition: transform 150ms, opacity 150ms;
}
.ct-row:hover .ct-row-arrow { transform: translateX(3px); opacity: 1; }

/* ── HOME ──────────────────────────────────────────────────────── */

/* Hero */
.ct-eyebrow {
  margin: 0 0 5px;
  font-size: 10.5px; font-weight: 700; letter-spacing: .14em;
  text-transform: uppercase; color: var(--app-accent); opacity: .9;
}
.ct-title {
  margin: 0;
  font-size: 22px; font-weight: 700; letter-spacing: -.03em; line-height: 1.2;
  color: var(--app-text);
}

/* Action rows */
.ct-actions {
  border-radius: var(--app-radius-md);
  overflow: hidden;
  border: 1px solid var(--app-border);
}
.ct-action {
  width: 100%; display: flex; align-items: center; gap: 14px;
  padding: 15px 16px;
  background: var(--app-item-surface);
  border: none; border-top: 1px solid var(--app-border);
  cursor: pointer; text-align: left;
  transition: background 140ms;
  -webkit-tap-highlight-color: transparent;
}
.ct-action:first-child { border-top: none; }
.ct-action:hover { background: var(--app-surface-hover); }

.ct-action-ico {
  width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: #fff;
}
.ct-action-ico svg { width: 20px; height: 20px; }
.ct-action-ico--community {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  box-shadow: 0 3px 12px rgba(99,102,241,.3);
}
.ct-action-ico--post {
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  box-shadow: 0 3px 12px rgba(245,158,11,.26);
}
.ct-action-ico--poll {
  background: linear-gradient(135deg, #14b8a6, #3b82f6);
  box-shadow: 0 3px 12px rgba(20,184,166,.26);
}

.ct-action-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ct-action-name {
  font-size: 15px; font-weight: 700; letter-spacing: -.02em;
  color: var(--app-text); display: block;
}
.ct-action-desc {
  font-size: 12px; color: var(--app-text-muted); display: block;
}
.ct-action-arrow {
  color: var(--app-text-subtle); flex-shrink: 0; opacity: .55;
  transition: transform 150ms, opacity 150ms;
}
.ct-action:hover .ct-action-arrow { transform: translateX(3px); opacity: 1; }

/* Section label */
.ct-section-label {
  margin: 0;
  font-size: 10.5px; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--app-text-subtle);
}

/* Chips */
.ct-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.ct-chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 13px 5px 5px; border-radius: 999px;
  background: var(--app-item-surface);
  border: 1px solid var(--app-border);
  cursor: pointer;
  transition: background 140ms, border-color 140ms, transform 120ms;
  -webkit-tap-highlight-color: transparent;
}
.ct-chip:hover {
  background: var(--app-surface-hover);
  border-color: var(--app-border-strong);
  transform: translateY(-1px);
}
.ct-chip-av {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 800; color: #fff; flex-shrink: 0;
}
.ct-chip-name {
  font-size: 12.5px; font-weight: 600; color: var(--app-text);
  white-space: nowrap; max-width: 110px;
  overflow: hidden; text-overflow: ellipsis;
}

/* Hint */
.ct-hint {
  margin: 0; font-size: 11px; color: var(--app-text-subtle);
}
.ct-link {
  color: var(--app-accent); cursor: pointer;
}
.ct-link:hover { text-decoration: underline; text-underline-offset: 2px; }

/* Empty */
.ct-empty {
  padding: 20px 16px; border-radius: var(--app-radius-md);
  background: var(--app-item-surface); border: 1px dashed var(--app-border-strong);
  display: flex; flex-direction: column; gap: 10px;
}
.ct-empty-text { margin: 0; font-size: 13px; color: var(--app-text-muted); }
.ct-empty-btn {
  font-size: 12.5px; font-weight: 600;
  color: var(--app-accent);
  background: rgba(94,106,210,.1);
  border: 1px solid rgba(94,106,210,.22);
  border-radius: 8px; padding: 7px 14px;
  cursor: pointer; width: fit-content;
  transition: background 140ms;
}
.ct-empty-btn:hover { background: rgba(94,106,210,.18); }

/* ── Avatar tones ──────────────────────────────────────────────── */
.av-violet { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
.av-blue   { background: linear-gradient(135deg, #3b82f6, #6366f1); }
.av-teal   { background: linear-gradient(135deg, #14b8a6, #3b82f6); }
.av-amber  { background: linear-gradient(135deg, #f59e0b, #ef4444); }
.av-rose   { background: linear-gradient(135deg, #ec4899, #8b5cf6); }

</style>