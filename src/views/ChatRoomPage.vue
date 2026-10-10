<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <button class="back-btn" @click="$router.back()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </ion-buttons>
        <ion-title>
          <button class="title-btn" :disabled="!ready" @click="showMembers = true">
            <span class="title-name">{{ roomTitle }}</span>
            <span v-if="ready" class="title-sub" :class="{ typing: chatRoomStore.typingNames.length }">{{ subtitle }}</span>
          </button>
        </ion-title>
        <ion-buttons slot="end">
          <button v-if="ready" class="header-action-btn" :class="{ active: searchOpen }" title="Search messages" @click="toggleSearch">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <button v-if="ready" class="header-action-btn" title="Members" @click="showMembers = true">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.4 3.4 0 010 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <span v-if="chatRoomStore.pendingJoins.length" class="hdr-badge">{{ chatRoomStore.pendingJoins.length }}</span>
          </button>
          <button class="header-action-btn" @click="shareInvite" :disabled="!hasAccess" title="Copy invite link">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M21 12l-7-7v4C7 10 4 15 3 21c2.5-3.5 6-5.1 11-5.1V20l7-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
          </button>
        </ion-buttons>
      </ion-toolbar>
      <div v-if="ready && searchOpen" class="search-bar">
        <input ref="searchInput" v-model="searchQuery" class="search-input" placeholder="Search this chat…" @keydown.esc="toggleSearch" />
        <span class="search-count">{{ searchQuery.trim() ? `${searchResults.length} found` : '' }}</span>
      </div>
      <button v-if="ready && !searchOpen && chatRoomStore.pinnedMessages.length" class="pinned-bar" @click="cyclePinned">
        <span class="pinned-icon">📌</span>
        <span class="pinned-body">
          <span class="pinned-label">Pinned{{ chatRoomStore.pinnedMessages.length > 1 ? ` · ${pinnedIndex + 1}/${chatRoomStore.pinnedMessages.length}` : '' }}</span>
          <span class="pinned-text">{{ previewText(currentPinned!) }}</span>
        </span>
      </button>
    </ion-header>

    <ion-content :scroll-y="false">
      <!-- Loading -->
      <div v-if="initialLoading" class="state-container">
        <div class="spinner"></div>
        <p class="state-sub">Decrypting room…</p>
      </div>

      <!-- Error -->
      <div v-else-if="chatRoomStore.error" class="state-container">
        <div class="state-icon error-icon">
          <ion-icon :icon="alertCircleOutline"></ion-icon>
        </div>
        <p class="state-title">Something went wrong</p>
        <p class="state-sub">{{ chatRoomStore.error }}</p>
        <button class="pill-btn outline" @click="initRoom">Retry</button>
      </div>

      <!-- Not a member yet: ask the creator's device for admission -->
      <div v-else-if="!hasAccess" class="state-container">
        <div class="state-icon lock-icon">
          <ion-icon :icon="lockClosedOutline"></ion-icon>
        </div>
        <template v-if="joinState === 'requested'">
          <p class="state-title">{{ joinPassword ? 'Checking password…' : 'Request sent' }}</p>
          <p class="state-sub">
            {{ joinPassword
              ? 'The creator\'s device admits you automatically once it confirms the password. If it is wrong, the creator can still approve you by hand.'
              : 'Waiting for the group creator to approve you.' }}
            This page opens the chat automatically once you're in.
          </p>
          <div class="spinner small"></div>
          <button v-if="accessMode === 'password'" class="pill-btn outline" @click="joinState = 'idle'">Try another password</button>
        </template>
        <template v-else>
          <p class="state-title">Join this group</p>
          <p class="state-sub">
            Group chats are end-to-end encrypted.
            {{ accessMode === 'password' ? 'Enter the group password to join.' : 'The creator\'s device must approve new members.' }}
          </p>
          <input v-if="accessMode === 'password'" v-model="joinPassword" type="password" class="field-input join-password"
            placeholder="Group password" autocomplete="off" @keydown.enter="requestJoin" />
          <button v-else class="link-btn" @click="accessMode = 'password'">I have a password</button>
          <button class="pill-btn accent" :disabled="joinState === 'sending' || (accessMode === 'password' && !joinPassword)" @click="requestJoin">
            {{ joinState === 'sending' ? 'Sending…' : accessMode === 'password' ? 'Join' : 'Request to join' }}
          </button>
          <p v-if="joinError" class="state-sub error-text">{{ joinError }}</p>
        </template>
      </div>

      <!-- Search results -->
      <div v-else-if="searchOpen && searchQuery.trim()" class="search-results">
        <p v-if="!searchResults.length" class="state-sub" style="text-align:center;padding:24px">No messages match.</p>
        <button v-for="m in searchResults" :key="m.id" class="search-hit" @click="jumpTo(m.messageId, true)">
          <span class="search-hit-head">
            <strong :style="{ color: senderColor(m.senderId) }">{{ m.senderId === currentUserId ? 'You' : m.senderName }}</strong>
            <span>{{ formatDay(m.timestamp) }} {{ formatClock(m.timestamp) }}</span>
          </span>
          <span class="search-hit-text">{{ previewText(m) }}</span>
        </button>
      </div>

      <!-- Messages -->
      <div v-else class="chat-container" @dragover.prevent="dragOver = true" @dragleave.self="dragOver = false" @drop.prevent="onDrop">
        <div v-if="dragOver" class="drop-overlay">Drop to send</div>
        <div ref="messagesContainer" class="messages-area" @scroll="onScroll">
          <div v-if="chatRoomStore.timeline.length === 0" class="empty-chat">
            <div class="empty-icon"><ion-icon :icon="chatbubblesOutline"></ion-icon></div>
            <p>No messages yet — say hello!</p>
          </div>
          <template v-for="(item, i) in chatRoomStore.timeline" :key="item.id">
            <div v-if="dayChanged(i)" class="day-sep"><span>{{ formatDay(item.timestamp) }}</span></div>
            <div v-if="item.id === unreadDividerId" class="unread-sep"><span>New messages</span></div>
            <GroupMessageBubble
              :item="item"
              :mine="item.senderId === currentUserId"
              :grouped="isGrouped(i)"
              :flash="flashId === item.messageId"
              :mention-names="mentionNamesFor(item)"
              :read-count="item.senderId === currentUserId ? chatRoomStore.readBy(item).length : 0"
              :other-count="chatRoomStore.otherAccounts.length"
              @reply="startReply(item)"
              @react="emoji => react(item, emoji)"
              @react-picker="ev => openMenu(item, ev, true)"
              @menu="ev => openMenu(item, ev)"
              @jump="id => jumpTo(id)"
              @vote="choices => vote(item, choices)"
              @open-media="url => (lightbox = url)"
            />
          </template>
        </div>
        <button v-if="!atBottom" class="scroll-down" @click="scrollToBottom(true)">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span v-if="newWhileAway" class="scroll-badge">{{ newWhileAway }}</span>
        </button>
      </div>
    </ion-content>

    <ion-footer v-if="ready" class="input-footer">
      <div v-if="chatRoomStore.typingNames.length" class="typing-row">
        <span class="typing-dots"><span></span><span></span><span></span></span>
        {{ typingText }}
      </div>

      <div v-if="replyTo || editing" class="compose-banner">
        <div class="compose-banner-body">
          <span class="compose-banner-title">{{ editing ? 'Editing message' : `Replying to ${replyTo!.senderId === currentUserId ? 'yourself' : replyTo!.senderName}` }}</span>
          <span class="compose-banner-text">{{ previewText((editing || replyTo)!) }}</span>
        </div>
        <button class="icon-btn" title="Cancel" @click="cancelCompose">✕</button>
      </div>

      <div v-if="pendingFile" class="compose-banner">
        <img v-if="pendingPreview" :src="pendingPreview" class="compose-thumb" alt="" />
        <div class="compose-banner-body">
          <span class="compose-banner-title">{{ pendingFile.name || 'Attachment' }}</span>
          <span class="compose-banner-text">{{ formatSize(pendingFile.size) }} · add a caption or press send</span>
        </div>
        <button class="icon-btn" title="Remove attachment" @click="clearPendingFile">✕</button>
      </div>

      <div v-if="mentionMatches.length" class="mention-list">
        <button v-for="(m, idx) in mentionMatches" :key="m.accountId" class="mention-item" :class="{ active: idx === mentionIndex }" @mousedown.prevent="applyMention(m)">
          <span class="mention-dot" :style="{ background: senderColor(m.accountId) }"></span>{{ m.name }}
        </button>
      </div>

      <div v-if="emojiOpen" class="emoji-grid">
        <button v-for="e in EMOJI_PICKER" :key="e" class="emoji-cell" @click="insertEmoji(e)">{{ e }}</button>
      </div>

      <div class="input-area" :class="{ recording }">
        <template v-if="recording">
          <span class="rec-dot"></span>
          <span class="rec-time">{{ recordClock }}</span>
          <span class="rec-hint">Recording voice message…</span>
          <button class="icon-btn" title="Cancel recording" @click="stopRecording(false)">🗑</button>
          <button class="send-button" title="Send voice message" @click="stopRecording(true)">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg>
          </button>
        </template>
        <template v-else>
          <button class="icon-btn" title="Emoji" @click="emojiOpen = !emojiOpen">😊</button>
          <button class="icon-btn" title="Attach file" @click="fileInput?.click()" :disabled="!!editing">
            <svg viewBox="0 0 24 24" fill="none"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn" title="Create poll" @click="openPollComposer" :disabled="!!editing">📊</button>
          <input ref="fileInput" type="file" hidden @change="onFilePicked" />
          <textarea
            ref="inputEl"
            v-model="messageInput"
            @keydown="onKeydown"
            @input="onInput"
            @paste="onPaste"
            @blur="chatRoomStore.stopTyping()"
            :placeholder="editing ? 'Edit message…' : 'Message…'"
            :disabled="!chatRoomStore.currentRoom"
            class="message-input"
            rows="1"
          />
          <button v-if="canSend" @click="handleSend" :disabled="isSending" class="send-button" title="Send">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg>
          </button>
          <button v-else class="send-button" title="Record voice message" :disabled="!canRecord" @click="startRecording">
            <svg viewBox="0 0 24 24" fill="none" class="w-5 h-5"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0014 0M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </template>
      </div>
    </ion-footer>

    <!-- Message context menu -->
    <div v-if="menu" class="menu-backdrop" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="menu" :style="menu.style" @click.stop>
        <div class="menu-reacts">
          <button v-for="e in QUICK_REACTIONS" :key="e" class="menu-react" :class="{ mine: myReaction(menu.item) === e }" @click="react(menu.item, myReaction(menu.item) === e ? '' : e); menu = null">{{ e }}</button>
          <button class="menu-react more" title="More" @click="menu.moreEmoji = !menu.moreEmoji">＋</button>
        </div>
        <div v-if="menu.moreEmoji" class="menu-emoji-grid">
          <button v-for="e in EMOJI_PICKER" :key="e" class="emoji-cell" @click="react(menu.item, e); menu = null">{{ e }}</button>
        </div>
        <template v-if="!menu.reactOnly && !menu.item.deleted">
          <button class="menu-item" @click="startReply(menu.item); menu = null">↩ Reply</button>
          <button v-if="menu.item.text" class="menu-item" @click="copyText(menu.item); menu = null">⧉ Copy text</button>
          <button class="menu-item" @click="openForward(menu.item); menu = null">↪ Forward</button>
          <button class="menu-item" @click="togglePin(menu.item); menu = null">📌 {{ menu.item.pinned ? 'Unpin' : 'Pin' }}</button>
          <button v-if="menu.item.senderId === currentUserId" class="menu-item" @click="infoFor = menu.item; menu = null">ⓘ Info</button>
          <button v-if="menu.item.senderId === currentUserId && !menu.item.poll && menu.item.status !== 'failed'" class="menu-item" @click="startEdit(menu.item); menu = null">✎ Edit</button>
          <button v-if="menu.item.senderId === currentUserId" class="menu-item danger" @click="confirmDelete(menu.item); menu = null">🗑 Delete for everyone</button>
        </template>
      </div>
    </div>

    <!-- Poll composer -->
    <ion-modal :is-open="pollOpen" @didDismiss="pollOpen = false">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start"><button class="modal-text-btn" @click="pollOpen = false">Cancel</button></ion-buttons>
          <ion-title>New poll</ion-title>
          <ion-buttons slot="end"><button class="modal-text-btn primary" :disabled="!pollValid || isSending" @click="sendPoll">Send</button></ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <div class="modal-body">
          <label class="field-label">Question</label>
          <input v-model="pollQuestion" class="field-input" maxlength="300" placeholder="Ask something…" />
          <label class="field-label">Options</label>
          <div v-for="(_, i) in pollOptions" :key="i" class="poll-opt-row">
            <input v-model="pollOptions[i]" class="field-input" maxlength="200" :placeholder="`Option ${i + 1}`" @input="growPollOptions" />
            <button v-if="pollOptions.length > 2" class="icon-btn" @click="pollOptions.splice(i, 1)">✕</button>
          </div>
          <label class="check-row"><input type="checkbox" v-model="pollMulti" /> Allow multiple answers</label>
        </div>
      </ion-content>
    </ion-modal>

    <!-- Members -->
    <ion-modal :is-open="showMembers" @didDismiss="showMembers = false">
      <ion-header>
        <ion-toolbar>
          <ion-title>{{ roomTitle }}</ion-title>
          <ion-buttons slot="end"><button class="modal-text-btn" @click="showMembers = false">Done</button></ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <p v-if="chatRoomStore.currentRoom?.description" class="room-description">{{ chatRoomStore.currentRoom.description }}</p>
        <div v-if="chatRoomStore.pinnedMessages.length" class="pinned-list">
          <h3 class="gp-h">📌 Pinned messages</h3>
          <button v-for="p in chatRoomStore.pinnedMessages" :key="p.id" class="search-hit" @click="showMembers = false; jumpTo(p.messageId)">
            <span class="search-hit-head"><strong>{{ p.senderName }}</strong><span>{{ formatDay(p.timestamp) }}</span></span>
            <span class="search-hit-text">{{ previewText(p) }}</span>
          </button>
        </div>
        <GroupMembersPanel />
        <div class="leave-row">
          <button class="pill-btn danger" @click="confirmLeave">{{ chatRoomStore.isOwner ? 'Close group' : 'Leave group' }}</button>
        </div>
      </ion-content>
    </ion-modal>

    <!-- Message info (read receipts) -->
    <ion-modal :is-open="!!infoFor" @didDismiss="infoFor = null" :initial-breakpoint="0.5" :breakpoints="[0, 0.5, 0.9]">
      <ion-content v-if="infoFor">
        <div class="modal-body">
          <h3 class="gp-h">Message info</h3>
          <p class="info-preview">{{ previewText(infoFor) }}</p>
          <p class="info-line">Sent {{ new Date(infoFor.timestamp).toLocaleString() }}</p>
          <h3 class="gp-h">Seen by</h3>
          <p v-if="!infoReaders.length" class="state-sub">Nobody yet</p>
          <div v-for="a in infoReaders" :key="a" class="info-reader"><span class="mention-dot" :style="{ background: senderColor(a) }"></span>{{ chatRoomStore.displayName(a) }}</div>
          <h3 class="gp-h">Not seen yet</h3>
          <p v-if="!infoUnread.length" class="state-sub">Everyone has seen it</p>
          <div v-for="a in infoUnread" :key="a" class="info-reader muted"><span class="mention-dot" :style="{ background: senderColor(a) }"></span>{{ chatRoomStore.displayName(a) }}</div>
        </div>
      </ion-content>
    </ion-modal>

    <!-- Forward -->
    <ion-modal :is-open="!!forwarding" @didDismiss="forwarding = null" :initial-breakpoint="0.6" :breakpoints="[0, 0.6, 0.9]">
      <ion-content>
        <div class="modal-body">
          <h3 class="gp-h">Forward to…</h3>
          <p v-if="!forwardRooms.length" class="state-sub">No other groups joined.</p>
          <button v-for="r in forwardRooms" :key="r.id" class="search-hit" @click="doForward(r.id)">
            <span class="search-hit-head"><strong>{{ r.name }}</strong><span>{{ r.memberCount }} members</span></span>
          </button>
        </div>
      </ion-content>
    </ion-modal>

    <div v-if="lightbox" class="lightbox" @click="lightbox = ''"><img :src="lightbox" alt="" /></div>
  </ion-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonModal,
  IonFooter, IonButtons, IonIcon, toastController, alertController,
} from '@ionic/vue';
import { lockClosedOutline, alertCircleOutline, chatbubblesOutline } from 'ionicons/icons';
import { useRouter } from 'vue-router';
import { useChatRoomStore } from '@/stores/chatRoomStore';
import { ChatRoomService } from '@/services/chatRoomService';
import { KeyVaultService } from '@/services/keyVaultService';
import { UserService } from '@/services/userService';
import { InviteLinkService } from '@/services/inviteLinkService';
import type { ChatRoom } from '@/services/chatRoomService';
import GroupMessageBubble from '@/components/groupchat/GroupMessageBubble.vue';
import GroupMembersPanel from '@/components/groupchat/GroupMembersPanel.vue';
import { previewText, type TimelineItem } from '@/utils/groupTimeline';
import { EMOJI_PICKER, QUICK_REACTIONS, senderColor } from '@/utils/chatFormat';

const props = defineProps<{ roomId: string }>();

const route = useRoute();
const router = useRouter();
const chatRoomStore = useChatRoomStore();

const messagesContainer = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const messageInput = ref('');
const initialLoading = ref(true);
const hasAccess = ref(false);
const currentUserId = ref('');
const currentUserName = ref('');
const isSending = ref(false);
const roomTitle = ref('Loading...');

const roomId = computed(() => props.roomId || (route.params.roomId as string));
const ready = computed(() => hasAccess.value && !initialLoading.value && !chatRoomStore.error);

// ── Header ────────────────────────────────────────────────────────────────
const typingText = computed(() => {
  const n = chatRoomStore.typingNames;
  if (n.length === 1) return `${n[0]} is typing…`;
  if (n.length === 2) return `${n[0]} and ${n[1]} are typing…`;
  return `${n.length} people are typing…`;
});
const subtitle = computed(() => {
  if (chatRoomStore.typingNames.length) return typingText.value;
  const accounts = new Set(chatRoomStore.members.map(m => m.accountId)).size || chatRoomStore.currentRoom?.memberCount || 0;
  const online = chatRoomStore.onlineAccounts.size;
  return `${accounts} ${accounts === 1 ? 'member' : 'members'}${online > 1 ? ` · ${online} online` : ''}`;
});

// ── Timeline helpers ──────────────────────────────────────────────────────
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
function dayChanged(i: number) {
  const t = chatRoomStore.timeline;
  return i === 0 || !sameDay(t[i].timestamp, t[i - 1].timestamp);
}
function isGrouped(i: number) {
  const t = chatRoomStore.timeline;
  if (i === 0 || dayChanged(i)) return false;
  return t[i].senderId === t[i - 1].senderId && t[i].timestamp - t[i - 1].timestamp < 5 * 60_000 && t[i].id !== unreadDividerId.value;
}
function formatDay(ts: number) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
const formatClock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

function mentionNamesFor(item: TimelineItem): string[] {
  if (item.ext?.k !== 'msg' || !item.ext.mentions) return [];
  return item.ext.mentions.map(a => (a === currentUserId.value ? currentUserName.value : chatRoomStore.displayName(a)));
}

/** First message from someone else that arrived after the last visit. */
const unreadDividerId = ref<string | null>(null);
function computeUnreadDivider() {
  const mark = chatRoomStore.readMarkAtOpen;
  const first = chatRoomStore.timeline.find(m => m.timestamp > mark && m.senderId !== currentUserId.value);
  unreadDividerId.value = mark && first ? first.id : null;
}

// ── Scrolling / read state ────────────────────────────────────────────────
const atBottom = ref(true);
const newWhileAway = ref(0);
const flashId = ref('');

function scrollToBottom(smooth = false) {
  const el = messagesContainer.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  newWhileAway.value = 0;
}
function onScroll() {
  const el = messagesContainer.value;
  if (!el) return;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (atBottom.value) { newWhileAway.value = 0; maybeMarkRead(); }
}
function maybeMarkRead() {
  if (atBottom.value && document.visibilityState === 'visible') void chatRoomStore.markRead();
}
function onVisibility() { maybeMarkRead(); }

watch(() => chatRoomStore.timeline.length, (len, old) => {
  if (initialLoading.value || !old) return;
  const last = chatRoomStore.timeline[len - 1];
  if (atBottom.value || last?.senderId === currentUserId.value) nextTick(() => { scrollToBottom(true); maybeMarkRead(); });
  else newWhileAway.value += len - old;
});

async function jumpTo(messageId: string, closeSearch = false) {
  if (closeSearch) { searchOpen.value = false; searchQuery.value = ''; }
  await nextTick();
  const el = messagesContainer.value?.querySelector(`[data-mid="${CSS.escape(messageId)}"]`);
  if (!el) {
    const t = await toastController.create({ message: 'That message is not on this device', duration: 1800, position: 'top' });
    return t.present();
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  flashId.value = messageId;
  setTimeout(() => { if (flashId.value === messageId) flashId.value = ''; }, 1600);
}

// ── Pinned ────────────────────────────────────────────────────────────────
const pinnedIndex = ref(0);
const currentPinned = computed(() => {
  const list = chatRoomStore.pinnedMessages;
  return list.length ? list[Math.min(pinnedIndex.value, list.length - 1)] : null;
});
function cyclePinned() {
  if (!currentPinned.value) return;
  void jumpTo(currentPinned.value.messageId);
  pinnedIndex.value = (pinnedIndex.value + 1) % chatRoomStore.pinnedMessages.length;
}

// ── Search ────────────────────────────────────────────────────────────────
const searchOpen = ref(false);
const searchQuery = ref('');
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];
  return chatRoomStore.timeline
    .filter(m => !m.deleted && (m.text.toLowerCase().includes(q) || m.senderName.toLowerCase().includes(q)
      || m.poll?.question.toLowerCase().includes(q) || m.media?.mediaName.toLowerCase().includes(q)))
    .slice().reverse();
});
function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  searchQuery.value = '';
  if (searchOpen.value) nextTick(() => searchInput.value?.focus());
  else nextTick(() => scrollToBottom());
}

// ── Composer: reply / edit / mentions / emoji / files ─────────────────────
const replyTo = ref<TimelineItem | null>(null);
const editing = ref<TimelineItem | null>(null);
const emojiOpen = ref(false);
const pendingFile = ref<File | null>(null);
const pendingPreview = ref('');
const dragOver = ref(false);
const canSend = computed(() => !!messageInput.value.trim() || !!pendingFile.value);

function focusInput() { nextTick(() => inputEl.value?.focus()); }
function startReply(item: TimelineItem) { editing.value = null; replyTo.value = item; focusInput(); }
function startEdit(item: TimelineItem) {
  replyTo.value = null; clearPendingFile();
  editing.value = item; messageInput.value = item.text; focusInput();
}
function cancelCompose() {
  if (editing.value) messageInput.value = '';
  editing.value = null; replyTo.value = null;
}

/** Mentions: `@` opens a picker; picked names map to signed account ids on send. */
const mentionQuery = ref<string | null>(null);
const mentionIndex = ref(0);
const mentionPicked = new Map<string, string>(); // display name -> accountId
const mentionCandidates = computed(() => {
  const seen = new Set<string>();
  return chatRoomStore.members
    .filter(m => m.accountId !== currentUserId.value && !seen.has(m.accountId) && !!seen.add(m.accountId))
    .map(m => ({ accountId: m.accountId, name: chatRoomStore.displayName(m.accountId) }));
});
const mentionMatches = computed(() => {
  if (mentionQuery.value === null) return [];
  const q = mentionQuery.value.toLowerCase();
  return mentionCandidates.value.filter(m => m.name.toLowerCase().includes(q)).slice(0, 6);
});
function onInput() {
  autosize();
  chatRoomStore.notifyTyping();
  const el = inputEl.value;
  const before = el ? messageInput.value.slice(0, el.selectionStart ?? messageInput.value.length) : messageInput.value;
  const m = before.match(/(?:^|\s)@([^\s@]{0,24})$/);
  mentionQuery.value = m ? m[1] : null;
  mentionIndex.value = 0;
}
function applyMention(m: { accountId: string; name: string }) {
  const el = inputEl.value;
  const pos = el?.selectionStart ?? messageInput.value.length;
  const before = messageInput.value.slice(0, pos).replace(/@([^\s@]{0,24})$/, `@${m.name} `);
  messageInput.value = before + messageInput.value.slice(pos);
  mentionPicked.set(m.name, m.accountId);
  mentionQuery.value = null;
  nextTick(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
}
function mentionsIn(text: string) {
  return [...mentionPicked].filter(([name]) => text.includes(`@${name}`)).map(([, id]) => id);
}

function insertEmoji(e: string) {
  const el = inputEl.value;
  const pos = el?.selectionStart ?? messageInput.value.length;
  messageInput.value = messageInput.value.slice(0, pos) + e + messageInput.value.slice(pos);
  nextTick(() => { el?.focus(); el?.setSelectionRange(pos + e.length, pos + e.length); });
}

function autosize() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

function onKeydown(ev: KeyboardEvent) {
  if (mentionMatches.value.length) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); mentionIndex.value = (mentionIndex.value + 1) % mentionMatches.value.length; return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); mentionIndex.value = (mentionIndex.value - 1 + mentionMatches.value.length) % mentionMatches.value.length; return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); applyMention(mentionMatches.value[mentionIndex.value]); return; }
    if (ev.key === 'Escape') { mentionQuery.value = null; return; }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void handleSend(); return; }
  if (ev.key === 'Escape') { cancelCompose(); emojiOpen.value = false; return; }
  // Discord: ↑ in an empty composer edits your last message.
  if (ev.key === 'ArrowUp' && !messageInput.value) {
    const last = [...chatRoomStore.timeline].reverse().find(m => m.senderId === currentUserId.value && !m.deleted && !m.poll && m.text);
    if (last) { ev.preventDefault(); startEdit(last); }
  }
}

function setPendingFile(file: File) {
  clearPendingFile();
  editing.value = null;
  pendingFile.value = file;
  if (file.type.startsWith('image/')) pendingPreview.value = URL.createObjectURL(file);
  focusInput();
}
function clearPendingFile() {
  if (pendingPreview.value) URL.revokeObjectURL(pendingPreview.value);
  pendingPreview.value = '';
  pendingFile.value = null;
  if (fileInput.value) fileInput.value.value = '';
}
function onFilePicked(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (file) setPendingFile(file);
}
function onPaste(ev: ClipboardEvent) {
  const file = [...(ev.clipboardData?.files ?? [])][0];
  if (file) { ev.preventDefault(); setPendingFile(file); }
}
function onDrop(ev: DragEvent) {
  dragOver.value = false;
  const file = ev.dataTransfer?.files?.[0];
  if (file) setPendingFile(file);
}

async function toastError(message: string) {
  const t = await toastController.create({ message, duration: 2600, position: 'top', color: 'danger' });
  await t.present();
}

async function handleSend() {
  const text = messageInput.value.trim();
  if ((!text && !pendingFile.value) || !chatRoomStore.currentRoom || isSending.value) return;
  isSending.value = true;
  emojiOpen.value = false;
  const reply = replyTo.value, edit = editing.value, file = pendingFile.value;
  messageInput.value = '';
  nextTick(autosize);
  try {
    if (edit) {
      if (text && text !== edit.text) await chatRoomStore.editMessage(edit.messageId, text);
    } else if (file) {
      await chatRoomStore.sendMedia(file, text, reply?.messageId);
    } else {
      await chatRoomStore.sendText(text, { replyTo: reply?.messageId, mentions: mentionsIn(text) });
    }
    editing.value = null; replyTo.value = null; clearPendingFile(); mentionPicked.clear();
    nextTick(() => scrollToBottom(true));
  } catch (err: any) {
    messageInput.value = text;
    console.error('Failed to send message:', err);
    await toastError(err?.message?.includes('Owner device') ? 'The group creator is offline — try again when they are back.' : 'Failed to send. Please try again.');
  } finally {
    isSending.value = false;
  }
}

// ── Message actions ───────────────────────────────────────────────────────
interface MenuState { item: TimelineItem; style: Record<string, string>; reactOnly: boolean; moreEmoji: boolean }
const menu = ref<MenuState | null>(null);
function openMenu(item: TimelineItem, ev: Event, reactOnly = false) {
  if (item.deleted && !reactOnly) return;
  const touch = (ev as TouchEvent).touches?.[0];
  const x = touch ? touch.clientX : (ev as MouseEvent).clientX;
  const y = touch ? touch.clientY : (ev as MouseEvent).clientY;
  const w = 280, h = reactOnly ? 70 : 330;
  const left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - h - 8));
  menuOpenedAt = Date.now();
  menu.value = { item, reactOnly, moreEmoji: false, style: { left: `${left}px`, top: `${top}px`, width: `${w}px` } };
}
// The touchend that finishes a long-press would otherwise land on the backdrop and close it at once.
let menuOpenedAt = 0;
function closeMenu() { if (Date.now() - menuOpenedAt > 350) menu.value = null; }
const myReaction = (item: TimelineItem) => item.reactions.find(r => r.mine)?.emoji ?? '';

async function run(action: () => Promise<unknown>) {
  try { await action(); }
  catch (err: any) {
    await toastError(err?.message?.includes('Owner device') ? 'The group creator is offline — try again when they are back.' : (err?.message || 'Action failed'));
  }
}
const react = (item: TimelineItem, emoji: string) => run(() => chatRoomStore.react(item.messageId, emoji));
const vote = (item: TimelineItem, choices: number[]) => run(() => chatRoomStore.vote(item.messageId, choices));
const togglePin = (item: TimelineItem) => run(() => (item.pinned ? chatRoomStore.unpin(item.messageId) : chatRoomStore.pin(item.messageId)));

async function copyText(item: TimelineItem) {
  await navigator.clipboard.writeText(item.text).catch(() => {});
  const t = await toastController.create({ message: 'Copied', duration: 1200, position: 'top' });
  await t.present();
}
async function confirmDelete(item: TimelineItem) {
  const alert = await alertController.create({
    header: 'Delete message?',
    message: 'It will be removed for everyone in this group.',
    buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Delete', role: 'destructive' }],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role === 'destructive') await run(() => chatRoomStore.deleteMessage(item.messageId));
}

// Read receipts sheet.
const infoFor = ref<TimelineItem | null>(null);
const infoReaders = computed(() => (infoFor.value ? chatRoomStore.readBy(infoFor.value) : []));
const infoUnread = computed(() => chatRoomStore.otherAccounts.filter(a => !infoReaders.value.includes(a)));

// Forwarding.
const forwarding = ref<TimelineItem | null>(null);
const forwardRooms = ref<ChatRoom[]>([]);
async function openForward(item: TimelineItem) {
  forwarding.value = item;
  forwardRooms.value = (await ChatRoomService.listJoinedRooms().catch(() => [])).filter(r => r.securityMode === 'EPOCH_GROUP_V1');
}
async function doForward(targetRoom: string) {
  const item = forwarding.value;
  forwarding.value = null;
  if (!item) return;
  await run(async () => {
    await chatRoomStore.forward(targetRoom, { text: item.text, media: item.media });
    const t = await toastController.create({ message: 'Forwarded', duration: 1400, position: 'top', color: 'success' });
    await t.present();
  });
}

// ── Polls ─────────────────────────────────────────────────────────────────
const pollOpen = ref(false);
const pollQuestion = ref('');
const pollOptions = ref<string[]>(['', '']);
const pollMulti = ref(false);
const pollValid = computed(() => pollQuestion.value.trim() && pollOptions.value.filter(o => o.trim()).length >= 2);
function openPollComposer() {
  pollQuestion.value = ''; pollOptions.value = ['', '']; pollMulti.value = false; pollOpen.value = true;
}
function growPollOptions() {
  const o = pollOptions.value;
  if (o.length < 12 && o[o.length - 1].trim()) o.push('');
}
async function sendPoll() {
  const options = pollOptions.value.map(o => o.trim()).filter(Boolean);
  isSending.value = true;
  try {
    await chatRoomStore.createPoll(pollQuestion.value.trim(), options, pollMulti.value);
    pollOpen.value = false;
    nextTick(() => scrollToBottom(true));
  } catch (err: any) {
    await toastError(err?.message || 'Failed to create poll');
  } finally { isSending.value = false; }
}

// ── Voice messages ────────────────────────────────────────────────────────
const canRecord = typeof window !== 'undefined' && 'MediaRecorder' in window && !!navigator.mediaDevices?.getUserMedia;
const recording = ref(false);
const recordStart = ref(0);
const recordNow = ref(0);
let recorder: MediaRecorder | null = null;
let recordChunks: Blob[] = [];
let recordTimer: ReturnType<typeof setInterval> | null = null;
let sendRecording = false;
const recordClock = computed(() => {
  const s = Math.max(0, Math.floor((recordNow.value - recordStart.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recordChunks = [];
    recorder.ondataavailable = e => { if (e.data.size) recordChunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
      recording.value = false;
      if (!sendRecording || !recordChunks.length) return;
      const type = recorder?.mimeType || 'audio/webm';
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File(recordChunks, `voice-${Date.now()}.${ext}`, { type: type.split(';')[0] });
      void run(() => chatRoomStore.sendMedia(file, '', replyTo.value?.messageId).then(() => { replyTo.value = null; }));
    };
    recorder.start();
    recording.value = true;
    recordStart.value = recordNow.value = Date.now();
    recordTimer = setInterval(() => { recordNow.value = Date.now(); }, 250);
  } catch {
    await toastError('Microphone unavailable');
  }
}
function stopRecording(send: boolean) {
  sendRecording = send;
  recorder?.stop();
}

// ── Lightbox ──────────────────────────────────────────────────────────────
const lightbox = ref('');

// ── Room lifecycle ────────────────────────────────────────────────────────
let initGeneration = 0;

async function initRoom() {
  const gen = ++initGeneration;
  initialLoading.value = true;
  chatRoomStore.error = null;

  try {
    const user = await UserService.getCurrentUser();
    if (gen !== initGeneration) return;

    currentUserId.value = user.id;
    currentUserName.value = user.displayName || user.username || 'Anonymous';
    chatRoomStore.setIdentity(user.id, currentUserName.value);

    const keyExists = await KeyVaultService.hasKey(roomId.value);
    if (gen !== initGeneration) return;

    if (!keyExists) {
      hasAccess.value = false;
      initialLoading.value = false;
      // Already approved on another visit? Then this completes the join.
      void tryCompleteJoin(gen);
      void chatRoomStore.accessMode(roomId.value).then(mode => { if (gen === initGeneration) accessMode.value = mode; });
      return;
    }
    hasAccess.value = true;

    const rooms = await ChatRoomService.listJoinedRooms();
    if (gen !== initGeneration) return;

    const room: ChatRoom | undefined = rooms.find(r => r.id === roomId.value);

    if (!room) {
      chatRoomStore.error = 'Room not found or could not be decrypted.';
      initialLoading.value = false;
      return;
    }

    roomTitle.value = room.name;
    // Awaited: `enterRoom` now loads history (local first, then the graph)
    // instead of only opening a live subscription onto an empty room.
    await chatRoomStore.enterRoom(room);
    if (gen !== initGeneration) return;
    computeUnreadDivider();
    initialLoading.value = false;
    await nextTick();
    const divider = unreadDividerId.value && messagesContainer.value?.querySelector('.unread-sep');
    if (divider) divider.scrollIntoView({ block: 'start' });
    else scrollToBottom();
    onScroll();
  } catch (err: any) {
    if (gen !== initGeneration) return;
    chatRoomStore.error = err.message || 'Failed to load room';
  } finally {
    if (gen === initGeneration) {
      initialLoading.value = false;
    }
  }
}

// ── Joining ───────────────────────────────────────────────────────────────
const joinState = ref<'idle' | 'sending' | 'requested'>('idle');
const accessMode = ref<'password' | 'approval'>('approval');
const joinPassword = ref('');
const joinError = ref('');
let joinPoll: ReturnType<typeof setInterval> | null = null;

async function tryCompleteJoin(gen: number): Promise<boolean> {
  try {
    await chatRoomStore.joinRoom(roomId.value, 'epoch-v1', 'invite');
    chatRoomStore.error = null;
    if (gen !== initGeneration) return true;
    stopJoinPoll();
    await initRoom();
    return true;
  } catch {
    chatRoomStore.error = null;
    return false;
  }
}
function stopJoinPoll() { if (joinPoll) { clearInterval(joinPoll); joinPoll = null; } }

async function requestJoin() {
  joinState.value = 'sending';
  joinError.value = '';
  try {
    const result = await chatRoomStore.requestJoin(roomId.value, currentUserName.value, accessMode.value === 'password' ? joinPassword.value : undefined);
    if (result === 'member') { await tryCompleteJoin(initGeneration); return; }
    joinState.value = 'requested';
    const gen = initGeneration;
    stopJoinPoll();
    joinPoll = setInterval(() => { void tryCompleteJoin(gen); }, 5000);
  } catch (err: any) {
    joinState.value = 'idle';
    joinError.value = err?.message?.includes('unavailable') ? 'Group not found. Check the invite link, or the creator may be offline.' : (err?.message || 'Could not send request');
  }
}

async function shareInvite() {
  try {
    const link = InviteLinkService.generateInviteLink(roomId.value, 'chatroom', 'epoch-v1');
    await navigator.clipboard.writeText(link);
    const toast = await toastController.create({
      message: 'Invite link copied — you\'ll approve each request in Members.',
      duration: 2600,
      position: 'top',
      color: 'success',
    });
    await toast.present();
  } catch (err) {
    console.error('Failed to share invite:', err);
    await toastError('Failed to copy invite link.');
  }
}

async function confirmLeave() {
  const owner = chatRoomStore.isOwner;
  const alert = await alertController.create({
    header: owner ? 'Close group?' : 'Leave group?',
    message: owner ? 'Everyone loses access and the group cannot be reopened.' : 'You will need to be approved again to rejoin.',
    buttons: [{ text: 'Cancel', role: 'cancel' }, { text: owner ? 'Close' : 'Leave', role: 'destructive' }],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  if (role !== 'destructive') return;
  try {
    await chatRoomStore.leaveRoom(roomId.value);
    showMembers.value = false;
    router.replace('/chatrooms');
  } catch (err: any) {
    await toastError(err?.message || 'Failed to leave');
  }
}

const showMembers = ref(false);

watch(roomId, () => {
  chatRoomStore.leaveCurrentRoom();
  stopJoinPoll();
  joinState.value = 'idle';
  cancelCompose(); clearPendingFile();
  searchOpen.value = false;
  roomTitle.value = 'Loading...';
  initRoom();
});

function onGlobalKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') { menu.value = null; lightbox.value = ''; }
  const typing = ev.target instanceof HTMLElement && ev.target.matches('input, textarea, select, [contenteditable]');
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f' && ready.value && !typing) { ev.preventDefault(); if (!searchOpen.value) toggleSearch(); }
}

onMounted(() => {
  initRoom();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('keydown', onGlobalKey);
});

onUnmounted(() => {
  stopJoinPoll();
  if (recording.value) stopRecording(false);
  clearPendingFile();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('keydown', onGlobalKey);
  chatRoomStore.leaveCurrentRoom();
});
</script>

<style scoped>
ion-header::after { display: none !important; }
ion-toolbar { --border-width: 0 !important; }
ion-content { --background: transparent; }

.back-btn, .header-action-btn {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; background: none; border: none;
  border-radius: 50%; color: var(--app-text-muted); cursor: pointer;
  transition: color 160ms ease, background 160ms ease;
}
.back-btn:hover, .header-action-btn:hover, .header-action-btn.active { color: var(--app-text); background: rgba(255,255,255,0.06); }
.back-btn svg, .header-action-btn svg { width: 22px; height: 22px; }
.header-action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.hdr-badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; border-radius: 999px; background: #f59e0b; color: #111; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; padding: 0 4px; }

.title-btn { display: flex; flex-direction: column; align-items: flex-start; background: none; border: none; color: inherit; cursor: pointer; padding: 0; max-width: 100%; font: inherit; }
.title-name { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.title-sub { font-size: 11.5px; font-weight: 500; color: var(--app-text-subtle); }
.title-sub.typing { color: #34d399; }

.search-bar { display: flex; align-items: center; gap: 8px; padding: 6px 14px 8px; }
.search-input { flex: 1; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 999px; padding: 7px 14px; color: var(--app-text); font: inherit; font-size: 14px; outline: none; }
.search-input:focus { border-color: rgba(99,102,241,.6); }
.search-count { font-size: 12px; color: var(--app-text-subtle); min-width: 60px; text-align: right; }
.search-results { height: 100%; overflow-y: auto; padding: 8px 14px; }
.search-hit { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 6px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); color: var(--app-text); cursor: pointer; font: inherit; }
.search-hit:hover { background: rgba(255,255,255,.08); }
.search-hit-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--app-text-subtle); }
.search-hit-text { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pinned-bar { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 16px; background: rgba(99,102,241,.08); border: none; border-top: 1px solid rgba(255,255,255,.05); border-bottom: 1px solid rgba(255,255,255,.05); color: var(--app-text); cursor: pointer; text-align: left; font: inherit; }
.pinned-body { display: flex; flex-direction: column; min-width: 0; }
.pinned-label { font-size: 11px; font-weight: 700; color: #a5b4fc; }
.pinned-text { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* States */
.state-container {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%; padding: 32px 24px; text-align: center; gap: 12px;
}
.state-icon {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2);
  display: flex; align-items: center; justify-content: center; color: #818cf8; font-size: 30px;
}
.state-icon.error-icon { background: rgba(239,68,68,.1); border-color: rgba(239,68,68,.2); color: #ef4444; }
.state-icon.lock-icon  { background: rgba(251,191,36,.1); border-color: rgba(251,191,36,.2); color: #fbbf24; }
.state-title { font-size: 17px; font-weight: 700; color: var(--app-text); margin: 0; }
.state-sub   { font-size: 13.5px; color: var(--app-text-muted); margin: 0; max-width: 380px; }
.error-text { color: #f87171; }
.join-password { max-width: 280px; text-align: center; }
.link-btn { background: none; border: none; color: #a5b4fc; font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; }
.spinner { width: 30px; height: 30px; border: 2.5px solid rgba(99,102,241,.2); border-top-color: #6366f1; border-radius: 50%; animation: spin .7s linear infinite; }
.spinner.small { width: 20px; height: 20px; }
@keyframes spin { to { transform: rotate(360deg); } }
.pill-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 999px; border: none; font-size: 13.5px; font-weight: 700; cursor: pointer; transition: opacity 160ms, transform 160ms; }
.pill-btn.accent { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.38); }
.pill-btn.outline { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); color: var(--app-text-muted); }
.pill-btn.danger { background: rgba(239,68,68,.12); border: 1px solid rgba(239,68,68,.35); color: #f87171; }
.pill-btn:disabled { opacity: .6; cursor: wait; }
.pill-btn:hover { opacity: .88; transform: translateY(-1px); }

/* Messages */
.chat-container { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.messages-area {
  flex: 1; overflow-y: auto; padding: 16px 14px 8px;
  display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.08) transparent;
}
.drop-overlay { position: absolute; inset: 8px; z-index: 5; border: 2px dashed #818cf8; border-radius: 18px; background: rgba(15,15,30,.75); display: flex; align-items: center; justify-content: center; font-weight: 700; color: #c7d2fe; pointer-events: none; }

.empty-chat {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; gap: 12px; color: var(--app-text-muted);
}
.empty-icon { width: 52px; height: 52px; border-radius: 50%; background: rgba(99,102,241,.1); display: flex; align-items: center; justify-content: center; color: #818cf8; font-size: 26px; }
.empty-chat p { font-size: 14px; margin: 0; }

.day-sep, .unread-sep { display: flex; justify-content: center; margin: 12px 0 8px; }
.day-sep span { font-size: 11.5px; font-weight: 600; color: var(--app-text-muted); background: rgba(255,255,255,.06); padding: 3px 12px; border-radius: 999px; }
.unread-sep { position: relative; }
.unread-sep::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 1px solid rgba(248,113,113,.45); }
.unread-sep span { position: relative; font-size: 11px; font-weight: 700; color: #f87171; background: var(--app-bg-base, #0b0b12); padding: 0 10px; text-transform: uppercase; letter-spacing: .05em; }

.scroll-down { position: absolute; right: 16px; bottom: 14px; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.12); background: var(--app-bg-elevated, #1f2030); color: var(--app-text); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
.scroll-down svg { width: 20px; height: 20px; }
.scroll-badge { position: absolute; top: -6px; right: -4px; min-width: 18px; height: 18px; border-radius: 999px; background: #6366f1; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; padding: 0 5px; }

/* Composer */
.input-footer { background: transparent; --background: transparent; border-top: 1px solid rgba(255,255,255,.06); }
.typing-row { display: flex; align-items: center; gap: 6px; padding: 6px 20px 0; font-size: 12px; color: #34d399; }
.typing-dots { display: inline-flex; gap: 3px; }
.typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: blink 1.2s infinite ease-in-out; }
.typing-dots span:nth-child(2) { animation-delay: .2s; }
.typing-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

.compose-banner { display: flex; align-items: center; gap: 10px; margin: 8px 12px 0; padding: 8px 10px 8px 12px; border-radius: 14px; background: rgba(255,255,255,.05); border-left: 3px solid #818cf8; }
.compose-banner-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.compose-banner-title { font-size: 12px; font-weight: 700; color: #a5b4fc; }
.compose-banner-text { font-size: 13px; color: var(--app-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compose-thumb { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; }

.mention-list { margin: 6px 12px 0; border-radius: 12px; overflow: hidden; background: var(--app-bg-elevated, #1f2030); border: 1px solid rgba(255,255,255,.1); }
.mention-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; background: none; border: none; color: var(--app-text); font: inherit; font-size: 14px; cursor: pointer; text-align: left; }
.mention-item.active, .mention-item:hover { background: rgba(99,102,241,.2); }
.mention-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }

.emoji-grid, .menu-emoji-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 2px; padding: 8px; }
.emoji-grid { margin: 6px 12px 0; border-radius: 14px; background: var(--app-bg-elevated, #1f2030); border: 1px solid rgba(255,255,255,.1); max-height: 180px; overflow-y: auto; }
.emoji-cell { font-size: 22px; height: 36px; background: none; border: none; border-radius: 8px; cursor: pointer; }
.emoji-cell:hover { background: rgba(255,255,255,.08); }

.input-area {
  display: flex; align-items: flex-end; gap: 4px;
  padding: 6px 6px 6px 6px; margin: 8px 12px 12px; border-radius: 24px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1);
  transition: border-color 180ms ease, box-shadow 180ms ease;
}
.input-area:focus-within { border-color: rgba(99,102,241,.5); box-shadow: 0 0 0 3px rgba(99,102,241,.1); }
.input-area.recording { align-items: center; border-color: rgba(239,68,68,.5); }
.icon-btn { flex-shrink: 0; width: 34px; height: 34px; border-radius: 50%; border: none; background: none; color: var(--app-text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 17px; }
.icon-btn:hover:not(:disabled) { background: rgba(255,255,255,.08); color: var(--app-text); }
.icon-btn:disabled { opacity: .35; cursor: not-allowed; }
.icon-btn svg { width: 19px; height: 19px; }
.message-input { flex: 1; align-self: center; background: transparent; border: none; outline: none; resize: none; font-size: 14.5px; line-height: 1.5; color: var(--ion-text-color); font-family: inherit; padding: 4px 4px 4px 6px; max-height: 140px; }
.message-input::placeholder { color: var(--app-text-subtle); }
.message-input:disabled { opacity: .45; cursor: not-allowed; }
.send-button { flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff; box-shadow: 0 4px 14px rgba(99,102,241,.4); transition: transform 160ms ease, box-shadow 160ms ease; }
.send-button:hover:not(:disabled) { transform: translateY(-1px) scale(1.06); box-shadow: 0 6px 20px rgba(99,102,241,.5); }
.send-button:active:not(:disabled) { transform: scale(0.94); }
.send-button:disabled { background: rgba(255,255,255,.08); color: var(--app-text-subtle); box-shadow: none; cursor: not-allowed; }
.w-5 { width: 20px; height: 20px; }
.rec-dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; margin-left: 10px; animation: blink 1s infinite; }
.rec-time { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--app-text); }
.rec-hint { flex: 1; font-size: 13px; color: var(--app-text-muted); }

/* Context menu */
.menu-backdrop { position: fixed; inset: 0; z-index: 1000; }
.menu { position: fixed; border-radius: 16px; background: var(--app-bg-elevated, #1f2030); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 16px 40px rgba(0,0,0,.45); padding: 6px; }
.menu-reacts { display: flex; justify-content: space-between; padding: 2px 2px 6px; }
.menu-react { font-size: 22px; width: 36px; height: 36px; border-radius: 50%; border: none; background: none; cursor: pointer; transition: transform .12s ease; }
.menu-react:hover { transform: scale(1.2); background: rgba(255,255,255,.06); }
.menu-react.mine { background: rgba(99,102,241,.3); }
.menu-react.more { font-size: 18px; color: var(--app-text-muted); }
.menu-emoji-grid { max-height: 160px; overflow-y: auto; border-top: 1px solid rgba(255,255,255,.08); }
.menu-item { display: block; width: 100%; text-align: left; padding: 9px 12px; border: none; background: none; border-radius: 10px; color: var(--app-text); font: inherit; font-size: 14px; cursor: pointer; }
.menu-item:hover { background: rgba(255,255,255,.07); }
.menu-item.danger { color: #f87171; }

/* Modals */
.modal-text-btn { background: none; border: none; color: var(--app-text-muted); font: inherit; font-size: 15px; font-weight: 600; padding: 6px 12px; cursor: pointer; }
.modal-text-btn.primary { color: #818cf8; }
.modal-text-btn:disabled { opacity: .4; cursor: not-allowed; }
.modal-body { padding: 16px; }
.field-label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--app-text-muted); margin: 12px 0 6px; }
.field-input { flex: 1; width: 100%; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 10px 12px; color: var(--app-text); font: inherit; font-size: 14.5px; outline: none; }
.field-input:focus { border-color: rgba(99,102,241,.6); }
.poll-opt-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.check-row { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; color: var(--app-text); }
.room-description { padding: 12px 16px 0; margin: 0; font-size: 14px; color: var(--app-text-muted); }
.pinned-list { padding: 0 16px; }
.gp-h { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--app-text-muted); margin: 14px 0 8px; }
.leave-row { display: flex; justify-content: center; padding: 8px 16px 32px; }
.info-preview { font-size: 14px; color: var(--app-text); background: rgba(255,255,255,.05); border-radius: 12px; padding: 10px 12px; margin: 0 0 6px; }
.info-line { font-size: 12.5px; color: var(--app-text-subtle); margin: 0; }
.info-reader { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 14px; color: var(--app-text); }
.info-reader.muted { color: var(--app-text-muted); }

.lightbox { position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,.9); display: flex; align-items: center; justify-content: center; cursor: zoom-out; }
.lightbox img { max-width: 95vw; max-height: 92vh; object-fit: contain; }

@media (prefers-reduced-motion: reduce) { .send-button, .input-area, .menu-react { transition: none; } }
</style>
