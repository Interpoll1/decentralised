import { GunService } from './gunService';
import { CryptoService } from './cryptoService';
import { AuditService } from './auditService';
import { PostService } from './postService';

function getGun() {
  return GunService.getGun();
}

export interface Comment {
  id: string;
  postId: string;
  communityId: string;
  authorId: string;
  authorName: string;
  content: string;
  parentId?: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number;
  edited?: boolean;
  editedAt?: number;
}

export interface CreateCommentData {
  postId: string;
  communityId: string;
  authorId: string;
  authorName: string;
  content: string;
  parentId?: string;
}

/**
 * Create a new comment
 */
export async function createComment(data: CreateCommentData): Promise<Comment> {
  const commentId = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = Date.now();

  const comment: Comment = {
    id: commentId,
    postId: data.postId,
    communityId: data.communityId,
    authorId: data.authorId,
    authorName: data.authorName,
    content: data.content,
    parentId: data.parentId || undefined,
    createdAt: timestamp,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    edited: false
  };

  return new Promise((resolve, reject) => {
    const commentNode = getGun().get('comments').get(commentId);
    
    // Set each field individually (Gun.js prefers this approach)
    commentNode.get('id').put(commentId);
    commentNode.get('postId').put(data.postId);
    commentNode.get('communityId').put(data.communityId);
    commentNode.get('authorId').put(data.authorId);
    commentNode.get('authorName').put(data.authorName);
    commentNode.get('content').put(data.content);
    
    if (data.parentId) {
      commentNode.get('parentId').put(data.parentId);
    }
    
    commentNode.get('createdAt').put(timestamp);
    commentNode.get('upvotes').put(0);
    commentNode.get('downvotes').put(0);
    commentNode.get('score').put(0);
    commentNode.get('edited').put(false);

    // Add to post's comments index
    getGun().get('posts')
      .get(data.postId)
      .get('comments')
      .set({ commentId, createdAt: timestamp });
    
    setTimeout(() => {
      // Audit receipt (fire-and-forget)
      (async () => {
        try {
          const contentHash = CryptoService.hash(
            JSON.stringify({
              id: comment.id,
              postId: comment.postId,
              communityId: comment.communityId,
              authorId: comment.authorId,
              createdAt: comment.createdAt,
              content: comment.content,
            })
          );

          await AuditService.logReceipt('comment', {
            commentId: comment.id,
            postId: comment.postId,
            communityId: comment.communityId,
            authorId: comment.authorId,
            createdAt: comment.createdAt,
            contentHash,
          });
        } catch (_error) {
          // Non-fatal: audit logging failed
        }
      })();

      // Bump comment count on the associated post (best-effort)
      (async () => {
        try {
          await PostService.incrementCommentCount(data.postId, data.communityId);
        } catch (_err) {
          // Non-fatal: comment count increment failed
        }
      })();

      resolve(comment);
    }, 100);
  });
}

/**
 * Get a single comment by ID
 */
export async function getComment(commentId: string): Promise<Comment | null> {
  return new Promise((resolve) => {
    getGun().get('comments')
      .get(commentId)
      .once((data) => {
        if (data && data.id) {
          resolve(data as Comment);
        } else {
          resolve(null);
        }
      });
  });
}

/**
 * Subscribe to real-time updates for comments in a post
 */
export function subscribeToCommentsInPost(
  postId: string,
  callback: (comment: Comment) => void
): void {
  getGun().get('posts')
    .get(postId)
    .get('comments')
    .map()
    .on((data: any) => {
      if (data && data.commentId) {
        // Fetch the full comment data
        getGun().get('comments')
          .get(data.commentId)
          .on((commentData: any) => {
            if (commentData && commentData.id) {
              // Reconstruct the comment object
              // Use postId from the function parameter as fallback if Gun.js doesn't return it
              const comment: Comment = {
                id: commentData.id,
                postId: commentData.postId || postId,
                communityId: commentData.communityId,
                authorId: commentData.authorId,
                authorName: commentData.authorName,
                content: commentData.content,
                // CRITICAL: Only set parentId if it actually exists (not null, undefined, or empty string)
                parentId: commentData.parentId && commentData.parentId !== 'null' && commentData.parentId !== '' ? commentData.parentId : undefined,
                createdAt: commentData.createdAt,
                upvotes: commentData.upvotes || 0,
                downvotes: commentData.downvotes || 0,
                score: commentData.score || 0,
                edited: commentData.edited || false,
                editedAt: commentData.editedAt
              };
              callback(comment);
            }
          });
      }
    });
}

/**
 * Get all comments for a post (one-time fetch)
 */
export async function getAllCommentsInPost(postId: string): Promise<Comment[]> {
  return new Promise((resolve) => {
    const comments: Comment[] = [];
    const seen = new Set<string>();

    getGun().get('posts')
      .get(postId)
      .get('comments')
      .map()
      .once((data: any) => {
        if (data && data.commentId && !seen.has(data.commentId)) {
          seen.add(data.commentId);
          
          getGun().get('comments')
            .get(data.commentId)
            .once((commentData: any) => {
              if (commentData && commentData.id) {
                const comment: Comment = {
                  id: commentData.id,
                  postId: commentData.postId || postId,
                  communityId: commentData.communityId,
                  authorId: commentData.authorId,
                  authorName: commentData.authorName,
                  content: commentData.content,
                  // CRITICAL: Only set parentId if it actually exists (not null, undefined, or empty string)
                  parentId: commentData.parentId && commentData.parentId !== 'null' && commentData.parentId !== '' ? commentData.parentId : undefined,
                  createdAt: commentData.createdAt,
                  upvotes: commentData.upvotes || 0,
                  downvotes: commentData.downvotes || 0,
                  score: commentData.score || 0,
                  edited: commentData.edited || false,
                  editedAt: commentData.editedAt
                };
                comments.push(comment);
              }
            });
        }
      });

    // Wait for all comments to load
    setTimeout(() => {
      resolve(comments);
    }, 1500);
  });
}

/**
 * Get replies to a comment
 */
export async function getReplies(parentCommentId: string): Promise<Comment[]> {
  return new Promise((resolve) => {
    const replies: Comment[] = [];
    const seen = new Set<string>();

    getGun().get('comments')
      .map()
      .once((comment: any) => {
        if (
          comment && 
          comment.id && 
          comment.parentId === parentCommentId &&
          !seen.has(comment.id)
        ) {
          seen.add(comment.id);
          replies.push(comment as Comment);
        }
      });

    setTimeout(() => {
      resolve(replies.sort((a, b) => b.score - a.score));
    }, 500);
  });
}

/**
 * Vote on a comment
 */
export async function voteOnComment(
  commentId: string,
  voteType: 'up' | 'down',
  userId: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Get current comment data
    getGun().get('comments')
      .get(commentId)
      .once((comment: any) => {
        if (!comment || !comment.id) {
          reject(new Error('Comment not found'));
          return;
        }

        const voteKey = `vote_${userId}_${commentId}`;
        
        // Check existing vote
        getGun().get('votes')
          .get(voteKey)
          .once((existingVote: any) => {
            let upvotes = comment.upvotes || 0;
            let downvotes = comment.downvotes || 0;

            // Remove old vote if exists
            if (existingVote && existingVote.type) {
              if (existingVote.type === 'up') {
                upvotes = Math.max(0, upvotes - 1);
              } else if (existingVote.type === 'down') {
                downvotes = Math.max(0, downvotes - 1);
              }
            }

            // Add new vote (or toggle off if same vote)
            if (!existingVote || existingVote.type !== voteType) {
              if (voteType === 'up') {
                upvotes++;
              } else {
                downvotes++;
              }

              // Store the vote
              getGun().get('votes')
                .get(voteKey)
                .put({
                  userId,
                  commentId,
                  type: voteType,
                  timestamp: Date.now()
                });
            } else {
              // Toggle off - remove vote
              getGun().get('votes')
                .get(voteKey)
                .put(null);
            }

            const score = upvotes - downvotes;

            // Update comment - use .put() on the parent node with all fields
            const commentNode = getGun().get('comments').get(commentId);
            
            // Update vote counts
            commentNode.put({
              upvotes: upvotes,
              downvotes: downvotes,
              score: score
            }, (ack: any) => {
              if (ack.err) {
                reject(new Error(ack.err));
              } else {
                resolve();
              }
            });
          });
      });
  });
}

/**
 * Edit a comment
 */
export async function editComment(commentId: string, newContent: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getGun().get('comments')
      .get(commentId)
      .once((comment: any) => {
        if (!comment || !comment.id) {
          reject(new Error('Comment not found'));
          return;
        }

        getGun().get('comments')
          .get(commentId)
          .get('content')
          .put(newContent);

        getGun().get('comments')
          .get(commentId)
          .get('edited')
          .put(true);

        getGun().get('comments')
          .get(commentId)
          .get('editedAt')
          .put(Date.now());

        resolve();
      });
  });
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    getGun().get('comments')
      .get(commentId)
      .once((comment: any) => {
        if (!comment || !comment.id) {
          reject(new Error('Comment not found'));
          return;
        }

        // Mark as deleted instead of actually deleting
        getGun().get('comments')
          .get(commentId)
          .get('content')
          .put('[deleted]');

        getGun().get('comments')
          .get(commentId)
          .get('deleted')
          .put(true);

        resolve();
      });
  });
}

/**
 * Get user's vote on a comment
 */
export async function getUserVote(
  commentId: string,
  userId: string
): Promise<'up' | 'down' | null> {
  return new Promise((resolve) => {
    const voteKey = `vote_${userId}_${commentId}`;
    
    getGun().get('votes')
      .get(voteKey)
      .once((vote: any) => {
        if (vote && vote.type) {
          resolve(vote.type as 'up' | 'down');
        } else {
          resolve(null);
        }
      });
  });
}

/**
 * Get comment count for a post
 */
export async function getCommentCount(postId: string): Promise<number> {
  return new Promise((resolve) => {
    let count = 0;
    const seen = new Set<string>();

    getGun().get('posts')
      .get(postId)
      .get('comments')
      .map()
      .once((commentRef: any) => {
        if (commentRef && commentRef.ref && !seen.has(commentRef.ref)) {
          seen.add(commentRef.ref);
          count++;
        }
      });

    setTimeout(() => {
      resolve(count);
    }, 500);
  });
}

// Export as CommentService object for compatibility
export const CommentService = {
  createComment,
  getComment,
  subscribeToCommentsInPost,
  getAllCommentsInPost,
  getReplies,
  voteOnComment,
  editComment,
  deleteComment,
  getUserVote,
  getCommentCount
};