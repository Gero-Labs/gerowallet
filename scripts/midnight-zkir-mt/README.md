# The multi-threaded Midnight prover build

`src/chains/midnight/midnightZkirThreads.ts` pins a build of Midnight's zkir prover
compiled with WebAssembly threads. This folder is the recipe that makes it. The
build is **not committed**: `node scripts/midnight-zkir-mt.mjs --build` runs the
recipe in Docker and installs the result into `src/assets/midnight-zkir-mt/` only
if every file matches its pin. A build of the extension without it proves on one
thread, as before. The feature is behind `isMidnightThreadedProvingEnabled`
(default off).

## What it is

- Source: `midnightntwrk/midnight-ledger`, tag `ledger-9.1.0.1`
  (`a2b30128ca4b660b73a068e29b56b48ede8c9a74`), crate `wasm-proving-demos/zkir-mt`:
  `pub use wasm_bindgen_rayon::init_thread_pool; pub use zkir::*;` over
  `zkir-wasm` (`midnight-zkir-wasm` 2.2.0), the crate the npm package
  `@midnight-ntwrk/zkir-v2` 2.2.0 is built from. Upstream calls that demo "not
  production code".
- Toolchain, all pinned in `Dockerfile`: `rust:1.95.0-trixie` by digest (the
  compiler the npm binary's own `producers` section names), wasm-pack 0.13.1,
  wasm-bindgen 0.2.108, binaryen 126, Debian clang 19.1.7 for blst's C, apt from a
  dated snapshot, crates by the tag's `Cargo.lock` (`--locked`).
- Reproducible: two independent builds (the second with the image rebuilt
  `--no-cache` and an empty target volume) gave the same bytes for every file.

## Changes from upstream's recipe

Upstream: `RUSTC_BOOTSTRAP=1 RUSTFLAGS='-C target-feature=+atomics,+bulk-memory' wasm-pack build --target web . -- -Z build-std=panic_abort,std`

1. **Seven linker arguments added, because without them there are no threads.**
   Up to Rust 1.91 rustc passed `--shared-memory`, `--import-memory`, `--max-memory`
   and the four `--export=__tls*` arguments itself when `atomics` was on; from 1.92
   it does not. Upstream's flags alone on 1.95.0 give a private memory and glue
   without thread support, while still exporting `initThreadPool`.
2. Maximum memory 4 GiB (rustc's old default was 1 GiB; a shared memory must declare one).
3. Two edits to wasm-bindgen-rayon's `workerHelpers.js` after the build (the
   `.wasm` is not affected): each worker thread gets an 8 MiB stack instead of
   wasm-bindgen's 2 MiB, and the helper imports the main module by file name
   instead of by directory (`import('../../..')` only resolves under a bundler; the
   extension loads these files as they are). The file says it was modified.

`build.sh` holds the reasons at length.

## What it is worth: measured

One machine, 21 November 2026: AMD Ryzen 7 9800X3D (8 cores, 16 threads), Windows 11,
Chromium 151, in an extension's offscreen document worker. Median of the proofs after
the first one; another application kept about 1.4 of the 16 threads busy.

| Proof | npm binary, 1 thread | this build, 8 threads | gain |
|---|---|---|---|
| DUST fee spend (k=13) | 7.90 s | 6.51 s | 1.2x |
| Zswap output (k=14) | 20.3 s | 15.9 s | 1.3x |
| Zswap spend (k=15) | 39.2 s | 29.1 s | 1.3x |

Threads on the DUST proof: 2 → 8.0 s, 4 → 6.8 s, 8 → 6.5 s, 16 → 6.4 s. The same
source built single-threaded with this toolchain takes 7.7 s, so the gain is the
threads, not the optimisation level.

**Why so little:** the largest step of each proof is multi-scalar multiplication,
done by the `blst` library on its own thread pool, and `blst` builds without that
pool on wasm32 (its `threadpool` dependency excludes the target). Only the parts
that use rayon run on several threads. The same proofs made natively on this
machine take 0.26 s, 0.73 s and 1.39 s.

Every proof from this build (2, 4, 8 and 16 threads, all three circuits) verified
against the pinned verifier keys with a native verifier built from the same
upstream source.

## Not known

- Stack depth: 8 MiB per worker is a margin, not a measured need, and a worker
  stack has no guard page.
- Memory beyond what these three proofs use; behaviour on machines with little memory.
- blst's C code is compiled without atomics and linked into the shared-memory
  module, as upstream's demo does. Its calls were only ever made from one thread
  at a time here.
- Chrome gives extension pages `SharedArrayBuffer` without cross-origin isolation
  headers. That is observed (Chromium 151), not documented; the loader checks for
  it and proves on one thread without it.

## Files

- `Dockerfile`, `build.sh`: the pinned build (`build.sh` runs inside the image).
- `build-in-docker.sh <out dir> [mt|st|mt-simd ...]`: host driver.
- `sanity.mjs`: loads a built package in Node and reads a circuit's size from its IR.
