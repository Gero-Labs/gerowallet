import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      include: ['crypto', 'buffer', 'stream', 'util'],
    }),
  ],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: [],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@/': `${resolve(__dirname, 'src')}/`,
      'buffer': 'buffer',
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
    mainFields: ['module', 'main'],
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2020',
    },
  },
});