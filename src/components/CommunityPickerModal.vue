<template>
  <teleport to="body">
    <transition name="picker-fade">
      <div v-if="modelValue" class="cpm-backdrop" @click.self="$emit('update:modelValue', false)">
        <transition name="picker-slide">
          <div v-if="modelValue" class="cpm-sheet" role="dialog" aria-modal="true" aria-label="Select a community">

            <!-- Header -->
            <div class="cpm-header">
              <div class="cpm-title-row">
                <span class="cpm-title">{{ title }}</span>
                <button class="cpm-close" @click="$emit('update:modelValue', false)" aria-label="Close">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </button>
              </div>
              <!-- Search -->
              <div class="cpm-search-wrap">
                <svg class="cpm-search-icon" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
                  <path d="M21 21l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <input
                  ref="searchInput"
                  v-model="query"
                  class="cpm-search"
                  placeholder="Search communities…"
                  autocomplete="off"
                  spellcheck="false"
                />
                <button v-if="query" class="cpm-search-clear" @click="query = ''" aria-label="Clear search">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                </button>
              </div>
            </div>

            <!-- List -->
            <div class="cpm-list" ref="listEl">
              <!-- Empty state -->
              <div v-if="filtered.length === 0" class="cpm-empty">
                <svg viewBox="0 0 24 24" fill="none" class="cpm-empty-icon">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M21 21l-4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <p>No communities match "{{ query }}"</p>
              </div>

              <button
                v-for="c in filtered"
                :key="c.id"
                class="cpm-item"
                :class="{ 'cpm-item--selected': selected?.id === c.id }"
                @click="pick(c)"
              >
                <span class="cpm-avatar" :class="tone(c.id)">
                  {{ initial(c) }}
                </span>
                <span class="cpm-item-body">
                  <span class="cpm-item-name">{{ c.displayName || c.name }}</span>
                  <span class="cpm-item-meta">
                    <span class="cpm-item-id">{{ c.id }}</span>
                    <span class="cpm-dot">·</span>
                    <span>{{ c.memberCount?.toLocaleString() ?? 0 }} member{{ c.memberCount !== 1 ? 's' : '' }}</span>
                    <template v-if="c.isPrivate">
                      <span class="cpm-dot">·</span>
                      <span class="cpm-badge-private">Private</span>
                    </template>
                  </span>
                </span>
                <svg v-if="selected?.id === c.id" class="cpm-check" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
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

// Auto-focus search when opening
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
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

@media (min-width: 640px) {
  .cpm-backdrop { align-items: center; }
}

/* ── Sheet ─────────────────────────────────── */
.cpm-sheet {
  width: 100%;
  max-width: 520px;
  max-height: 80dvh;
  display: flex;
  flex-direction: column;
  background: #12112a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 24px 24px 0 0;
  overflow: hidden;
}

@media (min-width: 640px) {
  .cpm-sheet {
    border-radius: 20px;
    max-height: 70dvh;
  }
}

/* ── Header ────────────────────────────────── */
.cpm-header {
  padding: 20px 20px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  flex-shrink: 0;
}

.cpm-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.cpm-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--app-text, #e8e8f0);
  letter-spacing: -0.02em;
}

.cpm-close {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.07);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-muted, #9090b0);
  transition: background 150ms;
}
.cpm-close:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.cpm-close svg { width: 14px; height: 14px; }

/* ── Search ────────────────────────────────── */
.cpm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.cpm-search-icon {
  position: absolute;
  left: 12px;
  width: 15px;
  height: 15px;
  color: var(--app-text-subtle, #6060a0);
  pointer-events: none;
  flex-shrink: 0;
}

.cpm-search {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 12px;
  padding: 10px 36px 10px 38px;
  font-size: 13.5px;
  font-family: inherit;
  color: var(--app-text, #e8e8f0);
  outline: none;
  transition: border-color 160ms, box-shadow 160ms;
}
.cpm-search::placeholder { color: var(--app-text-subtle, #6060a0); }
.cpm-search:focus {
  border-color: rgba(99, 102, 241, 0.5);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.cpm-search-clear {
  position: absolute;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--app-text-subtle, #6060a0);
}
.cpm-search-clear svg { width: 10px; height: 10px; }

/* ── List ──────────────────────────────────── */
.cpm-list {
  overflow-y: auto;
  flex: 1;
  padding: 8px 8px 16px;
  scroll-behavior: smooth;
}

.cpm-list::-webkit-scrollbar { width: 4px; }
.cpm-list::-webkit-scrollbar-track { background: transparent; }
.cpm-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }

/* ── Item ──────────────────────────────────── */
.cpm-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 12px;
  border-radius: 14px;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: background 140ms, border-color 140ms;
  -webkit-tap-highlight-color: transparent;
}
.cpm-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.07);
}
.cpm-item--selected {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.25);
}
.cpm-item--selected:hover {
  background: rgba(99, 102, 241, 0.14);
}

/* ── Avatar ────────────────────────────────── */
.cpm-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
  letter-spacing: -0.02em;
}
.tone-violet { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
.tone-blue   { background: linear-gradient(135deg, #3b82f6, #6366f1); }
.tone-teal   { background: linear-gradient(135deg, #14b8a6, #3b82f6); }
.tone-amber  { background: linear-gradient(135deg, #f59e0b, #ef4444); }
.tone-rose   { background: linear-gradient(135deg, #ec4899, #8b5cf6); }

/* ── Item body ─────────────────────────────── */
.cpm-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cpm-item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--app-text, #e8e8f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cpm-item-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--app-text-subtle, #6060a0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cpm-item-id {
  font-family: monospace;
  font-size: 11px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cpm-dot { opacity: 0.5; }
.cpm-badge-private {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  padding: 1px 6px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cpm-check {
  width: 18px;
  height: 18px;
  color: #6366f1;
  flex-shrink: 0;
}

/* ── Empty state ───────────────────────────── */
.cpm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
  color: var(--app-text-subtle, #6060a0);
}
.cpm-empty-icon {
  width: 36px;
  height: 36px;
  opacity: 0.5;
}
.cpm-empty p {
  margin: 0;
  font-size: 13.5px;
}

/* ── Transitions ───────────────────────────── */
.picker-fade-enter-active,
.picker-fade-leave-active { transition: opacity 220ms ease; }
.picker-fade-enter-from,
.picker-fade-leave-to { opacity: 0; }

.picker-slide-enter-active,
.picker-slide-leave-active { transition: transform 260ms cubic-bezier(.22, 1, .36, 1), opacity 220ms ease; }
.picker-slide-enter-from,
.picker-slide-leave-to { transform: translateY(20px); opacity: 0; }

@media (min-width: 640px) {
  .picker-slide-enter-from,
  .picker-slide-leave-to { transform: scale(0.96) translateY(8px); opacity: 0; }
}
</style>