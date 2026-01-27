// src/services/commentService.ts
import { GunService } from './gunService';

export interface Comment {
  id: string;
  postId: string;
  parentId?: string; // For nested replies
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number;
  replyCount: number;
}

export class CommentService {
  // Create comment or reply
  static async createComment(
    comment: Omit<Comment, 'id' | 'createdAt' | 'upvotes' | 'downvotes' | 'score' | 'replyCount'>
  ): Promise<Comment> {
    const gun = GunService.getGun();
    
    const newComment: Comment = {
      ...comment,
      id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      upvotes: 0,
      downvotes: 0,
      score: 0,
      replyCount: 0
    };

    // Store in Gun
    await gun.get('comments').get(newComment.id).put(newComment);
    
    // Add to post's comment list
    await gun.get('posts').get(newComment.postId).get('comments').set(
      gun.get('comments').get(newComment.id)
    );

    // If it's a reply, add to parent's reply list
    if (newComment.parentId) {
      await gun.get('comments').get(newComment.parentId).get('replies').set(
        gun.get('comments').get(newComment.id)
      );
      
      // Increment parent's reply count
      const parent = await this.getComment(newComment.parentId);
      if (parent) {
        await gun.get('comments').get(newComment.parentId).get('replyCount')
          .put(parent.replyCount + 1);
      }
    }

    // Increment post's comment count
    const post = await gun.get('posts').get(newComment.postId).once().then();
    if (post) {
      await gun.get('posts').get(newComment.postId).get('commentCount')
        .put((post.commentCount || 0) + 1);
    }

    console.log('✅ Comment created:', newComment.id);
    return newComment;
  }

  // Subscribe to comments for a post
  static subscribeToComments(postId: string, callback: (comment: Comment) => void) {
    const gun = GunService.getGun();
    
    gun.get('posts').get(postId).get('comments').map().on((data: any) => {
      if (data && !data._) {
        callback(data);
      }
    });
  }

  // Subscribe to replies for a comment
  static subscribeToReplies(commentId: string, callback: (comment: Comment) => void) {
    const gun = GunService.getGun();
    
    gun.get('comments').get(commentId).get('replies').map().on((data: any) => {
      if (data && !data._) {
        callback(data);
      }
    });
  }

  // Get single comment
  static async getComment(commentId: string): Promise<Comment | null> {
    const gun = GunService.getGun();
    return await gun.get('comments').get(commentId).once().then();
  }

  // Vote on comment
  static async voteOnComment(commentId: string, direction: 'up' | 'down'): Promise<void> {
    const gun = GunService.getGun();
    const comment = await this.getComment(commentId);
    
    if (!comment) return;

    const upvoteChange = direction === 'up' ? 1 : 0;
    const downvoteChange = direction === 'down' ? 1 : 0;

    await gun.get('comments').get(commentId).get('upvotes').put(comment.upvotes + upvoteChange);
    await gun.get('comments').get(commentId).get('downvotes').put(comment.downvotes + downvoteChange);
    await gun.get('comments').get(commentId).get('score').put(
      (comment.upvotes + upvoteChange) - (comment.downvotes + downvoteChange)
    );

    console.log(`✅ Vote on comment: ${direction} on ${commentId}`);
  }

  // Build comment tree (for nested display)
  static async buildCommentTree(postId: string): Promise<Comment[]> {
    return new Promise((resolve) => {
      const comments: Comment[] = [];
      const gun = GunService.getGun();

      gun.get('posts').get(postId).get('comments').map().once((data: any) => {
        if (data && !data._) {
          comments.push(data);
        }
      });

      // Wait a bit for all comments to load
      setTimeout(() => {
        // Sort by score (top comments first)
        comments.sort((a, b) => b.score - a.score);
        resolve(comments);
      }, 1000);
    });
  }
}