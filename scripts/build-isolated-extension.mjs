import { readdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Derived from Gero-Labs/gerowallet-e2e-tests at 4f277fea (the merged E2E #45).
// Run only in a clean, disposable wallet checkout with npm ci already complete.
const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/build-isolated-extension.mjs <clean-wallet-checkout>');
await access(join(root, 'src', 'chrome', 'inject.ts'));
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local', 'extension/manifest.json']) {
  try { await access(join(root, file)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error('Refusing to overwrite or load existing build configuration: ' + file);
}
const variables = new Set();
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile() && /\.(ts|mts|js|mjs|vue|html)$/.test(entry.name)) {
      for (const match of (await readFile(path, 'utf8')).matchAll(/\bVITE_[A-Z0-9_]+\b/g)) variables.add(match[0]);
    }
  }
}
await scan(join(root, 'src'));
await scan(join(root, 'scripts'));
const values = Object.fromEntries([...variables].sort().map(name => [name, '']));
Object.assign(values, {
  VITE_NEXUS_URL: 'https://api.gerowallet.io/api/nexus',
  VITE_BACKEND_URL: 'https://api.gerowallet.io',
  VITE_FLAGS_BASE_URL: 'https://sync.gerowallet.io',
});
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
values.MANIFEST_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
await writeFile(join(root, '.env.production'), Object.entries(values).map(([key, value]) => key + '=' + value).join('\n') + '\n', { flag: 'wx' });
const env = { ...process.env, NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=4096 --max-semi-space-size=128' };
// Do not let inherited application settings replace the isolated build values.
for (const key of Object.keys(env)) if (key.startsWith('VITE_') || key === 'MANIFEST_KEY' || key === 'GOOGLE_CLIENT_ID') delete env[key];
for (const target of ['background', 'content', 'inject', 'web', 'prepare']) {
  const args = ['run', 'build:' + target, ...(target === 'prepare' ? [] : ['--', '--mode', 'production'])];
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
await access(join(root, 'extension', 'manifest.json'));
console.log('Isolated extension built at ' + join(root, 'extension'));
