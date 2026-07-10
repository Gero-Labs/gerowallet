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

// Absolute POSIX path: sass `@import` does not reliably resolve vite's `@/`
// alias on Windows (r() yields backslashes), so we hand it a literal path.
const tokensScss = r('src/shared/styles/_tokens.scss').replace(/\\/g, '/');

export const sharedConfig: UserConfig = {
  root: r('src'),
  envDir: r('.'),
  base: './',
  customLogger: {
    info(msg, options) {
      console.log(msg);
    },
    warn(msg, options) {
      // Suppress externalized module warnings (vm, fs, etc. - expected in browser builds)
      if (msg.includes('externalized for browser compatibility')) return;
      // Suppress eval warnings from third-party dependencies (protobufjs)
      if (msg.includes('Use of eval') && msg.includes('node_modules')) return;
      // Show other warnings
      console.warn(msg);
    },
    error(msg, options) {
      console.error(msg);
    },
    clearScreen() {},
    hasErrorLogged() { return false; },
    hasWarned: false,
    warnOnce(msg, options) {
      // Apply same filtering as warn()
      if (msg.includes('externalized for browser compatibility')) return;
      if (msg.includes('Use of eval') && msg.includes('node_modules')) return;
      console.warn(msg);
    },
  },
  resolve: {
    alias: {
      '@/': `${r('src')}/`,
      'buffer': 'buffer',
      '@emurgo/cardano-message-signing-nodejs': '@emurgo/cardano-message-signing-browser',
      'lodash': 'lodash-es',
      'cbor': r('src/shims/cbor.js'),
      'stream': r('src/shims/stream.js'),
      'util': 'util',
      'pbkdf2': 'pbkdf2/browser',
      '@noble/ciphers/chacha': '@noble/ciphers/chacha.js',
      '@noble/hashes/pbkdf2': '@noble/hashes/pbkdf2.js',
      '@noble/hashes/sha2': '@noble/hashes/sha2.js',
    },
    extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Every `<style lang="scss">` block sees the token mirror. tokens.css
        // is canonical; these sass vars exist only for compile-time contexts
        // (breakpoints, sass math) where custom properties cannot work.
        additionalData: `@import "${tokensScss}";\n`,
        quietDeps: true,
        silenceDeprecations: ['legacy-js-api', 'import'],
      },
    },
  },
  define: {
    // Note: 'global' is handled by nodePolyfills plugin below
    // Don't define it here to avoid conflicts that create spurious window/window imports
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
        TextDecoder: true,
        TextEncoder: true,
      },
      include: ['crypto', 'buffer', 'events', 'stream', 'util', 'os', 'path', 'pbkdf2'],
      protocolImports: true,
    }),
    AutoImport({
      imports: ['vue', { 'webextension-polyfill': [['=', 'browser']] }],
      dts: r('src/auto-imports.d.ts'),
    })
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
    exclude: ['vue-demi', 'cbor'],
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
    force: isDev, // Force re-optimization in dev mode to catch changes
    holdUntilCrawlEnd: false, // Don't wait for all files
  },
  worker: {
    plugins: [
      wasm(),
      // topLevelAwait() // Temporarily disabled
    ],
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
      onwarn(warning, warn) {
        // Suppress externalized module warnings (vm, fs, etc. - expected in browser builds)
        if (warning.code === 'PLUGIN_WARNING' && warning.message?.includes('externalized')) return;
        // Suppress eval warnings from third-party dependencies (protobufjs)
        if (warning.code === 'EVAL' && warning.id?.includes('node_modules')) return;
        // Use default warning handler for everything else
        warn(warning);
      },
    },
  },
};

export default defineConfig(({ command }) => {
  return {
    ...sharedConfig,
    // Expose AGENT_TOKEN (not just VITE_*) to the options + sidepanel client bundles so the
    // Copilot dock can read the Fluxpoint dev key from its single source in .env.development.
    // DEV convenience only; production uses the Nexus proxy and must not expose this key.
    envPrefix: ['VITE_', 'AGENT_'],
    base: command === 'serve' ? `http://localhost:${port}/` : './',
    server: {
      port,
      // `base` and `origin` above are pinned to `port`. If the port is taken,
      // vite would otherwise serve on a different port while still emitting
      // asset URLs at the pinned port — large (non-inlined) assets then 404
      // (e.g. the welcome logo SVG). Fail loudly instead of silently breaking.
      strictPort: true,
      hmr: {
        host: 'localhost',
        overlay: false,
        clientPort: port,
      },
      origin: `http://localhost:${port}`,
      proxy: {
        '/babylon-mainnet': {
          target: 'https://staking-api.babylonlabs.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/babylon-mainnet/, ''),
        },
        '/babylon-testnet': {
          target: 'https://staking-api.testnet.babylonlabs.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/babylon-testnet/, ''),
        },
      },
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
        input: {
          options: r('src/options/index.html'),
          sidepanel: r('src/sidepanel/index.html'),
        },
        onwarn(warning, warn) {
          // Suppress window/window warnings - harmless artifacts from terser minification
          if (warning.message && warning.message.includes('window/window')) return;
          // Suppress eval warnings from third-party dependencies (protobufjs)
          if (warning.code === 'EVAL' && warning.id?.includes('node_modules')) return;
          // Use default warning handler for everything else
          warn(warning);
        },
        external: (id) => {
          // Ignore spurious window/window imports created by terser minification
          if (id === 'window/window' || id.includes('window/window')) return true;
          return false;
        },
        output: {
          // No hashes on any filenames — Chrome extension caches aggressively
          // and stale hashed references cause ERR_FILE_NOT_FOUND on every reload
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'js/[name].js',
          assetFileNames: 'assets/[name][extname]',
          compact: false, // Disable for faster builds
          minifyInternalExports: false, // Disable for faster builds
        },
        plugins: [
          copy({
            targets: [
              { src: 'src/assets/public/*', dest: 'extension/public', flatten: true },
              { src: 'src/assets/notifications/*', dest: 'extension/public/notifications', flatten: true },
              // Skip large images for faster build
              {
                src: 'src/assets/!(emptyState|welcome|cashbackcarousel|cardanoBg|apex|bg-dapp).*',
                dest: 'extension/assets'
              },
              // Only the JS loader (+ README) belongs in the runtime vendor dir — the CSS is
              // NOT loaded from here at runtime. It's a Vite build INPUT (see the <link
              // media="all"> comment in src/options/index.html / src/sidepanel/index.html):
              // Vite emits it as extension/assets/gero-swap.css and rewrites the href to
              // point there. Copying it into extension/vendor/gero-swap too would just be a
              // ~196KB dead duplicate that nothing ever loads.
              {
                src: ['src/vendor/gero-swap/gero-swap.js', 'src/vendor/gero-swap/README.md'],
                dest: 'extension/vendor/gero-swap',
                flatten: true,
              },
            ],
            hook: 'writeBundle',
            copySync: false, // Async copying
          }) as any,
        ]
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
    },
  };
});
