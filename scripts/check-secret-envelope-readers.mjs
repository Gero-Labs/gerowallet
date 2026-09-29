/**
 * Release guard: refuse to build a ref whose stored-secret readers cannot open
 * the `gpw2` envelope.
 *
 * Once any user's wallet has been migrated to `gpw2` (flag `isKeyEnvelopeV2Enabled`),
 * a build without the gpw2 readers reports "wrong password" for that wallet: a
 * lockout. That is exactly what a rollback or hotfix cut from an older tag would
 * ship. See docs/security/secret-envelope-runbook.md.
 *
 *   node scripts/check-secret-envelope-readers.mjs            # working tree
 *   node scripts/check-secret-envelope-readers.mjs v2.7.3     # any git ref, before cutting a hotfix from it
 *
 * The checks are textual on purpose: they must run against a ref's source
 * without building it. The real proof is the frozen-fixture suite
 * (src/shared/utils/secretReaders.spec.ts); if the readers are refactored,
 * update the markers here to the equivalent code.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENVELOPE = 'src/shared/utils/secretEnvelope.ts';
const CRYPTO = 'src/shared/utils/crypto.ts';

/** Body of `export function <name>(` up to the next top-level `export`, or null. */
function functionBody(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) return null;
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

/**
 * @param {{ envelope: string | null, crypto: string | null }} sources
 * @returns {string[]} problems; empty means the ref can open every gpw2 field.
 */
export function missingReaders({ envelope, crypto }) {
  const problems = [];
  if (envelope === null) {
    problems.push(`${ENVELOPE} is missing (no gpw2 envelope reader at all)`);
  } else if (!envelope.includes('export function openGpw2(')) {
    problems.push(`${ENVELOPE} has no openGpw2()`);
  }
  if (crypto === null) {
    problems.push(`${CRYPTO} is missing`);
    return problems;
  }
  const readers = [
    ['decryptPrivateKey', 'isGpw2(encryptedPrivateKey)', 'root keys'],
    ['decrypt', 'isGpw2(ciphertext)', 'mnemonic, MPC share, 2FA data'],
    ['decryptKeyBlob', 'isGpw2(blob)', 'SPO cold key, Strike key'],
  ];
  for (const [fn, marker, fields] of readers) {
    const body = functionBody(crypto, fn);
    if (body === null) problems.push(`${CRYPTO}: ${fn}() is missing (${fields})`);
    else if (!body.includes(marker)) problems.push(`${CRYPTO}: ${fn}() does not read gpw2 (${fields})`);
  }
  return problems;
}

function readAtRef(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function readWorkingTree(root, path) {
  const full = join(root, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const ref = process.argv[2];
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = path => (ref ? readAtRef(ref, path) : readWorkingTree(root, path));
  const problems = missingReaders({ envelope: read(ENVELOPE), crypto: read(CRYPTO) });
  const target = ref ?? 'working tree';
  if (problems.length > 0) {
    process.stderr.write([
      `check-secret-envelope-readers: FAIL for ${target}`,
      ...problems.map(p => `  - ${p}`),
      '',
      'This build cannot open wallets already migrated to gpw2 and would lock those users out.',
      'Cut rollbacks and hotfixes only from a ref that passes. See docs/security/secret-envelope-runbook.md.',
      '',
    ].join('\n'));
    process.exit(1);
  }
  process.stdout.write(`check-secret-envelope-readers: OK for ${target}\n`);
}
