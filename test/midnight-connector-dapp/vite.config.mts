import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Midnight connector test dApp: `npm run midnight:connector-dapp`, then open
// http://localhost:3341 in a Chrome with the wallet installed.
const dappDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = resolve(dappDirectory, '../..');

export default defineConfig({
  root: dappDirectory,
  cacheDir: resolve(repositoryRoot, 'node_modules/.vite-midnight-connector-dapp'),
  // ledger-v9 is a wasm-bindgen module; the address codec uses Node's Buffer.
  plugins: [wasm(), nodePolyfills({ include: ['buffer'], globals: { Buffer: true } })],
  optimizeDeps: { exclude: ['@midnightntwrk/ledger-v9'] },
  build: { target: 'esnext', outDir: resolve(repositoryRoot, 'dist/midnight-connector-dapp'), emptyOutDir: true },
  server: {
    // localhost, not 127.0.0.1: the wallet's site permissions are per origin, keep it stable.
    host: 'localhost',
    port: 3341,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
});
