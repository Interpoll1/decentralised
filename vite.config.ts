import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import crypto from 'crypto';

function getBuildHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return crypto.createHash('sha256').update(new Date().toISOString()).digest('hex').slice(0, 7);
  }
}

// Changes on every build. Used to give the service worker a fresh URL each
// deploy — see swRegisterInlinePlugin.
const BUILD_TIME = new Date().toISOString();
const BUILD_ID   = Date.now().toString(36);

/**
 * Registers the service worker from an inline <script> in index.html, at a
 * per-build URL (`/sw.js?v=<BUILD_ID>`).
 *
 * Why not vite-plugin-pwa's injectRegister: the host (Hostinger/LiteSpeed
 * behind Cloudflare) serves every .js with `max-age=31536000, immutable`,
 * including sw.js and registerSW.js — our .htaccess overrides are not applied.
 * Cloudflare then pins both at the edge for a year, so new builds are never
 * fetched and the old service worker keeps serving its old precache forever.
 *
 * index.html is the one entry point the host sends `no-cache` for (and CF
 * leaves uncached), so the registration must live inside it, and the SW URL
 * must differ per build — CF's cache key includes the query string, so a new
 * ?v= is a guaranteed cache miss.
 *
 * updateViaCache: 'none' additionally stops the browser's own HTTP cache from
 * satisfying update checks with the immutable copy.
 */
function swRegisterInlinePlugin() {
  return {
    name: 'sw-register-inline',
    apply: 'build' as const,
    transformIndexHtml() {
      if (isNativeBuild) return;
      return [{
        tag: 'script',
        injectTo: 'body' as const,
        children: [
          `if ('serviceWorker' in navigator) {`,
          `  window.addEventListener('load', function () {`,
          `    navigator.serviceWorker`,
          `      .register('/sw.js?v=${BUILD_ID}', { scope: '/', updateViaCache: 'none' })`,
          `      .then(function (r) { r.update(); })`,
          `      .catch(function () {});`,
          `  });`,
          `}`,
        ].join('\n'),
      }];
    },
  };
}

function spaRouteFallbackPlugin() {
  const blockedPrefixes = ['/src/', '/node_modules/', '/@vite/', '/@fs/', '/assets', '/public/'];
  return {
    name: 'spa-route-fallback',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url     = req.url?.split('?')[0] ?? '/';
        const accepts = String(req.headers?.accept || '');
        if (
          !url || url === '/' || req.method !== 'GET' ||
          !accepts.includes('text/html') ||
          blockedPrefixes.some(p => url.startsWith(p)) ||
          path.extname(url)
        ) { next(); return; }
        try {
          const html        = await fs.readFile(path.resolve(__dirname, 'index.html'), 'utf8');
          const transformed = await server.transformIndexHtml(url, html, req.originalUrl);
          res.setHeader('Content-Type', 'text/html');
          res.statusCode = 200;
          res.end(transformed);
        } catch (e) { next(e); }
      });
    },
  };
}

const isNativeBuild = process.env.CAP_BUILD === '1';

export default defineConfig({
  base: '/',
  plugins: [
    vue(),
    spaRouteFallbackPlugin(),
    swRegisterInlinePlugin(),
    ...(isNativeBuild ? [] : [
      VitePWA({
        registerType: 'autoUpdate',
        // Registration is inlined into index.html instead — the emitted
        // registerSW.js is served immutable by the host and goes stale.
        injectRegister: null,
        manifest: {
          name: 'InterPoll',
          short_name: 'InterPoll',
          description: 'Decentralized, censorship-resistant polling & discussion',
          theme_color: '#141420',
          background_color: '#141420',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/gun/, /^\/api/, /^\/oauth/, /^\/db/],
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /\/api\/(posts|polls|communities|feed|comment-counts|trending-categories)/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'api-feed-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 },
              },
            },
          ],
        },
      }),
    ]),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer',
      os:     'os-browserify/browser',
      path:   'path-browserify',
      stream: 'stream-browserify',
    },
  },

  define: {
    'process.env':      {},
    'process.platform': JSON.stringify('browser'),
    'process.versions': JSON.stringify({}),
    global:             'globalThis',
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(getBuildHash()),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(BUILD_TIME),
  },

  optimizeDeps: {
    include: [
      'vue', 'vue-router', 'pinia',
      '@ionic/vue',
      'buffer', 'os-browserify/browser',
      'ionicons/icons',
    ],
    exclude: [
      'ipfs-core',
      'libp2p-webrtc-star',
    ],
    esbuildOptions: { define: { global: 'globalThis' } },
  },

  build: {
    sourcemap: false,
    assetsDir: 'assets2',
    chunkSizeWarningLimit: 600,
    // es2022: gun-shim.ts uses top-level await to load Gun from CDN
    target: 'es2022',
    minify: 'esbuild',
    cssMinify: true,
    cssCodeSplit: true,
    reportCompressedSize: false,
    commonjsOptions: { transformMixedEsModules: true },

    rollupOptions: {
      external: (id) => {
        if (id === 'ipfs-core' || id === 'libp2p-webrtc-star') return true;
        return false;
      },

      onwarn(warning, warn) {
        if (warning.code === 'SOURCEMAP_ERROR')     return;
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        warn(warning);
      },

      output: {
        chunkFileNames:  'assets2/[name]-[hash].js',
        entryFileNames:  'assets2/[name]-[hash].js',
        assetFileNames:  'assets2/[name]-[hash].[ext]',

        manualChunks(id) {
          if (
            id.includes('node_modules/ipfs-core') ||
            id.includes('node_modules/libp2p-webrtc-star')
          ) return 'vendor-dead';

          // Gun bundled via shim — gets its own cache key
          if (id.includes('node_modules/gun')) return 'vendor-gun';

          // Ionic UI — own cache key
          if (id.includes('node_modules/@ionic')) return 'vendor-ionic';

          // Ionicons SVG data
          if (id.includes('node_modules/ionicons')) return 'vendor-ionicons';

          // Image compression — only via dynamic import
          if (id.includes('node_modules/browser-image-compression')) return 'vendor-image';

          // Crypto / keys — signing only, already behind dynamic import()
          if (
            id.includes('node_modules/@noble') ||
            id.includes('node_modules/bip39')  ||
            id.includes('node_modules/@scure')
          ) return 'vendor-crypto';

          // Vue ecosystem — long cache lifetime
          if (
            id.includes('node_modules/vue')       ||
            id.includes('node_modules/pinia')      ||
            id.includes('node_modules/vue-router') ||
            id.includes('node_modules/@vue')       ||
            id.includes('node_modules/@unhead')
          ) return 'vendor-vue';

          // Signal Protocol — chat-only, must be lazy
          // Verify it's never eagerly imported: grep -r "signalProtocol" src --include="*.ts" | grep -v "dynamic\|import()"
          if (id.includes('signalProtocol')) return 'vendor-signal';

          if (id.includes('node_modules')) return 'vendor-misc';
        },
      },
    },
  },

  server: {
    fs: { strict: false },
  },
});






















