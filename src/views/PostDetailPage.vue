<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button :default-href="`/community/${post?.communityId || '/home'}`"></ion-back-button>
        </ion-buttons>
        <ion-title>Post</ion-title>
        <ion-buttons slot="end">
          <ion-button @click="refreshPost">
            <ion-icon :icon="refreshOutline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <!-- Loading -->
      <div v-if="isLoading" class="loading-container">
        <ion-spinner></ion-spinner>
        <p>Loading post...</p>
      </div>

      <!-- Post Not Found -->
      <div v-else-if="!post" class="empty-state">
        <ion-icon :icon="alertCircleOutline" size="large"></ion-icon>
        <p>Post not found</p>
        <ion-button @click="$router.push('/home')">Go Home</ion-button>
      </div>

      <!-- Post Content -->
      <div v-else>
        <!-- Post Card -->
        <ion-card class="post-detail-card">
          <ion-card-header>
            <div class="post-meta">
              <ion-chip @click="$router.push(`/community/${post.communityId}`)">
                <ion-icon :icon="peopleOutline"></ion-icon>
                <ion-label>{{ communityName }}</ion-label>
              </ion-chip>
              <span class="separator">•</span>
              <span class="author">u/{{ post.authorName }}</span>
              <span class="separator">•</span>
              <span class="timestamp">{{ formatTime(post.createdAt) }}</span>
            </div>
            <ion-card-title class="post-title">{{ post.title }}</ion-card-title>
          </ion-card-header>

          <ion-card-content>
            <!-- Post Content -->
            <div v-if="post.content" class="post-content">
              {{ post.content }}
            </div>

            <!-- Post Image -->
            <div v-if="post.imageThumbnail || post.imageIPFS" class="post-image">
              <img :src="post.imageThumbnail || getIPFSUrl(post.imageIPFS)" :alt="post.title" />
            </div>

            <!-- Vote & Actions Bar -->
            <div class="actions-bar">
              <div class="vote-buttons">
                <button class="vote-button upvote" @click="handleUpvote" :class="{ active: hasUpvoted }">
                  <ion-icon :icon="arrowUpOutline"></ion-icon>
                  <span>{{ formatNumber(post.upvotes) }}</span>
                </button>
                
                <button class="vote-button downvote" @click="handleDownvote" :class="{ active: hasDownvoted }">
                  <ion-icon :icon="arrowDownOutline"></ion-icon>
                  <span>{{ formatNumber(post.downvotes) }}</span>
                </button>

                <div class="stat-item score">
                  <ion-icon :icon="trendingUpOutline"></ion-icon>
                  <span>Score: {{ post.score }}</span>
                </div>
              </div>

              <button class="action-button share" @click="sharePost">
                <ion-icon :icon="shareSocialOutline"></ion-icon>
                <span>Share</span>
              </button>
            </div>
          </ion-card-content>
        </ion-card>

        <!-- Comments Section -->
        <ion-card class="comments-card">
          <ion-card-header>
            <ion-card-title>
              Comments ({{ allComments.length }})
            </ion-card-title>
          </ion-card-header>

          <ion-card-content>
            <!-- Add Comment Form -->
            <div class="add-comment-form">
              <ion-textarea
                v-model="newCommentText"
                placeholder="Add a comment..."
                :auto-grow="true"
                :rows="3"
                class="comment-textarea"
              ></ion-textarea>
              <ion-button 
                expand="block" 
                @click="submitComment"
                :disabled="!newCommentText.trim()"
              >
                <ion-icon slot="start" :icon="sendOutline"></ion-icon>
                Post Comment
              </ion-button>
            </div>

            <!-- Comments List -->
            <div v-if="allComments.length > 0" class="comments-list">
              <CommentCard 
                v-for="comment in sortedComments" 
                :key="comment.id"
                :comment="comment"
                :post-id="post.id"
                :community-id="post.communityId"
                @upvote="handleCommentUpvote(comment)"
                @downvote="handleCommentDownvote(comment)"
              />
            </div>

            <!-- Empty Comments State -->
            <div v-else class="empty-comments">
              <ion-icon :icon="chatbubbleOutline" size="large"></ion-icon>
              <p>No comments yet</p>
              <p class="subtitle">Be the first to comment!</p>
            </div>
          </ion-card-content>
        </ion-card>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonChip,
  IonLabel,
  IonSpinner,
  IonTextarea,
  toastController,
  actionSheetController
} from '@ionic/vue';
import {
  peopleOutline,
  arrowUpOutline,
  arrowDownOutline,
  trendingUpOutline,
  chatbubbleOutline,
  sendOutline,
  shareSocialOutline,
  alertCircleOutline,
  refreshOutline
} from 'ionicons/icons';
import { usePostStore } from '../stores/postStore';
import { useCommentStore } from '../stores/commentStore';
import { useCommunityStore } from '../stores/communityStore';
import { useUserStore } from '../stores/userStore';
import CommentCard from '../components/CommentCard.vue';
import { Post } from '../services/postService';

const route = useRoute();
const router = useRouter();
const postStore = usePostStore();
const commentStore = useCommentStore();
const communityStore = useCommunityStore();
const userStore = useUserStore();

const post = ref<Post | null>(null);
const isLoading = ref(true);
const newCommentText = ref('');

const postId = computed(() => route.params.postId as string);
const communityId = computed(() => route.params.communityId as string);

const communityName = computed(() => {
  const community = communityStore.communities.find(c => c.id === communityId.value);
  return community?.displayName || communityId.value;
});

const allComments = computed(() => {
  return commentStore.comments.filter(c => {
    const matchesPost = c.postId === postId.value || c.postId === post.value?.id;
    return matchesPost && !c.parentId;
  });
});

const sortedComments = computed(() => {
  const minKarma = Number(localStorage.getItem('minUserKarma') || '-1000');

  const visible = allComments.value.filter((c) => {
    if (minKarma <= -1000) return true;

    const authorId = c.authorId;
    if (!authorId) return true;

    const cached = userStore.getCachedKarma(authorId);
    if (cached !== null) {
      return cached >= minKarma;
    }

    // No profile yet: fetch in background and show for now
    userStore.getProfile(authorId);
    return true;
  });

  return visible.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.createdAt - a.createdAt;
  });
});

const hasUpvoted = computed(() => {
  const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
  return votedPosts.includes(postId.value);
});

const hasDownvoted = computed(() => {
  const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
  return votedPosts.includes(postId.value);
});

function formatTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

function formatNumber(num: number | undefined | null): string {
  const n = num ?? 0;
  
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function getIPFSUrl(cid?: string): string {
  if (!cid) return '';
  return `https://ipfs.io/ipfs/${cid}`;
}

async function handleUpvote() {
  if (!post.value) return;
  
  try {
    if (hasUpvoted.value) {
      await postStore.removeUpvote(post.value.id);
      
      const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      const filtered = votedPosts.filter((id: string) => id !== post.value!.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      
      const toast = await toastController.create({
        message: 'Upvote removed',
        duration: 1500,
        color: 'medium'
      });
      await toast.present();
    } else {
      const downvotedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      if (downvotedPosts.includes(post.value.id)) {
        await postStore.removeDownvote(post.value.id);
        const filtered = downvotedPosts.filter((id: string) => id !== post.value!.id);
        localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      }

      await postStore.upvotePost(post.value.id);

      const votedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      votedPosts.push(post.value.id);
      localStorage.setItem('upvoted-posts', JSON.stringify(votedPosts));
      
      const toast = await toastController.create({
        message: 'Upvoted',
        duration: 1500,
        color: 'success'
      });
      await toast.present();
    }
    
    await loadPost();
  } catch (_error) {
    // Upvote failed
  }
}

async function handleDownvote() {
  if (!post.value) return;
  
  try {
    if (hasDownvoted.value) {
      await postStore.removeDownvote(post.value.id);
      
      const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      const filtered = votedPosts.filter((id: string) => id !== post.value!.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(filtered));
      
      const toast = await toastController.create({
        message: 'Downvote removed',
        duration: 1500,
        color: 'medium'
      });
      await toast.present();
    } else {
      const upvotedPosts = JSON.parse(localStorage.getItem('upvoted-posts') || '[]');
      if (upvotedPosts.includes(post.value.id)) {
        await postStore.removeUpvote(post.value.id);
        const filtered = upvotedPosts.filter((id: string) => id !== post.value!.id);
        localStorage.setItem('upvoted-posts', JSON.stringify(filtered));
      }

      await postStore.downvotePost(post.value.id);

      const votedPosts = JSON.parse(localStorage.getItem('downvoted-posts') || '[]');
      votedPosts.push(post.value.id);
      localStorage.setItem('downvoted-posts', JSON.stringify(votedPosts));
      
      const toast = await toastController.create({
        message: 'Downvoted',
        duration: 1500,
        color: 'warning'
      });
      await toast.present();
    }
    
    await loadPost();
  } catch (_error) {
    // Downvote failed
  }
}

async function submitComment() {
  if (!post.value || !newCommentText.value.trim()) return;
  
  try {
    await commentStore.createComment({
      postId: post.value.id,
      communityId: post.value.communityId,
      content: newCommentText.value.trim()
    });
    
    newCommentText.value = '';
    
    const toast = await toastController.create({
      message: 'Comment posted',
      duration: 2000,
      color: 'success'
    });
    await toast.present();
    
    setTimeout(() => {
      commentStore.loadCommentsForPost(post.value!.id);
    }, 500);
    
  } catch (_error) {
    const toast = await toastController.create({
      message: 'Failed to post comment',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

async function handleCommentUpvote(comment: any) {
  try {
    await commentStore.upvoteComment(comment.id);
    
    const toast = await toastController.create({
      message: 'Comment upvoted',
      duration: 1500,
      color: 'success'
    });
    await toast.present();
  } catch (_error) {
    // Comment upvote failed
  }
}

async function handleCommentDownvote(comment: any) {
  try {
    await commentStore.downvoteComment(comment.id);
    
    const toast = await toastController.create({
      message: 'Comment downvoted',
      duration: 1500,
      color: 'warning'
    });
    await toast.present();
  } catch (_error) {
    // Comment downvote failed
  }
}

async function sharePost() {
  if (!post.value) return;
  
  const actionSheet = await actionSheetController.create({
    header: 'Share Post',
    buttons: [
      {
        text: 'Copy Link',
        icon: 'link-outline',
        handler: () => {
          const url = window.location.href;
          navigator.clipboard.writeText(url);
          
          toastController.create({
            message: 'Link copied to clipboard',
            duration: 2000,
            color: 'success'
          }).then(toast => toast.present());
        }
      },
      {
        text: 'Share via...',
        icon: 'share-social-outline',
        handler: () => {
          if (navigator.share) {
            navigator.share({
              title: post.value!.title,
              text: post.value!.content,
              url: window.location.href
            });
          }
        }
      },
      {
        text: 'Cancel',
        role: 'cancel'
      }
    ]
  });
  
  await actionSheet.present();
}

async function loadPost() {
  isLoading.value = true;
  
  try {
    await postStore.selectPost(postId.value);
    post.value = postStore.currentPost;
    
    if (post.value) {
      await commentStore.loadCommentsForPost(post.value.id);
    }
  } catch (_error) {
    // Post loading failed
  } finally {
    isLoading.value = false;
  }
}

async function refreshPost() {
  await loadPost();
  
  const toast = await toastController.create({
    message: 'Post refreshed',
    duration: 1500,
    color: 'success'
  });
  await toast.present();
}

onMounted(async () => {
  await loadPost();
});
</script>

<style scoped>
.loading-container,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
  text-align: center;
}

.empty-state ion-icon {
  font-size: 64px;
  color: var(--ion-color-medium);
}

.post-detail-card {
  margin: 12px;
}

.post-meta {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--ion-color-medium);
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}

.separator {
  margin: 0 4px;
}

.post-title {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
  margin: 8px 0;
}

.post-content {
  font-size: 16px;
  line-height: 1.6;
  margin: 16px 0;
  white-space: pre-wrap;
}

.post-image {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
}

.post-image img {
  width: 100%;
  height: auto;
  display: block;
}

.actions-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--ion-color-light);
}

.vote-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vote-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--ion-color-medium);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;
  font-family: inherit;
  font-weight: 500;
}

.vote-button:hover {
  background: var(--ion-color-light);
}

.vote-button:active {
  transform: scale(0.95);
}

.vote-button.upvote.active {
  background: transparent;
  color: var(--ion-color-primary);
  border: 1px solid rgba(var(--ion-color-primary-rgb), 0.5);
}

.vote-button.upvote.active ion-icon {
  color: var(--ion-color-primary);
}

.vote-button.downvote.active {
  color: var(--ion-color-danger);
  background: var(--ion-color-danger-tint);
}

.vote-button.downvote.active ion-icon {
  color: var(--ion-color-danger);
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--ion-color-medium);
  padding: 0 8px;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--ion-color-medium);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s ease;
  font-family: inherit;
}

.action-button:hover {
  background: var(--ion-color-light);
  color: var(--ion-color-primary);
}

.comments-card {
  margin: 12px;
}

.add-comment-form {
  margin-bottom: 24px;
}

.comment-textarea {
  margin-bottom: 12px;
  --background: var(--ion-color-light);
  --padding-start: 12px;
  --padding-end: 12px;
  --padding-top: 12px;
  --padding-bottom: 12px;
  border-radius: 8px;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty-comments {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  gap: 12px;
}

.empty-comments ion-icon {
  font-size: 48px;
  color: var(--ion-color-medium);
}

.empty-comments p {
  margin: 0;
  color: var(--ion-color-medium);
}

.subtitle {
  font-size: 14px;
}
</style>