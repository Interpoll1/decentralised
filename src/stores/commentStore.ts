// src/stores/commentStore.ts
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { Comment, CommentService } from '../services/commentService';
import { generatePseudonym } from '../utils/pseudonym';

// Helper function to get current user
function getCurrentUser() {
  const userStr = localStorage.getItem('currentUser');
  if (!userStr) {
    // Create a default anonymous user if none exists
    const anonUser = {
      id: `anon_${Date.now()}`,
      username: 'Anonymous',
      email: ''
    };
    localStorage.setItem('currentUser', JSON.stringify(anonUser));
    return anonUser;
  }
  return JSON.parse(userStr);
}

export const useCommentStore = defineStore('comment', () => {
  const comments = ref<Comment[]>([]);
  const isLoading = ref(false);
  const voteVersion = ref(0);

  // Load comments for a post
  async function loadCommentsForPost(postId: string) {
    isLoading.value = true;

    try {
      // Clear existing comments for this post
      comments.value = comments.value.filter(c => c.postId !== postId);
      
      const seen = new Set<string>();
      
      try {
        // Subscribe to real-time updates
        CommentService.subscribeToCommentsInPost(postId, (comment) => {
          if (!seen.has(comment.id)) {
            seen.add(comment.id);
            
            const existingIndex = comments.value.findIndex(c => c.id === comment.id);
            
            if (existingIndex >= 0) {
              // Update existing comment but preserve vote counts if they're higher
              const existing = comments.value[existingIndex];
              comments.value[existingIndex] = {
                ...comment,
                upvotes: Math.max(comment.upvotes || 0, existing.upvotes || 0),
                downvotes: Math.max(comment.downvotes || 0, existing.downvotes || 0),
                score: (Math.max(comment.upvotes || 0, existing.upvotes || 0)) - (Math.max(comment.downvotes || 0, existing.downvotes || 0))
              };
            } else {
              comments.value.push(comment);
            }
          }
        });
      } catch (err) {
        // Fall back to one-time fetch only
      }
      
      // Also do a one-time fetch
      setTimeout(async () => {
        try {
          const allComments = await CommentService.getAllCommentsInPost(postId);
          
          allComments.forEach(comment => {
            if (!seen.has(comment.id)) {
              seen.add(comment.id);
              comments.value.push(comment);
            } else {
              // Update if already exists
              const existingIndex = comments.value.findIndex(c => c.id === comment.id);
              if (existingIndex >= 0) {
                const existing = comments.value[existingIndex];
                comments.value[existingIndex] = {
                  ...comment,
                  upvotes: Math.max(comment.upvotes || 0, existing.upvotes || 0),
                  downvotes: Math.max(comment.downvotes || 0, existing.downvotes || 0),
                  score: (Math.max(comment.upvotes || 0, existing.upvotes || 0)) - (Math.max(comment.downvotes || 0, existing.downvotes || 0))
                };
              }
            }
          });
        } catch (fetchErr) {
          console.error('Error fetching comments:', fetchErr);
        } finally {
          isLoading.value = false;
        }
      }, 500);
      
    } catch (error) {
      console.error('Error loading comments:', error);
      isLoading.value = false;
    }
  }

  // Create a comment
  async function createComment(data: {
    postId: string;
    communityId: string;
    content: string;
    parentId?: string;
  }) {
    try {
      // Validate required fields
      if (!data.postId) {
        throw new Error('postId is required but was empty or undefined');
      }
      if (!data.communityId) {
        throw new Error('communityId is required but was empty or undefined');
      }
      if (!data.content || !data.content.trim()) {
        throw new Error('content is required');
      }
      
      // Get current user
      const currentUser = getCurrentUser();
      
      const commentData = {
        postId: data.postId,
        communityId: data.communityId,
        authorId: currentUser.id,
        authorName: generatePseudonym(data.postId, currentUser.id),
        content: data.content,
        parentId: data.parentId
      };
      
      const comment = await CommentService.createComment(commentData);

      // Add to local array
      const exists = comments.value.find(c => c.id === comment.id);
      if (!exists) {
        comments.value.unshift(comment);
      }
      
      return comment;
    } catch (error) {
      console.error('Error creating comment:', error);
      throw error;
    }
  }

  // Upvote a comment
  async function upvoteComment(commentId: string) {
    try {
      const currentUser = getCurrentUser();
      const wasUpvoted = hasUpvoted(commentId);
      const wasDownvoted = hasDownvoted(commentId);

      // Update localStorage first (optimistic UI)
      if (wasUpvoted) {
        const votedComments = JSON.parse(localStorage.getItem('upvoted-comments') || '[]');
        const filtered = votedComments.filter((id: string) => id !== commentId);
        localStorage.setItem('upvoted-comments', JSON.stringify(filtered));
      } else {
        const votedComments = JSON.parse(localStorage.getItem('upvoted-comments') || '[]');
        if (!votedComments.includes(commentId)) {
          votedComments.push(commentId);
          localStorage.setItem('upvoted-comments', JSON.stringify(votedComments));
        }
        // Remove from downvoted if exists
        if (wasDownvoted) {
          const downvotedComments = JSON.parse(localStorage.getItem('downvoted-comments') || '[]');
          const filtered = downvotedComments.filter((id: string) => id !== commentId);
          localStorage.setItem('downvoted-comments', JSON.stringify(filtered));
        }
      }

      // Optimistically update local state
      const comment = comments.value.find(c => c.id === commentId);
      if (comment) {
        if (wasUpvoted) {
          comment.upvotes = Math.max(0, comment.upvotes - 1);
        } else {
          comment.upvotes++;
          if (wasDownvoted) {
            comment.downvotes = Math.max(0, comment.downvotes - 1);
          }
        }
        comment.score = comment.upvotes - comment.downvotes;
      }

      voteVersion.value++;

      // Persist to Gun.js
      await CommentService.voteOnComment(commentId, 'up', currentUser.id);
    } catch (error) {
      voteVersion.value++;
      console.error('Error upvoting comment:', error);
      throw error;
    }
  }

  // Downvote a comment
  async function downvoteComment(commentId: string) {
    try {
      const currentUser = getCurrentUser();
      const wasUpvoted = hasUpvoted(commentId);
      const wasDownvoted = hasDownvoted(commentId);

      // Update localStorage first (optimistic UI)
      if (wasDownvoted) {
        const votedComments = JSON.parse(localStorage.getItem('downvoted-comments') || '[]');
        const filtered = votedComments.filter((id: string) => id !== commentId);
        localStorage.setItem('downvoted-comments', JSON.stringify(filtered));
      } else {
        const votedComments = JSON.parse(localStorage.getItem('downvoted-comments') || '[]');
        if (!votedComments.includes(commentId)) {
          votedComments.push(commentId);
          localStorage.setItem('downvoted-comments', JSON.stringify(votedComments));
        }
        // Remove from upvoted if exists
        if (wasUpvoted) {
          const upvotedComments = JSON.parse(localStorage.getItem('upvoted-comments') || '[]');
          const filtered = upvotedComments.filter((id: string) => id !== commentId);
          localStorage.setItem('upvoted-comments', JSON.stringify(filtered));
        }
      }

      // Optimistically update local state
      const comment = comments.value.find(c => c.id === commentId);
      if (comment) {
        if (wasDownvoted) {
          comment.downvotes = Math.max(0, comment.downvotes - 1);
        } else {
          comment.downvotes++;
          if (wasUpvoted) {
            comment.upvotes = Math.max(0, comment.upvotes - 1);
          }
        }
        comment.score = comment.upvotes - comment.downvotes;
      }

      voteVersion.value++;

      // Persist to Gun.js
      await CommentService.voteOnComment(commentId, 'down', currentUser.id);
    } catch (error) {
      voteVersion.value++;
      console.error('Error downvoting comment:', error);
      throw error;
    }
  }

  // Helper functions to check vote status
  function hasUpvoted(commentId: string): boolean {
    const votedComments = JSON.parse(localStorage.getItem('upvoted-comments') || '[]');
    return votedComments.includes(commentId);
  }

  function hasDownvoted(commentId: string): boolean {
    const votedComments = JSON.parse(localStorage.getItem('downvoted-comments') || '[]');
    return votedComments.includes(commentId);
  }

  // Clear comments
  function clearComments() {
    comments.value = [];
  }

  return {
    comments,
    isLoading,
    voteVersion,
    loadCommentsForPost,
    createComment,
    upvoteComment,
    downvoteComment,
    hasUpvoted,
    hasDownvoted,
    clearComments
  };
});