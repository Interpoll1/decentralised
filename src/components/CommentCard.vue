<template>
  <div class="cc-wrap" :style="depth > 0 ? `margin-left: ${Math.min(depth, 4) * 20}px` : ''">

    <!-- Thread connector line for replies -->
    <div v-if="depth > 0" class="cc-thread-line"></div>

    <div class="comment-card">
      <!-- Flagged overlay -->
      <div v-if="flagged && filterAction === 'blur' && !revealed" class="flagged-overlay" @click.stop="revealed = true">
        <ion-icon :icon="warningOutline"></ion-icon>
        <span>Hidden by word filter — tap to reveal</span>
      </div>

      <div :class="{ 'content-blurred': flagged && filterAction === 'blur' && !revealed }">
        <!-- Header -->
        <div class="comment-header">
          <!-- Avatar initials -->
          <div class="cc-avatar" :class="avatarTone">{{ avatarInitial }}</div>

          <div class="cc-meta">
            <span class="author-name">{{ displayName }}</span>
            <span class="identity-badge" :class="authorIdentityClass">{{ authorIdentityLabel }}</span>
            <button v-if="canInviteAuthor" class="invite-btn" @click.stop="sendInviteToCommentAuthor">Chat</button>
          </div>

          <span class="cc-time">{{ formatTime(comment.createdAt) }}</span>
          <span v-if="comment.edited" class="edited-label">edited</span>
          <span v-if="syncState && syncState !== 'confirmed'" class="sync-label" :class="syncState">
            {{ syncState === 'failed' ? 'not synced' : 'sending…' }}
          </span>
          <span v-if="flagged && filterAction === 'flag'" class="flag-badge">
            <ion-icon :icon="warningOutline"></ion-icon>
          </span>
        </div>

        <!-- Body -->
        <div class="comment-body">
          <p>{{ comment.content }}</p>
        </div>
      </div>

      <!-- Actions -->
      <div class="comment-actions">
        <button class="ca-btn upvote" :class="{ active: hasUpvoted, 'pop-heart': heartPop }" @click="onUpvote">
          <svg class="ca-heart" viewBox="0 0 24 24" fill="none" width="13" height="13">
            <path :fill="hasUpvoted ? '#c4b5fd' : 'none'"
              :stroke="hasUpvoted ? '#c4b5fd' : 'currentColor'"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          {{ formatNumber(comment.upvotes) }}
        </button>
        <button class="ca-btn downvote" :class="{ active: hasDownvoted, 'pop-down': downPop }" @click="onDownvote">
          <svg class="ca-thumb-down" viewBox="0 0 24 24" fill="none" width="13" height="13" style="transform:rotate(-20deg) scaleX(-1)">
            <path d="M15 3H6C5.17 3 4.46 3.5 4.16 4.22l-3.02 7.05C1.05 11.5 1 11.74 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"
              :fill="hasDownvoted ? '#ef4444' : 'currentColor'"/>
          </svg>
          {{ formatNumber(comment.downvotes) }}
        </button>
        <button class="ca-btn reply-btn" @click="toggleReply">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          Reply
        </button>
        <span class="ca-score">{{ comment.score > 0 ? '+' : '' }}{{ comment.score }}</span>
      </div>

      <!-- Reply form -->
      <div v-if="showReplyForm" class="reply-form">
        <ion-textarea v-model="replyText" placeholder="Write a reply…" :auto-grow="true" :rows="2" class="reply-textarea"></ion-textarea>
        <div class="reply-actions">
          <ion-button size="small" @click="submitReply" :disabled="!replyText.trim()">
            <ion-icon slot="start" :icon="sendOutline"></ion-icon>Reply
          </ion-button>
          <ion-button size="small" fill="clear" @click="cancelReply">Cancel</ion-button>
        </div>
      </div>
    </div>

    <!-- Nested replies — recursive, depth increases -->
    <div v-if="replies.length > 0" class="cc-replies">
      <CommentCard
        v-for="reply in replies"
        :key="reply.id"
        :comment="reply"
        :post-id="postId"
        :community-id="communityId"
        :depth="(depth ?? 0) + 1"
        :flagged="checkReplyFlagged(reply.content)"
        :filter-action="filterAction"
        @upvote="(c: any) => $emit('upvote', c)"
        @downvote="(c: any) => $emit('downvote', c)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { IonIcon, IonTextarea, IonButton, toastController } from '@ionic/vue';
import { sendOutline, warningOutline } from 'ionicons/icons';
import { useCommentStore } from '../stores/commentStore';
import { Comment } from '../services/commentService';
import { generatePseudonym } from '../utils/pseudonym';
import type { FilterAction } from '../services/moderationService';
import { ModerationService } from '../services/moderationService';
import { useUserStore } from '../stores/userStore';
import type { UserProfile } from '../services/userService';
import { UserService } from '../services/userService';
import { ChatInviteService } from '../services/chatInviteService';
import { formatTrustedIdentityLabel } from '../utils/identityTrust';
import { checkContent } from '../utils/contentGuard';
import { useBurst } from '../composables/useBurst';

const props = defineProps<{
  comment: Comment;
  postId: string;
  communityId: string;
  depth?: number;
  flagged?: boolean;
  filterAction?: FilterAction;
}>();
const emit = defineEmits(['upvote', 'downvote']);

const commentStore  = useCommentStore();
const userStore     = useUserStore();
const showReplyForm = ref(false);
const replyText     = ref('');
const revealed      = ref(false);
const authorProfile = ref<UserProfile | null>(null);
const currentUserId = ref('');
let authorProfileRequestId = 0;

watch(() => props.comment.authorId, async (authorId) => {
  const requestId = ++authorProfileRequestId;
  if (!authorId) { authorProfile.value = null; return; }
  const profile = await userStore.getProfile(authorId);
  if (requestId !== authorProfileRequestId) return;
  authorProfile.value = profile;
}, { immediate: true });

const displayName = computed(() => {
  if (props.comment?.authorShowRealName) return props.comment.authorName || 'anon';
  if (props.comment?.authorId && props.postId) return generatePseudonym(props.postId, props.comment.authorId);
  return props.comment.authorName || 'anon';
});

const AVATAR_TONES = ['av-violet','av-blue','av-teal','av-amber','av-rose','av-indigo','av-green'];
const avatarTone = computed(() => {
  const code = (props.comment.authorId || '').split('').reduce((a,c) => a + c.charCodeAt(0), 0);
  return AVATAR_TONES[code % AVATAR_TONES.length];
});
const avatarInitial = computed(() => (displayName.value || '?').charAt(2).toUpperCase() || '?');

const authorIdentityLabel = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer'
    ? formatTrustedIdentityLabel({ username: authorProfile.value?.identityUsername || authorProfile.value?.customUsername || props.comment.authorName, issuer: authorProfile.value?.identityIssuer })
    : 'Unverified'
);
const authorIdentityClass = computed(() =>
  authorProfile.value?.identityTrustLevel === 'trusted-issuer' ? 'trusted-issuer' : 'unverified'
);
const canInviteAuthor = computed(() =>
  !!props.comment.authorId && !!currentUserId.value && props.comment.authorId !== currentUserId.value
);

const hasUpvoted  = computed(() => commentStore.hasUpvoted(props.comment.id));
const hasDownvoted = computed(() => commentStore.hasDownvoted(props.comment.id));

const heartPop = ref(false);
const downPop  = ref(false);
const { triggerBurst } = useBurst();

function onUpvote() {
  heartPop.value = true;
  setTimeout(() => { heartPop.value = false; }, 600);
  triggerBurst('heart');
  emit('upvote', props.comment);
}
function onDownvote() {
  downPop.value = true;
  setTimeout(() => { downPop.value = false; }, 600);
  triggerBurst('dislike');
  emit('downvote', props.comment);
}
const syncState   = computed(() => commentStore.statusOf(props.comment.id));

const replies = computed(() =>
  commentStore.comments
    .filter(c => c.parentId === props.comment.id)
    .sort((a, b) => b.score !== a.score ? b.score - a.score : a.createdAt - b.createdAt)
);

function checkReplyFlagged(content: string) { return ModerationService.checkContent(content || '').flagged; }
function toggleReply() { showReplyForm.value = !showReplyForm.value; if (!showReplyForm.value) replyText.value = ''; }
function cancelReply() { showReplyForm.value = false; replyText.value = ''; }

async function sendInviteToCommentAuthor() {
  if (!canInviteAuthor.value) return;
  try {
    await ChatInviteService.sendInvite(props.comment.authorId);
    const t = await toastController.create({ message: `Chat invite sent`, duration: 2200, color: 'success' });
    await t.present();
  } catch {
    const t = await toastController.create({ message: 'Failed to send invite', duration: 2200, color: 'danger' });
    await t.present();
  }
}

async function submitReply() {
  if (!replyText.value.trim()) return;
  const guard = checkContent(replyText.value.trim(), 'comment');
  if (!guard.ok) {
    const t = await toastController.create({ message: guard.reason!, duration: 2500, color: 'warning' });
    await t.present(); return;
  }
  try {
    await commentStore.createComment({ postId: props.postId, communityId: props.communityId, content: replyText.value.trim(), parentId: props.comment.id });
    replyText.value = ''; showReplyForm.value = false;
  } catch {
    const t = await toastController.create({ message: 'Failed to post reply', duration: 2000, color: 'danger' });
    await t.present();
  }
}

function formatTime(ts: number): string {
  const d = Date.now() - ts, m = Math.floor(d/60000), h = Math.floor(d/3600000), dy = Math.floor(d/86400000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m`; if (h < 24) return `${h}h`; if (dy < 7) return `${dy}d`;
  return new Date(ts).toLocaleDateString();
}
function formatNumber(n: number|undefined|null): string {
  const v = n ?? 0; if (v >= 1e6) return (v/1e6).toFixed(1)+'M'; if (v >= 1000) return (v/1000).toFixed(1)+'K'; return v.toString();
}

onMounted(async () => {
  try { const u = await UserService.getCurrentUser(); currentUserId.value = u.id; } catch { currentUserId.value = ''; }
});
</script>

<style scoped>
/* ── Wrapper with thread line ── */
.cc-wrap {
  position: relative;
}
.cc-thread-line {
  position: absolute;
  left: -12px;
  top: 0; bottom: 0;
  width: 2px;
  background: rgba(255,255,255,0.08);
  border-radius: 1px;
}

/* ── Card ── */
.comment-card {
  padding: 10px 0 8px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.cc-replies {
  margin-top: 2px;
}

/* ── Header ── */
.comment-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

/* Avatar */
.cc-avatar {
  width: 26px; height: 26px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800;
  flex-shrink: 0;
}
.av-violet { background: rgba(99,102,241,0.25); color: #a5b4fc; }
.av-blue   { background: rgba(59,130,246,0.22);  color: #93c5fd; }
.av-teal   { background: rgba(20,184,166,0.22);  color: #5eead4; }
.av-amber  { background: rgba(245,158,11,0.22);  color: #fcd34d; }
.av-rose   { background: rgba(236,72,153,0.22);  color: #f9a8d4; }
.av-indigo { background: rgba(129,140,248,0.22); color: #c7d2fe; }
.av-green  { background: rgba(52,211,153,0.22);  color: #6ee7b7; }

.cc-meta {
  display: flex; align-items: center; gap: 5px;
  flex: 1; min-width: 0;
}
.author-name {
  font-size: 12.5px; font-weight: 700;
  color: var(--app-text);
  white-space: nowrap;
}
.cc-time {
  font-size: 11px;
  color: var(--app-text-subtle, rgba(255,255,255,0.3));
  margin-left: auto;
  flex-shrink: 0;
}
.identity-badge {
  border-radius: 6px; padding: 1px 6px;
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  flex-shrink: 0;
}
.identity-badge.unverified  { background: rgba(251,191,36,0.12); color: #fbbf24; }
.identity-badge.trusted-issuer { background: rgba(52,211,153,0.14); color: #34d399; }

.edited-label { font-size: 10px; color: rgba(255,255,255,0.3); }
.sync-label { font-size: 10px; font-weight: 700; border-radius: 6px; padding: 1px 6px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.5); }
.sync-label.failed { background: rgba(251,191,36,0.12); color: #fbbf24; }
.flag-badge ion-icon { font-size: 12px; color: #fbbf24; }

.invite-btn {
  font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px;
  border: 1px solid rgba(99,102,241,0.3); background: rgba(99,102,241,0.1);
  color: #a5b4fc; cursor: pointer; opacity: 0; transition: opacity 120ms;
}
.comment-header:hover .invite-btn { opacity: 1; }

/* ── Body ── */
.comment-body {
  font-size: 14px;
  line-height: 1.55;
  color: var(--app-text);
  margin-bottom: 7px;
  white-space: pre-wrap;
  padding-left: 32px; /* align with avatar width + gap */
}
.comment-body p { margin: 0; }

/* ── Actions ── */
.comment-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: 30px;
}
.ca-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 7px; border-radius: 6px;
  border: none; background: none;
  font-size: 12px; font-weight: 600;
  color: rgba(255,255,255,0.4);
  cursor: pointer; transition: color 120ms, background 120ms;
  font-family: inherit;
}
.ca-btn:hover { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.75); }
.ca-btn.upvote .ca-heart { color: rgba(196,181,253,0.6); }
.ca-btn.upvote.active .ca-heart { color: #c4b5fd; }
.ca-btn.downvote .ca-thumb-down { color: rgba(255,255,255,0.35); }
.ca-btn.downvote.active .ca-thumb-down { color: #ef4444; }
.ca-score {
  margin-left: auto;
  font-size: 11px; font-weight: 700;
  color: rgba(255,255,255,0.35);
}

/* ── Reply form ── */
.reply-form {
  margin: 8px 0 0 32px;
  padding: 10px;
  background: rgba(255,255,255,0.03);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.07);
}
.reply-textarea { margin-bottom: 8px; }
.reply-actions { display: flex; gap: 8px; }

/* ── Flagged ── */
.flagged-overlay {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; margin-bottom: 6px;
  background: rgba(251,191,36,0.08);
  border: 1px solid rgba(251,191,36,0.2);
  border-radius: 8px; color: #fbbf24;
  font-size: 12px; cursor: pointer;
}
.content-blurred { filter: blur(5px); user-select: none; pointer-events: none; }

@media (max-width: 576px) { .invite-btn { opacity: 1; } }

/* ── Click animations ── */
@keyframes cc-heart-pop {
  0%   { transform: scale(1); }
  25%  { transform: scale(1.6); }
  50%  { transform: scale(0.85); }
  75%  { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes cc-down-pop {
  0%   { transform: rotate(-20deg) scaleX(-1) scale(1); }
  30%  { transform: rotate(-20deg) scaleX(-1) scale(1.55); }
  60%  { transform: rotate(-20deg) scaleX(-1) scale(0.85); }
  100% { transform: rotate(-20deg) scaleX(-1) scale(1); }
}
@keyframes cc-ripple {
  0%   { transform: scale(0); opacity: 0.4; }
  100% { transform: scale(4); opacity: 0; }
}

.ca-btn { position: relative; overflow: hidden; }

.ca-btn.pop-heart .ca-heart {
  animation: cc-heart-pop 0.52s cubic-bezier(0.36,0.07,0.19,0.97);
}
.ca-btn.pop-down .ca-thumb-down {
  animation: cc-down-pop 0.48s cubic-bezier(0.36,0.07,0.19,0.97);
}
.ca-btn::after {
  content: '';
  position: absolute;
  inset: 0; margin: auto;
  width: 12px; height: 12px;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
}
.ca-btn.pop-heart::after {
  background: rgba(196,181,253,0.5);
  animation: cc-ripple 0.45s ease-out;
}
.ca-btn.pop-down::after {
  background: rgba(239,68,68,0.4);
  animation: cc-ripple 0.4s ease-out;
}
</style>
