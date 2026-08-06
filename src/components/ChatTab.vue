<template>
  <div class="chat-tab">
    <div class="tab-intro">
      <p>{{ totalUnread > 0 ? `${totalUnread} unread message${totalUnread > 1 ? 's' : ''}` : '' }}</p>
    </div>

    <!-- User Search -->
    <div class="user-search-box">
      <ion-searchbar
        v-model="userSearchQuery"
        placeholder="Search users by name..."
        @ionInput="$emit('searchUsers', userSearchQuery)"
        debounce="300"
      ></ion-searchbar>
    </div>

    <!-- Search Results -->
    <div v-if="userSearchQuery && userSearchResults.length > 0" class="user-search-results">
      <div class="search-results-header">
        <span>Search Results</span>
        <button @click="$emit('clearUserSearch')" class="clear-search-btn">Clear</button>
      </div>
      <div
        v-for="user in userSearchResults"
        :key="user.id"
        class="user-result-item"
        @click="$emit('startChat', user)"
      >
        <div class="user-avatar">
          <ion-icon :icon="personCircleOutline"></ion-icon>
        </div>
        <div class="user-info">
          <div class="user-name">{{ user.name }}</div>
          <div class="user-username">u/{{ user.username }}</div>
        </div>
        <ion-icon :icon="chatbubbleOutline" class="chat-icon"></ion-icon>
      </div>
    </div>

    <div v-if="userSearchQuery && userSearchResults.length === 0 && !searchingUsers" class="no-users-found">
      <p>No users found for "{{ userSearchQuery }}"</p>
    </div>

    <div v-if="searchingUsers" class="searching-users">
      <ion-spinner></ion-spinner>
      <p>Searching users...</p>
    </div>

    <!-- Chat List -->
    <div class="chat-list">
      <div class="chat-list-header" v-if="!userSearchQuery">
        <span>Recent Conversations</span>
      </div>

      <div v-if="chatList.length === 0 && !userSearchQuery" class="empty-chat">
        <ion-icon :icon="chatbubbleOutline" class="empty-chat-icon"></ion-icon>
        <p>No conversations yet</p>
        <p class="empty-hint">Search for users above to start chatting</p>
      </div>

      <div
        v-for="chat in chatList"
        :key="chat.userId"
        class="chat-item"
        @click="$emit('openChat', chat)"
        v-show="!userSearchQuery"
      >
        <div class="chat-avatar">
          <ion-icon :icon="personCircleOutline"></ion-icon>
        </div>
        <div class="chat-info">
          <div class="chat-header-row">
            <span class="chat-name">{{ chat.name }}</span>
            <span class="chat-time">{{ formatChatTime(chat.lastMessageTime) }}</span>
          </div>
          <div class="chat-preview">
            {{ chat.lastMessage }}
          </div>
        </div>
        <div v-if="chat.unreadCount > 0" class="unread-badge">
          {{ chat.unreadCount }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { IonIcon, IonSpinner, IonSearchbar } from '@ionic/vue';
import { personCircleOutline, chatbubbleOutline } from 'ionicons/icons';
import { ref } from 'vue';

interface ChatEntry {
  userId: string;
  name: string;
  lastMessage: string;
  lastMessageTime: number;
  unreadCount: number;
  publicKey: string;
}

interface UserResult {
  id: string;
  name: string;
  username: string;
  publicKey: string;
}

const props = defineProps<{
  chatList: ChatEntry[];
  totalUnread: number;
  userSearchResults: UserResult[];
  searchingUsers: boolean;
}>();

defineEmits<{
  (e: 'searchUsers', query: string): void;
  (e: 'clearUserSearch'): void;
  (e: 'startChat', user: UserResult): void;
  (e: 'openChat', chat: ChatEntry): void;
}>();

const userSearchQuery = ref('');

function formatChatTime(timestamp: number): string {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 60_000)      return 'Just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
</script>
