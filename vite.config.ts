import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import crypto from 'crypto';

function getBuildHash(): string {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    return commit;
  } catch {
    const now = new Date().toISOString();
    const hash = crypto.createHash('sha256').update(now).digest('hex').substring(0, 7);
    return hash;
  }
}

function spaRouteFallbackPlugin() {
  const blockedPrefixes = ['/src/', '/node_modules/', '/@vite/', '/@fs/', '/assets', '/public/'];

  return {
    name: 'spa-route-fallback',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url?.split('?')[0] ?? '/';
        const accepts = String(req.headers?.accept || '');
        if (
          !url ||
          url === '/' ||
          req.method !== 'GET' ||
          !accepts.includes('text/html') ||
          blockedPrefixes.some((prefix) => url.startsWith(prefix)) ||
          path.extname(url)
        ) {
          next();
          return;
        }

        try {
          const html = await fs.readFile(path.resolve(__dirname, 'index.html'), 'utf8');
          const transformed = await server.transformIndexHtml(url, html, req.originalUrl);
          res.setHeader('Content-Type', 'text/html');
          res.statusCode = 200;
          res.end(transformed);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

// When building for the Capacitor native shell we disable the service worker:
// Workbox precache/navigateFallback fights Capacitor's local asset serving and
// causes stale-asset / blank-screen issues inside the WebView. Set via the
// `build:mobile` npm script (CAP_BUILD=1).
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
        // Precache the app shell so the app LOADS with no network. Dynamic
        // relay/Gun/API traffic is never precached — those go to the network.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/gun/, /^\/api/, /^\/oauth/, /^\/db/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // the ionic vendor chunk is ~1.1MB
      },
    }),
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: 'buffer',
      os: 'os-browserify/browser',
      path: 'path-browserify',
      stream: 'stream-browserify'
    },
  },
  define: {
    'process.env': {},
    'process.platform': JSON.stringify('browser'),
    'process.versions': JSON.stringify({}),
    global: 'globalThis',
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(getBuildHash()),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  optimizeDeps: {
    exclude: ['@ionic/vue'],
    include: ['buffer', 'os-browserify/browser'],
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    }
  },
  build: {
    sourcemap: false,
    assetsDir: 'assets2',
    // 1. Raise warning threshold to reduce noise
    chunkSizeWarningLimit: 600,
    // 2. Target modern browsers — smaller output, no legacy polyfills
    target: 'es2020',
    // 3. Minification options
    minify: 'esbuild',
    cssMinify: true,
    commonjsOptions: {
      transformMixedEsModules: true
    },
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'SOURCEMAP_ERROR') return;
        if (warning.code === 'CIRCULAR_DEPENDENCY') return; // Gun.js has many
        warn(warning);
      },
      output: {
        // 4. Manual chunk splitting — breaks up that 1.5MB vendor bundle
        manualChunks(id) {
          // Gun.js into its own chunk
          if (id.includes('node_modules/gun')) {
            return 'vendor-gun';
          }
          // IPFS into its own chunk
          if (id.includes('node_modules/ipfs') || id.includes('node_modules/ipfs-core')) {
            return 'vendor-ipfs';
          }
          // Ionic UI into its own chunk (large, but rarely changes)
          if (id.includes('node_modules/@ionic')) {
            return 'vendor-ionic';
          }
          // Crypto libs together
          if (id.includes('node_modules/@noble') || id.includes('node_modules/bip39')) {
            return 'vendor-crypto';
          }
          // Vue ecosystem together
          if (id.includes('node_modules/vue') || id.includes('node_modules/pinia') || id.includes('node_modules/vue-router')) {
            return 'vendor-vue';
          }
          // Everything else in node_modules → general vendor chunk
          if (id.includes('node_modules')) {
            return 'vendor-misc';
          }
        },
        // 5. Consistent file naming
        chunkFileNames: 'assets2/[name]-[hash].js',
        entryFileNames: 'assets2/[name]-[hash].js',
        assetFileNames: 'assets2/[name]-[hash].[ext]',
      }
    }
  },
  server: {
    fs: {
      strict: false
    }
  }
});