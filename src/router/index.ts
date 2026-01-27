// src/router/index.ts
import { createRouter, createWebHistory } from '@ionic/vue-router';
import { RouteRecordRaw } from 'vue-router';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/home'
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

// Navigation guard for debugging
router.beforeEach((to, from, next) => {
  console.log(`🧭 Navigating from ${from.path} to ${to.path}`);
  next();
});

export default router;