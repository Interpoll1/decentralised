<template>
  <nav class="side-nav surface-card">
    <div class="side-nav-brand" @click="goHome()">
      <span class="side-nav-brand-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 3L4 7.5V16.5L12 21L20 16.5V7.5L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
          <path d="M12 8V16M8.5 10.5L12 12.5L15.5 10.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="side-nav-brand-name">Interpoll</span>
    </div>

    <!-- Primary nav tabs -->
    <button
      class="side-nav-item"
      :class="{ active: activeTab === 'home' }"
      @click="goTab('home')"
    >
      <ion-icon :icon="activeTab === 'home' ? home : homeOutline"></ion-icon>
      <span>Home</span>
    </button>
    <button
      class="side-nav-item"
      :class="{ active: activeTab === 'communities' }"
      @click="goTab('communities')"
    >
      <ion-icon :icon="activeTab === 'communities' ? people : peopleOutline"></ion-icon>
      <span>Communities</span>
    </button>
    <button
      class="side-nav-item"
      :class="{ active: activeTab === 'chat' }"
      @click="goTab('chat')"
    >
      <ion-icon :icon="activeTab === 'chat' ? chatbubble : chatbubbleOutline"></ion-icon>
      <span>Chat</span>
    </button>
    <button
      class="side-nav-item"
      :class="{ active: activeTab === 'create' }"
      @click="goTab('create')"
    >
      <ion-icon :icon="activeTab === 'create' ? addCircle : addCircleOutline"></ion-icon>
      <span>Create</span>
    </button>

    <div class="side-nav-divider"></div>

    <p class="side-nav-section-label">Categories</p>
    <button
      v-for="cat in feedCategories"
      :key="cat.id"
      class="side-nav-item side-nav-util side-nav-category"
      :class="{ active: activeTab === 'home' && selectedCategory === cat.id }"
      @click="goCategory(cat.id)"
    >
      <ion-icon :icon="cat.icon" :class="cat.tone"></ion-icon>
      <span>{{ cat.label }}</span>
    </button>
    <button class="side-nav-item side-nav-util side-nav-category" @click="goCategory('all')">
      <ion-icon :icon="ellipsisHorizontalOutline"></ion-icon>
      <span>More</span>
    </button>

    <div class="side-nav-divider"></div>

    <button class="side-nav-item side-nav-util" @click="$router.push('/search')">
      <ion-icon :icon="searchOutline"></ion-icon>
      <span>Search</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/profile')">
      <ion-icon :icon="personCircleOutline"></ion-icon>
      <span>Profile</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/settings')">
      <ion-icon :icon="settingsOutline"></ion-icon>
      <span>Settings</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/chain-explorer')">
      <ion-icon :icon="cube"></ion-icon>
      <span>Chain Explorer</span>
    </button>
    <button class="side-nav-item side-nav-util" @click="$router.push('/resilience')">
      <ion-icon :icon="shieldOutline"></ion-icon>
      <span>Resilience Center</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { IonIcon } from '@ionic/vue';
import { useRouter } from 'vue-router';
import {
  home, homeOutline, people, peopleOutline, chatbubble, chatbubbleOutline,
  addCircle, addCircleOutline, searchOutline, personCircleOutline, settingsOutline,
  cube, shieldOutline, ellipsisHorizontalOutline,
  codeSlashOutline, gameControllerOutline, flaskOutline, businessOutline, logoBitcoin, trophyOutline,
} from 'ionicons/icons';

const props = defineProps<{
  /** Which primary tab is active. Pass 'home' | 'communities' | 'chat' | 'create' | '' */
  activeTab?: string;
  /** Currently selected feed category, only meaningful when activeTab === 'home' */
  selectedCategory?: string;
}>();

const router = useRouter();

const feedCategories = [
  { id: 'technology', label: 'Technology', icon: codeSlashOutline, tone: 'tone-technology' },
  { id: 'gaming', label: 'Gaming', icon: gameControllerOutline, tone: 'tone-gaming' },
  { id: 'science', label: 'Science', icon: flaskOutline, tone: 'tone-science' },
  { id: 'politics', label: 'Politics', icon: businessOutline, tone: 'tone-politics' },
  { id: 'crypto', label: 'Crypto', icon: logoBitcoin, tone: 'tone-crypto' },
  { id: 'sports', label: 'Sports', icon: trophyOutline, tone: 'tone-sports' },
] as const;

function goHome() {
  router.push('/home');
}

function goTab(tab: string) {
  router.push({ path: '/home', query: { tab } });
}

function goCategory(id: string) {
  router.push({ path: '/home', query: { tab: 'home', category: id } });
}
</script>

<style scoped>
.side-nav {
  display: none;
}

.side-nav-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent);
  margin: 8px 12px;
  border-radius: 1px;
}

@media (min-width: 768px) {
  .side-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 220px;
    flex-shrink: 0;
    position: sticky;
    top: 24px;
    padding: 16px 12px 20px;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
  }

  .side-nav-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px 14px;
    cursor: pointer;
    user-select: none;
  }
  .side-nav-brand-mark {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-accent);
    background: linear-gradient(145deg, rgba(94, 106, 210, 0.28), rgba(139, 92, 246, 0.18));
    border: 1px solid rgba(124, 140, 255, 0.35);
    box-shadow: 0 8px 20px rgba(94, 106, 210, 0.2);
  }
  .side-nav-brand-name {
    font-family: var(--font-display);
    font-size: 1.0625rem;
    font-variation-settings: "opsz" 18;
    font-weight: 700;
    letter-spacing: -0.04em;
    color: var(--app-text);
  }

  .side-nav-section-label {
    margin: 10px 14px 6px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--app-text-subtle);
  }

  .side-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: none;
    border: none;
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 500;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: var(--app-transition);
    text-align: left;
    width: 100%;
    position: relative;
  }
  .side-nav-item ion-icon { font-size: 20px; flex-shrink: 0; }

  .side-nav-item:hover {
    background: var(--app-item-surface);
    color: var(--app-text);
  }

  .side-nav-item.active {
    background: rgba(var(--app-accent-rgb), 0.14);
    border: 1px solid rgba(var(--app-accent-rgb), 0.28);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 12px 24px rgba(var(--app-accent-rgb), 0.12);
    color: var(--app-accent-bright);
    font-weight: 700;
  }

  .side-nav-util {
    font-size: 14px;
    padding: 8px 14px;
  }
  .side-nav-util ion-icon {
    font-size: 18px;
  }
  .side-nav-category.active {
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--app-text);
    font-weight: 600;
  }

  .tone-technology { color: var(--tone-technology); }
  .tone-gaming     { color: var(--tone-gaming); }
  .tone-science    { color: var(--tone-science); }
  .tone-politics   { color: var(--tone-politics); }
  .tone-crypto     { color: var(--tone-crypto); }
  .tone-sports     { color: var(--tone-sports); }
}

@media (min-width: 1024px) {
  .side-nav { width: 220px; }
}

@media (min-width: 1280px) {
  .side-nav { width: 240px; }
}
</style>
