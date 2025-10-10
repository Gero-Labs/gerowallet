import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mts';
import { isDev, r } from './scripts/utils';
import packageJson from './package.json';
import rollupTla from 'rollup-plugin-tla';
import commonjs from '@rollup/plugin-commonjs';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  ...sharedConfig,
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
      ignored: [
        '**/DumpStack.log.tmp',
        '**/DumpStack.log*',
        '**/*.tmp',
        '**/*.log.tmp',
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
          unsafe_arrows: false,
          unsafe_methods: false,
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
                // Fix `this instanceof` patterns that cause errors in service workers
                chunk.code = chunk.code.replace(
                  /if \(this instanceof (\w+)\)/g,
                  'if (typeof this !== "undefined" && this instanceof $1)'
                );
                // Fix ternary instanceof patterns: this instanceof X?...
                // Wrap in try-catch to handle prototype issues
                chunk.code = chunk.code.replace(
                  /function (\w+)\(\)\{return (typeof this !== "undefined" && )?this instanceof (\w+)\?([^:]+):([^}]+)\}/g,
                  'function $1(){try{return (typeof this !== "undefined" && this instanceof $3)?$4:$5}catch(e){return $5}}'
                );
                // Fix the specific getAugmentedNamespace anonymous function pattern
                chunk.code = chunk.code.replace(
                  /var a = \/\* @__PURE__ \*\/ __name\(function (\w+)\(\) \{[\s\S]*?}, "a"\);/g,
                  'var a = /* @__PURE__ */ __name(function $1() { try { if (typeof this !== "undefined" && this instanceof $1) { return Reflect.construct(f, arguments, this.constructor); } return f.apply(this, arguments); } catch(e) { return f.apply(this, arguments); } }, "a");'
                );
                // Fix axios fetch adapter destructuring issues in service worker
                // Fix Request/Response destructuring - multiple patterns

                // Pattern 1: const globalFetchAPI = (({Request, Response}) => ({...}))(something.global);
                chunk.code = chunk.code.replace(
                  /const globalFetchAPI = \(\(\{ Request, Response }\) => \(\{[^}]+}\)\)\(([^)]+)\);/g,
                  'const globalFetchAPI = (() => { try { const g = $1 || globalThis; const { Request, Response } = g; return { Request, Response }; } catch(e) { return { Request: globalThis.Request, Response: globalThis.Response }; } })();'
                );

                // Pattern 2: Minified destructuring (({Request:e,Response:t})=>({Request:e,Response:t}))(xxx.global)
                chunk.code = chunk.code.replace(
                  /\(\(\{Request:(\w+),Response:(\w+)\}\)=>\(\{Request:\1,Response:\2\}\)\)\((\w+)\.global\)/g,
                  '(()=>{try{const g=$3.global||globalThis;return{Request:g.Request,Response:g.Response}}catch(e){return{Request:globalThis.Request,Response:globalThis.Response}}})()'
                );
                // Fix ReadableStream and TextEncoder destructuring from minified/unminified global
                // Handle minified: {ReadableStream:Gxe,TextEncoder:zxe}=yxe.global
                chunk.code = chunk.code.replace(
                  /\{ReadableStream:(\w+),TextEncoder:(\w+)\}=(\w+)\.global/g,
                  '$1=globalThis.ReadableStream,$2=globalThis.TextEncoder'
                );
                // Handle unminified multiline with newlines
                chunk.code = chunk.code.replace(
                  /const\s*\{\s*ReadableStream:\s*(\w+\$\d+),\s*TextEncoder:\s*(\w+\$\d+)\s*\}\s*=\s*(\w+\$\d+)\.global;/g,
                  'const $1 = globalThis.ReadableStream; const $2 = globalThis.TextEncoder;'
                );
                // Fix web-encoding imports that got mangled during build
                // Pattern: var TextDecoder$1 = class {... or similar
                chunk.code = chunk.code.replace(
                  /var TextDecoder(\$?\d*)\s*=\s*class\s*\{/g,
                  'var TextDecoder$1 = globalThis.TextDecoder || class {'
                );
                // Fix direct TextDecoder instantiations from web-encoding
                // Replace: new TextDecoder('utf8', { fatal: true }) where TextDecoder might be undefined
                chunk.code = chunk.code.replace(
                  /const\s+(\w+)\s*=\s*new\s+TextDecoder\(/g,
                  'const $1 = new (globalThis.TextDecoder)('
                );
              }
            }
          }
        }
      ]
    },
  },
});
