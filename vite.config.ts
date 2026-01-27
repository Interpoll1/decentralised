import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
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