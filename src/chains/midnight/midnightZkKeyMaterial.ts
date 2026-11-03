/**
 * The key-material provider zkir proves with on this device: the pinned
 * built-in keys of midnightZkKeys.ts, read through an injected fetcher and
 * checked against their size and SHA-256 before zkir ever sees them.
 *
 * Runs in the offscreen prover worker (midnightDeviceProverWorker.ts) and in
 * Node tests; nothing here touches chrome APIs or the network itself.
 */

import {
  allowedMidnightZkCircuits,
  MIDNIGHT_SRS_FILES,
  type MidnightZkCircuit,
  type MidnightZkFile,
} from './midnightZkKeys';

/** The zkir-v2 key-material shape (`@midnight-ntwrk/zkir-v2` KeyMaterialProvider). */
export interface ZkirKeyMaterialProvider {
  lookupKey(keyLocation: string): Promise<{ proverKey: Uint8Array; verifierKey: Uint8Array; ir: Uint8Array } | undefined>;
  getParams(k: number): Promise<Uint8Array>;
}

/** The part of the zkir-v2 module this file needs: reading a circuit's size from its IR. */
export interface ZkirIr {
  Zkir: { deserialize(bytes: Uint8Array): { getK(): number } };
}

/** Reads one file's bytes. Integrity is checked here, not by the fetcher. */
export type FetchZkFile = (file: MidnightZkFile) => Promise<Uint8Array>;

/** A key file that is missing, the wrong size, or does not hash to its pin. */
export class MidnightZkKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidnightZkKeyError';
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetches `file` and returns its bytes only if they match the pin. */
export async function readVerifiedZkFile(fetchFile: FetchZkFile, file: MidnightZkFile): Promise<Uint8Array> {
  const bytes = await fetchFile(file);
  if (bytes.length !== file.bytes) {
    throw new MidnightZkKeyError(`Proving key ${file.name} has ${bytes.length} bytes, expected ${file.bytes}`);
  }
  if (await sha256Hex(bytes) !== file.sha256) {
    throw new MidnightZkKeyError(`Proving key ${file.name} does not match its pinned hash`);
  }
  return bytes;
}

export interface PinnedKeyMaterial extends ZkirKeyMaterialProvider {
  /** Reads and verifies every file of one circuit, and checks the IR's k against the pin. */
  preload(keyLocation: string): Promise<void>;
}

/**
 * The provider for one proving session. `shielded` widens it from the DUST
 * fee circuit to the Zswap circuits; nothing else ever resolves. Verified
 * bytes are cached for the provider's lifetime, so a transaction with several
 * proofs of one circuit reads its keys once.
 */
export function makePinnedKeyMaterial(
  fetchFile: FetchZkFile,
  zkir: ZkirIr,
  options: { shielded: boolean },
): PinnedKeyMaterial {
  const circuits = new Map<string, MidnightZkCircuit>(
    allowedMidnightZkCircuits(options.shielded).map((c) => [c.keyLocation, c]),
  );
  const allowedK = new Set([...circuits.values()].map((c) => c.k));
  const cache = new Map<string, Promise<Uint8Array>>();
  const checkedK = new Set<string>();

  const read = (f: MidnightZkFile): Promise<Uint8Array> => {
    let hit = cache.get(f.name);
    if (!hit) {
      hit = readVerifiedZkFile(fetchFile, f);
      // A failed read is not remembered: the next proof tries again.
      hit.catch(() => cache.delete(f.name));
      cache.set(f.name, hit);
    }
    return hit;
  };

  const circuitFor = (keyLocation: string): MidnightZkCircuit | undefined => circuits.get(keyLocation);

  const material = async (circuit: MidnightZkCircuit) => {
    const [proverKey, verifierKey, ir] = await Promise.all([read(circuit.prover), read(circuit.verifier), read(circuit.ir)]);
    if (!checkedK.has(circuit.keyLocation)) {
      // The IR is pinned, so this only fails if the pin table itself is wrong.
      if (zkir.Zkir.deserialize(ir).getK() !== circuit.k) {
        throw new MidnightZkKeyError(`Circuit ${circuit.keyLocation} does not have k=${circuit.k}`);
      }
      checkedK.add(circuit.keyLocation);
    }
    return { proverKey, verifierKey, ir };
  };

  return {
    async preload(keyLocation) {
      const circuit = circuitFor(keyLocation);
      if (!circuit) throw new MidnightZkKeyError(`No on-device key for circuit ${keyLocation}`);
      await Promise.all([material(circuit), read(MIDNIGHT_SRS_FILES[circuit.k])]);
    },
    async lookupKey(keyLocation) {
      const circuit = circuitFor(keyLocation);
      return circuit ? material(circuit) : undefined;
    },
    async getParams(k) {
      const srs = MIDNIGHT_SRS_FILES[k];
      if (!srs || !allowedK.has(k)) throw new MidnightZkKeyError(`No on-device parameters for k=${k}`);
      return read(srs);
    },
  };
}
