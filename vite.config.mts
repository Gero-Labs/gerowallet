import wasm from 'vite-plugin-wasm';
import { defineConfig, UserConfig } from 'vite';
import Vue from '@vitejs/plugin-vue2';
import { VuetifyResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { isDev, port, r } from './scripts/utils';
import packageJson from './package.json';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import copy from 'rollup-plugin-copy';
// import { viteImagemin } from 'vite-plugin-imagemin';

export const sharedConfig: UserConfig = {
  root: r('src'),
  envDir: r('.'),
  base: './',
  resolve: {
    alias: {
      '@/': `${r('src')}/`,
      'buffer': 'buffer',
      '@emurgo/cardano-serialization-lib-nodejs': '@emurgo/cardano-serialization-lib-browser',
      'lodash': 'lodash-es',
      'cbor': r('src/shims/cbor.js'),
      'stream': r('src/shims/stream.js'),
      'util': 'util',
      'pbkdf2': 'pbkdf2/browser.js',
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  },
  define: {
    'global': 'window',
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    'APP_VERSION': JSON.stringify(packageJson.version),
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  plugins: [
    Vue({
      template: {
        compilerOptions: {
          whitespace: 'condense',
        },
      },
    }),
    Components({
      // resolvers for custom components
      resolvers: [
        // Vuetify
        VuetifyResolver(),
      ],
      version: 2.7,
      dts: true,
    }),
    wasm(), // Enable WebAssembly support
    // topLevelAwait(), // Temporarily disabled due to array length error
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      include: ['crypto', 'buffer', 'events', 'stream', 'util', 'os', 'path', 'pbkdf2'],
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
        return null;
      },
    },
    // TODO: Add image optimization later
    // !isDev && viteImagemin({...}),
  ],
  optimizeDeps: {
    include: [
      'vue',
      '@vueuse/core',
      'webextension-polyfill',
      'buffer',
      '@cardano-sdk/crypto',
      'readable-stream',
      'util',
      'pbkdf2',
      'lodash-es',
      'axios',
      'dexie',
      'highcharts',
      'qrcode',
      'vue-i18n',
      'vuetify',
      'vue-router',
      'bip39',
      'blake2b',
      'crypto-ts',
    ],
    exclude: ['vue-demi', '@emurgo/cardano-serialization-lib-browser', 'cbor'],
    esbuildOptions: {
      plugins: [],
      target: 'es2020',
      minify: false,
      treeShaking: false, // Disable for speed
      platform: 'browser',
      dropLabels: [], // Don't drop any labels
      ignoreAnnotations: true, // Ignore pure annotations for speed
      format: 'esm',
      loader: {
        '.js': 'jsx',
        '.ts': 'tsx',
      },
    },
    force: false, // Enable caching
    holdUntilCrawlEnd: false, // Don't wait for all files
  },
  worker: {
    plugins: [
      wasm(),
      // topLevelAwait() // Temporarily disabled
    ],
  },
  server: {
    hmr: {
      overlay: false,
      clientPort: port,
    },
    fs: {
      allow: ['..'],
    },
  },
  esbuild: {
    target: 'es2022',
    keepNames: isDev,
    minifyIdentifiers: false, // Disable for speed
    minifySyntax: false, // Disable for speed
    minifyWhitespace: false, // Disable for speed
    treeShaking: false, // Disable for speed
    drop: [], // Don't drop anything for speed
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: undefined, // Disable manual chunking for faster builds
      },
    },
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
        ignored: ['C:/DumpStack.log.tmp', 'C:/DumpStack.log'],
      },
    },
    build: {
      minify: false, // Disable minification for speed
      target: 'es2022',
      watch: isDev
        ? {
            ignored: ['C:/DumpStack.log.tmp', 'C:/DumpStack.log'],
          }
        : undefined,
      outDir: r('extension'),
      assetsDir: 'assets',
      emptyOutDir: false,
      sourcemap: false, // Always disable sourcemaps
      cssCodeSplit: false, // Disable CSS splitting for speed
      chunkSizeWarningLimit: 10000, // Increase limit to avoid warnings
      reportCompressedSize: false,
      assetsInlineLimit: 0, // Don't inline any assets
      copyPublicDir: false, // Skip copying public directory
      rollupOptions: {
        maxParallelFileOps: 50, // Increase parallel processing
        cache: true,
        treeshake: false, // Disable for faster builds
        input: {
          options: r('src/options/index.html'),
        },
        output: {
          chunkFileNames: 'js/[name].[hash].js',
          assetFileNames: 'assets/[name].[hash][extname]',
          compact: false, // Disable for faster builds
          minifyInternalExports: false, // Disable for faster builds
        },
        plugins: [
          copy({
            targets: [
              { src: 'src/assets/public/*', dest: 'extension/public' },
              { src: 'src/assets/notifications/*', dest: 'extension/public' },
              // Skip large images for faster build
              {
                src: 'src/assets/!(emptyState|welcome|Midnight|cashbackcarousel|cardanoBg|apex|bg-dapp).*',
                dest: 'extension/assets',
              },
            ],
            hook: 'writeBundle',
            copySync: false, // Async copying
            flatten: false,
          }) as any,
          {
            name: 'cbor-fix',
            resolveId(id, importer) {
              if (id === 'cbor') {
                return r('src/shims/cbor.js');
              }
              return null;
            },
          },
        ],
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
