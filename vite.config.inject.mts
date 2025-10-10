import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mts';
import { isDev, r } from './scripts/utils';
import packageJson from './package.json';

// bundling the content script using Vite
export default defineConfig({
  ...sharedConfig,
  define: {
    '__DEV__': isDev,
    '__NAME__': JSON.stringify(packageJson.name),
    // https://github.com/vitejs/vite/issues/9320
    // https://github.com/vitejs/vite/issues/9186
    'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
  },
  build: {
    target: 'es2022',
    assetsDir: '.',
    watch: isDev
      ? {
          ignored: ['**/DumpStack.log.tmp', '**/DumpStack.log', '**/*.tmp', '**/node_modules/**', '**/.git/**']
        }
      : undefined,
    outDir: r('extension/content'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    lib: {
      entry: r('src/chrome/inject.ts'),
      name: packageJson.name,
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        extend: true,
        inlineDynamicImports: false,
      },
    },
  },
});
