// No GeroVault page module opens a stored root key: vault keys are derived in the background
// (GEROVAULT_DERIVE_ACCOUNT_KEY, GEROVAULT_SIGN_VAULT_BUNDLE). The PassKey path is the one
// documented exception: WebAuthn runs in the page, so `decryptPrivateKeyWithPrf` is allowed there
// (create/ownAccountKey.ts), and nothing else.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = __dirname;

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__fixtures__' ? [] : sources(path);
    return /\.(?:ts|vue)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** The code without its comments: a module may name the reader in prose, never use it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const files = sources(ROOT).map(path => ({ file: relative(ROOT, path).split(sep).join('/'), text: code(readFileSync(path, 'utf8')) }));

describe('GeroVault pages never open the stored root key', () => {
  it('finds the modules to check', () => {
    expect(files.map(f => f.file)).toEqual(expect.arrayContaining(['views/GerovaultSpend.vue', 'spend/signClient.ts', 'detail/roleKeys.ts']));
  });

  it('imports no reader of the stored root key', () => {
    const offenders = files.filter(({ text }) => /\bdecryptPrivateKey\b/.test(text) || /['"]@\/shared\/utils\/crypto['"]/.test(text)).map(f => f.file);
    expect(offenders).toEqual([]);
  });

  it('keeps the PassKey exception to the one module that documents it', () => {
    const passKey = files.filter(({ text }) => /decryptPrivateKeyWithPrf/.test(text)).map(f => f.file);
    expect(passKey).toEqual(['create/ownAccountKey.ts']);
  });

  it('signs vault spends only through the background request', () => {
    const pageSigners = files.filter(({ file, text }) => /\bsignWithRootKey\(/.test(text) && file !== 'spend/signer.ts' && file !== 'spend/signBundleFlow.ts').map(f => f.file);
    expect(pageSigners).toEqual([]);
  });
});
