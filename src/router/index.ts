// src/router/index.ts
import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/home'
  },
  {
    path: '/auth/callback',
    name: 'AuthCallback',
    component: () => import('../views/AuthCallbackPage.vue')
  },
  {
    path: '/home',
    name: 'Home',
    component: () => import('../views/HomePage.vue')
  },
  {
    path: '/community/:communityId',
    name: 'Community',
    component: () => import('../views/CommunityPage.vue'),
    props: route => ({ 
      communityId: route.params.communityId 
    })
  },
  {
    path: '/community/:communityId/create-post',
    name: 'CreatePost',
    component: () => import('../views/CreatePostPage.vue'),
    props: true
  },
  {
    path: '/community/:communityId/poll/:pollId',
    name: 'PollDetail',
    component: () => import('../views/PollDetailPage.vue'),
    props: true
  },
  {
    path: '/post/:postId',
    name: 'PostDetail',
    component: () => import('../views/PostDetailPage.vue'),
    props: true
  },
  {
    path: '/create-community',
    name: 'CreateCommunity',
    component: () => import('../views/CreateCommunityPage.vue')
  },
  {
    path: '/create-poll',
    name: 'CreatePoll',
    component: () => import('../views/CreatePollPage.vue')
  },
  {
    path: '/profile',
    name: 'Profile',
    component: () => import('../views/ProfilePage.vue')
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/SettingsPage.vue')
  },
  {
    path: '/chain-explorer',
    name: 'ChainExplorer',
    component: () => import('../views/ChainExplorerPage.vue')
  },
  {
    path: '/vote/:pollId',
    name: 'Vote',
    component: () => import('../views/VotePage.vue'),
    props: true,
  },
  {
    path: '/results/:pollId',
    name: 'Results',
    component: () => import('../views/ResultsPage.vue'),
    props: true,
  },
  {
    path: '/receipt/:mnemonic?',
    name: 'Receipt',
    component: () => import('../views/ReceiptPage.vue')
  },
  // Catch-all route for 404
  {
    path: '/:pathMatch(.*)*',
    redirect: '/home'
  }
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

router.beforeEach((_to, _from, next) => {
  next();
});

export default router;