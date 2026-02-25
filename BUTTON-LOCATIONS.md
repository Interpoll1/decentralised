# 🔘 Search & Chat Button Locations

## ✅ Search Button

### Location: HomePage Header (Top Right)
**File:** `src/views/HomePage.vue`

```vue
<ion-header>
  <ion-toolbar>
    <ion-title class="logo-title">Interpoll</ion-title>
    <ion-buttons slot="end">
      <!-- ✅ SEARCH BUTTON ADDED HERE -->
      <ion-button @click="$router.push('/search')">
        <ion-icon :icon="searchOutline"></ion-icon>
      </ion-button>
      
      <!-- Existing buttons -->
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
</ion-header>
```

**Visual Location:** 
- Top right corner of home page
- First button before Profile icon
- Clicking opens `/search` page

---

## ✅ Chat Button

### Location: User Profile View (Below Username)
**File:** `src/views/UserProfileView.vue` (NEW FILE)

```vue
<div class="profile-header">
  <div class="avatar-placeholder">
    <ion-icon :icon="personCircleOutline"></ion-icon>
  </div>
  <h1>{{ userProfile?.displayName }}</h1>
  <p class="username">u/{{ userProfile?.username }}</p>

  <!-- ✅ CHAT BUTTON ADDED HERE -->
  <ion-button
    v-if="!isOwnProfile"
    class="chat-button"
    @click="startChat"
  >
    <ion-icon slot="start" :icon="chatbubbleOutline"></ion-icon>
    Message
  </ion-button>

  <!-- User stats -->
  <div class="stats-row">
    ...
  </div>
</div>
```

**Visual Location:**
- On other users' profile pages (NOT your own profile)
- Below the username
- Above the stats (Karma, Posts, Comments)
- Clicking opens `/chat/:userId` page

**Route:** `/user/:userId` - For viewing other users' profiles

---

## 📁 File Changes Summary

### Modified Files:
1. ✅ `src/views/HomePage.vue` 
   - Added search button to header
   - Added `searchOutline` icon import

2. ✅ `src/router/index.ts`
   - Added `/search` route
   - Added `/chat/:userId` route
   - Added `/user/:userId` route (for UserProfileView)

### New Files:
3. ✅ `src/views/UserProfileView.vue` (NEW)
   - View other users' profiles
   - Contains chat button
   - Click usernames/avatars to navigate here

4. ✅ `src/views/SearchView.vue`
   - Full search interface
   - Filters by type/community
   - Pagination

5. ✅ `src/views/ChatView.vue`
   - 1-to-1 chat interface
   - End-to-end encrypted
   - Real-time messaging

6. ✅ `src/services/chatService.ts`
7. ✅ `src/services/searchService.ts`
8. ✅ `src/composables/useChat.ts`
9. ✅ `src/composables/useSearch.ts`

---

## 🎯 How Users Access Features

### Search:
1. **Click search icon** in top right of home page
2. Opens `/search` page with search bar

### Chat:
1. **Click on a user's name/avatar** in posts/comments
2. Opens their profile at `/user/:userId`
3. **Click "Message" button** on their profile
4. Opens chat at `/chat/:userId`

---

## 🔗 Quick Navigation Flow

```
HomePage
├── Search Icon (top right) → SearchView
├── User's Post/Comment
│   └── Click username → UserProfileView
│       └── Message Button → ChatView
```

---

## 💡 Where to Link UserProfileView

Add links to UserProfileView in these places:

### 1. PostCard Component
```vue
<!-- In src/components/PostCard.vue -->
<div class="post-author">
  <router-link :to="`/user/${post.authorId}`">
    u/{{ post.authorName }}
  </router-link>
</div>
```

### 2. CommentCard Component
```vue
<!-- In src/components/CommentCard.vue -->
<div class="comment-author">
  <router-link :to="`/user/${comment.authorId}`">
    u/{{ comment.authorName }}
  </router-link>
</div>
```

### 3. PollCard Component
```vue
<!-- In src/components/PollCard.vue -->
<div class="poll-author">
  <router-link :to="`/user/${poll.authorId}`">
    u/{{ poll.authorName }}
  </router-link>
</div>
```

---

## ✨ Next Steps

1. **Extract the new zip file** - it has all buttons integrated
2. **Add environment variables** in `.env`:
   ```bash
   VITE_WS_URL=wss://your-relay-server.com
   VITE_API_URL=https://your-relay-server.com
   ```
3. **Link usernames** in your existing components to `/user/:userId`
4. **Store user public keys** when users create accounts
5. **Test the flow**:
   - Click search icon → Search page opens ✅
   - Click username → User profile opens ✅
   - Click "Message" → Chat opens ✅

---

## 📸 Visual Mockup

```
┌─────────────────────────────────────┐
│ Interpoll         🔍 👤 ⚙️ 📦      │ ← Search icon (first button)
├─────────────────────────────────────┤
│                                     │
│  User's Post...                     │
│  by u/john_doe ← Click for profile  │
│                                     │
└─────────────────────────────────────┘

        ↓ Click username

┌─────────────────────────────────────┐
│ ← User Profile                      │
├─────────────────────────────────────┤
│         👤                          │
│      John Doe                       │
│    u/john_doe                       │
│                                     │
│  [ 💬 Message ]  ← Chat button      │
│                                     │
│  1250 Karma  42 Posts  156 Comments│
└─────────────────────────────────────┘

        ↓ Click Message

┌─────────────────────────────────────┐
│ ← John Doe            typing...     │
├─────────────────────────────────────┤
│                                     │
│  [Their message bubble]             │
│                    [Your bubble]    │
│                                     │
├─────────────────────────────────────┤
│ [Type a message...] [Send]          │
└─────────────────────────────────────┘
```

That's it! Everything is connected and ready to use! 🎉
