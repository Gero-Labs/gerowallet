/**
 * Starts the multi-threaded build of the prover (midnightZkirThreads.ts), or
 * says why it cannot be used. Runs in the offscreen prover worker; the two
 * things it does to the outside world (read a file, import a module) are
 * injected, so the order of checks is tested without a browser.
 *
 * Order: nothing of the package runs before every file of it has been hashed
 * against its pin. Nothing here throws: every failure is a reason, and the
 * caller then proves with the standard build.
 */
import { readVerifiedZkFile } from './midnightZkKeyMaterial';
import {
  midnightZkirMtFiles,
  type MidnightZkirMtPackage,
  type ThreadedProvingUnavailable,
} from './midnightZkirThreads';

/** What the threaded glue exports beyond the standard prover's API. */
export interface ThreadedZkirModule {
  /** Instantiates the WebAssembly module from bytes this loader has verified. */
  default(input: { module_or_path: BufferSource }): Promise<unknown>;
  /** Starts `threads` worker threads sharing the prover's memory. */
  initThreadPool(threads: number): Promise<unknown>;
}

export type ThreadedZkirLoad<M> =
  | { ok: true; zkir: M; threads: number }
  | { ok: false; reason: ThreadedProvingUnavailable };

export async function startThreadedZkir<M extends ThreadedZkirModule>(deps: {
  pkg: MidnightZkirMtPackage | null;
  /** From `threadedProvingPlan`: 0 threads carries the reason. */
  plan: { threads: number; reason?: ThreadedProvingUnavailable };
  /** Bytes of one package file, by its name. */
  readFile(name: string): Promise<Uint8Array>;
  /** `import()` of the glue, by its name. */
  importGlue(name: string): Promise<M>;
}): Promise<ThreadedZkirLoad<M>> {
  const { pkg, plan } = deps;
  if (!pkg) return { ok: false, reason: 'not-shipped' };
  if (plan.threads < 2) return { ok: false, reason: plan.reason ?? 'single-core' };
  let wasm: Uint8Array | undefined;
  try {
    for (const file of midnightZkirMtFiles(pkg)) {
      const bytes = await readVerifiedZkFile(() => deps.readFile(file.name), { ...file, hostPath: file.name, source: 'bundled' });
      if (file === pkg.wasm) wasm = bytes;
    }
  } catch {
    return { ok: false, reason: 'package-invalid' };
  }
  if (!wasm) return { ok: false, reason: 'package-invalid' };
  try {
    const zkir = await deps.importGlue(pkg.glue.name);
    await zkir.default({ module_or_path: wasm as unknown as BufferSource });
    await zkir.initThreadPool(plan.threads);
    return { ok: true, zkir, threads: plan.threads };
  } catch {
    return { ok: false, reason: 'failed-to-start' };
  }
}
