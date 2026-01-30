// src/stores/postStore.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Post, PostService } from '../services/postService';
import { UserService } from '../services/userService';

export const usePostStore = defineStore('post', () => {
  const posts = ref<Post[]>([]);
  const currentPost = ref<Post | null>(null);
  const isLoading = ref(false);
  const currentFeed = ref<'all' | 'community'>('all');
  const currentCommunityId = ref<string | null>(null);

  // Computed: Posts sorted by score
  const sortedPosts = computed(() => {
    return [...posts.value].sort((a, b) => {
      // Sort by score (hot algorithm could be added here)
      return b.score - a.score;
    });
  });

  // Computed: Posts for current community
  const communityPosts = computed(() => {
    if (!currentCommunityId.value) return sortedPosts.value;
    return sortedPosts.value.filter(p => p.communityId === currentCommunityId.value);
  });

  // Load posts for a community
  async function loadPostsForCommunity(communityId: string) {
    // Don't set isLoading or clear posts if we're batch loading
    const isBatchLoad = currentCommunityId.value !== communityId;
    
    if (!isBatchLoad) {
      isLoading.value = true;
      currentCommunityId.value = communityId;
      currentFeed.value = 'community';
      posts.value = [];
    }

    try {
      console.log('Loading posts for community:', communityId);
      
      const seen = new Set<string>();
      
      // Subscribe to real-time updates
      PostService.subscribeToPostsInCommunity(communityId, (post) => {
        // Prevent duplicates
        if (!seen.has(post.id)) {
          seen.add(post.id);
          
          // Check if already exists in array
          const existingIndex = posts.value.findIndex(p => p.id === post.id);
          
          if (existingIndex >= 0) {
            // Update existing
            posts.value[existingIndex] = post;
            console.log('Post updated:', post.title);
          } else {
            // Add new
            posts.value.push(post);
            console.log('Post loaded:', post.title);
          }
        }
      });
      
      // Also do a one-time fetch for initial load
      setTimeout(async () => {
        const allPosts = await PostService.getAllPostsInCommunity(communityId);
        
        // Merge with existing
        allPosts.forEach(post => {
          if (!seen.has(post.id)) {
            seen.add(post.id);
            posts.value.push(post);
            console.log('Post loaded (fetch):', post.title);
          }
        });
        
        if (!isBatchLoad) {
          isLoading.value = false;
        }
        console.log(`Loaded ${allPosts.length} posts from ${communityId}`);
      }, 500); // Reduced from 1s to 500ms for speed
      
    } catch (error) {
      console.error('Error loading posts:', error);
      if (!isBatchLoad) {
        isLoading.value = false;
      }
    }
  }

  // Create new post
  async function createPost(data: {
    communityId: string;
    title: string;
    content: string;
    imageFile?: File;
  }) {
    try {
      console.log('Creating post...');
      
      const currentUser = await UserService.getCurrentUser();
      
      const post = await PostService.createPost({
        communityId: data.communityId,
        authorId: currentUser.id,
        authorName: currentUser.username,
        title: data.title,
        content: data.content
      }, data.imageFile);

      // Update user stats
      await UserService.incrementPostCount();

      // Add to local array immediately if not already present
      const exists = posts.value.find(p => p.id === post.id);
      if (!exists) {
        posts.value.unshift(post);
      }
      
      console.log('Post created:', post.id);
      return post;
    } catch (error) {
      console.error('Error creating post:', error);
      throw error;
    }
  }

  // Select post for viewing
  async function selectPost(postId: string) {
    try {
      console.log('Selecting post:', postId);
      
      // First check if we have it locally
      const local = posts.value.find(p => p.id === postId);
      if (local) {
        currentPost.value = local;
        console.log('Post selected (from cache):', local.title);
        return;
      }
      
      // Otherwise fetch from Gun
      currentPost.value = await PostService.getPost(postId);
      
      if (currentPost.value) {
        console.log('Post selected:', currentPost.value.title);
        
        // Add to posts array if not present
        const exists = posts.value.find(p => p.id === postId);
        if (!exists) {
          posts.value.push(currentPost.value);
        }
      } else {
        console.log('Post not found:', postId);
      }
    } catch (error) {
      console.error('Error selecting post:', error);
    }
  }

  // Vote on post (legacy method - kept for compatibility)
  async function voteOnPost(postId: string, direction: 'up' | 'down') {
    try {
      const currentUser = await UserService.getCurrentUser();
      await PostService.voteOnPost(postId, direction, currentUser.id);
      
      // Update local post
      const post = posts.value.find(p => p.id === postId);
      if (post) {
        if (direction === 'up') {
          post.upvotes++;
        } else {
          post.downvotes++;
        }
        post.score = post.upvotes - post.downvotes;
        
        // Update author's karma
        await UserService.incrementKarma(post.authorId, direction === 'up' ? 1 : -1);
      }
      
      console.log(`Vote cast: ${direction} on post ${postId}`);
    } catch (error) {
      console.error('Error voting on post:', error);
      throw error;
    }
  }

  // Upvote a post
  async function upvotePost(postId: string) {
    try {
      console.log('Upvoting post:', postId);
      
      const currentUser = await UserService.getCurrentUser();
      await PostService.voteOnPost(postId, 'up', currentUser.id);

      const updated = await PostService.getPost(postId);

      if (updated) {
        const idx = posts.value.findIndex(p => p.id === postId);
        if (idx >= 0) posts.value[idx] = updated;
        if (currentPost.value?.id === postId) currentPost.value = updated;

        // Update author's karma only when direction actually changed to up
        await UserService.incrementKarma(updated.authorId, 1);
      }

      console.log('Post upvoted');
    } catch (error) {
      console.error('Error upvoting post:', error);
      throw error;
    }
  }

  // Downvote a post
  async function downvotePost(postId: string) {
    try {
      console.log('Downvoting post:', postId);
      
      const currentUser = await UserService.getCurrentUser();
      await PostService.voteOnPost(postId, 'down', currentUser.id);

      const updated = await PostService.getPost(postId);

      if (updated) {
        const idx = posts.value.findIndex(p => p.id === postId);
        if (idx >= 0) posts.value[idx] = updated;
        if (currentPost.value?.id === postId) currentPost.value = updated;

        await UserService.incrementKarma(updated.authorId, -1);
      }

      console.log('Post downvoted');
    } catch (error) {
      console.error('Error downvoting post:', error);
      throw error;
    }
  }

  // Remove upvote from a post
  async function removeUpvote(postId: string) {
    try {
      console.log('Removing upvote from post:', postId);
      
      const currentUser = await UserService.getCurrentUser();
      
      // Check if PostService has removeVote method, otherwise just decrement locally
      if (PostService.removeVote) {
        await PostService.removeVote(postId, 'up', currentUser.id);
      }

      const updated = await PostService.getPost(postId);

      if (updated) {
        const idx = posts.value.findIndex(p => p.id === postId);
        if (idx >= 0) posts.value[idx] = updated;
        if (currentPost.value?.id === postId) currentPost.value = updated;

        await UserService.incrementKarma(updated.authorId, -1);
      }

      console.log('Upvote removed');
    } catch (error) {
      console.error('Error removing upvote:', error);
      throw error;
    }
  }

  // Remove downvote from a post
  async function removeDownvote(postId: string) {
    try {
      console.log('Removing downvote from post:', postId);
      
      const currentUser = await UserService.getCurrentUser();
      
      // Check if PostService has removeVote method, otherwise just decrement locally
      if (PostService.removeVote) {
        await PostService.removeVote(postId, 'down', currentUser.id);
      }

      const updated = await PostService.getPost(postId);

      if (updated) {
        const idx = posts.value.findIndex(p => p.id === postId);
        if (idx >= 0) posts.value[idx] = updated;
        if (currentPost.value?.id === postId) currentPost.value = updated;

        await UserService.incrementKarma(updated.authorId, 1);
      }

      console.log('Downvote removed');
    } catch (error) {
      console.error('Error removing downvote:', error);
      throw error;
    }
  }

  // Refresh posts
  async function refreshPosts() {
    console.log('Refreshing posts...');
    if (currentCommunityId.value) {
      posts.value = [];
      await loadPostsForCommunity(currentCommunityId.value);
    }
  }

  return {
    posts,
    sortedPosts,
    communityPosts,
    currentPost,
    isLoading,
    currentFeed,
    loadPostsForCommunity,
    createPost,
    selectPost,
    voteOnPost,
    upvotePost,
    downvotePost,
    removeUpvote,
    removeDownvote,
    refreshPosts
  };
});