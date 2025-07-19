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
      '@emurgo/cardano-serialization-lib-nodejs': '@emurgo/cardano-serialization-lib-browser',
      'lodash': 'lodash-es',
      'cbor': r('src/shims/cbor.js'),
      stream: r('src/shims/stream.js'),
      util: 'util',
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  },
  define: {
    global: 'window',
    __DEV__: isDev,
    __NAME__: JSON.stringify(packageJson.name),
    APP_VERSION: JSON.stringify(packageJson.version),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
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
    // topLevelAwait(), // Temporarily disabled due to array length error
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      include: ['crypto', 'buffer', 'events', 'pbkdf2', 'stream', 'util', 'os', 'path'],
    }),
    AutoImport({
      imports: ['vue', { 'webextension-polyfill': [['=', 'browser']] }],
      dts: r('src/auto-imports.d.ts'),
    }),
    {
      name: 'cbor-fix-dev',
      resolveId(id, importer) {
        if (id === 'cbor') {
          return r('src/shims/cbor.js');
        }
      }
    },
  ],
  optimizeDeps: {
    include: ['vue', '@vueuse/core', 'webextension-polyfill', 'buffer', '@cardano-sdk/crypto', 'readable-stream', 'util', 'pbkdf2'],
    exclude: ['vue-demi', '@emurgo/cardano-serialization-lib-browser', 'cbor'],
    esbuildOptions: {
      plugins: [],
    }
  },
  worker: {
    plugins: [
      wasm(),
      // topLevelAwait() // Temporarily disabled
    ]
  },
};

export default defineConfig(({ command }) => {
  return {
    ...sharedConfig,
    base: command === 'serve' ? `http://localhost:${port}/` : './',
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
      minify: 'terser',
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
          {
            name: 'cbor-fix',
            resolveId(id, importer) {
              if (id === 'cbor') {
                return r('src/shims/cbor.js');
              }
            }
          }
        ]
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
