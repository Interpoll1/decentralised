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
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
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
    target: 'es2020',
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






















