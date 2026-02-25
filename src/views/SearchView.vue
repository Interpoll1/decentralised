<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>Search</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="search-page">
    <!-- Search Header -->
    <div class="search-header">
      <div class="search-box">
        <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          v-model="searchQuery"
          @input="handleSearch"
          type="search"
          placeholder="Search posts and polls..."
          class="search-input"
          autofocus
        />
      </div>

      <div class="search-filters">
        <select v-model="filterType" @change="handleFilterChange" class="filter-select">
          <option value="">All Types</option>
          <option value="post">Posts Only</option>
          <option value="poll">Polls Only</option>
        </select>

        <input
          v-model="filterCommunity"
          @input="handleFilterChange"
          type="text"
          placeholder="Filter by community..."
          class="filter-input"
        />
      </div>
    </div>

    <!-- Results Area -->
    <div class="results-container">
      <!-- Loading -->
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Searching...</p>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="error-state">
        <svg class="error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>{{ error }}</p>
      </div>

      <!-- No Results -->
      <div v-else-if="results.length === 0 && searchQuery" class="no-results">
        <svg class="no-results-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p>No results found for "{{ searchQuery }}"</p>
        <span class="no-results-hint">Try different keywords or remove filters</span>
      </div>

      <!-- Results -->
      <div v-else class="results-list">
        <div
          v-for="result in results"
          :key="result.id"
          @click="navigateToResult(result)"
          class="result-item"
        >

          
          <h3 class="result-title">{{ result.title || result.question }}</h3>
          
          <p class="result-content">
            {{ truncate(result.content || result.description || '', 150) }}
          </p>
          
          <div class="result-meta">
            <span class="result-author">by {{ result.author || 'Anonymous' }}</span>
            <span v-if="result.community" class="result-community">
              in {{ result.community }}
            </span>
            <span class="result-date">{{ formatDate(result.created_at) }}</span>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="total > perPage && results.length > 0" class="pagination">
        <button
          @click="goToPreviousPage"
          :disabled="currentPage === 1"
          class="pagination-btn"
        >
          Previous
        </button>

        <div class="pagination-pages">
          <button
            v-for="page in visiblePages"
            :key="page"
            @click="page !== '...' && goToPage(page)"
            :class="{ active: page === currentPage, ellipsis: page === '...' }"
            class="page-btn"
          >
            {{ page }}
          </button>
        </div>

        <button
          @click="goToNextPage"
          :disabled="!hasNextPage"
          class="pagination-btn"
        >
          Next
        </button>
      </div>
    </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
ion-content {
  --background: transparent;
}

.search-page {
  max-width: 700px;
  margin: 0 auto;
  padding: 16px 16px 40px;
}

.search-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 20px;
  background: rgba(var(--ion-card-background-rgb), 0.35);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-bottom-color: var(--glass-border-bottom);
  box-shadow: var(--glass-shadow), var(--glass-highlight), var(--glass-inner-glow);
  transition: var(--liquid-transition);
}

.search-box:focus-within {
  border-color: rgba(var(--ion-color-primary-rgb), 0.45);
  border-top-color: rgba(var(--ion-color-primary-rgb), 0.65);
  box-shadow:
    0 8px 40px rgba(var(--ion-color-primary-rgb), 0.12),
    0 1.5px 4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    inset 0 -1px 0 rgba(255, 255, 255, 0.08),
    inset 0 0 30px rgba(255, 255, 255, 0.12);
}

.search-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: var(--ion-color-medium);
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--ion-text-color);
  font-family: inherit;
}

.search-input::placeholder { color: var(--ion-color-medium); }
.search-input::-webkit-search-cancel-button { cursor: pointer; }

.search-filters {
  display: flex;
  gap: 8px;
}

.filter-select,
.filter-input {
  flex: 1;
  padding: 9px 14px;
  border-radius: 14px;
  background: rgba(var(--ion-card-background-rgb), 0.28);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  border-bottom-color: var(--glass-border-bottom);
  color: var(--ion-text-color);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: var(--liquid-transition);
}

.filter-select:focus,
.filter-input:focus {
  border-color: rgba(var(--ion-color-primary-rgb), 0.45);
  border-top-color: rgba(var(--ion-color-primary-rgb), 0.65);
}

.filter-select option {
  background: var(--ion-background-color);
  color: var(--ion-text-color);
}

.filter-input::placeholder { color: var(--ion-color-medium); }

/* ── States ── */
.loading-state,
.error-state,
.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  gap: 12px;
  color: var(--ion-color-medium);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(var(--ion-color-primary-rgb), 0.20);
  border-top-color: var(--ion-color-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-icon,
.no-results-icon {
  width: 48px;
  height: 48px;
  color: var(--ion-color-medium);
}

.no-results-hint {
  font-size: 13px;
  color: var(--ion-color-medium);
  opacity: 0.7;
}

/* ── Results ── */
.results-list {
  display: flex;
  flex-direction: column;
  gap: 0px;
}

.result-item {
  padding: 14px 16px;
  margin-top: 20px;
border-bottom: 1px solid var(--glass-border-bottom);

background: transparent;
}

.result-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 10px;
  border-radius: 20px;
  margin-bottom: 8px;
}

.result-badge.post {
  background: rgba(var(--ion-color-primary-rgb), 0.12);
  color: var(--ion-color-primary);
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.20);
}

.result-badge.poll {
  background: rgba(var(--ion-color-tertiary-rgb), 0.12);
  color: var(--ion-color-tertiary);
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.20);
}

.result-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  color: var(--ion-text-color);
  line-height: 1.3;
}

.result-content {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--ion-text-color);
  opacity: 0.7;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--ion-color-medium);
}

.result-author,
.result-community,
.result-date {
  display: flex;
  align-items: center;
}

.result-community::before { content: '·'; margin-right: 8px; }
.result-date::before      { content: '·'; margin-right: 8px; }

/* ── Pagination ── */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
}

.pagination-btn {
  padding: 8px 18px;
  border-radius: 14px;
  background: rgba(var(--ion-card-background-rgb), 0.28);
  backdrop-filter: blur(12px) saturate(1.4);
  -webkit-backdrop-filter: blur(12px) saturate(1.4);
  border: 1px solid var(--glass-border);
  border-top-color: var(--glass-border-top);
  color: var(--ion-color-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: var(--liquid-spring);
}

.pagination-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(var(--ion-color-primary-rgb), 0.18);
  border-color: rgba(var(--ion-color-primary-rgb), 0.35);
}

.pagination-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.pagination-pages {
  display: flex;
  gap: 4px;
}

.page-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--ion-card-background-rgb), 0.20);
  border: 1px solid var(--glass-border);
  color: var(--ion-text-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: var(--liquid-transition);
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-btn:hover:not(.ellipsis) {
  background: rgba(var(--ion-color-primary-rgb), 0.10);
  border-color: rgba(var(--ion-color-primary-rgb), 0.25);
  color: var(--ion-color-primary);
}

.page-btn.active {
  background: rgba(var(--ion-color-primary-rgb), 0.85);
  border-color: transparent;
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(var(--ion-color-primary-rgb), 0.30);
}

.page-btn.ellipsis {
  background: transparent;
  border-color: transparent;
  cursor: default;
  color: var(--ion-color-medium);
}

/* ── Dark mode ── */
html.dark .search-box,
html.dark .result-item {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: #0d0d0d;
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow: none;
}

html.dark .search-box:focus-within {
  border-color: rgba(var(--ion-color-primary-rgb), 0.35);
  box-shadow: 0 0 0 1px rgba(var(--ion-color-primary-rgb), 0.20);
}

html.dark .filter-select,
html.dark .filter-input,
html.dark .pagination-btn,
html.dark .page-btn {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: #0d0d0d;
  border-color: rgba(255, 255, 255, 0.06);
}

html.dark .result-item:hover {
  background: #141414;
  border-color: rgba(255, 255, 255, 0.10);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.40);
  transform: translateY(-2px);
}

html.dark .page-btn.active {
  background: rgba(var(--ion-color-primary-rgb), 0.85);
  border-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .result-item { animation: none; }
  .result-item,
  .pagination-btn,
  .page-btn,
  .search-box { transition: none; }
  .spinner { animation: none; }
}
</style>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonSearchbar, IonSegment,
  IonSegmentButton, IonLabel, IonSpinner, IonIcon,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonBadge, IonButton
} from '@ionic/vue';
import { useSearch } from '../composables/useSearch';

const router  = useRouter();
const API_URL = import.meta.env.VITE_API_URL || 'https://interpoll.onrender.com';

const {
  results,
  total,
  loading,
  error,
  currentPage,
  perPage,
  searchPage,
  nextPage,
  previousPage,
  clearResults,
} = useSearch(API_URL);

const searchQuery     = ref('');
const filterType      = ref<'post' | 'poll' | ''>('');
const filterCommunity = ref('');
const debounceTimer   = ref<number | null>(null);

const hasNextPage = computed(() => currentPage.value * perPage.value < total.value);

const visiblePages = computed(() => {
  const pages: (number | string)[] = [];
  const totalPages = Math.ceil(total.value / perPage.value);
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage.value - 2 && i <= currentPage.value + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...');
    }
  }
  return pages;
});

// ── Search handlers ───────────────────────────────────────────────────────────

const handleSearch = (event: any) => {
  const query = event.detail?.value ?? searchQuery.value;
  searchQuery.value = query;

  if (debounceTimer.value) clearTimeout(debounceTimer.value);

  // Clear if too short
  if (query.length < 2) {
    clearResults();
    return;
  }

  // Debounce 300ms then search
  debounceTimer.value = window.setTimeout(() => {
    performSearch();
  }, 300);
};

const handleFilterChange = () => {
  if (searchQuery.value.length >= 2) performSearch();
};

const performSearch = async () => {
  const options: any = {};
  if (filterType.value)      options.type      = filterType.value;
  if (filterCommunity.value) options.community = filterCommunity.value;
  await searchPage(searchQuery.value, 1, options);
};

const goToPage = async (page: number | string) => {
  if (typeof page !== 'number') return;
  const options: any = {};
  if (filterType.value)      options.type      = filterType.value;
  if (filterCommunity.value) options.community = filterCommunity.value;
  await searchPage(searchQuery.value, page, options);
};

const goToNextPage = async () => {
  const options: any = {};
  if (filterType.value)      options.type      = filterType.value;
  if (filterCommunity.value) options.community = filterCommunity.value;
  await nextPage(searchQuery.value, options);
};

const goToPreviousPage = async () => {
  const options: any = {};
  if (filterType.value)      options.type      = filterType.value;
  if (filterCommunity.value) options.community = filterCommunity.value;
  await previousPage(searchQuery.value, options);
};

// ── Navigation ────────────────────────────────────────────────────────────────

const navigateToResult = (result: any) => {
  if (result.type === 'post') {
    router.push(`/post/${result.id}`);
  } else {
    router.push(`/vote/${result.id}`);
  }
};

// ── Formatting ────────────────────────────────────────────────────────────────

const truncate = (text: string, length: number): string => {
  if (!text) return '';
  return text.length > length ? text.slice(0, length) + '...' : text;
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const diff = Date.now() - date.getTime();
  if (diff < 86400000)  return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
</script>