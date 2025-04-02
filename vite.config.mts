import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { defineConfig, UserConfig } from 'vite';
import Vue from '@vitejs/plugin-vue2';
import { VuetifyResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import AutoImport from 'unplugin-auto-import/vite';
import { isDev, port, r } from './scripts/utils';
import packageJson from './package.json';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import copy from 'rollup-plugin-copy';

export const sharedConfig: UserConfig = {
  root: r('src'),
  envDir: r('.'),
  base: './',
  resolve: {
    alias: {
      '@/': `${r('src')}/`,
      buffer: 'buffer',
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  },
  define: {
    global: 'window',
    __DEV__: isDev,
    __NAME__: JSON.stringify(packageJson.name),
    APP_VERSION: JSON.stringify(packageJson.version),
  },
  plugins: [
    Vue(),
    Components({
      // resolvers for custom components
      resolvers: [
        // Vuetify
        VuetifyResolver(),
      ],
      // Vue version of project.
      version: 2.7,
    }),
    wasm(), // Enable WebAssembly support
    topLevelAwait({
      promiseExportName: '__tla',
      promiseImportName: i => `__tla_${i}`,
    }),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    AutoImport({
      imports: ['vue', { 'webextension-polyfill': [['=', 'browser']] }],
      dts: r('src/auto-imports.d.ts'),
    }),
  ],
  optimizeDeps: {
    include: ['vue', '@vueuse/core', 'webextension-polyfill', 'buffer'],
    exclude: ['vue-demi', '@emurgo/cardano-serialization-lib-browser'],
    esbuildOptions: {
      plugins: [],
    }
  },
  worker: {
    plugins: [
      wasm(),
      topLevelAwait()
    ]
  },
};

export default defineConfig(({ command }) => {
  return {
    ...sharedConfig,
    base: command === 'serve' ? `http://localhost:${port}/` : '.',
    server: {
      port,
      hmr: {
        host: 'localhost',
      },
      origin: `http://localhost:${port}`,
      watch: {
        usePolling: true,
        interval: 1000,
        ignored: ['C:/DumpStack.log.tmp']
      }
    },
    build: {
      target: 'esnext',
      watch: isDev ? {} : undefined,
      outDir: r('extension'),
      assetsDir: 'assets',
      emptyOutDir: false,
      sourcemap: isDev ? 'inline' : false,
      terserOptions: {
        mangle: false,
      },
      rollupOptions: {
        input: {
          options: r('src/options/index.html'),
          // popup: r('src/popup/index.html'),
          // sidepanel: r('src/sidepanel/index.html'),
        },
        plugins: [
          copy({
            targets: [
              { src: 'src/assets/public/*', dest: 'extension/public' },
              { src: 'src/assets/notifications/*', dest: 'extension/public' },
            ],
            hook: 'writeBundle',
          }),
        ]
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
