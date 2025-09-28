import wasm from 'vite-plugin-wasm';
import { defineConfig, UserConfig } from 'vite';
import Vue from '@vitejs/plugin-vue2';
import { VuetifyResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
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
      buffer: 'buffer',
      '@emurgo/cardano-serialization-lib-nodejs': '@emurgo/cardano-serialization-lib-browser',
      '@emurgo/cardano-message-signing-nodejs': '@emurgo/cardano-message-signing-browser',
      'lodash': 'lodash-es',
      'cbor': r('src/shims/cbor.js'),
      stream: r('src/shims/stream.js'),
      util: 'util',
      'pbkdf2': 'pbkdf2/browser',
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
        TextDecoder: true,
        TextEncoder: true,
      },
      include: ['crypto', 'buffer', 'events', 'stream', 'util', 'os', 'path', 'pbkdf2'],
      protocolImports: true,
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
      }
    },
    {
      name: 'fix-web-encoding',
      transform(code, id) {
        // Fix web-encoding import in @cardano-sdk/core
        if (id.includes('@cardano-sdk/core') && code.includes("from 'web-encoding'")) {
          return code.replace(
            /import \{ TextDecoder \} from 'web-encoding';/g,
            "const TextDecoder = globalThis.TextDecoder;"
          );
        }
        return null;
      }
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
    exclude: [
      'vue-demi',
      '@emurgo/cardano-serialization-lib-browser',
      'cbor'
    ],
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
    ]
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
      }
    }
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
        overlay: false,
        clientPort: port,
      },
      origin: `http://localhost:${port}`,
      fs: {
        allow: ['..'],
      },
      watch: {
        usePolling: true,
        interval: 1000,
        ignored: [
          '**/DumpStack.log.tmp',
          '**/DumpStack.log*',
          '**/*.tmp',
          '**/*.temp',
          '**/dump*',
          '**/temp/**',
          '**/tmp/**',
          '**/node_modules/**',
          '**/.git/**',
          'D:\\DumpStack.log.tmp',
          'D:\\DumpStack.log',
          'D:\\*.tmp'
        ]
      }
    },
    build: {
      minify: false, // Disable minification for speed
      target: 'es2022',
      watch: isDev ? {} : undefined,
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
        external: ['window/window'], // Fix for fake external created by global replacement
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
                src: 'src/assets/!(emptyState|welcome|cashbackcarousel|cardanoBg|apex|bg-dapp).*',
                dest: 'extension/assets'
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
            }
          },
          {
            name: 'remove-window-window-imports-and-fix-request-response',
            generateBundle(options, bundle) {
              // Remove window/window imports and fix Request/Response destructuring from all chunks and assets
              for (const [fileName, chunk] of Object.entries(bundle)) {
                if (chunk.type === 'chunk' || (chunk.type === 'asset' && fileName.endsWith('.js'))) {
                  const code = chunk.type === 'chunk' ? chunk.code : chunk.source?.toString();
                  if (code) {
                    // Replace import from "window/window" with const undefined (handles both default and side-effect imports)
                    let newCode = code.replace(/import\s+([^;]+)\s+from\s+["']window\/window["'];?\s*\n?/g, 'const $1 = undefined;');

                    // Also handle side-effect imports: import "window/window";
                    newCode = newCode.replace(/import\s+["']window\/window["'];?\s*\n?/g, '// removed window/window import\n');

                    // Fix Request/Response destructuring patterns (same as background script fixes)
                    // Pattern 1: const globalFetchAPI = (({Request, Response}) => ({...}))(something.global);
                    newCode = newCode.replace(
                      /const globalFetchAPI = \(\(\{ Request, Response }\) => \(\{[^}]+}\)\)\(([^)]+)\);/g,
                      'const globalFetchAPI = (() => { try { const g = $1 || globalThis; const { Request, Response } = g; return { Request, Response }; } catch(e) { return { Request: globalThis.Request, Response: globalThis.Response }; } })();'
                    );

                    // Pattern 2: Minified destructuring (({Request:e,Response:t})=>({Request:e,Response:t}))(xxx.global)
                    newCode = newCode.replace(
                      /\(\(\{Request:(\w+),Response:(\w+)\}\)=>\(\{Request:\1,Response:\2\}\)\)\((\w+)\.global\)/g,
                      '(()=>{try{const g=$3.global||globalThis;return{Request:g.Request,Response:g.Response}}catch(e){return{Request:globalThis.Request,Response:globalThis.Response}}})()'
                    );

                    // Pattern 3: Fix destructuring after merge that might have undefined properties
                    // const { fetch: envFetch, Request, Response } = env;
                    newCode = newCode.replace(
                      /const\s+\{\s*fetch:\s*(\w+),\s*Request,\s*Response\s*\}\s*=\s*(\w+);/g,
                      'const $1 = $2?.fetch; const Request = $2?.Request || globalThis.Request; const Response = $2?.Response || globalThis.Response;'
                    );

                    // Pattern 4: Fix ReadableStream and TextEncoder destructuring (all variants)
                    // const { ReadableStream: ReadableStream$1, TextEncoder: TextEncoder$1 } = utils$y.global;
                    newCode = newCode.replace(
                      /const\s+\{\s*ReadableStream:\s*(\w+),\s*TextEncoder:\s*(\w+)\s*\}\s*=\s*([^;]+);/gs,
                      'const $1 = $3?.ReadableStream || globalThis.ReadableStream; const $2 = $3?.TextEncoder || globalThis.TextEncoder;'
                    );

                    // Pattern 4b: Handle multiline pattern with newlines
                    newCode = newCode.replace(
                      /const\s+\{\s*\n\s*ReadableStream:\s*(\w+),\s*\n\s*TextEncoder:\s*(\w+)\s*\n\s*\}\s*=\s*([^;]+);/g,
                      'const $1 = $3?.ReadableStream || globalThis.ReadableStream; const $2 = $3?.TextEncoder || globalThis.TextEncoder;'
                    );

                    // Pattern 4c: Handle exact pattern from the error (no newlines but with spaces)
                    newCode = newCode.replace(
                      /const\s+\{\s*ReadableStream:\s*(\w+),[\s\n]*TextEncoder:\s*(\w+)[\s\n]*\}\s*=\s*([^;]+);/g,
                      'const $1 = $3?.ReadableStream || globalThis.ReadableStream; const $2 = $3?.TextEncoder || globalThis.TextEncoder;'
                    );

                    // Pattern 4d: Handle the exact multiline destructuring pattern from build output
                    newCode = newCode.replace(
                      /const\s+\{\s*\n\s*ReadableStream:\s*(\w+),\s*\n\s*TextEncoder:\s*(\w+)\s*\n\s*\}\s*=\s*([^;]+);/gm,
                      'const $1 = $3?.ReadableStream || globalThis.ReadableStream;\nconst $2 = $3?.TextEncoder || globalThis.TextEncoder;'
                    );

                    // Pattern 4e: Handle the exact pattern from the current error (very specific formatting)
                    newCode = newCode.replace(
                      /const\s+\{\s*\n\s*ReadableStream:\s*(\w+\$\d+),\s*\n\s*TextEncoder:\s*(\w+\$\d+)\s*\n\}\s*=\s*utils\$y\.global;/g,
                      'const $1 = utils$y.global?.ReadableStream || globalThis.ReadableStream;\nconst $2 = utils$y.global?.TextEncoder || globalThis.TextEncoder;'
                    );

                    if (chunk.type === 'chunk') {
                      chunk.code = newCode;
                    } else if (chunk.type === 'asset' && typeof chunk.source === 'string') {
                      chunk.source = newCode;
                    }
                  }
                }
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
