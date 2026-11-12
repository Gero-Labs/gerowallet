#!/usr/bin/env node
/**
 * Checks the Midnight on-device proving keys against their pins in
 * src/chains/midnight/midnightZkKeys.ts (size and SHA-256 per file).
 *
 *   node scripts/midnight-zk-keys.mjs                 # the bundled files in src/assets/midnight-zk
 *   node scripts/midnight-zk-keys.mjs --verify        # ...and every pin against srs.midnight.network
 *   node scripts/midnight-zk-keys.mjs --verify --host https://keys.example/midnight-zk
 *                                                     # ...and a copy served under flat names
 *                                                     #    (the layout of VITE_MIDNIGHT_ZK_KEYS_URL)
 *   node scripts/midnight-zk-keys.mjs --fetch <dir>   # download every pinned file into <dir>, verified
 *                                                     #    (MIDNIGHT_ZK_KEYS_DIR for the proving tests)
 *
 * The pins are the hashes the ledger source publishes; a host is only a copy.
 * Exits non-zero on any mismatch. Public files only: nothing secret is read or sent.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PINS = join(ROOT, 'src/chains/midnight/midnightZkKeys.ts');
const BUNDLED = join(ROOT, 'src/assets/midnight-zk');

/** The pin table, read from the module itself so there is one source. */
export function readPins(source = readFileSync(PINS, 'utf8')) {
  const host = /MIDNIGHT_ZK_KEY_HOST = '([^']+)'/.exec(source)?.[1];
  const files = new Map();
  const pattern = /file\('([^']+)', '([^']+)', ([\d_]+), '([0-9a-f]{64})', '(bundled|hosted)'\)/g;
  for (const match of source.matchAll(pattern)) {
    const [, name, hostPath, bytes, sha256, location] = match;
    files.set(name, { name, hostPath, bytes: Number(bytes.replaceAll('_', '')), sha256, source: location });
  }
  if (!host || files.size === 0) throw new Error('No pins found in midnightZkKeys.ts');
  return { host, files: [...files.values()] };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** null when `bytes` match `file`'s pin, else what differs. */
export function mismatch(file, bytes) {
  if (bytes.length !== file.bytes) return `${bytes.length} bytes, pinned ${file.bytes}`;
  const digest = sha256(bytes);
  return digest === file.sha256 ? null : `sha256 ${digest}, pinned ${file.sha256}`;
}

async function download(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main(argv) {
  const { host, files } = readPins();
  let failed = 0;
  const report = (label, problem) => {
    if (problem) { failed += 1; console.error(`✗ ${label}: ${problem}`); } else console.log(`✓ ${label}`);
  };

  const bundled = files.filter((f) => f.source === 'bundled');
  for (const file of bundled) {
    const path = join(BUNDLED, file.name);
    report(`bundled ${file.name}`, existsSync(path) ? mismatch(file, readFileSync(path)) : 'missing');
  }
  for (const name of readdirSync(BUNDLED)) {
    if (!bundled.some((f) => f.name === name)) report(`bundled ${name}`, 'not pinned (remove it or pin it)');
  }

  const fetchDir = argv.includes('--fetch') ? argv[argv.indexOf('--fetch') + 1] : undefined;
  if (argv.includes('--verify') || fetchDir) {
    if (fetchDir) mkdirSync(fetchDir, { recursive: true });
    for (const file of files) {
      const url = `${host}/${file.hostPath}`;
      try {
        const bytes = await download(url);
        const problem = mismatch(file, bytes);
        report(`${url}`, problem);
        if (!problem && fetchDir) writeFileSync(join(fetchDir, file.name), bytes);
      } catch (error) {
        report(url, error.message);
      }
    }
  }
  const copy = argv.includes('--host') ? argv[argv.indexOf('--host') + 1]?.replace(/\/+$/, '') : undefined;
  if (copy) {
    for (const file of files.filter((f) => f.source === 'hosted')) {
      const url = `${copy}/${file.name}`;
      try { report(url, mismatch(file, await download(url))); } catch (error) { report(url, error.message); }
    }
  }
  if (failed) {
    console.error(`midnight-zk-keys: ${failed} file(s) do not match their pins`);
    process.exit(1);
  }
  console.log('midnight-zk-keys: OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => { console.error(error); process.exit(1); });
}
