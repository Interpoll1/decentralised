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

export default defineConfig({
  base: '/',
  plugins: [vue(), spaRouteFallbackPlugin()],
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
    global: 'globalThis'
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
    commonjsOptions: {
      transformMixedEsModules: true
    },
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'SOURCEMAP_ERROR') return;
        warn(warning);
      }
    }
  },
  server: {
    fs: {
      strict: false
    }
  }
});
