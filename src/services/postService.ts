// src/services/postService.ts
import { GunService } from './gunService';
import { IPFSService } from './ipfsService';

export interface Post {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  title: string;
  content: string;
  imageIPFS?: string;
  imageThumbnail?: string;
  createdAt: number;
  upvotes: number;
  downvotes: number;
  score: number; // upvotes - downvotes
  commentCount: number;
}

export class PostService {
  // Create post with optional image
  static async createPost(
    post: Omit<Post, 'id' | 'createdAt' | 'upvotes' | 'downvotes' | 'score' | 'commentCount'>,
    imageFile?: File
  ): Promise<Post> {
    const gun = GunService.getGun();
    
    // Upload image to IPFS if provided
    let imageData = undefined;
    if (imageFile) {
      imageData = await IPFSService.uploadImage(imageFile);
    }

    const newPost: Post = {
      id: `post-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      communityId: post.communityId || '',
      authorId: post.authorId || '',
      authorName: post.authorName || 'Anonymous',
      title: post.title || '',
      content: post.content || '',
      imageIPFS: imageData?.cid || '',
      imageThumbnail: imageData?.thumbnail || '',
      createdAt: Date.now(),
      upvotes: 0,
      downvotes: 0,
      score: 0,
      commentCount: 0
    };

    // Clean the post object - remove empty strings for optional fields
    const cleanPost: any = {
      id: newPost.id,
      communityId: newPost.communityId,
      authorId: newPost.authorId,
      authorName: newPost.authorName,
      title: newPost.title,
      content: newPost.content,
      createdAt: newPost.createdAt,
      upvotes: newPost.upvotes,
      downvotes: newPost.downvotes,
      score: newPost.score,
      commentCount: newPost.commentCount,
    };

    // Only add image fields if they exist
    if (newPost.imageIPFS) {
      cleanPost.imageIPFS = newPost.imageIPFS;
    }
    if (newPost.imageThumbnail) {
      cleanPost.imageThumbnail = newPost.imageThumbnail;
    }

    console.log('📝 Creating post with data:', cleanPost);

    try {
      // Store in Gun - individual path
      await GunService.put(`posts/${newPost.id}`, cleanPost);
      
      // Store in posts collection
      await new Promise<void>((resolve, reject) => {
        gun.get('posts').get(newPost.id).put(cleanPost, (ack: any) => {
          if (ack.err) {
            console.error('❌ Error saving post:', ack.err);
            reject(ack.err);
          } else {
            resolve();
          }
        });
      });
      
      // Add reference to community's post list
      await new Promise<void>((resolve, reject) => {
        gun.get('communities').get(newPost.communityId).get('posts').get(newPost.id).put(cleanPost, (ack: any) => {
          if (ack.err) {
            console.error('❌ Error adding post to community:', ack.err);
            reject(ack.err);
          } else {
            resolve();
          }
        });
      });
      
      console.log('✅ Post created:', newPost.id);
      return newPost;
    } catch (error) {
      console.error('❌ Error creating post:', error);
      throw error;
    }
  }

  // Subscribe to posts in a community
  static subscribeToPostsInCommunity(communityId: string, callback: (post: Post) => void) {
    const gun = GunService.getGun();
    
    console.log('📡 Subscribing to posts in community:', communityId);
    
    try {
      gun.get('communities').get(communityId).get('posts').map().on((data: any, key: string) => {
        if (data && typeof data === 'object' && data.id && data.title) {
          // Filter out Gun metadata
          if (!key.startsWith('_')) {
            const cleanPost: Post = {
              id: data.id || '',
              communityId: data.communityId || communityId,
              authorId: data.authorId || '',
              authorName: data.authorName || 'Anonymous',
              title: data.title || '',
              content: data.content || '',
              imageIPFS: data.imageIPFS || undefined,
              imageThumbnail: data.imageThumbnail || undefined,
              createdAt: data.createdAt || Date.now(),
              upvotes: data.upvotes || 0,
              downvotes: data.downvotes || 0,
              score: data.score || 0,
              commentCount: data.commentCount || 0,
            };
            
            console.log('📥 Post received:', cleanPost.title);
            callback(cleanPost);
          }
        }
      });
      
      console.log('✅ Post subscription active');
    } catch (error) {
      console.error('❌ Error subscribing to posts:', error);
    }
  }

  // Get all posts in community (one-time fetch)
  static async getAllPostsInCommunity(communityId: string): Promise<Post[]> {
    const gun = GunService.getGun();
    const posts: Post[] = [];
    
    return new Promise((resolve) => {
      console.log('📡 Fetching all posts in community:', communityId);
      
      const seen = new Set<string>();
      
      gun.get('communities').get(communityId).get('posts').map().once((data: any, key: string) => {
        if (data && data.id && data.title && !seen.has(data.id)) {
          seen.add(data.id);
          
          const post: Post = {
            id: data.id || '',
            communityId: data.communityId || communityId,
            authorId: data.authorId || '',
            authorName: data.authorName || 'Anonymous',
            title: data.title || '',
            content: data.content || '',
            imageIPFS: data.imageIPFS || undefined,
            imageThumbnail: data.imageThumbnail || undefined,
            createdAt: data.createdAt || Date.now(),
            upvotes: data.upvotes || 0,
            downvotes: data.downvotes || 0,
            score: data.score || 0,
            commentCount: data.commentCount || 0,
          };
          
          posts.push(post);
          console.log('📥 Loaded post:', post.title);
        }
      });
      
      // Wait 2 seconds for Gun to sync
      setTimeout(() => {
        console.log(`✅ Loaded ${posts.length} posts`);
        resolve(posts);
      }, 2000);
    });
  }

  // Get single post
  static async getPost(postId: string): Promise<Post | null> {
    const gun = GunService.getGun();
    
    return new Promise((resolve) => {
      let resolved = false;
      
      // Try from posts collection
      gun.get('posts').get(postId).once((data: any) => {
        if (!resolved && data && data.id) {
          resolved = true;
          
          const post: Post = {
            id: data.id || '',
            communityId: data.communityId || '',
            authorId: data.authorId || '',
            authorName: data.authorName || 'Anonymous',
            title: data.title || '',
            content: data.content || '',
            imageIPFS: data.imageIPFS || undefined,
            imageThumbnail: data.imageThumbnail || undefined,
            createdAt: data.createdAt || Date.now(),
            upvotes: data.upvotes || 0,
            downvotes: data.downvotes || 0,
            score: data.score || 0,
            commentCount: data.commentCount || 0,
          };
          
          resolve(post);
        }
      });
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      }, 3000);
    });
  }

  // Vote on post (with blockchain verification)
  static async voteOnPost(postId: string, direction: 'up' | 'down', userId: string): Promise<void> {
    const gun = GunService.getGun();
    const post = await this.getPost(postId);
    
    if (!post) {
      console.error('❌ Post not found:', postId);
      return;
    }

    // Update vote counts
    const upvoteChange = direction === 'up' ? 1 : 0;
    const downvoteChange = direction === 'down' ? 1 : 0;
    
    const newUpvotes = post.upvotes + upvoteChange;
    const newDownvotes = post.downvotes + downvoteChange;
    const newScore = newUpvotes - newDownvotes;

    try {
      // Update in posts collection
      await gun.get('posts').get(postId).get('upvotes').put(newUpvotes);
      await gun.get('posts').get(postId).get('downvotes').put(newDownvotes);
      await gun.get('posts').get(postId).get('score').put(newScore);
      
      // Update in community's posts
      await gun.get('communities').get(post.communityId).get('posts').get(postId).get('upvotes').put(newUpvotes);
      await gun.get('communities').get(post.communityId).get('posts').get(postId).get('downvotes').put(newDownvotes);
      await gun.get('communities').get(post.communityId).get('posts').get(postId).get('score').put(newScore);
      
      // TODO: Add to blockchain for verification
      console.log(`✅ Vote recorded: ${direction} on ${postId}`);
    } catch (error) {
      console.error('❌ Error voting on post:', error);
      throw error;
    }
  }
}