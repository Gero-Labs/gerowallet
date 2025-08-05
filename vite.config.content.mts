import { defineConfig } from 'vite';
import { sharedConfig } from './vite.config.mjs';
import { isDev, r } from './scripts/utils';
import packageJson from './package.json';

// bundling the content script using Vite
export default defineConfig({
  ...sharedConfig,
  esbuild: {
    target: 'es2022',
  },
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
      ? {}
      : undefined,
    outDir: r('extension/content'),
    cssCodeSplit: false,
    emptyOutDir: false,
    sourcemap: isDev ? 'inline' : false,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        content: r('src/chrome/content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
