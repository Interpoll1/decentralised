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
import { recordError, reportFatal } from './utils/errorReporting';

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

// Vue render/lifecycle errors that no error boundary caught reach here — treat
// them as fatal so the app-level fallback screen can take over. (Errors a
// boundary handles call onErrorCaptured and never propagate here.)
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue error]', info, err);
  reportFatal(`vue:${info}`, err);
};

// Raw runtime errors and dropped promise rejections: record for diagnostics
// only. The app emits many benign background rejections (Gun sync, relay
// probes), so these must NOT hijack the screen — the error boundary owns that.
window.addEventListener('error', (e) => {
  recordError('window.error', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  recordError('unhandledrejection', e.reason);
});

router.isReady().then(() => {
  try {
    app.mount('#app');
  } catch (err) {
    // Mounting itself failed — Vue can't render the fallback, so inject a
    // minimal static recovery screen directly.
    recordError('mount', err);
    renderStaticFatal();
    return;
  }
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
    // Restore the last local snapshot (offline resilience / network re-seed) and
    // start automatic snapshot persistence.
    (async () => {
      try {
        const { SnapshotAutoService } = await import('./services/snapshotAutoService');
        const restored = await SnapshotAutoService.restore();
        if (restored) {
          try {
            const { useChainStore } = await import('./stores/chainStore');
            await useChainStore().loadBlocks();
          } catch { /* store not ready; blocks load on next chain read */ }
        }
        SnapshotAutoService.initialize();
      } catch (err) {
        console.warn('[Startup] Snapshot auto-restore failed:', err);
      }
    })();
  }, 0);
})

// Last-resort recovery screen shown only if Vue itself fails to mount (so the
// AppErrorBoundary component can't render). Kept dependency-free on purpose.
function renderStaticFatal(): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#141420;color:#e6e6ef;font-family:system-ui,sans-serif;text-align:center">
      <div style="max-width:420px">
        <div style="font-size:40px">⚠️</div>
        <h1 style="font-size:20px;margin:12px 0 8px">Something went wrong</h1>
        <p style="font-size:14px;color:#b7b7c8;line-height:1.5;margin:0 0 20px">The app couldn't start. Reloading usually fixes it.</p>
        <button onclick="location.reload()" style="border:1px solid #5b5bff;background:#5b5bff;color:#fff;font-size:14px;padding:10px 18px;border-radius:10px;min-height:44px;cursor:pointer">Reload</button>
      </div>
    </div>`;
}
