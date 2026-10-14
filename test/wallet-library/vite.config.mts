import { defineConfig } from 'vite';
import Vue from '@vitejs/plugin-vue';
import { localeMessagesPlugin } from '../../scripts/i18n-compiler.mjs';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { resolve } from 'node:path';
// Isolated fixture: uses the production component/repository with a separate DB.
export default defineConfig({ cacheDir: 'node_modules/.vite-wallet-library', plugins: [Vue(), localeMessagesPlugin(), nodePolyfills({ globals: { global: true, Buffer: true, process: true } })],
define: { __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_I18N_FULL_INSTALL__: true, __VUE_I18N_LEGACY_API__: false, __INTLIFY_DROP_MESSAGE_COMPILER__: true },
optimizeDeps: { entries: [resolve('test/wallet-library/index.html')] },
css: { preprocessorOptions: { scss: { additionalData: `@import "${resolve('src/shared/styles/_tokens.scss').replace(/\\/g, '/')}";\n`, quietDeps: true, silenceDeprecations: ['import'] } } },
resolve: { alias: [
  { find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm-bundler.js' },
  { find: 'vuedraggable', replacement: resolve('node_modules/vuedraggable/src/vuedraggable.js') },
  { find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' },
  { find: '@/options/modules/welcome/components/WalletsListLogin.vue', replacement: resolve('test/wallet-library/WalletsListFixture.vue') },
  { find: '@/db/gero-db', replacement: resolve('test/wallet-library/database.ts') },
  { find: '@/stores/geroStore', replacement: resolve('test/wallet-library/store.ts') },
  { find: '@/utils/networks', replacement: resolve('test/wallet-library/networks.ts') },
  { find: '@/utils/assets', replacement: resolve('test/wallet-library/assets.ts') },
  { find: '@', replacement: resolve('src') },
] }, server: { host: '127.0.0.1', port: 3317, strictPort: true,
  watch: { ignored: ['**/extension/**', '**/output/**'] },
  fs: { allow: [resolve('.'), resolve('../..')] } } });
