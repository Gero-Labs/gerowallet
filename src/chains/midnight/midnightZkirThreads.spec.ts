// @vitest-environment node
//
// The multi-threaded prover build: when it may be used, with how many threads,
// and that none of it runs before every file matched its pin.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  MIDNIGHT_ZKIR_MT,
  midnightZkirMtFiles,
  proverThreadCount,
  threadedProvingPlan,
  wasmThreadsAvailable,
  type MidnightZkirMtPackage,
} from './midnightZkirThreads';
import { startThreadedZkir } from './midnightZkirThreadsLoader';
import { walletProverFor } from './midnightProvingTarget';
import { LEDGER8_PROTOCOL_VERSION as L8, LEDGER9_PROTOCOL_VERSION_SAMPLE as L9, useMidnightChains } from '@test/helpers/midnightChains';

const bytesOf = (text: string) => new TextEncoder().encode(text);
const pin = (name: string, bytes: Uint8Array) => ({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

const FILES = {
  'zkir_mt_bg.wasm': bytesOf('wasm bytes'),
  'zkir_mt.js': bytesOf('glue'),
  'snippets/rayon/workerHelpers.js': bytesOf('thread helper'),
};
const PKG: MidnightZkirMtPackage = {
  sourceTag: 'ledger-9.1.0.1',
  sourceCommit: 'a2b30128ca4b660b73a068e29b56b48ede8c9a74',
  wasm: pin('zkir_mt_bg.wasm', FILES['zkir_mt_bg.wasm']),
  glue: pin('zkir_mt.js', FILES['zkir_mt.js']),
  support: [pin('snippets/rayon/workerHelpers.js', FILES['snippets/rayon/workerHelpers.js'])],
};

/** A context that has (or lacks) shared WebAssembly memory. */
function scope(shared: boolean) {
  class FakeSab {}
  return {
    SharedArrayBuffer: shared ? FakeSab : undefined,
    WebAssembly: { Memory: class { buffer = shared ? new FakeSab() : new ArrayBuffer(1); } },
  } as never;
}

function fakeGlue() {
  const calls: string[] = [];
  const glue = {
    default: vi.fn(async (input: { module_or_path: BufferSource }) => { calls.push(`init:${(input.module_or_path as Uint8Array).length}`); }),
    initThreadPool: vi.fn(async (threads: number) => { calls.push(`pool:${threads}`); }),
  };
  return { glue, calls };
}

describe('proverThreadCount', () => {
  it.each([
    [undefined, 0], [0, 0], [1, 0], [2, 2], [4, 4], [6, 4], [8, 4], [12, 6], [16, 8], [32, 8], [128, 8],
  ])('%s logical processors → %s threads', (logical, threads) => {
    expect(proverThreadCount(logical as number | undefined)).toBe(threads);
  });
});

describe('wasmThreadsAvailable', () => {
  it('needs shared memory that can really be made', () => {
    expect(wasmThreadsAvailable(scope(true))).toBe(true);
    expect(wasmThreadsAvailable(scope(false))).toBe(false);
    expect(wasmThreadsAvailable({} as never)).toBe(false);
    // SharedArrayBuffer exists, and a shared memory is refused (no cross-origin isolation in some contexts).
    class FakeSab {}
    const refusing = { SharedArrayBuffer: FakeSab, WebAssembly: { Memory: class { constructor() { throw new TypeError('shared memory not allowed'); } } } };
    expect(wasmThreadsAvailable(refusing as never)).toBe(false);
  });
});

describe('threadedProvingPlan', () => {
  it('pins the reproducible build of Midnight source at ledger 9.1.0.1, file by file', () => {
    // Reviewed constants: a change here is a change of the prover binary that is handed secret keys.
    expect(MIDNIGHT_ZKIR_MT).toMatchObject({
      sourceTag: 'ledger-9.1.0.1',
      sourceCommit: 'a2b30128ca4b660b73a068e29b56b48ede8c9a74',
      wasm: { name: 'midnight_zkir_wasm_mt_bg.wasm', bytes: 5_629_688, sha256: '98b6ef668f1fada715267d565ebab4d38bc1d466e6ecfed35ef144b56c7bd7cb' },
      glue: { name: 'midnight_zkir_wasm_mt.js', bytes: 36_546, sha256: '05bb7108915aa1d0f436146009eac6fc63d5434c2056c8fb7d4a5279e41a30e5' },
    });
    // The glue starts its threads from the helper beside it: that file is pinned too.
    expect(MIDNIGHT_ZKIR_MT?.support.map((f) => f.name)).toEqual(['snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js']);
    for (const file of midnightZkirMtFiles(MIDNIGHT_ZKIR_MT as MidnightZkirMtPackage)) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(threadedProvingPlan(16, scope(true))).toEqual({ threads: 8 });
  });

  it('says why threads cannot be used, in the order that matters', () => {
    expect(threadedProvingPlan(16, scope(true), PKG)).toEqual({ threads: 8 });
    expect(threadedProvingPlan(16, scope(false), PKG)).toEqual({ threads: 0, reason: 'no-shared-memory' });
    expect(threadedProvingPlan(1, scope(true), PKG)).toEqual({ threads: 0, reason: 'single-core' });
    expect(threadedProvingPlan(16, scope(true), null)).toEqual({ threads: 0, reason: 'not-shipped' });
  });
});

describe('startThreadedZkir', () => {
  const readFile = async (name: string) => new Uint8Array(FILES[name as keyof typeof FILES]);

  it('verifies every file, then instantiates the verified bytes and starts the threads', async () => {
    const { glue, calls } = fakeGlue();
    const read = vi.fn(readFile);
    const importGlue = vi.fn(async () => { calls.push('import'); return glue; });
    const loaded = await startThreadedZkir({ pkg: PKG, plan: { threads: 8 }, readFile: read, importGlue });

    expect(loaded).toMatchObject({ ok: true, threads: 8 });
    expect(read.mock.calls.map(([name]) => name)).toEqual(midnightZkirMtFiles(PKG).map((f) => f.name));
    // Nothing of the package ran before all of it was read and hashed.
    expect(calls).toEqual(['import', `init:${FILES['zkir_mt_bg.wasm'].length}`, 'pool:8']);
    expect(importGlue).toHaveBeenCalledWith('zkir_mt.js');
  });

  it.each(Object.keys(FILES))('runs nothing when %s does not match its pin', async (tampered) => {
    const { glue } = fakeGlue();
    const importGlue = vi.fn(async () => glue);
    const loaded = await startThreadedZkir({
      pkg: PKG,
      plan: { threads: 8 },
      readFile: async (name) => {
        const bytes = await readFile(name);
        if (name === tampered) bytes[0] ^= 0xff;
        return bytes;
      },
      importGlue,
    });
    expect(loaded).toEqual({ ok: false, reason: 'package-invalid' });
    expect(importGlue).not.toHaveBeenCalled();
  });

  it('treats a missing file as an invalid package', async () => {
    const importGlue = vi.fn();
    const loaded = await startThreadedZkir({
      pkg: PKG, plan: { threads: 4 }, readFile: async () => { throw new Error('HTTP 404'); }, importGlue,
    });
    expect(loaded).toEqual({ ok: false, reason: 'package-invalid' });
    expect(importGlue).not.toHaveBeenCalled();
  });

  it('reports a build that loads and cannot start, without throwing', async () => {
    const { glue } = fakeGlue();
    glue.initThreadPool.mockRejectedValueOnce(new Error('could not start workers'));
    expect(await startThreadedZkir({ pkg: PKG, plan: { threads: 4 }, readFile, importGlue: async () => glue }))
      .toEqual({ ok: false, reason: 'failed-to-start' });
    expect(await startThreadedZkir({ pkg: PKG, plan: { threads: 4 }, readFile, importGlue: async () => { throw new Error('blocked'); } }))
      .toEqual({ ok: false, reason: 'failed-to-start' });
  });

  it('reads nothing when no build is pinned or the plan has no threads', async () => {
    const read = vi.fn(readFile);
    const importGlue = vi.fn();
    expect(await startThreadedZkir({ pkg: null, plan: { threads: 8 }, readFile: read, importGlue }))
      .toEqual({ ok: false, reason: 'not-shipped' });
    expect(await startThreadedZkir({ pkg: PKG, plan: { threads: 0, reason: 'no-shared-memory' }, readFile: read, importGlue }))
      .toEqual({ ok: false, reason: 'no-shared-memory' });
    expect(read).not.toHaveBeenCalled();
    expect(importGlue).not.toHaveBeenCalled();
  });
});

describe('walletProverFor with "In this browser"', () => {
  const chosen = { mode: 'local', localEngine: 'browser' } as const;

  it('proves both kinds of send in the browser only when chosen AND offered', () => {
    useMidnightChains({ preprod: [L9, L8], mainnet: [L8, L8] });
    expect(walletProverFor('Preprod', chosen, 'unshielded', { browser: true })).toBe('device');
    expect(walletProverFor('Preprod', chosen, 'shielded', { browser: true })).toBe('device');
    // The flag off: the stored choice reads as the Docker server, as before.
    expect(walletProverFor('Preprod', chosen, 'shielded')).toBe('local');
    expect(walletProverFor('Preprod', chosen, 'shielded', { helper: true })).toBe('local');
    // Offered, and not chosen: nothing changes.
    expect(walletProverFor('Preprod', { mode: 'local' }, 'shielded', { browser: true })).toBe('local');
    expect(walletProverFor('Preprod', { mode: 'local', localEngine: 'helper' }, 'shielded', { browser: true })).toBe('local');
    // A chain still on ledger 8 has no pinned keys for it.
    expect(walletProverFor('Mainnet', chosen, 'unshielded', { browser: true })).toBe('local');
  });

  it('leaves Gero Cloud mode as it was: private sends stay on Gero Cloud', () => {
    useMidnightChains({ preprod: [L9, L8] });
    expect(walletProverFor('Preprod', { mode: 'remote', localEngine: 'browser' }, 'shielded', { browser: true })).toBe('cloud');
    expect(walletProverFor('Preprod', { mode: 'remote', localEngine: 'browser' }, 'unshielded', { browser: true })).toBe('device');
  });

  it('keeps the two no-Docker choices apart', () => {
    useMidnightChains({ preprod: [L9, L8] });
    const both = { helper: true, browser: true };
    expect(walletProverFor('Preprod', { mode: 'local', localEngine: 'helper' }, 'shielded', both)).toBe('helper');
    expect(walletProverFor('Preprod', chosen, 'shielded', both)).toBe('device');
    expect(walletProverFor('Preprod', { mode: 'local', localEngine: 'docker' }, 'shielded', both)).toBe('local');
  });
});
