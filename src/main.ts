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

type CleanupLevel = 'none' | 'light' | 'aggressive' | 'emergency';

/**
 * Give the memory watchdog something to actually release.
 *
 * The watchdog has always exposed an `onCleanup` registry, but nothing ever
 * registered with it, so every pressure level — emergency included — only evicted
 * the Gun graph while app-level state (cached posts, community data, trust
 * certificates, the store maps) grew for the life of the session. These handlers
 * close that gap. Everything dropped here is re-derivable from Gun or the relay,
 * so cleanup costs a refetch, never correctness.
 *
 * Imports are dynamic and each handler is independently guarded: a failure to
 * trim one subsystem must not prevent the others from being trimmed.
 */
function registerMemoryCleanupHandlers(watchdog: { onCleanup: (cb: (level: CleanupLevel) => void) => () => void }) {
  watchdog.onCleanup((level) => {
    if (level === 'none') return;

    void (async () => {
      try {
        const { PostService } = await import('./services/postService');
        PostService.trimCaches(level);
      } catch (e) { console.warn('[Cleanup] PostService trim failed:', e); }

      try {
        const { CommunityService } = await import('./services/communityService');
        CommunityService.trimCaches(level);
      } catch (e) { console.warn('[Cleanup] CommunityService trim failed:', e); }

      try {
        const { TrustService } = await import('./services/trustService');
        TrustService.trimCaches(level);
      } catch (e) { console.warn('[Cleanup] TrustService trim failed:', e); }

      try {
        const { ModerationService } = await import('./services/moderationService');
        ModerationService.trimCaches(level);
      } catch (e) { console.warn('[Cleanup] ModerationService trim failed:', e); }

      // Store maps: only shrink once pressure is real. At `light` the bounded
      // caches above are enough, and trimming the feed the user is reading would
      // cost a visible refetch for no benefit.
      if (level === 'aggressive' || level === 'emergency') {
        try {
          const { usePostStore } = await import('./stores/postStore');
          const { usePollStore } = await import('./stores/pollStore');
          const removedPosts = usePostStore().trimPostsToVisible();
          const removedPolls = usePollStore().trimPollsToVisible();
          if (removedPosts || removedPolls) {
            console.info(`[Cleanup] Trimmed ${removedPosts} posts / ${removedPolls} polls from stores`);
          }
        } catch (e) { console.warn('[Cleanup] Store trim failed:', e); }
      }

      if (level === 'emergency') {
        try {
          const { useCommentStore } = await import('./stores/commentStore');
          useCommentStore().clearComments();
        } catch (e) { console.warn('[Cleanup] Comment clear failed:', e); }
      }
    })();
  });
}

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
  // Native-shell (Capacitor) integration: hardware back button, lifecycle.
  // No-op in the browser.
  import('./native/capacitorApp').then(({ initCapacitorApp }) => {
    initCapacitorApp(router).catch(e => console.warn('[Init] Capacitor App init failed:', e));
  }).catch(() => { /* not in native shell */ });
  // Push notifications — no-op until Firebase is configured and enabled (M5).
  import('./native/pushNotifications').then(({ initPushNotifications }) => {
    initPushNotifications().catch(e => console.warn('[Init] Push init failed:', e));
  }).catch(() => { /* not in native shell */ });

  // Defer after first paint
  setTimeout(() => {
    import('./services/gunService').then(({ GunService }) => {
      GunService.initialize();
      // Probe all preset relays in the background; live ones are added to Gun dynamically
      GunService.probePresetsAndExpand().catch(e => console.warn('[Init] GunService probe failed:', e));
    }).catch(e => console.error('[Init] GunService failed:', e));
    import('./services/ipfsService').then(({ IPFSService }) => IPFSService.initialize()).catch(e => console.error('[Init] IPFSService failed:', e));
    import('./services/memoryWatchdogService').then(({ MemoryWatchdogService }) => {
      registerMemoryCleanupHandlers(MemoryWatchdogService);
      MemoryWatchdogService.start();
    }).catch(e => console.error('[Init] MemoryWatchdog failed:', e));
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
