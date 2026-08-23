<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/home"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ displayName }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <DesktopPageShell>
      <!-- Profile Header -->
      <div class="profile-header">
        <div class="avatar-placeholder">
          <ion-icon :icon="personCircleOutline"></ion-icon>
        </div>
        <h1>{{ displayName }}</h1>
        <p v-if="userProfile?.username" class="username">u/{{ userProfile.username }}</p>

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
            <strong class="tabular">{{ userProfile?.karma ?? 0 }}</strong>
            <span>Karma</span>
          </div>
          <div class="stat">
            <strong class="tabular">{{ userProfile?.postCount ?? 0 }}</strong>
            <span>Posts</span>
          </div>
          <div class="stat">
            <strong class="tabular">{{ userProfile?.commentCount ?? 0 }}</strong>
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
        <p class="section-title">Posts</p>
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
            @click="$router.push(`/community/${post.communityId}/post/${post.id}`)"
          />
        </div>
      </div>

      <div class="divider"></div>

      <!-- Polls replace what was a comments section: GunDB has no by-author
           comment index, so that list could only ever render empty. -->
      <div class="section">
        <p class="section-title">Polls</p>
        <div v-if="loadingPosts" class="loading">
          <ion-spinner></ion-spinner>
        </div>
        <div v-else-if="userPolls.length === 0" class="empty-state">
          <p>No polls yet</p>
        </div>
        <div v-else class="posts-list">
          <PollCard
            v-for="poll in userPolls"
            :key="poll.id"
            :poll="poll"
            @click="$router.push(`/community/${poll.communityId}/poll/${poll.id}`)"
          />
        </div>
      </div>
      </DesktopPageShell>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import DesktopPageShell from '../components/DesktopPageShell.vue';
import { useRouter, useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonButton, IonIcon, IonSpinner,
  toastController
} from '@ionic/vue';
import { personCircleOutline, chatbubbleOutline } from 'ionicons/icons';
import PostCard from '../components/PostCard.vue';
import PollCard from '../components/PollCard.vue';
import { useChat } from '../composables/useChat';
import { useUserStore } from '../stores/userStore';
import { useCommunityStore } from '../stores/communityStore';
import { usePostStore } from '../stores/postStore';
import { usePollStore } from '../stores/pollStore';
import { UserService, type UserProfile } from '../services/userService';
import config from '@/config';

const router = useRouter();
const route = useRoute();

const userId = route.params.userId as string;

const userStore = useUserStore();
const communityStore = useCommunityStore();
const postStore = usePostStore();
const pollStore = usePollStore();

const currentUserId = ref<string>('');
const WS_URL = config.relay.websocket;

const userProfile = ref<UserProfile | null>(null);
const loadingProfile = ref(true);
const loadingPosts = ref(true);

// Chat composable. The peer key is only known once the profile resolves, so
// the composable is created with an empty id until then rather than a literal.
const { publicKey: chatPublicKey } = useChat(WS_URL, userId);

/** Falls back to the id rather than inventing a name when the profile has
 *  not replicated to this peer yet. */
const displayName = computed(() =>
  userProfile.value?.displayName || userProfile.value?.username || (loadingProfile.value ? 'Loading…' : `u/${userId.slice(0, 12)}`)
);

const isOwnProfile = computed(() => !!currentUserId.value && userId === currentUserId.value);

/** Posts this user authored, newest first, drawn from the loaded feed. */
const userPosts = computed(() =>
  postStore.sortedPosts.filter((post: any) => post.authorId === userId)
);

/** Polls this user authored. Private polls are omitted — they are not this
 *  viewer's to see from a profile page. */
const userPolls = computed(() =>
  pollStore.sortedPolls.filter((poll: any) => poll.authorId === userId && !poll.isPrivate)
);

onMounted(async () => {
  void UserService.getCurrentUser()
    .then(me => { currentUserId.value = me.id; })
    .catch(() => { /* anonymous viewer — isOwnProfile stays false */ });

  await Promise.all([loadUserProfile(), loadAuthoredContent()]);
});

const loadUserProfile = async () => {
  loadingProfile.value = true;
  try {
    userProfile.value = await userStore.getProfile(userId);
  } finally {
    loadingProfile.value = false;
  }
};

/**
 * There is no by-author index in GunDB, and no global post feed — posts and
 * polls are only reachable per community. So subscribe across every known
 * community and filter locally, the same way the home feed is assembled.
 * Capped with a timeout because a slow or absent relay leaves Gun
 * subscriptions hanging indefinitely.
 */
const CONTENT_LOAD_TIMEOUT_MS = 6000;

const loadAuthoredContent = async () => {
  loadingPosts.value = true;
  try {
    await communityStore.loadCommunities();
    const subscriptions = communityStore.communities.flatMap((c: any) => [
      postStore.loadPostsForCommunity(c.id),
      pollStore.loadPollsForCommunity(c.id),
    ]);
    await Promise.race([
      Promise.allSettled(subscriptions),
      new Promise(resolve => setTimeout(resolve, CONTENT_LOAD_TIMEOUT_MS)),
    ]);
  } finally {
    loadingPosts.value = false;
  }
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
