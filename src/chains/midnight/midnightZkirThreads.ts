/**
 * The multi-threaded build of the Midnight prover (zkir) for the on-device
 * prover (midnightDeviceProver.ts), and when it may be used.
 *
 * What it is: the same `midnight-zkir-wasm` 2.2.0 source the npm package
 * `@midnight-ntwrk/zkir-v2` is built from, compiled with WebAssembly threads
 * (rayon over wasm-bindgen-rayon), as Midnight's own demo does
 * (midnight-ledger `wasm-proving-demos/zkir-mt`). The prover, the keys and the
 * proofs are the same; only the number of processor threads differs. Recipe,
 * versions and how to rebuild it byte for byte: scripts/midnight-zkir-mt/.
 *
 * Pins: the package is NOT taken on trust from wherever it was built. Every
 * file of it is pinned here by size and SHA-256, the worker hashes each one
 * before it runs any of it, and a file that does not match means the standard
 * single-threaded prover is used instead. An empty pin list means "no threaded
 * build ships in this version": unsupported, fails closed.
 *
 * Where the bytes live: `src/assets/midnight-zkir-mt/` (not committed; made by
 * `node scripts/midnight-zkir-mt.mjs`), copied to `extension/midnight-zkir-mt/`.
 * The files run unbundled, as the upstream glue expects: it starts its own
 * worker threads from a script beside it.
 *
 * Dependency-free on purpose: imported by the background, the offscreen prover
 * worker, extension pages and Node tests.
 */

export interface MidnightZkirMtFile {
  /** Path inside the package folder. */
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface MidnightZkirMtPackage {
  /** Upstream source the build was made from. */
  readonly sourceTag: string;
  readonly sourceCommit: string;
  /** The ES module to import: `default()` instantiates, `initThreadPool(n)` starts the threads. */
  readonly glue: MidnightZkirMtFile;
  readonly wasm: MidnightZkirMtFile;
  /** Everything else the glue loads (the thread helper script). */
  readonly support: readonly MidnightZkirMtFile[];
}

/** One pinned file. The name `mtFile` is what scripts/midnight-zkir-mt.mjs reads the pins by. */
function mtFile(name: string, bytes: number, sha256: string): MidnightZkirMtFile {
  return { name, bytes, sha256 };
}

/** Where the package is served from inside the extension. */
export const MIDNIGHT_ZKIR_MT_PATH = '/midnight-zkir-mt/';

/**
 * The pinned threaded build, or `null` when none is pinned.
 * Reviewed constants, like the key pins of midnightZkKeys.ts: these hashes
 * decide which prover binary is handed the wallet's secret keys.
 *
 * These are the hashes of the build the recipe in scripts/midnight-zkir-mt/
 * produces from Midnight's source at the tag below (two independent builds
 * gave the same bytes). Pinning is not shipping: the files are not in the
 * repository, a build includes them only when `node scripts/midnight-zkir-mt.mjs`
 * has made and verified them, and `isMidnightThreadedProvingEnabled` is off by
 * default. Measured gain on one machine: 1.2 to 1.35 times (see the README there).
 */
export const MIDNIGHT_ZKIR_MT: MidnightZkirMtPackage | null = {
  sourceTag: 'ledger-9.1.0.1',
  sourceCommit: 'a2b30128ca4b660b73a068e29b56b48ede8c9a74',
  wasm: mtFile('midnight_zkir_wasm_mt_bg.wasm', 5_629_688, '98b6ef668f1fada715267d565ebab4d38bc1d466e6ecfed35ef144b56c7bd7cb'),
  glue: mtFile('midnight_zkir_wasm_mt.js', 36_546, '05bb7108915aa1d0f436146009eac6fc63d5434c2056c8fb7d4a5279e41a30e5'),
  support: [
    mtFile('snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js', 4_831, '124dab344f04de79b8fe61a6659004e1fd27f5dc8bdf55d00c0eb428c89d619e'),
  ],
};

/** Every file of the package, in the order they are verified. */
export function midnightZkirMtFiles(pkg: MidnightZkirMtPackage): MidnightZkirMtFile[] {
  return [pkg.wasm, pkg.glue, ...pkg.support];
}

/** Fewer threads than this is not worth the second prover binary. */
const MIN_THREADS = 2;
/**
 * More threads than this stopped helping in measurement (see the bench notes
 * in scripts/midnight-zkir-mt/README.md), and each one costs memory.
 */
const MAX_THREADS = 8;

/**
 * How many threads the prover uses on a machine with `hardwareConcurrency`
 * logical processors. Logical processors are usually two per core, and the
 * prover's arithmetic gains little from the second one, so half of them, at
 * least two and at most {@link MAX_THREADS}. 0 when threads are not worth it.
 */
export function proverThreadCount(hardwareConcurrency: number | undefined): number {
  const logical = Number.isFinite(hardwareConcurrency) ? Math.floor(hardwareConcurrency as number) : 0;
  if (logical < MIN_THREADS) return 0;
  if (logical <= 4) return logical;
  return Math.min(MAX_THREADS, Math.max(4, Math.ceil(logical / 2)));
}

/**
 * Whether this context can run WebAssembly threads at all: shared memory must
 * exist and be constructible. Chrome gives extension pages and their workers
 * `SharedArrayBuffer` without cross-origin isolation headers; this does not
 * rely on that being so, it checks.
 */
export function wasmThreadsAvailable(scope: {
  SharedArrayBuffer?: unknown;
  WebAssembly?: { Memory?: new (descriptor: { initial: number; maximum: number; shared: boolean }) => { buffer: unknown } };
} = globalThis as never): boolean {
  try {
    if (typeof scope.SharedArrayBuffer !== 'function' || !scope.WebAssembly?.Memory) return false;
    const memory = new scope.WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return memory.buffer instanceof (scope.SharedArrayBuffer as unknown as new () => object);
  } catch {
    return false;
  }
}

/** Why the threaded prover is not in use, for the page that explains it. */
export type ThreadedProvingUnavailable =
  /** No threaded build is pinned in this version. */
  | 'not-shipped'
  /** This browser context has no shared WebAssembly memory. */
  | 'no-shared-memory'
  /** One processor: nothing to gain. */
  | 'single-core'
  /** The package is missing or a file of it does not match its pin. */
  | 'package-invalid'
  /** It was loaded and failed to start. */
  | 'failed-to-start';

/**
 * What can be known without loading anything: whether the threaded prover
 * could be used here, and with how many threads.
 */
export function threadedProvingPlan(
  hardwareConcurrency: number | undefined,
  scope?: Parameters<typeof wasmThreadsAvailable>[0],
  pkg: MidnightZkirMtPackage | null = MIDNIGHT_ZKIR_MT,
): { threads: number } | { threads: 0; reason: ThreadedProvingUnavailable } {
  if (!pkg) return { threads: 0, reason: 'not-shipped' };
  if (!wasmThreadsAvailable(scope)) return { threads: 0, reason: 'no-shared-memory' };
  const threads = proverThreadCount(hardwareConcurrency);
  return threads > 0 ? { threads } : { threads: 0, reason: 'single-core' };
}
