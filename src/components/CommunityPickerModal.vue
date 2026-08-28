<template>
  <teleport to="body">
    <transition name="picker-fade">
      <div v-if="modelValue" class="cpm-backdrop" @click.self="$emit('update:modelValue', false)">
        <transition name="picker-slide">
          <div v-if="modelValue" class="cpm-sheet" role="dialog" aria-modal="true" aria-label="Select a community">

            <!-- Header -->
            <div class="cpm-header">
              <div class="cpm-title-row">
                <div class="cpm-title-left">
                  <div class="cpm-title-icon">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                      <circle cx="9" cy="7" r="4" stroke="currentColor" stroke-width="1.8"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <p class="cpm-title">{{ title || 'Select Community' }}</p>
                    <p class="cpm-subtitle">{{ filtered.length }} available</p>
                  </div>
                </div>
                <button class="cpm-close" @click="$emit('update:modelValue', false)" aria-label="Close">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </button>
              </div>

              <!-- Search -->
              <div class="cpm-search-wrap" :class="{ focused: searchFocused }">
                <svg class="cpm-search-icon" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <input
                  ref="searchInput"
                  v-model="query"
                  class="cpm-search"
                  placeholder="Search communities…"
                  autocomplete="off"
                  spellcheck="false"
                  @focus="searchFocused = true"
                  @blur="searchFocused = false"
                />
                <button v-if="query" class="cpm-search-clear" @click="query = ''" aria-label="Clear">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>

            <!-- List -->
            <div class="cpm-list" ref="listEl">

              <!-- Empty state -->
              <div v-if="filtered.length === 0" class="cpm-empty">
                <div class="cpm-empty-icon-wrap">
                  <svg viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/>
                    <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  </svg>
                </div>
                <p class="cpm-empty-title">No results</p>
                <p class="cpm-empty-sub">No communities match "{{ query }}"</p>
              </div>

              <button
                v-for="c in filtered"
                :key="c.id"
                class="cpm-item"
                :class="{ 'cpm-item--selected': selected?.id === c.id }"
                @click="pick(c)"
              >
                <!-- Avatar -->
                <span class="cpm-avatar" :class="tone(c.id)">
                  {{ initial(c) }}
                </span>

                <!-- Info -->
                <span class="cpm-item-body">
                  <span class="cpm-item-name">{{ c.displayName || c.name }}</span>
                  <span class="cpm-item-meta">
                    <span class="cpm-item-id">c/{{ c.id }}</span>
                    <span class="cpm-dot">·</span>
                    <span>{{ (c.memberCount ?? 0).toLocaleString() }} member{{ c.memberCount !== 1 ? 's' : '' }}</span>
                    <template v-if="c.isPrivate">
                      <span class="cpm-dot">·</span>
                      <span class="cpm-badge-private">
                        <svg viewBox="0 0 24 24" fill="none" width="9" height="9"><rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                        Private
                      </span>
                    </template>
                  </span>
                </span>

                <!-- Selected check -->
                <span v-if="selected?.id === c.id" class="cpm-check-wrap">
                  <svg class="cpm-check" viewBox="0 0 24 24" fill="none">
                    <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </button>

            </div>

          </div>
        </transition>
      </div>
    </transition>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { Community } from '../services/communityService';

const props = defineProps<{
  modelValue: boolean;
  communities: Community[];
  selected: Community | null;
  title?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'pick', community: Community): void;
}>();

const query = ref('');
const searchFocused = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const listEl = ref<HTMLElement | null>(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.communities;
  return props.communities.filter(c =>
    (c.displayName || c.name || '').toLowerCase().includes(q) ||
    c.id.toLowerCase().includes(q)
  );
});

function pick(c: Community) {
  emit('pick', c);
  emit('update:modelValue', false);
}

function initial(c: Community) {
  return (c.displayName || c.name || 'C').charAt(0).toUpperCase();
}

const TONES = ['tone-violet', 'tone-blue', 'tone-teal', 'tone-amber', 'tone-rose'];
function tone(id: string) {
  const code = id.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return TONES[code % TONES.length];
}

watch(() => props.modelValue, async (open) => {
  if (open) {
    query.value = '';
    await nextTick();
    searchInput.value?.focus();
  }
});
</script>

<style scoped>
/* ── Backdrop ──────────────────────────────── */
.cpm-backdrop {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: flex-end; justify-content: center;
}
@media (min-width: 640px) { .cpm-backdrop { align-items: center; } }

/* ── Sheet ─────────────────────────────────── */
.cpm-sheet {
  width: 100%; max-width: 520px;
  max-height: 82dvh;
  display: flex; flex-direction: column;
  background:
    radial-gradient(ellipse at 20% 0%,  rgba(139,92,246,0.22) 0%, transparent 55%),
    radial-gradient(ellipse at 85% 5%,  rgba(236,72,153,0.14) 0%, transparent 45%),
    #0e0f1c;
  border: 1px solid rgba(139,92,246,0.2);
  border-radius: 24px 24px 0 0;
  overflow: hidden;
  box-shadow: 0 -8px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
}
@media (min-width: 640px) {
  .cpm-sheet { border-radius: 22px; max-height: 72dvh; box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04); }
}

/* ── Header ────────────────────────────────── */
.cpm-header {
  padding: 20px 18px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
  background: rgba(255,255,255,0.02);
}

.cpm-title-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.cpm-title-left { display: flex; align-items: center; gap: 12px; }

.cpm-title-icon {
  width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  box-shadow: 0 4px 12px rgba(99,102,241,0.35);
  display: flex; align-items: center; justify-content: center;
  color: #fff;
}
.cpm-title-icon svg { width: 18px; height: 18px; }

.cpm-title {
  font-size: 15px; font-weight: 800;
  letter-spacing: -0.025em;
  color: var(--app-text, #e8e8f0);
  margin: 0 0 1px;
  background: linear-gradient(135deg, #fff 60%, rgba(167,139,250,0.9));
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent;
}
.cpm-subtitle {
  font-size: 11.5px; color: var(--app-text-subtle, #6060a0);
  margin: 0; font-weight: 500;
}

.cpm-close {
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.09);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--app-text-muted, #9090b0);
  transition: background 150ms, color 150ms; flex-shrink: 0;
}
.cpm-close:hover { background: rgba(255,255,255,0.13); color: #fff; }
.cpm-close svg { width: 14px; height: 14px; }

/* ── Search ────────────────────────────────── */
.cpm-search-wrap {
  display: flex; align-items: center;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  transition: border-color 160ms, box-shadow 160ms;
  padding: 0 12px;
  gap: 8px;
}
.cpm-search-wrap.focused {
  border-color: rgba(99,102,241,0.5);
  box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
}
.cpm-search-icon { width: 15px; height: 15px; color: var(--app-text-subtle,#6060a0); flex-shrink: 0; }
.cpm-search {
  flex: 1; background: transparent; border: none; outline: none;
  padding: 10px 0; font-size: 13.5px; font-family: inherit;
  color: var(--app-text,#e8e8f0); -webkit-appearance: none;
}
.cpm-search::placeholder { color: var(--app-text-subtle,#6060a0); }
.cpm-search::-webkit-search-decoration,
.cpm-search::-webkit-search-cancel-button { -webkit-appearance: none; }
.cpm-search-clear {
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(255,255,255,0.09); border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--app-text-subtle,#6060a0); flex-shrink: 0;
  transition: background 150ms;
}
.cpm-search-clear:hover { background: rgba(255,255,255,0.16); }
.cpm-search-clear svg { width: 10px; height: 10px; }

/* ── List ──────────────────────────────────── */
.cpm-list {
  overflow-y: auto; flex: 1;
  padding: 10px 10px 20px;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: rgba(99,102,241,0.2) transparent;
}
.cpm-list::-webkit-scrollbar { width: 4px; }
.cpm-list::-webkit-scrollbar-track { background: transparent; }
.cpm-list::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.2); border-radius: 4px; }

/* ── Item ──────────────────────────────────── */
.cpm-item {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 11px 12px; border-radius: 16px;
  background: transparent; border: 1px solid transparent;
  cursor: pointer; text-align: left;
  transition: background 140ms, border-color 140ms, transform 120ms;
  -webkit-tap-highlight-color: transparent;
  margin-bottom: 4px;
}
.cpm-item:last-child { margin-bottom: 0; }
.cpm-item:hover {
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.08);
  transform: translateX(2px);
}
.cpm-item--selected {
  background: rgba(99,102,241,0.12);
  border-color: rgba(99,102,241,0.28);
}
.cpm-item--selected:hover {
  background: rgba(99,102,241,0.16);
  transform: translateX(2px);
}

/* ── Avatar ────────────────────────────────── */
.cpm-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800; color: #fff; flex-shrink: 0;
  letter-spacing: -0.02em;
}
.tone-violet { background: linear-gradient(135deg,#6366f1,#8b5cf6); box-shadow: 0 3px 10px rgba(99,102,241,0.35); }
.tone-blue   { background: linear-gradient(135deg,#3b82f6,#6366f1); box-shadow: 0 3px 10px rgba(59,130,246,0.35); }
.tone-teal   { background: linear-gradient(135deg,#14b8a6,#3b82f6); box-shadow: 0 3px 10px rgba(20,184,166,0.35); }
.tone-amber  { background: linear-gradient(135deg,#f59e0b,#ef4444); box-shadow: 0 3px 10px rgba(245,158,11,0.35); }
.tone-rose   { background: linear-gradient(135deg,#ec4899,#8b5cf6); box-shadow: 0 3px 10px rgba(236,72,153,0.35); }

/* ── Item body ─────────────────────────────── */
.cpm-item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cpm-item-name {
  font-size: 14px; font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--app-text,#e8e8f0);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cpm-item-meta {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: var(--app-text-subtle,#6060a0);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cpm-item-id { font-family: monospace; font-size: 11px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; color: #818cf8; }
.cpm-dot { opacity: 0.4; }
.cpm-badge-private {
  display: inline-flex; align-items: center; gap: 3px;
  background: rgba(251,191,36,0.12); color: #fbbf24;
  padding: 2px 6px; border-radius: 999px;
  font-size: 9.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; border: 1px solid rgba(251,191,36,0.22);
}

/* ── Selected check ────────────────────────── */
.cpm-check-wrap {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  background: rgba(99,102,241,0.18); border: 1px solid rgba(99,102,241,0.35);
  display: flex; align-items: center; justify-content: center;
}
.cpm-check { width: 14px; height: 14px; color: #818cf8; }

/* ── Empty state ───────────────────────────── */
.cpm-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 48px 20px; text-align: center;
}
.cpm-empty-icon-wrap {
  width: 52px; height: 52px; border-radius: 50%;
  background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
  display: flex; align-items: center; justify-content: center;
  color: #818cf8;
}
.cpm-empty-icon-wrap svg { width: 24px; height: 24px; }
.cpm-empty-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--app-text,#e8e8f0); }
.cpm-empty-sub { margin: 0; font-size: 13px; color: var(--app-text-subtle,#6060a0); }

/* ── Transitions ───────────────────────────── */
.picker-fade-enter-active,
.picker-fade-leave-active { transition: opacity 220ms ease; }
.picker-fade-enter-from,
.picker-fade-leave-to { opacity: 0; }

.picker-slide-enter-active,
.picker-slide-leave-active { transition: transform 280ms cubic-bezier(.22,1,.36,1), opacity 220ms ease; }
.picker-slide-enter-from,
.picker-slide-leave-to { transform: translateY(24px); opacity: 0; }
@media (min-width: 640px) {
  .picker-slide-enter-from,
  .picker-slide-leave-to { transform: scale(0.96) translateY(10px); opacity: 0; }
}
</style>