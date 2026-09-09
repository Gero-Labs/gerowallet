import { defineConfig } from 'vite';
import Vue from '@vitejs/plugin-vue2';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'node:path';
// Isolated fixture: uses the production component/repository with a separate DB.
export default defineConfig({ cacheDir: 'node_modules/.vite-wallet-library', plugins: [Vue(), nodePolyfills({ globals: { global: true, Buffer: true, process: true } })], resolve: { alias: [
  { find: '@/options/modules/welcome/components/WalletsListLogin.vue', replacement: resolve('test/wallet-library/WalletsListFixture.vue') },
  { find: '@/db/gero-db', replacement: resolve('test/wallet-library/database.ts') },
  { find: '@/stores/geroStore', replacement: resolve('test/wallet-library/store.ts') },
  { find: '@/utils/networks', replacement: resolve('test/wallet-library/networks.ts') },
  { find: '@/utils/assets', replacement: resolve('test/wallet-library/assets.ts') },
  { find: '@', replacement: resolve('src') },
] }, server: { host: '127.0.0.1', port: 3317, strictPort: true, fs: { allow: [resolve('.'), resolve('../..')] } } });
