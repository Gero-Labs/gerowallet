// The script that verifies the multi-threaded prover package against its pins.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPins, runtimeFiles, verifyPackage } from './midnight-zkir-mt.mjs';

const dirs = [];
function pkg(files) {
  const dir = mkdtempSync(join(tmpdir(), 'zkir-mt-spec-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}
const pin = (name, text) => ({ name, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });

afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('midnight-zkir-mt pins', () => {
  it('reads the pinned files from midnightZkirThreads.ts', () => {
    const pins = readPins();
    expect(pins.files.map((f) => f.name)).toEqual([
      'midnight_zkir_wasm_mt_bg.wasm',
      'midnight_zkir_wasm_mt.js',
      'snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js',
    ]);
    for (const file of pins.files) expect(file.bytes).toBeGreaterThan(1000);
  });

  it('reads "no build pinned" as null, and refuses a pin list it cannot parse', () => {
    expect(readPins('export const MIDNIGHT_ZKIR_MT: MidnightZkirMtPackage | null = null;\n')).toBeNull();
    expect(() => readPins('export const MIDNIGHT_ZKIR_MT: X | null = {\n  wasm: other(),\n};\n')).toThrow(/lists no mtFile/);
    expect(() => readPins('nothing here')).toThrow(/not found/);
  });
});

describe('verifyPackage', () => {
  const files = { 'a.wasm': 'wasm bytes', 'a.js': 'glue', 'snippets/x/src/workerHelpers.js': 'helper' };
  const pins = { files: Object.entries(files).map(([name, text]) => pin(name, text)) };

  it('accepts a package whose every pinned file matches', () => {
    expect(verifyPackage(pkg(files), pins)).toEqual([]);
  });

  it('names a missing file, a file of the wrong size and a file with the wrong content', () => {
    expect(verifyPackage(pkg({ 'a.wasm': 'wasm bytes', 'a.js': 'glue' }), pins)).toEqual(['snippets/x/src/workerHelpers.js: missing']);
    expect(verifyPackage(pkg({ ...files, 'a.js': 'glue!' }), pins)).toEqual(['a.js: 5 bytes, pinned 4']);
    expect(verifyPackage(pkg({ ...files, 'a.wasm': 'wasm bytez' }), pins)).toEqual(['a.wasm: does not match its pinned hash']);
  });

  it('lists the files a built package would run, not its typings', () => {
    const dir = pkg({ ...files, 'a.d.ts': 'types', 'package.json': '{}' });
    expect(runtimeFiles(dir)).toEqual(['a.js', 'a.wasm', 'snippets/x/src/workerHelpers.js']);
  });
});
