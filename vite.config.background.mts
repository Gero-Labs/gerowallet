import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mjs';
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
    target: 'es2020',
    assetsDir: '.',
    watch: isDev ? {} : undefined,
    outDir: r('extension/background'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    chunkSizeWarningLimit: 10000,
    ...(isDev ? {} : {
      terserOptions: {
        mangle: {
          keep_fnames: true,
        },
        compress: {
          keep_fnames: true,
          sequences: false,
        },
      },
    }),
    rollupOptions: {
      input: r('src/chrome/background.ts'),
      output: {
        entryFileNames: 'index.js',
        format: 'iife',
        manualChunks: undefined,
        globals: {}
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
                chunk.code = chunk.code.replace(
                  /"undefined"!=typeof document\?document\.currentScript:null/g,
                  'null'
                );
                chunk.code = chunk.code.replace(
                  /document\.currentScript/g,
                  'null'
                );
                // Replace document.baseURI references for service worker compatibility
                chunk.code = chunk.code.replace(
                  /document\.baseURI/g,
                  'self.location.href'
                );
                // Replace more complex patterns with document.baseURI
                chunk.code = chunk.code.replace(
                  /null && null\.tagName\.toUpperCase\(\) === 'SCRIPT' && null\.src \|\| document\.baseURI/g,
                  'self.location.href'
                );
              }
            }
          }
        }
      ]
    },
  },
});
