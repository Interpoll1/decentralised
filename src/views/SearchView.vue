<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="router.back()">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </ion-buttons>
        <ion-title>Search</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
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
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<style scoped>
/* ── Kill Ionic toolbar border + back-button blue hover ── */
ion-header::after { display: none !important; }
ion-toolbar ion-buttons button::after,
ion-toolbar ion-buttons button::before { display: none !important; }
ion-toolbar ion-buttons button:hover,
ion-toolbar ion-buttons button:focus {
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}
ion-toolbar { --border-width: 0 !important; }

ion-back-button {
  --background-hover: transparent !important;
  --background-focused: transparent !important;
  --background-hover-opacity: 0 !important;
  --ripple-color: rgba(255, 255, 255, 0.08);
  --color: var(--app-text-muted, rgba(255,255,255,0.65));
  --color-hover: var(--app-text, #fff);
}

ion-title {
  --color: var(--app-text, #fff);
}

ion-content { --background: transparent; }

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: none;
  border: none;
  border-radius: 50%;
  color: var(--app-text-muted, rgba(255,255,255,0.65));
  cursor: pointer;
  margin-left: 4px;
  transition: color 160ms ease;
}
.back-btn:hover { color: var(--app-text, #fff); background: none; }
.back-btn svg { width: 22px; height: 22px; }

.search-page {
  max-width: 700px;
  margin: 0 auto;
  padding: 16px 16px 40px;
}

/* ── Search box ── */
.search-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 16px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  transition: border-color 180ms ease, box-shadow 180ms ease;
  outline: none;
}
.search-box:focus-within {
  border-color: rgba(var(--app-accent-rgb, 99,102,241), 0.45);
  box-shadow: 0 0 0 3px rgba(var(--app-accent-rgb, 99,102,241), 0.12);
}

.search-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--app-text-subtle, rgba(255,255,255,0.35));
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  -webkit-appearance: none;
  font-size: 15px;
  color: var(--ion-text-color);
  font-family: inherit;
}
.search-input:focus { outline: none; box-shadow: none; }
.search-input::placeholder { color: var(--app-text-subtle, rgba(255,255,255,0.35)); }
.search-input::-webkit-search-cancel-button { cursor: pointer; }
.search-input::-webkit-search-decoration { -webkit-appearance: none; }

/* ── Filters ── */
.search-filters { display: flex; gap: 8px; }

.filter-select,
.filter-input {
  flex: 1;
  padding: 9px 14px;
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  color: var(--ion-text-color);
  font-size: 13.5px;
  font-family: inherit;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  transition: border-color 180ms ease;
}
.filter-select {
  /* re-add dropdown arrow manually since we killed appearance */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
  appearance: none;
  -webkit-appearance: none;
}
.filter-select:focus,
.filter-input:focus {
  outline: none;
  box-shadow: none;
  border-color: rgba(var(--app-accent-rgb,99,102,241),0.4);
}
.filter-select option { background: var(--ion-background-color); color: var(--ion-text-color); }
.filter-input::placeholder { color: var(--app-text-subtle, rgba(255,255,255,0.35)); }

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
  color: var(--app-text-muted);
}

.spinner {
  width: 30px;
  height: 30px;
  border: 2.5px solid rgba(var(--app-accent-rgb,99,102,241), 0.2);
  border-top-color: rgba(var(--app-accent-rgb,99,102,241),0.9);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-icon,
.no-results-icon { width: 44px; height: 44px; opacity: 0.5; }
.no-results-hint { font-size: 13px; opacity: 0.6; }

/* ── Result cards ── */
.results-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-item {
  padding: 16px 18px;
  border-radius: 16px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}
.result-item:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.13);
  transform: translateY(-1px);
}
.result-item:active { transform: translateY(0); }

/* type badge (Post / Poll) */
.result-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
.result-badge.post-badge {
  background: rgba(var(--app-accent-rgb,99,102,241), 0.12);
  color: #818cf8;
  border: 1px solid rgba(99,102,241,0.2);
}
.result-badge.poll-badge {
  background: rgba(var(--ion-color-tertiary-rgb), 0.12);
  color: var(--ion-color-tertiary);
  border: 1px solid rgba(var(--ion-color-tertiary-rgb), 0.20);
}

.result-title {
  margin: 0 0 5px;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.025em;
  background: linear-gradient(135deg, var(--app-text, #fff) 60%, rgba(167,139,250,0.85));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.result-content {
  margin: 0 0 10px;
  font-size: 13.5px;
  color: var(--app-text-muted, rgba(255,255,255,0.55));
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text-subtle, rgba(255,255,255,0.35));
  align-items: center;
}

.result-author { font-weight: 600; color: var(--app-text-muted, rgba(255,255,255,0.55)); }
.result-community { color: #818cf8; font-weight: 600; }
.result-community::before { content: '·'; margin-right: 6px; color: rgba(255,255,255,0.2); }
.result-date::before      { content: '·'; margin-right: 6px; color: rgba(255,255,255,0.2); }

/* ── Pagination ── */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 28px;
}

.pagination-btn {
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09);
  color: var(--app-text-muted, rgba(255,255,255,0.6));
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease;
}
.pagination-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.09);
  border-color: rgba(255,255,255,0.15);
}
.pagination-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.pagination-pages { display: flex; gap: 4px; }

.page-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.07);
  color: var(--app-text-muted, rgba(255,255,255,0.6));
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
  display: flex;
  align-items: center;
  justify-content: center;
}
.page-btn:hover:not(.ellipsis) {
  background: rgba(99,102,241,0.12);
  color: #818cf8;
  border-color: rgba(99,102,241,0.25);
}
.page-btn.active {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 14px rgba(99,102,241,0.35);
}
.page-btn.ellipsis {
  background: transparent;
  border-color: transparent;
  cursor: default;
  opacity: 0.4;
  color: var(--ion-color-medium);
}

/* ── Dark mode ── */
html.dark .search-box,
html.dark .result-item {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: #0d0d0d;
  border-color: var(--app-border);
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
  border-color: var(--app-border);
}

html.dark .result-item:hover {
  background: #141414;
  border-color: var(--app-border);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.40);
  transform: translateY(-2px);
}

html.dark .page-btn.active {
  background: rgba(var(--ion-color-primary-rgb), 0.85);
  border-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .result-item, .pagination-btn, .page-btn, .search-box { transition: none; }
  .spinner { animation: none; }
}

</style>
<script setup lang="ts">
import { ref, computed } from 'vue';
import DesktopPageShell from '../components/DesktopPageShell.vue';
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
} = useSearch();

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
    router.push({
      path: `/vote/${result.id}`,
      query: result.community ? { communityId: result.community } : undefined,
    });
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