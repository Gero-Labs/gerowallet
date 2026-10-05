import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { missingReaders } from './check-secret-envelope-readers.mjs';

const envelope = readFileSync('src/shared/utils/secretEnvelope.ts', 'utf8');
const crypto = readFileSync('src/shared/utils/crypto.ts', 'utf8');

describe('check-secret-envelope-readers', () => {
  it('passes on the current source', () => {
    expect(missingReaders({ envelope, crypto })).toEqual([]);
  });

  it('fails a ref from before the gpw2 readers (no envelope module)', () => {
    expect(missingReaders({ envelope: null, crypto })).toEqual([
      'src/shared/utils/secretEnvelope.ts is missing (no gpw2 envelope reader at all)',
    ]);
  });

  it('fails when one reader loses its gpw2 branch', () => {
    const noRootBranch = crypto.replace('isGpw2(encryptedPrivateKey)', 'false');
    expect(missingReaders({ envelope, crypto: noRootBranch })).toEqual([
      'src/shared/utils/crypto.ts: decryptPrivateKey() does not read gpw2 (root keys)',
    ]);
  });

  it('fails when a reader is missing entirely', () => {
    const noKeyBlob = crypto.replace('export function decryptKeyBlob(', 'export function renamedKeyBlob(');
    expect(missingReaders({ envelope, crypto: noKeyBlob })).toEqual([
      'src/shared/utils/crypto.ts: decryptKeyBlob() is missing (SPO cold key, Strike key)',
    ]);
  });
});
