import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'path';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import Vue from '@vitejs/plugin-vue';
import { localeMessagesPlugin } from './scripts/i18n-compiler.mjs';

export default defineConfig({
  plugins: [
    Vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'gero-swap' } } }),
    localeMessagesPlugin(),
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
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_DROP_MESSAGE_COMPILER__: true,
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['test/setup.ts'],
    testTimeout: 30000,
    // `.claude/worktrees/*` holds per-developer agent worktrees — full checkouts
    // of other branches, gitignored (see .gitignore's `.claude/`). Without this
    // exclusion vitest globs every one of them, so a local run executes the same
    // suites N+1 times: stale copies of the code, counted into the totals, and
    // competing for CPU. That last part is not cosmetic — the duplicated
    // real-timer suites (crossDeviceSigning's WAKE_PENDING polls) starve each
    // other and flake. Four worktrees present when this was added turned 251
    // crossDevice tests into 807.
    //
    // `.worktrees/*` (.gitignore:102) is the same hazard from a plain
    // `git worktree add` at the repo root instead of under `.claude/`.
    //
    // Spread `configDefaults.exclude` rather than hand-listing node_modules and
    // dist: `exclude` REPLACES the defaults rather than merging, so naming only
    // those two silently dropped the rest (cypress, `.{idea,git,cache,output,
    // temp}`, and the *.config.* files).
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      '**/.worktrees/**',
    ],
    server: {
      deps: {
        // @cardano-sdk/hardware-ledger's ESM build imports
        // '@cardano-foundation/ledgerjs-hw-app-cardano/dist/utils/address' with no extension,
        // which Node's ESM loader rejects. Inlined, Vite resolves it, as the app build does.
        inline: ['@cardano-sdk/hardware-ledger', 'vuetify'],
      },
    },
  },
  resolve: {
    alias: {
      '@/': `${resolve(__dirname, 'src')}/`,
      '@test/': `${resolve(__dirname, 'test')}/`,
      'vuedraggable': resolve(__dirname, 'node_modules/vuedraggable/src/vuedraggable.js'),
      'vue-i18n': 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js',
      'buffer': 'buffer',
      '@noble/ciphers/chacha': '@noble/ciphers/chacha.js',
      '@noble/hashes/pbkdf2': '@noble/hashes/pbkdf2.js',
      '@noble/hashes/sha2': '@noble/hashes/sha2.js',
      // Test-only: the browser emurgo message-signing WASM can't load in the node
      // test runner; the nodejs variant has an identical API + a Node-loadable WASM.
      '@emurgo/cardano-message-signing-browser': '@emurgo/cardano-message-signing-nodejs',
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
