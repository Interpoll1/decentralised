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

  // Strip development-only logging from production bundles. `pure` calls are
  // only eliminated by the minifier, which runs on `vite build` and not in dev,
  // so logs stay available while developing. console.warn and console.error are
  // deliberately kept — they carry real diagnostics for users and support.
  esbuild: {
    pure: ['console.log', 'console.debug'],
  },
  plugins: [
    vue(),
    spaRouteFallbackPlugin(),
    ...(isNativeBuild ? [] : [
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
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
          // Ionic vendor chunk ~1.1 MB — raise limit so SW caches it
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // Runtime cache for relay REST feed endpoints (stale-while-revalidate)
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
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },

  optimizeDeps: {
    // Pre-bundle these for instant dev cold starts
    include: [
      'vue', 'vue-router', 'pinia',
      '@ionic/vue',
      'buffer', 'os-browserify/browser',
      'ionicons/icons',
    ],
    // Skip dead deps and heavy async-only libs from the dep scan
    exclude: [
      'ipfs-core',            // dead dep — ipfsService.ts never imports it
      'libp2p-webrtc-star',   // dead dep — never imported anywhere
    ],
    esbuildOptions: { define: { global: 'globalThis' } },
  },

  build: {
    sourcemap: false,
    assetsDir: 'assets2',
    chunkSizeWarningLimit: 600,
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    // Per-chunk CSS — each lazy component only loads its own stylesheet
    cssCodeSplit: true,
    // Skip gzip size report — saves 2-3s per build, misleading anyway
    reportCompressedSize: false,
    commonjsOptions: { transformMixedEsModules: true },

    rollupOptions: {
      // Dead deps: in package.json but never imported — exclude from bundle entirely
      external: (id) =>
        id === 'ipfs-core' ||
        id === 'libp2p-webrtc-star',

      onwarn(warning, warn) {
        if (warning.code === 'SOURCEMAP_ERROR')    return;
        if (warning.code === 'CIRCULAR_DEPENDENCY') return;
        warn(warning);
      },

      output: {
        chunkFileNames:  'assets2/[name]-[hash].js',
        entryFileNames:  'assets2/[name]-[hash].js',
        assetFileNames:  'assets2/[name]-[hash].[ext]',

        manualChunks(id) {
          // Dead — never actually imported, just in package.json
          if (
            id.includes('node_modules/ipfs-core') ||
            id.includes('node_modules/libp2p-webrtc-star')
          ) return 'vendor-dead';

          // Ionic UI ~1.1 MB — own cache key, independent of app logic changes
          if (id.includes('node_modules/@ionic')) return 'vendor-ionic';

          // Ionicons — SVG icon data, split from Ionic components so
          // icon tree-shaking doesn't bust the component chunk cache
          if (id.includes('node_modules/ionicons')) return 'vendor-ionicons';

          // Image compression — only used in ipfsService (dynamic import),
          // never on the critical path
          if (id.includes('node_modules/browser-image-compression')) return 'vendor-image';

          // Crypto / keys — only needed at post-create time (signing)
          // and identity setup. Already behind dynamic import() in postService.
          if (
            id.includes('node_modules/@noble') ||
            id.includes('node_modules/bip39')  ||
            id.includes('node_modules/@scure')
          ) return 'vendor-crypto';

          // GunDB — relay/SEA code isolated from Vue runtime chunk
          if (id.includes('node_modules/gun')) return 'vendor-gun';

          // Vue ecosystem — rarely changes, long cache lifetime
          if (
            id.includes('node_modules/vue')       ||
            id.includes('node_modules/pinia')      ||
            id.includes('node_modules/vue-router') ||
            id.includes('node_modules/@vue')       ||
            id.includes('node_modules/@unhead')
          ) return 'vendor-vue';

          // Remaining node_modules — one shared chunk avoids HTTP/2 stream explosion
          if (id.includes('node_modules')) return 'vendor-misc';

          // App code: Rollup handles route-level splitting automatically
          // via dynamic imports in router/index.ts and defineAsyncComponent.
        },
      },
    },
  },

  server: {
    fs: { strict: false },
  },
});