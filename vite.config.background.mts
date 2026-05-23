import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mts';
import { isDev, r } from './scripts/utils';
import packageJson from './package.json';
import rollupTla from 'rollup-plugin-tla';
import commonjs from '@rollup/plugin-commonjs';
import wasm from 'vite-plugin-wasm';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

// Virtual module plugin for CJS packages that break under Rollup's
// getAugmentedNamespace double-wrapping (CJS→ESM→namespace→wrapper).
// These small ljharb utility packages export a single native function
// (e.g. Object.getOwnPropertyDescriptor) but Rollup wraps them twice,
// turning functions into plain {} objects at runtime.
// Must be at top-level Vite plugins with enforce:'pre' so it intercepts
// BEFORE Vite's built-in resolver maps them to node_modules files.
// Stub for @effect/platform's swagger-ui module — pulled in transitively by
// @midnight-ntwrk/wallet-sdk-unshielded-wallet → effect → @effect/platform.
// The module ships a 100KB+ minified swagger-ui-bundle string that breaks
// Vite's commonjs resolver during the extension background build. We never
// render an OpenAPI swagger UI from inside the wallet, so an empty module
// is functionally equivalent.
const HTTP_API_SWAGGER_STUB = `
export const javascript = '';
export const css = '';
export const html = () => '';
`;

const cjsInteropPlugin = {
  name: 'cjs-interop-virtual-modules',
  enforce: 'pre' as const,
  resolveId(source: string, importer?: string) {
    const virtuals: Record<string, string> = {
      'gopd': '\0virtual:gopd',
      'gopd/gOPD': '\0virtual:gopd-gOPD',
      'gopd/gOPD.js': '\0virtual:gopd-gOPD',
      'es-define-property': '\0virtual:es-define-property',
      'hasown': '\0virtual:hasown',
      'function-bind': '\0virtual:function-bind',
      'has-proto': '\0virtual:has-proto',
      // bn.js is CJS-only (@polkadot/util from Midnight SDK does `import BN from 'bn.js'`).
      // Must intercept before Vite's node-resolve maps it to the CJS file, which Rollup
      // then fails to find a `default` export from.
      'bn.js': '\0virtual:bn-js-esm',
      // The `assert` browser polyfill pulls in call-bound/get-intrinsic, which throws
      // "Function.prototype.apply was called on ServiceWorkerGlobalScope" during init
      // in service-worker contexts. The polyfill's intrinsic lookup falls back to
      // globalThis when running in SW. Replace with a minimal local implementation
      // that doesn't depend on those packages at all.
      'assert': '\0virtual:assert-stub',
      'assert/': '\0virtual:assert-stub',
    };
    if (virtuals[source]) return virtuals[source];

    // Intercept @effect/platform's bundled UI modules (swagger-ui, scalar
    // api-reference) — they ship multi-hundred-KB minified strings that break
    // Vite's commonjs resolver during the extension background build. We never
    // render these UIs from inside the wallet, so empty stubs are functionally
    // equivalent. Both relative and absolute import forms are handled.
    const effectStubMap: Record<string, string> = {
      './internal/httpApiSwagger.js': '\0virtual:effect-httpApiSwagger',
      './internal/httpApiSwagger': '\0virtual:effect-httpApiSwagger',
      './internal/httpApiScalar.js': '\0virtual:effect-httpApiScalar',
      './internal/httpApiScalar': '\0virtual:effect-httpApiScalar',
    };
    if (effectStubMap[source] && importer && importer.includes('@effect/platform')) {
      return effectStubMap[source];
    }
    if (source.endsWith('@effect/platform/dist/esm/internal/httpApiSwagger.js')) {
      return '\0virtual:effect-httpApiSwagger';
    }
    if (source.endsWith('@effect/platform/dist/esm/internal/httpApiScalar.js')) {
      return '\0virtual:effect-httpApiScalar';
    }
    return null;
  },
  load(id: string) {
    switch (id) {
      // gopd/gOPD.js: exports Object.getOwnPropertyDescriptor directly
      case '\0virtual:gopd-gOPD':
        return `export default Object.getOwnPropertyDescriptor;`;

      // gopd/index.js: exports Object.getOwnPropertyDescriptor (validated)
      case '\0virtual:gopd':
        return `var $gOPD = Object.getOwnPropertyDescriptor;
try { $gOPD([], 'length'); } catch(e) { $gOPD = null; }
export default $gOPD;`;

      // es-define-property/index.js: exports Object.defineProperty (validated)
      case '\0virtual:es-define-property':
        return `var $dp = Object.defineProperty || false;
if ($dp) { try { $dp({}, 'a', { value: 1 }); } catch(e) { $dp = false; } }
export default $dp;`;

      // hasown/index.js: exports bound Object.prototype.hasOwnProperty
      case '\0virtual:hasown':
        return `export default Function.prototype.call.bind(Object.prototype.hasOwnProperty);`;

      // function-bind/index.js: exports Function.prototype.bind (native in modern browsers)
      case '\0virtual:function-bind':
        return `export default Function.prototype.bind;`;

      // has-proto/index.js: exports function that tests __proto__ support
      case '\0virtual:has-proto':
        return `var test = { __proto__: null, foo: {} };
var result = { __proto__: test }.foo === test.foo && !(test instanceof Object);
export default function hasProto() { return result; };`;

      case '\0virtual:effect-httpApiSwagger':
      case '\0virtual:effect-httpApiScalar':
        return HTTP_API_SWAGGER_STUB;

      case '\0virtual:assert-stub':
        // Minimal `assert` polyfill. The npm `assert` browser package depends
        // on call-bound → get-intrinsic, which throws in service-worker context
        // ("Function.prototype.apply was called on ServiceWorkerGlobalScope")
        // because the intrinsic lookup falls back to globalThis. None of the
        // Midnight / @polkadot deps use the rich Node assert API at runtime —
        // they just need `assert(value)` to throw on falsy.
        return `
function assert(value, message) {
  if (!value) throw new (assert.AssertionError)({ message: message || 'Assertion failed', actual: value, expected: true });
}
function fail(actual, expected, message) {
  throw new (assert.AssertionError)({ message: message || ('AssertionError: ' + actual + ' ' + expected), actual: actual, expected: expected });
}
assert.AssertionError = class AssertionError extends Error {
  constructor(opts) {
    super((opts && opts.message) || 'AssertionError');
    this.name = 'AssertionError';
    if (opts) { this.actual = opts.actual; this.expected = opts.expected; this.operator = opts.operator; }
  }
};
assert.ok = assert;
assert.fail = fail;
assert.equal = function (a, b, m) { if (a != b) fail(a, b, m); };
assert.notEqual = function (a, b, m) { if (a == b) fail(a, b, m); };
assert.strictEqual = function (a, b, m) { if (a !== b) fail(a, b, m); };
assert.notStrictEqual = function (a, b, m) { if (a === b) fail(a, b, m); };
assert.deepEqual = function (a, b, m) { try { if (JSON.stringify(a) !== JSON.stringify(b)) fail(a, b, m); } catch (e) { fail(a, b, m); } };
assert.notDeepEqual = function (a, b, m) { try { if (JSON.stringify(a) === JSON.stringify(b)) fail(a, b, m); } catch (e) { /* ok */ } };
assert.deepStrictEqual = assert.deepEqual;
assert.notDeepStrictEqual = assert.notDeepEqual;
assert.throws = function (fn) { try { fn(); } catch (e) { return; } throw new Error('Did not throw'); };
assert.doesNotThrow = function (fn) { fn(); };
assert.ifError = function (err) { if (err) throw err; };
assert.match = function (s, r, m) { if (!r.test(s)) fail(s, r, m); };
assert.doesNotMatch = function (s, r, m) { if (r.test(s)) fail(s, r, m); };
assert.rejects = async function (fn) { try { await (typeof fn === 'function' ? fn() : fn); } catch (e) { return; } throw new Error('Did not reject'); };
assert.doesNotReject = async function (fn) { await (typeof fn === 'function' ? fn() : fn); };
export default assert;
export { assert, fail };
export const ok = assert.ok;
export const equal = assert.equal;
export const notEqual = assert.notEqual;
export const strictEqual = assert.strictEqual;
export const notStrictEqual = assert.notStrictEqual;
export const deepEqual = assert.deepEqual;
export const notDeepEqual = assert.notDeepEqual;
export const deepStrictEqual = assert.deepStrictEqual;
export const notDeepStrictEqual = assert.notDeepStrictEqual;
export const throws = assert.throws;
export const doesNotThrow = assert.doesNotThrow;
export const ifError = assert.ifError;
export const match = assert.match;
export const doesNotMatch = assert.doesNotMatch;
export const rejects = assert.rejects;
export const doesNotReject = assert.doesNotReject;
export const AssertionError = assert.AssertionError;
`;

      case '\0virtual:bn-js-esm': {
        // bn.js is wrapped in its own IIFE that takes `(module, exports)` as
        // parameters and calls itself with `(typeof module === 'undefined' ||
        // module, this)`. `BN` is only defined inside that IIFE scope. We
        // can't strip the wrapper without breaking lexical scope, so instead
        // we run the original code inside a wrapper IIFE that supplies
        // `module`/`exports` locals, then re-export `module.exports` as the
        // ESM default. Wrapping in an IIFE keeps `module`/`exports` out of
        // the bundle's module-level scope, where they would otherwise collide
        // with Rollup's commonjs interop hoisting.
        // @polkadot/util (Midnight SDK dep) does `import BN from 'bn.js'`.
        const bnPath = _require.resolve('bn.js');
        const src = readFileSync(bnPath, 'utf-8');
        const bnCode =
          'const _bnExports = (function () {\n' +
          '  var module = { exports: {} };\n' +
          '  var exports = module.exports;\n' +
          src + '\n' +
          '  return module.exports;\n' +
          '})();\n' +
          'export default _bnExports;\n';
        return { code: bnCode, map: null };
      }
    }
    return null;
  }
};

export default defineConfig({
  ...sharedConfig,
  plugins: [
    ...(Array.isArray(sharedConfig.plugins) ? sharedConfig.plugins : []),
    cjsInteropPlugin,
  ],
  resolve: {
    ...sharedConfig.resolve,
    alias: (() => {
      // Clone shared aliases but remove 'pbkdf2' - the virtual module plugin (rollup plugin)
      // handles pbkdf2 resolution for the background build instead. The shared config alias
      // ('pbkdf2' -> 'pbkdf2/browser') races with the virtual module plugin because Vite
      // aliases resolve BEFORE Rollup plugins, causing sporadic "pbkdf2Sync is not exported"
      // errors when the alias wins the race.
      const aliases = { ...sharedConfig.resolve?.alias } as Record<string, string>;
      delete aliases['pbkdf2'];
      return aliases;
    })(),
  },
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
        '**/DumpStack.log.tmp',
        '**/DumpStack.log'
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
    // Note: 'global' is handled by nodePolyfills plugin from sharedConfig
    // Don't define it here to avoid conflicts with terser minification
  },
  build: {
    minify: isDev ? false : 'terser',
    target: 'es2020',
    assetsDir: '.',
    watch: isDev ? {
      clearScreen: false,
      ...(process.platform === 'win32' ? {
        include: ['src/**'],
        chokidar: {
          cwd: process.cwd(),
          ignored: [
            '**/*.tmp',
            '**/*.log',
            '**/*.log.tmp',
            '**/DumpStack.log*',
            '**/node_modules/**',
            '**/.git/**',
            (path: string) => {
              // Ignore any paths outside the project directory
              const projectDir = process.cwd();
              return !path.startsWith(projectDir);
            }
          ],
          ignoreInitial: true,
          ignorePermissionErrors: true,
          disableGlobbing: false,
          usePolling: false,
          awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 100
          }
        }
      } : {})
    } : undefined,
    outDir: r('extension/background'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: false, // Disabled — background bundle has 3000+ modules (WC SDK); sourcemaps cause OOM
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
      onwarn(warning, warn) {
        // Suppress window/window warnings - these are harmless artifacts from commonjs plugin + terser
        if (warning.message && warning.message.includes('window/window')) return;
        // Suppress externalized module warnings (vm, fs, etc. - expected in browser builds)
        if (warning.code === 'PLUGIN_WARNING' && warning.message?.includes('externalized')) return;
        // Suppress eval warnings from third-party dependencies (protobufjs)
        if (warning.code === 'EVAL' && warning.id?.includes('node_modules')) return;
        // Use default warning handler for everything else
        warn(warning);
      },
      external: (id) => {
        // Keep vm external in dev mode (node built-in not available in browser)
        if (isDev && id === 'vm') return true;
        // Ignore spurious window/window imports created by commonjs plugin + terser
        // This happens when terser minifies code with window property access
        if (id === 'window/window' || id.includes('window/window')) return true;
        return false;
      },
      plugins: [
        // pbkdf2 virtual module — stays at Rollup level (works here, breaks at Vite level)
        {
          name: 'pbkdf2-virtual-module',
          enforce: 'pre',
          resolveId(source) {
            if (source === 'pbkdf2') return '\0virtual:pbkdf2';
            return null;
          },
          load(id) {
            if (id === '\0virtual:pbkdf2') {
              return `
import pbkdf2Browser from 'pbkdf2/browser.js';
export const pbkdf2 = pbkdf2Browser.pbkdf2 || pbkdf2Browser;
export const pbkdf2Sync = pbkdf2Browser.pbkdf2Sync || pbkdf2Browser;
export default pbkdf2Browser;
`;
            }
            return null;
          }
        },
        commonjs({
          include: [/node_modules/],
          requireReturnsDefault: 'auto',
          defaultIsModuleExports: 'auto',
          esmExternals: true,
          transformMixedEsModules: true,
          strictRequires: true,
          ignore: (id) => {
            // Ignore spurious window/window imports
            if (id === 'window/window' || id.includes('window/window')) return true;
            return false;
          },
        }),
        wasm(),
        rollupTla(),
        // Service worker compatibility fixes
        {
          name: 'service-worker-fixes',
          generateBundle(options, bundle) {
            for (const [fileName, chunk] of Object.entries(bundle)) {
              if (chunk.type === 'chunk' && fileName === 'index.js') {
                // Prepend addEventListener monkey-patch to suppress Chrome's service worker warnings
                // Chrome warns when addEventListener('online'/'offline') is not called during initial evaluation
                const suppressionCode = `
// Suppress Chrome's service worker event handler warnings for Ably
// Ably adds online/offline listeners dynamically, which triggers Chrome warnings
// These warnings are harmless - we silence them by making addEventListener a no-op for these events
(function() {
  const originalAddEventListener = self.addEventListener;
  self.addEventListener = function(type, listener, options) {
    // Silently ignore online/offline event listeners to suppress Chrome warnings
    if (type === 'online' || type === 'offline') {
      return; // Don't register these listeners, preventing the warning
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
})();
`;
                chunk.code = suppressionCode + chunk.code;

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
                // Fix getAugmentedNamespace: native functions (Object.getOwnPropertyDescriptor,
                // Object.defineProperty, etc.) have .prototype === undefined, which causes
                // "Function has non-object prototype 'undefined' in instanceof check".
                // Fix 1: Guard the prototype assignment
                chunk.code = chunk.code.replace(
                  /(\w+)\.prototype\s*=\s*(\w+)\.prototype;\s*\}\s*else\s*\n?\s*(\w+)\s*=\s*\{\};/g,
                  '$1.prototype = $2.prototype; } else $3 = {}; if (!$1.prototype) $1.prototype = {};'
                );
                // Fix 2: Wrap instanceof in try-catch inside getAugmentedNamespace wrapper
                // Handles both: `this instanceof X` and `typeof this !== "undefined" && this instanceof X`
                chunk.code = chunk.code.replace(
                  /if\s*\(typeof this\s*!==\s*"undefined"\s*&&\s*this\s+instanceof\s+(\w+)\)\s*\{?\s*return\s+Reflect\.construct\((\w+),\s*arguments,\s*this\.constructor\);\s*\}?/g,
                  'if (typeof this !== "undefined" && $1.prototype && this instanceof $1) { return Reflect.construct($2, arguments, this.constructor); }'
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
                  'var a = /* @__PURE__  */ __name(function $1() { try { if (typeof this !== "undefined" && this instanceof $1) { return Reflect.construct(f, arguments, this.constructor); } return f.apply(this, arguments); } catch(e) { return f.apply(this, arguments); } }, "a");'
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
