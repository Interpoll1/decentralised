# Vue Frontend Integration Guide

## 📦 New Files Added

### Services
- `src/services/chatService.ts` - P2P Chat service with end-to-end encryption
- `src/services/searchService.ts` - Full-text search service

### Composables
- `src/composables/useChat.ts` - Vue composable for chat functionality
- `src/composables/useSearch.ts` - Vue composable for search functionality

### Views
- `src/views/ChatView.vue` - 1-to-1 chat interface
- `src/views/SearchView.vue` - Search results page

### Routes
- `/search` - Search page
- `/chat/:userId` - Chat page

## 🔧 Required Changes

### 1. Environment Variables

Add to your `.env` file:

```bash
# WebSocket URL for chat
VITE_WS_URL=wss://your-relay-server.com

# API URL for search
VITE_API_URL=https://your-relay-server.com
```

### 2. Update Navbar Component

Add search and chat icons to your navbar (e.g., `src/components/Navbar.vue`):

```vue
<template>
  <div class="navbar">
    <!-- Existing nav items -->
    
    <!-- Add Search Icon -->
    <router-link to="/search" class="nav-icon">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    </router-link>

    <!-- Add Chat Icon (optional - if you have a chat list page) -->
    <router-link to="/chats" class="nav-icon">
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </router-link>
  </div>
</template>
```

### 3. Auto-Index Posts and Polls

#### In Post Creation Service

Update `src/services/postService.ts`:

```typescript
import SearchService from './searchService';

const searchService = new SearchService();

export async function createPost(postData: any) {
  // ... existing post creation logic ...
  
  // Auto-index for search
  try {
    await searchService.indexContent('post', post.id, {
      title: post.title,
      content: post.content,
      authorName: post.authorName,
      communitySlug: post.communitySlug,
      createdAt: post.createdAt,
    });
  } catch (err) {
    console.warn('Search indexing failed:', err);
  }
  
  return post;
}
```

#### In Poll Creation Service

Update `src/services/pollService.ts`:

```typescript
import SearchService from './searchService';

const searchService = new SearchService();

export async function createPoll(pollData: any) {
  // ... existing poll creation logic ...
  
  // Auto-index for search
  try {
    await searchService.indexContent('poll', poll.id, {
      question: poll.question,
      description: poll.description,
      authorName: poll.authorName,
      communitySlug: poll.communitySlug,
      createdAt: poll.createdAt,
    });
  } catch (err) {
    console.warn('Search indexing failed:', err);
  }
  
  return poll;
}
```

### 4. Add Chat Button to User Profiles

In `src/views/ProfilePage.vue` or wherever you show user info:

```vue
<template>
  <div class="user-profile">
    <!-- Existing profile content -->
    
    <!-- Add Chat Button -->
    <button
      v-if="user.id !== currentUser.id"
      @click="startChat(user)"
      class="chat-button"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      Message
    </button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useChat } from '../composables/useChat';

const router = useRouter();
const WS_URL = import.meta.env.VITE_WS_URL;
const currentUser = { id: 'current-user-id' }; // Get from auth store

const { publicKey } = useChat(WS_URL, currentUser.id);

const startChat = async (user: any) => {
  // Navigate to chat with user's public key
  router.push({
    name: 'Chat',
    params: { userId: user.id },
    query: {
      name: user.name,
      publicKey: user.publicKey || publicKey.value, // Use their public key
    },
  });
};
</script>
```

### 5. Store User Public Keys

Update user service to store chat public keys:

```typescript
// src/services/userService.ts

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  publicKey?: string; // Add this for chat
  // ... existing fields
}

export async function updateUserProfile(profile: Partial<UserProfile>) {
  // Include publicKey when updating profile
  // ... existing update logic
}
```

## 🎨 Usage Examples

### Search Usage

```vue
<script setup lang="ts">
import { useSearch } from '../composables/useSearch';

const { results, loading, search } = useSearch();

// Simple search
await search('blockchain voting');

// Search posts only
await searchPosts('decentralization');

// Search in a community
await searchInCommunity('update', 'c-tech');
</script>
```

### Chat Usage

```vue
<script setup lang="ts">
import { useChat } from '../composables/useChat';

const WS_URL = 'wss://your-relay-server.com';
const currentUserId = 'user-123';

const {
  connected,
  publicKey,
  sendMessage,
  getMessages,
  startChat,
} = useChat(WS_URL, currentUserId);

// Start chat
await startChat({
  userId: 'recipient-456',
  publicKey: 'their-public-key',
  name: 'John Doe',
});

// Send message
await sendMessage('recipient-456', 'Hello!');

// Get messages
const messages = getMessages('recipient-456');
</script>
```

## 🔒 Security Notes

1. **Chat Encryption**: Messages are end-to-end encrypted using RSA-OAEP
2. **Public Keys**: Store user public keys in their profiles
3. **Session Management**: Use JWT tokens from enhanced relay server
4. **Rate Limiting**: Implement client-side rate limiting for chat

## 📱 Mobile Considerations

If using Capacitor/Ionic:

1. Add WebSocket plugin for native apps
2. Handle background connections for chat
3. Implement push notifications for new messages
4. Cache search results for offline access

## 🐛 Troubleshooting

### Chat Not Connecting
- Check `VITE_WS_URL` is correct
- Verify relay server is running on port 8080
- Check browser console for WebSocket errors

### Search Not Working
- Verify `VITE_API_URL` is correct
- Check MySQL FULLTEXT is enabled
- Verify content is being indexed (check `/api/search` endpoint)

### Messages Not Decrypting
- Ensure both users have exchanged public keys
- Check if `startChat()` was called before sending messages
- Verify Web Crypto API is available (HTTPS required)

## 🚀 Next Steps

1. Create a chat list page (`/chats`)
2. Add unread message badges
3. Implement push notifications
4. Add search filters UI
5. Create search history
6. Add typing indicators UI
7. Implement message reactions
8. Add file/image sharing in chat

## 📚 API Reference

Full documentation:
- Chat WebSocket API: See `DEPLOYMENT-GUIDE.md`
- Search REST API: See `DEPLOYMENT-GUIDE.md`
- Services: Check TypeScript interfaces in service files
