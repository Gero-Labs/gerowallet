import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mts';
import { isDev, r } from './scripts/utils';
import packageJson from './package.json';
import rollupTla from 'rollup-plugin-tla';
import commonjs from '@rollup/plugin-commonjs';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  ...sharedConfig,
  define: {
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    // https://github.com/vitejs/vite/issues/9320
    // https://github.com/vitejs/vite/issues/9186
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
    // Service worker compatibility
    'typeof document': '"undefined"',
    'typeof window': '"undefined"',
    // Global replacements for service worker
    'global': 'globalThis',
  },
  build: {
    minify: isDev ? false : 'terser',
    target: 'es2022',
    assetsDir: '.',
    watch: isDev ? {} : undefined,
    outDir: r('extension/background'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    chunkSizeWarningLimit: 10000,
    reportCompressedSize: false, // Disable to speed up build
    ...(isDev
      ? {}
      : {
          terserOptions: {
            compress: {
              drop_console: true,
              drop_debugger: true,
              pure_funcs: ['console.log', 'console.debug', 'console.info', 'console.warn'],
              passes: 2,
              unsafe_math: true,
              unsafe_methods: true,
              unsafe_proto: true,
              unsafe_regexp: true,
              unsafe_undefined: true,
              hoist_funs: true,
              hoist_props: true,
              hoist_vars: false,
              if_return: true,
              join_vars: true,
              reduce_vars: true,
              side_effects: false,
            },
            mangle: {
              safari10: true,
            },
            format: {
              comments: false,
            },
          },
        }),
    rollupOptions: {
      // Enable better tree-shaking
      treeshake: {
        preset: 'smallest',
        moduleSideEffects: false,
        propertyReadSideEffects: false,
        unknownGlobalSideEffects: false,
      },
      input: r('src/chrome/background.ts'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js',
        format: 'es',
        // Enable code splitting for ES modules in Manifest V3
        manualChunks(id) {
          // Split large crypto libraries
          if (id.includes('@cardano-sdk')) {
            return 'cardano-sdk';
          }
          if (id.includes('@emurgo')) {
            return 'emurgo';
          }
          if (id.includes('@keystonehq')) {
            return 'keystone';
          }
          if (id.includes('@ledgerhq')) {
            return 'ledger';
          }
          if (id.includes('libsodium')) {
            return 'sodium';
          }
          if (id.includes('cbor')) {
            return 'cbor';
          }
          if (id.includes('axios')) {
            return 'axios';
          }
          if (id.includes('highcharts')) {
            return 'charts';
          }
          // Split large node modules into vendor chunks
          if (id.includes('node_modules')) {
            const directories = id.split('/node_modules/')[1].split('/');
            return `vendor-${directories[0]}`;
          }
        },
      },
      external: isDev ? ['vm'] : [],
      plugins: [
        wasm(),
        rollupTla(),
        commonjs(),
        // Service worker compatibility fixes
        {
          name: 'service-worker-fixes',
          generateBundle(options, bundle) {
            for (const [fileName, chunk] of Object.entries(bundle)) {
              if (chunk.type === 'chunk' && fileName === 'index.js') {
                // Replace document.currentScript references for service worker compatibility
                chunk.code = chunk.code.replace(/"undefined"!=typeof document\?document\.currentScript:null/g, 'null');
                chunk.code = chunk.code.replace(/document\.currentScript/g, 'null');
                // Replace document.baseURI references for service worker compatibility
                chunk.code = chunk.code.replace(/document\.baseURI/g, 'self.location.href');
                // Replace more complex patterns with document.baseURI
                chunk.code = chunk.code.replace(
                  /null && null\.tagName\.toUpperCase\(\) === 'SCRIPT' && null\.src \|\| document\.baseURI/g,
                  'self.location.href'
                );
              }
            }
          },
        },
      ],
    },
  },
});
