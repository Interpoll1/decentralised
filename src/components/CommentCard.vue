<template>
  <div class="comment-card">
    <!-- Comment Header -->
    <div class="comment-header">
      <span class="author-badge">
        <span class="commenter-dot"></span>
        <span class="author-name">u/{{ displayName }}</span>
      </span>
      <span class="separator">•</span>
      <span class="timestamp">{{ formatTime(comment.createdAt) }}</span>
      <span v-if="comment.edited" class="edited-label">(edited)</span>
    </div>

    <!-- Comment Content -->
    <div class="comment-content">
      <p>{{ comment.content }}</p>
    </div>

    <!-- Comment Actions -->
    <div class="comment-actions">
      <button 
        class="action-button upvote" 
        @click="$emit('upvote')"
        :class="{ active: hasUpvoted }"
      >
        <ion-icon :icon="arrowUpOutline"></ion-icon>
        <span>{{ formatNumber(comment.upvotes) }}</span>
      </button>

      <button 
        class="action-button downvote" 
        @click="$emit('downvote')"
        :class="{ active: hasDownvoted }"
      >
        <ion-icon :icon="arrowDownOutline"></ion-icon>
        <span>{{ formatNumber(comment.downvotes) }}</span>
      </button>

      <button class="action-button reply" @click="toggleReply">
        <ion-icon :icon="chatbubbleOutline"></ion-icon>
        <span>Reply</span>
      </button>

      <div class="score">
        <ion-icon :icon="trendingUpOutline"></ion-icon>
        <span>{{ comment.score }}</span>
      </div>
    </div>

    <!-- Reply Form -->
    <div v-if="showReplyForm" class="reply-form">
      <ion-textarea
        v-model="replyText"
        placeholder="Write a reply..."
        :auto-grow="true"
        :rows="2"
        class="reply-textarea"
      ></ion-textarea>
      <div class="reply-actions">
        <ion-button 
          size="small" 
          @click="submitReply"
          :disabled="!replyText.trim()"
        >
          <ion-icon slot="start" :icon="sendOutline"></ion-icon>
          Reply
        </ion-button>
        <ion-button 
          size="small" 
          fill="clear" 
          @click="cancelReply"
        >
          Cancel
        </ion-button>
      </div>
    </div>

    <!-- Nested Replies -->
    <div v-if="replies.length > 0" class="replies-container">
      <CommentCard
        v-for="reply in replies"
        :key="reply.id"
        :comment="reply"
        :post-id="postId"
        :community-id="communityId"
        @upvote="$emit('upvote', reply)"
        @downvote="$emit('downvote', reply)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { IonIcon, IonTextarea, IonButton, toastController } from '@ionic/vue';
import {
  arrowUpOutline,
  arrowDownOutline,
  chatbubbleOutline,
  trendingUpOutline,
  sendOutline,
} from 'ionicons/icons';
import { useCommentStore } from '../stores/commentStore';
import { Comment } from '../services/commentService';
import { generatePseudonym } from '../utils/pseudonym';

const props = defineProps<{
  comment: Comment;
  postId: string;
  communityId: string;
}>();

defineEmits(['upvote', 'downvote']);

const commentStore = useCommentStore();
const showReplyForm = ref(false);
const replyText = ref('');

const displayName = computed(() => {
  if (props.comment?.authorId && props.postId) {
    return generatePseudonym(props.postId, props.comment.authorId);
  }
  return props.comment.authorName || 'anon';
});

const hasUpvoted = computed(() => {
  const votedComments = JSON.parse(localStorage.getItem('upvoted-comments') || '[]');
  return votedComments.includes(props.comment.id);
});

const hasDownvoted = computed(() => {
  const votedComments = JSON.parse(localStorage.getItem('downvoted-comments') || '[]');
  return votedComments.includes(props.comment.id);
});

const replies = computed(() => {
  const filtered = commentStore.comments.filter(c => {
    return c.parentId === props.comment.id;
  }).sort((a, b) => {
    // Sort by score first, then by creation date
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.createdAt - b.createdAt; // Older replies first
  });

  return filtered;
});

function toggleReply() {
  showReplyForm.value = !showReplyForm.value;
  if (!showReplyForm.value) {
    replyText.value = '';
  }
}

function cancelReply() {
  showReplyForm.value = false;
  replyText.value = '';
}

async function submitReply() {
  if (!replyText.value.trim()) return;

  try {
    await commentStore.createComment({
      postId: props.postId,
      communityId: props.communityId,
      content: replyText.value.trim(),
      parentId: props.comment.id
    });

    const toast = await toastController.create({
      message: 'Reply posted!',
      duration: 2000,
      color: 'success'
    });
    await toast.present();

    replyText.value = '';
    showReplyForm.value = false;

    // Reload comments to show the new reply
    setTimeout(() => {
      commentStore.loadCommentsForPost(props.postId);
    }, 500);

  } catch (error) {
    console.error('Error posting reply:', error);

    const toast = await toastController.create({
      message: 'Failed to post reply',
      duration: 2000,
      color: 'danger'
    });
    await toast.present();
  }
}

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
</script>

<style scoped>
.comment-card {
  padding: 16px;
  background: rgba(var(--ion-card-background-rgb), 0.35);
  backdrop-filter: blur(14px) saturate(1.3);
  -webkit-backdrop-filter: blur(14px) saturate(1.3);
  border-radius: 14px;
  border-left: 3px solid var(--ion-color-primary);
  border-top: 1px solid var(--glass-border);
  border-right: 1px solid var(--glass-border);
  border-bottom: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow), var(--glass-highlight);
}

.comment-header {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.author-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.commenter-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ion-color-success);
  flex-shrink: 0;
  box-shadow: 0 0 4px rgba(var(--ion-color-success-rgb), 0.5);
}

.comment-author {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.comment-author ion-icon {
  font-size: 18px;
  color: var(--ion-color-primary);
}

.username {
  font-weight: 600;
  color: var(--ion-color-dark);
}

.separator {
  margin: 0 4px;
}

.comment-content {
  font-size: 15px;
  line-height: 1.5;
  color: var(--ion-color-dark);
  margin-bottom: 12px;
  white-space: pre-wrap;
}

.comment-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--ion-card-background-rgb), 0.25);
  border: 1px solid var(--glass-border);
  padding: 6px 10px;
  font-size: 13px;
  color: var(--ion-color-medium);
  cursor: pointer;
  border-radius: 10px;
  transition: var(--liquid-transition);
  font-family: inherit;
  font-weight: 500;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.action-button:hover {
  background: rgba(var(--ion-color-primary-rgb), 0.1);
  border-color: rgba(var(--ion-color-primary-rgb), 0.2);
}

.action-button:active {
  transform: scale(0.95);
}

.action-button.upvote.active {
  color: var(--ion-color-primary);
  background: rgba(var(--ion-color-primary-rgb), 0.12);
  border-color: rgba(var(--ion-color-primary-rgb), 0.25);
}

.action-button.downvote.active {
  color: var(--ion-color-danger);
  background: rgba(var(--ion-color-danger-rgb), 0.12);
  border-color: rgba(var(--ion-color-danger-rgb), 0.25);
}

.action-button.reply:hover {
  color: var(--ion-color-primary);
}

.score {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--ion-color-medium);
  padding: 0 6px;
  margin-left: auto;
}

.score ion-icon {
  font-size: 16px;
}
.reply-form {
  margin-top: 12px;
  padding: 12px;
  background: rgba(var(--ion-card-background-rgb), 0.25);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-radius: 12px;
  border: 1px solid var(--glass-border);
}

.reply-textarea {
  margin-bottom: 8px;
}

.reply-actions {
  display: flex;
  gap: 8px;
}

.replies-container {
  margin-top: 12px;
  margin-left: 20px;
  border-left: 2px solid rgba(var(--ion-color-primary-rgb), 0.2);
}
</style>