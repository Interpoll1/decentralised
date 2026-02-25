<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ userProfile?.displayName || 'User Profile' }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Profile Header -->
      <div class="profile-header">
        <div class="avatar-placeholder">
          <ion-icon :icon="personCircleOutline"></ion-icon>
        </div>
        <h1>{{ userProfile?.displayName || userProfile?.username }}</h1>
        <p class="username">u/{{ userProfile?.username }}</p>

        <!-- Chat Button - Only show if not viewing own profile -->
        <ion-button
          v-if="!isOwnProfile"
          class="chat-button"
          @click="startChat"
          :disabled="!chatPublicKey"
        >
          <ion-icon slot="start" :icon="chatbubbleOutline"></ion-icon>
          Message
        </ion-button>

        <div class="stats-row">
          <div class="stat">
            <strong>{{ userProfile?.karma || 0 }}</strong>
            <span>Karma</span>
          </div>
          <div class="stat">
            <strong>{{ userProfile?.postCount || 0 }}</strong>
            <span>Posts</span>
          </div>
          <div class="stat">
            <strong>{{ userProfile?.commentCount || 0 }}</strong>
            <span>Comments</span>
          </div>
        </div>

        <div v-if="userProfile?.bio" class="bio">
          <p>{{ userProfile.bio }}</p>
        </div>
      </div>

      <div class="divider"></div>

      <!-- User's Posts -->
      <div class="section">
        <p class="section-title">Recent Posts</p>
        <div v-if="loadingPosts" class="loading">
          <ion-spinner></ion-spinner>
        </div>
        <div v-else-if="userPosts.length === 0" class="empty-state">
          <p>No posts yet</p>
        </div>
        <div v-else class="posts-list">
          <PostCard
            v-for="post in userPosts"
            :key="post.id"
            :post="post"
            @click="$router.push(`/post/${post.id}`)"
          />
        </div>
      </div>

      <div class="divider"></div>

      <!-- User's Comments -->
      <div class="section">
        <p class="section-title">Recent Comments</p>
        <div v-if="loadingComments" class="loading">
          <ion-spinner></ion-spinner>
        </div>
        <div v-else-if="userComments.length === 0" class="empty-state">
          <p>No comments yet</p>
        </div>
        <div v-else class="comments-list">
          <CommentCard
            v-for="comment in userComments"
            :key="comment.id"
            :comment="comment"
          />
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonButton, IonIcon, IonSpinner,
  toastController
} from '@ionic/vue';
import { personCircleOutline, chatbubbleOutline } from 'ionicons/icons';
import PostCard from '../components/PostCard.vue';
import CommentCard from '../components/CommentCard.vue';
import { useChat } from '../composables/useChat';

const router = useRouter();
const route = useRoute();

const userId = route.params.userId as string;
const currentUserId = ref('current-user-id'); // Get from auth store

const WS_URL = import.meta.env.VITE_WS_URL || 'wss://your-relay-server.com';

// Chat composable
const { publicKey: chatPublicKey } = useChat(WS_URL, currentUserId.value);

// User profile data
const userProfile = ref<any>(null);
const userPosts = ref<any[]>([]);
const userComments = ref<any[]>([]);
const loadingPosts = ref(false);
const loadingComments = ref(false);

const isOwnProfile = computed(() => userId === currentUserId.value);

onMounted(async () => {
  await loadUserProfile();
  await loadUserPosts();
  await loadUserComments();
});

const loadUserProfile = async () => {
  // TODO: Fetch user profile from your backend/Gun
  // For now, mock data
  userProfile.value = {
    id: userId,
    username: 'user123',
    displayName: 'John Doe',
    bio: 'Love decentralized tech and community building!',
    karma: 1250,
    postCount: 42,
    commentCount: 156,
    publicKey: 'mock-public-key', // This should come from backend
  };
};

const loadUserPosts = async () => {
  loadingPosts.value = true;
  // TODO: Fetch user's posts
  userPosts.value = [];
  loadingPosts.value = false;
};

const loadUserComments = async () => {
  loadingComments.value = true;
  // TODO: Fetch user's comments
  userComments.value = [];
  loadingComments.value = false;
};

const startChat = async () => {
  if (!userProfile.value?.publicKey) {
    const toast = await toastController.create({
      message: 'Unable to start chat. User public key not available.',
      duration: 2000,
      color: 'warning',
    });
    await toast.present();
    return;
  }

  router.push({
    name: 'Chat',
    params: { userId: userId },
    query: {
      name: userProfile.value.displayName || userProfile.value.username,
      publicKey: userProfile.value.publicKey,
    },
  });
};
</script>

<style scoped>
.profile-header {
  padding: 2rem 1rem;
  text-align: center;
  background: var(--ion-background-color);
}

.avatar-placeholder {
  width: 100px;
  height: 100px;
  margin: 0 auto 1rem;
  border-radius: 50%;
  background: var(--ion-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-placeholder ion-icon {
  font-size: 80px;
  color: var(--ion-color-medium);
}

.profile-header h1 {
  margin: 0 0 0.25rem 0;
  font-size: 1.5rem;
  font-weight: 600;
}

.username {
  color: var(--ion-color-medium);
  font-size: 0.875rem;
  margin: 0 0 1rem 0;
}

.chat-button {
  margin: 1rem 0;
}

.stats-row {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-top: 1.5rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat strong {
  font-size: 1.25rem;
  font-weight: 600;
}

.stat span {
  font-size: 0.75rem;
  color: var(--ion-color-medium);
  text-transform: uppercase;
  margin-top: 0.25rem;
}

.bio {
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--ion-color-light);
  border-radius: 8px;
  text-align: left;
}

.bio p {
  margin: 0;
  color: var(--ion-color-step-600);
  line-height: 1.5;
}

.divider {
  height: 8px;
  background: var(--ion-color-light);
}

.section {
  padding: 1rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--ion-color-medium);
  margin: 0 0 1rem 0;
  letter-spacing: 0.05em;
}

.loading,
.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem;
  color: var(--ion-color-medium);
}

.posts-list,
.comments-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
