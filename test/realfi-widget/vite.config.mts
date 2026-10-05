import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = resolve(fixtureDirectory, '../..');

export default defineConfig({
  root: repositoryRoot,
  optimizeDeps: {
    noDiscovery: true,
    entries: [resolve(fixtureDirectory, 'index.html')],
  },
  server: {
    host: '127.0.0.1',
    port: 3331,
    strictPort: true,
    fs: { allow: [repositoryRoot] },
  },
});
