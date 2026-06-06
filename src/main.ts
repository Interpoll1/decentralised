import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';
import './style.css';
import App from './App.vue';
import router from './router';

// One-time migration
if (!localStorage.getItem('interpoll_migration_v2')) {
  localStorage.removeItem('seen-post-ids');
  localStorage.removeItem('seen-poll-ids');
  localStorage.setItem('interpoll_migration_v2', '1');
}

const app = createApp(App)
  .use(IonicVue)
  .use(createPinia())
  .use(router);

router.isReady().then(() => {
  app.mount('#app')
  // Defer after first paint
  setTimeout(() => {
    import('./services/gunService').then(({ GunService }) => {
      GunService.initialize();
      // Probe all preset relays in the background; live ones are added to Gun dynamically
      GunService.probePresetsAndExpand().catch(e => console.warn('[Init] GunService probe failed:', e));
    }).catch(e => console.error('[Init] GunService failed:', e));
    import('./services/ipfsService').then(({ IPFSService }) => IPFSService.initialize()).catch(e => console.error('[Init] IPFSService failed:', e));
    import('./services/memoryWatchdogService').then(({ MemoryWatchdogService }) => MemoryWatchdogService.start()).catch(e => console.error('[Init] MemoryWatchdog failed:', e));
    // Evict legacy/v2 posts from caches on startup
    (async () => {
      try {
        const { PostService } = await import('./services/postService');
        await PostService.evictLegacyPosts();
      } catch (e) {
        console.warn('Post eviction failed:', e);
      }
    })();
    // Run destructive purge of persisted legacy posts if user requested it
    (async () => {
      try {
        const { StorageService } = await import('./services/storageService');
        const gun = await import('./services/gunService');
        const removed = await StorageService.purgePersistedLegacyPosts(gun.GUN_NAMESPACE);
        if (removed > 0) console.info(`[Startup] Removed ${removed} persisted legacy posts`);
      } catch (err) {
        /* best-effort purge */
      }
    })();
  }, 0);
})
