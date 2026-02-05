<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Decentralized Network</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="$router.push('/profile')">
            <ion-icon :icon="personCircleOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/settings')">
            <ion-icon :icon="settingsOutline"></ion-icon>
          </ion-button>
          <ion-button @click="$router.push('/chain-explorer')">
            <ion-icon :icon="cube"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>

      <!-- Tab Bar -->
      <ion-toolbar>
        <ion-segment v-model="activeTab">
          <ion-segment-button value="home">
            <ion-icon :icon="homeOutline"></ion-icon>
            <ion-label>Home</ion-label>
          </ion-segment-button>
          <ion-segment-button value="communities">
            <ion-icon :icon="peopleOutline"></ion-icon>
            <ion-label>Communities</ion-label>
          </ion-segment-button>
          <ion-segment-button value="create">
            <ion-icon :icon="addCircleOutline"></ion-icon>
            <ion-label>Create</ion-label>
          </ion-segment-button>
          <ion-segment-button value="network">
            <ion-icon :icon="statsChartOutline"></ion-icon>
            <ion-label>Network</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- HOME TAB - Random Posts Feed -->
      <div v-if="activeTab === 'home'" class="home-tab">
        <div class="ion-padding">
          <h2>Home Feed</h2>
          <p class="subtitle">Latest posts and polls from all communities</p>
        </div>

        <!-- Loading Posts -->
        <div v-if="isLoadingPosts" class="loading-container">
          <ion-spinner></ion-spinner>
          <p>Loading content...</p>
        </div>

        <!-- Combined Feed -->
        <div v-else-if="combinedFeed.length > 0" class="feed-list">
          <template v-for="item in combinedFeed" :key="`${item.type}-${item.data.id}`">
            <!-- Post Card -->
            <PostCard 
              v-if="item.type === 'post'"
              :post="item.data"
              :community-name="getCommunityName(item.data.communityId)"
              :has-upvoted="hasUpvoted(item.data.id)"
              :has-downvoted="hasDownvoted(item.data.id)"
              @click="navigateToPost(item.data)"
              @upvote="handleUpvote(item.data)"
              @downvote="handleDownvote(item.data)"
              @comments="navigateToPost(item.data)"
            />
            <!-- Poll Card -->
            <PollCard 
              v-else-if="item.type === 'poll'"
              :poll="item.data"
              :community-name="getCommunityName(item.data.communityId)"
              @click="navigateToPoll(item.data)"
              @vote="navigateToPoll(item.data)"
            />
          </template>
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <ion-icon :icon="documentTextOutline" size="large"></ion-icon>
          <p>No content yet</p>
          <p class="subtitle">Join a community and create the first post or poll!</p>
        </div>
      </div>

      <!-- COMMUNITIES TAB -->
      <div v-else-if="activeTab === 'communities'" class="communities-tab">
        <!-- Create Community Button -->
        <div class="ion-padding">
          <ion-button expand="block" @click="$router.push('/create-community')">
            <ion-icon slot="start" :icon="addCircleOutline"></ion-icon>
            Create Community
          </ion-button>
        </div>

        <!-- Filter Buttons -->
        <div class="ion-padding-horizontal">
          <ion-segment v-model="communityFilter">
            <ion-segment-button value="all">
              <ion-label>All</ion-label>
            </ion-segment-button>
            <ion-segment-button value="joined">
              <ion-label>Joined</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>

        <!-- Loading Communities -->
        <div v-if="communityStore.isLoading" class="loading-container">
          <ion-spinner></ion-spinner>
          <p>Loading communities...</p>
        </div>

        <!-- Communities List -->
        <div v-else-if="displayedCommunities.length > 0" class="communities-list">
          <CommunityCard 
            v-for="community in displayedCommunities" 
            :key="community.id"
            :community="community"
            @click="$router.push(`/community/${community.id}`)"
          />
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <ion-icon :icon="earthOutline" size="large"></ion-icon>
          <p>{{ communityFilter === 'joined' ? 'No joined communities' : 'No communities yet' }}</p>
          <ion-button @click="communityFilter === 'joined' ? communityFilter = 'all' : $router.push('/create-community')">
            {{ communityFilter === 'joined' ? 'Browse All' : 'Create the first one!' }}
          </ion-button>
        </div>
      </div>

      <!-- CREATE TAB -->
      <div v-else-if="activeTab === 'create'" class="create-tab">
        <div class="ion-padding">
          <h2>Create Content</h2>
          <p class="subtitle">What would you like to create?</p>
        </div>

        <!-- Create Options -->
        <div class="create-options">
          <ion-card button @click="$router.push('/create-community')">
            <ion-card-content>
              <div class="create-option">
                <ion-icon :icon="peopleOutline" color="primary" size="large"></ion-icon>
                <div>
                  <h3>Create Community</h3>
                  <p>Start a new community for discussions</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" slot="end"></ion-icon>
              </div>
            </ion-card-content>
          </ion-card>

          <ion-card button @click="showPostOptions">
            <ion-card-content>
              <div class="create-option">
                <ion-icon :icon="documentTextOutline" color="secondary" size="large"></ion-icon>
                <div>
                  <h3>Create Post</h3>
                  <p>Share content in a community</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" slot="end"></ion-icon>
              </div>
            </ion-card-content>
          </ion-card>

          <ion-card button @click="showPollOptions">
            <ion-card-content>
              <div class="create-option">
                <ion-icon :icon="statsChartOutline" color="tertiary" size="large"></ion-icon>
                <div>
                  <h3>Create Poll</h3>
                  <p>Ask the community a question</p>
                </div>
                <ion-icon :icon="chevronForwardOutline" slot="end"></ion-icon>
              </div>
            </ion-card-content>
          </ion-card>
        </div>

        <!-- Recent Communities (for quick posting) -->
        <div v-if="joinedCommunities.length > 0" class="ion-padding">
          <h3>Post to Community</h3>
          <p class="subtitle">Quick access to your communities</p>
          
          <div class="quick-communities">
            <ion-chip 
              v-for="community in joinedCommunities.slice(0, 5)" 
              :key="community.id"
              @click="$router.push(`/community/${community.id}/create-post`)"
            >
              <ion-icon :icon="peopleOutline"></ion-icon>
              <ion-label>{{ community.displayName }}</ion-label>
            </ion-chip>
          </div>
        </div>
      </div>

      <!-- NETWORK TAB - Network & Connectivity -->
      <div v-else-if="activeTab === 'network'" class="network-tab">
        <div class="ion-padding">
          <h2>Network Status</h2>
        </div>

        <!-- Chain Status -->
        <ChainStatus />

        <!-- P2P Network Status -->
        <ion-card class="status-card">
          <ion-card-header>
            <ion-card-title>P2P Network</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <div class="status-row">
              <div class="status-item">
                <ion-icon :icon="serverOutline" :color="websocketConnected ? 'success' : 'danger'"></ion-icon>
                <div>
                  <strong>WebSocket Relay</strong>
                  <p>{{ websocketConnected ? 'Connected' : 'Disconnected' }}</p>
                </div>
              </div>
              <div class="status-item">
                <ion-icon :icon="peopleOutline" :color="peerCount > 0 ? 'success' : 'warning'"></ion-icon>
                <div>
                  <strong>Active Peers</strong>
                  <p>{{ peerCount }} peer{{ peerCount !== 1 ? 's' : '' }}</p>
                </div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- GunDB Status -->
        <ion-card class="status-card">
          <ion-card-header>
            <ion-card-title>GunDB Status</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <div class="status-row">
              <div class="status-item">
                <ion-icon :icon="cloudOutline" :color="gunConnected ? 'success' : 'danger'"></ion-icon>
                <div>
                  <strong>Connection</strong>
                  <p>{{ gunConnected ? 'Connected' : 'Disconnected' }}</p>
                </div>
              </div>
              <div class="status-item">
                <ion-icon :icon="syncOutline"></ion-icon>
                <div>
                  <strong>Sync Status</strong>
                  <p>{{ gunSyncStatus }}</p>
                </div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- IPFS Status -->
        <ion-card class="status-card">
          <ion-card-header>
            <ion-card-title>IPFS Storage</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <div class="status-row">
              <div class="status-item">
                <ion-icon :icon="imageOutline" :color="ipfsReady ? 'success' : 'medium'"></ion-icon>
                <div>
                  <strong>Image Upload</strong>
                  <p>{{ ipfsReady ? 'Ready' : 'Initializing' }}</p>
                </div>
              </div>
              <div class="status-item">
                <ion-icon :icon="cubeOutline"></ion-icon>
                <div>
                  <strong>Storage</strong>
                  <p>Decentralized</p>
                </div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Blockchain Status -->
        <ion-card class="status-card">
          <ion-card-header>
            <ion-card-title>Blockchain</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <div class="status-row">
              <div class="status-item">
                <ion-icon :icon="cubeOutline" color="primary"></ion-icon>
                <div>
                  <strong>Latest Block</strong>
                  <p>#{{ blockCount }}</p>
                </div>
              </div>
              <div class="status-item">
                <ion-icon :icon="checkmarkCircleOutline" :color="isChainValid ? 'success' : 'danger'"></ion-icon>
                <div>
                  <strong>Chain Validity</strong>
                  <p>{{ isChainValid ? 'Valid' : 'Invalid' }}</p>
                </div>
              </div>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Statistics -->
        <ion-card class="status-card">
          <ion-card-header>
            <ion-card-title>Network Statistics</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-list>
              <ion-item>
                <ion-label>
                  <h3>Total Communities</h3>
                  <p>{{ totalCommunities }}</p>
                </ion-label>
              </ion-item>
              <ion-item>
                <ion-label>
                  <h3>Joined Communities</h3>
                  <p>{{ joinedCount }}</p>
                </ion-label>
              </ion-item>
              <ion-item>
                <ion-label>
                  <h3>Total Posts</h3>
                  <p>{{ allPosts.length }}</p>
                </ion-label>
              </ion-item>
            </ion-list>
          </ion-card-content>
        </ion-card>

        <!-- Refresh Button -->
        <div class="ion-padding">
          <ion-button expand="block" @click="refreshStatus">
            <ion-icon slot="start" :icon="refreshOutline"></ion-icon>
            Refresh Status
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSpinner,
  IonList,
  IonItem,
  IonChip,
  actionSheetController,
  toastController
} from '@ionic/vue';
import { 
  cube, 
  personCircleOutline, 
  settingsOutline,
  addCircleOutline,
  earthOutline,
  cloudOutline,
  peopleOutline,
  homeOutline,
  statsChartOutline,
  documentTextOutline,
  serverOutline,
  syncOutline,
  imageOutline,
  cubeOutline,
  checkmarkCircleOutline,
  refreshOutline,
  chevronForwardOutline
} from 'ionicons/icons';
import { useRouter } from 'vue-router';
import { useChainStore } from '../stores/chainStore';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import ChainStatus from '../components/ChainStatus.vue';
import CommunityCard from '../components/CommunityCard.vue';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import { Post } from '../services/postService';
import { Poll } from '../services/pollService';

const router = useRouter();
const chainStore = useChainStore();
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();

const activeTab = ref('home'); // Start on home
const communityFilter = ref('all');
const isLoadingPosts = ref(false);
const hasLoadedPosts = ref(false); // Track if posts have been loaded

// Network status
const websocketConnected = ref(false);
const peerCount = ref(0);
const gunConnected = ref(false);
const gunSyncStatus = ref('Initializing...');
const ipfsReady = ref(false);

// Update interval
let statusInterval: any = null;

const displayedCommunities = computed(() => {
  if (communityFilter.value === 'joined') {
    return communityStore.communities.filter(c => 
      communityStore.isJoined(c.id)
    );
  }
  return communityStore.communities;
});

const allPosts = computed(() => {
  return postStore.sortedPosts || [];
});

const allPolls = computed(() => {
  // Hide private polls from the global home feed
  return (pollStore.sortedPolls || []).filter(p => !p.isPrivate);
});

// Combined feed of posts and polls, sorted by creation date
const combinedFeed = computed(() => {
  const items: Array<{type: 'post' | 'poll', data: any, createdAt: number}> = [];
  
  allPosts.value.forEach(post => {
    items.push({ type: 'post', data: post, createdAt: post.createdAt });
  });
  
  allPolls.value.forEach(poll => {
    items.push({ type: 'poll', data: poll, createdAt: poll.createdAt });
  });
  
  // Sort by creation date (newest first)
  return items.sort((a, b) => b.createdAt - a.createdAt);
});

const blockCount = computed(() => {
  return chainStore.chain?.length || 0;
});

const isChainValid = computed(() => {
  return chainStore.isValid ?? false;
});

const totalCommunities = computed(() => {
  return communityStore.communities?.length || 0;
});

const joinedCount = computed(() => {
  return communityStore.joinedCommunities?.size || 0;
});

const joinedCommunities = computed(() => {
  return communityStore.communities.filter(c => communityStore.isJoined(c.id));
});

function hasUpvoted(postId: string): boolean {
  const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
  return votedPosts.includes(postId);
}

function hasDownvoted(postId: string): boolean {
  const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
  return votedPosts.includes(postId);
}

async function handleUpvote(post: Post) {
  console.log('Upvoting post:', post.id);
  
  try {
    // Check if already upvoted
    if (hasUpvoted(post.id)) {
      // Remove upvote
      await postStore.removeUpvote(post.id);
      
      // Remove from localStorage
      const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      const filtered = votedPosts.filter((id: string) => id !== post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      
      const toast = await toastController.create({
        message: 'Upvote removed',
        duration: 1500,
        color: 'medium'
      });
      await toast.present();
    } else {
      // If previously downvoted, clear that first to avoid wiping the new upvote
      const downvotedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      if (downvotedPosts.includes(post.id)) {
        await postStore.removeDownvote(post.id);
        const filtered = downvotedPosts.filter((id: string) => id !== post.id);
        localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      }

      await postStore.upvotePost(post.id);
      
      // Add to localStorage
      const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      votedPosts.push(post.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(votedPosts));
      
      const toast = await toastController.create({
        message: 'Upvoted',
        duration: 1500,
        color: 'success'
      });
      await toast.present();
    }
  } catch (error) {
    console.error('Error upvoting:', error);
    const toast = await toastController.create({
      message: 'Failed to upvote',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

async function handleDownvote(post: Post) {
  console.log('Downvoting post:', post.id);
  
  try {
    // Check if already downvoted
    if (hasDownvoted(post.id)) {
      // Remove downvote
      await postStore.removeDownvote(post.id);
      
      // Remove from localStorage
      const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      const filtered = votedPosts.filter((id: string) => id !== post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      
      const toast = await toastController.create({
        message: 'Downvote removed',
        duration: 1500,
        color: 'medium'
      });
      await toast.present();
    } else {
      // If previously upvoted, clear that first to avoid wiping the new downvote
      const upvotedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      if (upvotedPosts.includes(post.id)) {
        await postStore.removeUpvote(post.id);
        const filtered = upvotedPosts.filter((id: string) => id !== post.id);
        localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      }

      await postStore.downvotePost(post.id);
      
      // Add to localStorage
      const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      votedPosts.push(post.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(votedPosts));
      
      const toast = await toastController.create({
        message: 'Downvoted',
        duration: 1500,
        color: 'warning'
      });
      await toast.present();
    }
  } catch (error) {
    console.error('Error downvoting:', error);
    const toast = await toastController.create({
      message: 'Failed to downvote',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

function getCommunityName(communityId: string): string {
  const community = communityStore.communities.find(c => c.id === communityId);
  return community?.displayName || communityId;
}

function navigateToPost(post: Post) {
  router.push(`/community/${post.communityId}/post/${post.id}`);
}

function navigateToPoll(poll: Poll) {
  router.push(`/community/${poll.communityId}/poll/${poll.id}`);
}

async function loadAllPosts() {
  if (hasLoadedPosts.value) {
    console.log('Posts already loaded, skipping');
    return;
  }
  
  if (communityStore.communities.length === 0) {
    console.log('No communities available to load content from');
    return;
  }
  
  isLoadingPosts.value = true;
  
  try {
    console.log(`Loading content from ${communityStore.communities.length} communities...`);
    
    // Load both posts and polls from all communities in parallel
    const loadPromises = communityStore.communities.flatMap(community => [
      postStore.loadPostsForCommunity(community.id),
      pollStore.loadPollsForCommunity(community.id)
    ]);
    
    await Promise.all(loadPromises);
    
    hasLoadedPosts.value = true;
    console.log(`Loaded ${postStore.posts.length} posts and ${pollStore.polls.length} polls`);
  } catch (error) {
    console.error('Error loading content:', error);
  } finally {
    isLoadingPosts.value = false;
  }
}

function updateNetworkStatus() {
  // Check WebSocket status
  try {
    websocketConnected.value = true; // TODO: Get from WebSocket service
    peerCount.value = 1; // TODO: Get actual peer count
  } catch (error) {
    websocketConnected.value = false;
    peerCount.value = 0;
  }

  // Check Gun status
  try {
    gunConnected.value = true;
    gunSyncStatus.value = 'Synced';
  } catch (error) {
    gunConnected.value = false;
    gunSyncStatus.value = 'Error';
  }

  // IPFS status
  ipfsReady.value = true;
}

async function showPostOptions() {
  // If user has joined communities, show them
  if (joinedCommunities.value.length > 0) {
    const actionSheet = await actionSheetController.create({
      header: 'Select Community',
      buttons: [
        ...joinedCommunities.value.slice(0, 10).map(community => ({
          text: community.displayName,
          handler: () => {
            router.push(`/community/${community.id}/create-post`);
          }
        })),
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });
    await actionSheet.present();
  } else {
    // No communities joined, redirect to communities tab
    activeTab.value = 'communities';
  }
}

async function showPollOptions() {
  // If user has joined communities, show them
  if (joinedCommunities.value.length > 0) {
    const actionSheet = await actionSheetController.create({
      header: 'Select Community',
      buttons: [
        ...joinedCommunities.value.slice(0, 10).map(community => ({
          text: community.displayName,
          handler: () => {
            router.push(`/create-poll?communityId=${community.id}`);
          }
        })),
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });
    await actionSheet.present();
  } else {
    // No communities joined, redirect to communities tab
    activeTab.value = 'communities';
  }
}

async function refreshStatus() {
  updateNetworkStatus();
  await chainStore.initialize();
  await communityStore.refreshCommunities();
}

// Watch for communities being loaded - then load posts automatically
watch(() => communityStore.communities.length, async (newLength, oldLength) => {
  if (newLength > 0 && oldLength === 0 && !hasLoadedPosts.value) {
    // Communities just finished loading, now load posts
    console.log('Communities loaded, now loading posts...');
    await loadAllPosts();
  }
});

// Watch for tab changes - load posts only when switching to Home tab
watch(activeTab, async (newTab) => {
  if (newTab === 'home' && !hasLoadedPosts.value && communityStore.communities.length > 0) {
    await loadAllPosts();
  }
});

onMounted(async () => {
  console.log('HomePage mounted');
  
  // Initialize chain
  await chainStore.initialize();
  
  // Load communities (fast)
  await communityStore.loadCommunities();

  // Posts will auto-load via watcher when communities finish loading

  // Update network status
  updateNetworkStatus();

  // Update status every 10 seconds
  statusInterval = setInterval(updateNetworkStatus, 10000);
});

onUnmounted(() => {
  if (statusInterval) {
    clearInterval(statusInterval);
  }
});
</script>


<style scoped>
.home-tab h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.subtitle {
  margin: 4px 0 0 0;
  color: var(--ion-color-medium);
  font-size: 14px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
}

.loading-container p {
  margin-top: 16px;
  color: var(--ion-color-medium);
}

.posts-list {
  padding: 0 0px 0px 0px;
}

.communities-list {
  padding: 0 0 0px 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.empty-state ion-icon {
  color: var(--ion-color-medium);
  margin-bottom: 16px;
}

.empty-state p {
  color: var(--ion-color-medium);
  margin: 8px 0;
}

.status-card {
  margin: 12px;
}

.status-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.status-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.status-item ion-icon {
  font-size: 32px;
  margin-top: 4px;
}

.status-item strong {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
}

.status-item p {
  margin: 0;
  font-size: 13px;
  color: var(--ion-color-medium);
}

ion-segment {
  padding: 0 12px;
}

ion-segment-button {
  font-size: 12px;
}

ion-list {
  background: transparent;
}

ion-item {
  --background: transparent;
}

@media (min-width: 768px) {
  .posts-list,
  .communities-list {
    max-width: 800px;
    margin: 0 auto;
  }
}
</style>