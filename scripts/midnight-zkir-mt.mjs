/**
 * The multi-threaded build of the Midnight prover (src/chains/midnight/midnightZkirThreads.ts).
 *
 * The package is never committed. It is built from Midnight's own source by the
 * pinned recipe in scripts/midnight-zkir-mt/ (Docker; a rebuild is byte for byte
 * the same), and a build of the extension includes it only if every file of it
 * matches the pins in midnightZkirThreads.ts.
 *
 *   node scripts/midnight-zkir-mt.mjs                    # verify src/assets/midnight-zkir-mt against the pins
 *   node scripts/midnight-zkir-mt.mjs --install <pkg>    # copy the pinned files of a built package in, verified
 *   node scripts/midnight-zkir-mt.mjs --hashes <pkg>     # print the pin table of a built package (to review, then pin)
 *   node scripts/midnight-zkir-mt.mjs --build            # run the recipe in Docker, then --install its output
 *   node scripts/midnight-zkir-mt.mjs --clean            # remove the installed package
 *
 * `--allow-missing` makes the plain verify succeed when nothing is installed
 * (a build without the package proves on one thread, which is a valid build).
 * Exits non-zero on any mismatch. Public files only: nothing secret is read or sent.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PINS = join(ROOT, 'src/chains/midnight/midnightZkirThreads.ts');
const INSTALLED = join(ROOT, 'src/assets/midnight-zkir-mt');
const RECIPE = join(ROOT, 'scripts/midnight-zkir-mt');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The pinned package, read from the module itself so there is one source.
 * Returns null while `MIDNIGHT_ZKIR_MT` is `null` (no build is pinned).
 */
export function readPins(source = readFileSync(PINS, 'utf8')) {
  const start = source.indexOf('export const MIDNIGHT_ZKIR_MT:');
  if (start < 0) throw new Error('MIDNIGHT_ZKIR_MT not found in midnightZkirThreads.ts');
  const declaration = source.slice(start, source.indexOf('\n};', start) + 3);
  if (/=\s*null\s*;/.test(source.slice(start, source.indexOf(';', start) + 1))) return null;
  const files = [];
  const pattern = /mtFile\('([^']+)',\s*([\d_]+),\s*'([0-9a-f]{64})'\)/g;
  for (const [, name, bytes, hash] of declaration.matchAll(pattern)) {
    files.push({ name, bytes: Number(bytes.replaceAll('_', '')), sha256: hash });
  }
  if (files.length === 0) throw new Error('MIDNIGHT_ZKIR_MT is set and lists no mtFile(...) pins');
  return { files };
}

/** Problems found comparing `dir` with the pins; empty when every pinned file matches. */
export function verifyPackage(dir, pins) {
  const problems = [];
  for (const file of pins.files) {
    const path = join(dir, file.name);
    if (!existsSync(path)) {
      problems.push(`${file.name}: missing`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.length !== file.bytes) problems.push(`${file.name}: ${bytes.length} bytes, pinned ${file.bytes}`);
    else if (sha256(bytes) !== file.sha256) problems.push(`${file.name}: does not match its pinned hash`);
  }
  return problems;
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
function listFiles(dir, prefix = '') {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(path).isDirectory() ? listFiles(path, relative) : [relative];
  });
}

/** The files of a built package the extension runs: the module, its glue and the thread helper. */
export function runtimeFiles(dir) {
  return listFiles(dir).filter((name) => /\.wasm$/.test(name) || (/\.js$/.test(name) && !/\.d\.ts$/.test(name))).sort();
}

function install(from, pins) {
  const problems = verifyPackage(from, pins);
  if (problems.length > 0) return problems;
  rmSync(INSTALLED, { recursive: true, force: true });
  for (const file of pins.files) {
    mkdirSync(dirname(join(INSTALLED, file.name)), { recursive: true });
    cpSync(join(from, file.name), join(INSTALLED, file.name));
  }
  return verifyPackage(INSTALLED, pins);
}

function build() {
  const out = mkdtempSync(join(tmpdir(), 'zkir-mt-'));
  const script = join(RECIPE, 'build-in-docker.sh');
  const result = spawnSync('bash', [script, out], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`The recipe failed (exit ${result.status}). See scripts/midnight-zkir-mt/README.md.`);
  return join(out, 'mt');
}

function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);

  if (flag('--hashes')) {
    const dir = value('--hashes');
    if (!dir || !existsSync(dir)) throw new Error('usage: --hashes <built package dir>');
    for (const name of runtimeFiles(dir)) {
      const bytes = readFileSync(join(dir, name));
      console.log(`mtFile('${name}', ${bytes.length.toLocaleString('en-US').replaceAll(',', '_')}, '${sha256(bytes)}'),`);
    }
    return 0;
  }
  if (flag('--clean')) {
    rmSync(INSTALLED, { recursive: true, force: true });
    console.log('midnight-zkir-mt: removed');
    return 0;
  }

  const pins = readPins();
  if (!pins) {
    console.log('midnight-zkir-mt: no build is pinned (MIDNIGHT_ZKIR_MT is null); the prover proves on one thread.');
    return existsSync(INSTALLED) ? 1 : 0;
  }

  let problems;
  if (flag('--build')) problems = install(build(), pins);
  else if (flag('--install')) {
    const dir = value('--install');
    if (!dir || !existsSync(dir)) throw new Error('usage: --install <built package dir>');
    problems = install(dir, pins);
  } else if (!existsSync(INSTALLED)) {
    if (flag('--allow-missing')) {
      console.log('midnight-zkir-mt: not installed; this build proves on one thread.');
      return 0;
    }
    problems = ['src/assets/midnight-zkir-mt is missing (run with --build, or --install <pkg>)'];
  } else {
    problems = verifyPackage(INSTALLED, pins);
    // Anything beside the pinned files would ship unverified.
    const pinned = new Set(pins.files.map((f) => f.name));
    for (const name of listFiles(INSTALLED)) if (!pinned.has(name)) problems.push(`${name}: not a pinned file`);
  }

  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length === 0) console.log(`midnight-zkir-mt: OK (${pins.files.length} files match their pins)`);
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`midnight-zkir-mt: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
