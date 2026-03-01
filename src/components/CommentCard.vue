<template>
  <div class="comment-card">
    <!-- Flagged content overlay (blur mode) -->
    <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
      <ion-icon :icon="warningOutline"></ion-icon>
      <span>Comment hidden by word filter — tap to reveal</span>
    </div>

    <div :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
      <!-- Comment Header -->
      <div class="comment-header">
        <span class="commenter-dot"></span>
        <span class="author-name">u/{{ displayName }}</span>
        <span class="separator">•</span>
        <span class="timestamp">{{ formatTime(comment.createdAt) }}</span>
        <span v-if="comment.edited" class="edited-label">(edited)</span>
        <span v-if="flagged && filterAction === 'flag'" class="flag-badge" title="Flagged by word filter">
          <ion-icon :icon="warningOutline"></ion-icon>
        </span>
      </div>

      <!-- Comment Content -->
      <div class="comment-content">
        <p>{{ comment.content }}</p>
      </div>
    </div>

    <!-- Comment Actions -->
    <div class="comment-actions">
      <button class="action-button upvote" @click="$emit('upvote', comment)" :class="{ active: hasUpvoted }">
        <ion-icon :icon="arrowUpOutline"></ion-icon>
        <span>{{ formatNumber(comment.upvotes) }}</span>
      </button>

      <button class="action-button downvote" @click="$emit('downvote', comment)" :class="{ active: hasDownvoted }">
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
        <ion-button size="small" @click="submitReply" :disabled="!replyText.trim()">
          <ion-icon slot="start" :icon="sendOutline"></ion-icon>
          Reply
        </ion-button>
        <ion-button size="small" fill="clear" @click="cancelReply">Cancel</ion-button>
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
        :flagged="checkReplyFlagged(reply.content)"
        :filter-action="filterAction"
        @upvote="(c: any) => $emit('upvote', c)"
        @downvote="(c: any) => $emit('downvote', c)"
      />
    </div>
  </div>
</template>

<style scoped>
.comment-card {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--ion-text-color-rgb), 0.07);
}

/* ── Header ─────────────────────────────────────── */
.comment-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--ion-color-medium);
}

.commenter-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ion-color-success);
  flex-shrink: 0;
}

.author-name {
  font-weight: 600;
  color: var(--ion-text-color);
}

.edited-label {
  font-size: 11px;
  color: var(--ion-color-medium);
}

/* ── Content ─────────────────────────────────────── */
.comment-content {
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 10px;
  white-space: pre-wrap;
}

.comment-content p {
  margin: 0;
}

/* ── Actions ─────────────────────────────────────── */
.comment-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  padding: 4px 8px;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  color: var(--ion-color-medium);
  cursor: pointer;
  border-radius: 8px;
  transition: color 0.15s, background 0.15s;
}

.action-button:hover {
  background: rgba(var(--ion-text-color-rgb), 0.06);
}

.action-button:active {
  transform: scale(0.95);
}

.action-button.upvote.active {
  color: var(--ion-color-primary);
}

.action-button.downvote.active {
  color: var(--ion-color-danger);
}

.score {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--ion-color-medium);
  margin-left: auto;
}

/* ── Reply Form ──────────────────────────────────── */
.reply-form {
  margin-top: 10px;
  padding: 10px;
  background: rgba(var(--ion-text-color-rgb), 0.04);
  border-radius: 10px;
}

.reply-textarea {
  margin-bottom: 8px;
}

.reply-actions {
  display: flex;
  gap: 8px;
}

/* ── Nested Replies ──────────────────────────────── */
.replies-container {
  margin-top: 8px;
  margin-left: 16px;
  border-left: 2px solid rgba(var(--ion-text-color-rgb), 0.1);
  padding-left: 4px;
}

/* ── Flagged content ─────────────────────────────── */
.flagged-overlay {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(var(--ion-color-warning-rgb), 0.10);
  border: 1px solid rgba(var(--ion-color-warning-rgb), 0.25);
  border-radius: 8px;
  color: var(--ion-color-warning-shade);
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 8px;
}

.flagged-overlay ion-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.content-blurred {
  filter: blur(6px);
  user-select: none;
  pointer-events: none;
}

.flag-badge {
  display: inline-flex;
  align-items: center;
  color: var(--ion-color-warning);
  margin-left: 4px;
}

.flag-badge ion-icon {
  font-size: 13px;
}
</style>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { IonIcon, IonTextarea, IonButton, toastController } from '@ionic/vue';
import {
  arrowUpOutline,
  arrowDownOutline,
  chatbubbleOutline,
  trendingUpOutline,
  sendOutline,
  warningOutline,
} from 'ionicons/icons';
import { useCommentStore } from '../stores/commentStore';
import { Comment } from '../services/commentService';
import { generatePseudonym } from '../utils/pseudonym';
import type { FilterAction } from '../services/moderationService';
import { ModerationService } from '../services/moderationService';

const props = defineProps<{
  comment: Comment;
  postId: string;
  communityId: string;
  flagged?: boolean;
  filterAction?: FilterAction;
}>();

defineEmits(['upvote', 'downvote']);

const commentStore = useCommentStore();
const showReplyForm = ref(false);
const replyText = ref('');
const revealed = ref(false);

function checkReplyFlagged(content: string): boolean {
  return ModerationService.checkContent(content || '').flagged;
}

const displayName = computed(() => {
  if (props.comment?.authorShowRealName) {
    return props.comment.authorName || 'anon';
  }
  if (props.comment?.authorId && props.postId) {
    return generatePseudonym(props.postId, props.comment.authorId);
  }
  return props.comment.authorName || 'anon';
});

const hasUpvoted = computed(() => {
  commentStore.voteVersion; // reactive dependency to trigger re-evaluation on vote changes
  const votedComments = JSON.parse(localStorage.getItem('upvoted-comments') || '[]');
  return votedComments.includes(props.comment.id);
});

const hasDownvoted = computed(() => {
  commentStore.voteVersion; // reactive dependency to trigger re-evaluation on vote changes
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

