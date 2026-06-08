import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import fs from 'fs/promises';

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

/**
 * Serve GenosDB's self-contained `dist/` intact from a single location
 * (`<base>/genosdb/`) instead of bundling it. GenosDB resolves its own plugins
 * at runtime via `new URL('./*.min.js', import.meta.url)`, so all of them must
 * live together in one folder — bundling would split + hash them and break that
 * relative resolution. Dev serves them from node_modules; build copies the whole
 * folder verbatim into the output. Matches the app's dynamic import in
 * `src/services/gdbServices.ts`.
 */
function genosdbStaticPlugin() {
  const distDir = path.resolve(__dirname, 'node_modules/genosdb/dist');
  return {
    name: 'genosdb-static',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const match = (req.url?.split('?')[0] ?? '').match(/\/genosdb\/(.+\.js)$/);
        if (!match) return next();
        try {
          const file = await fs.readFile(path.join(distDir, match[1]));
          res.setHeader('Content-Type', 'application/javascript');
          res.end(file);
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      const outDir = path.resolve(__dirname, 'dist/genosdb');
      await fs.mkdir(outDir, { recursive: true });
      const files = (await fs.readdir(distDir)).filter((f) => f.endsWith('.js'));
      await Promise.all(
        files.map((f) => fs.copyFile(path.join(distDir, f), path.join(outDir, f)))
      );
    },
  };
}

export default defineConfig({
  // GitHub Pages serves project sites under /<repo>/. Build with GH_PAGES=1 to
  // emit that base; local dev/preview stays at root.
  base: process.env.GH_PAGES === '1' ? '/interpoll-genosdb/' : '/',
  plugins: [vue(), spaRouteFallbackPlugin(), genosdbStaticPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'process.env': {},
    'process.platform': JSON.stringify('browser'),
    'process.versions': JSON.stringify({}),
    global: 'globalThis'
  },
  optimizeDeps: {
    // genosdb is not pre-bundled here — it is served intact as a static folder
    // by the genosdb-static plugin and loaded via dynamic import (see gdbServices).
    exclude: ['@ionic/vue'],
    esbuildOptions: {
      target: 'es2022',
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
    // 2. Target modern browsers — es2022 enables top-level await (GenosDB init)
    target: 'es2022',
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