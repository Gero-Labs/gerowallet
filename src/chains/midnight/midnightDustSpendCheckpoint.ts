// The ledger 9 DUST light sync's checkpoint (DustSpendCheckpoint): where each
// of the wallet's DUST spend chains stood at the last reconstruction, so the
// next fee build scans only the blocks after it instead of every DUST spend
// since the ledger 9 crossing (a full scan of one nullifier prefix took
// ~150 s on mainnet on 2026-11-16, and grows with the chain).
//
// STORAGE: the Midnight wallet-state store (midnightWalletStatePersistence):
// the extension's own IndexedDB, keyed by a one-way hash of the DUST seed, and
// cleared with the other Midnight checkpoints on a chain reset or a forced
// re-sync. Never chrome.storage: the heads are the wallet's own coins.
//
// CORRECTNESS: a checkpoint is a hint, never trusted for a security decision.
// One from another chain (genesis or generation) or of another shape is
// ignored; a head that does not fit its chain is rescanned from the start
// (reconstructDustState). A load or save failure only costs a full scan.

import type { MidnightChainIdentity } from './midnightChainIdentity';
import type { DustSpendCheckpoint } from './midnightDustLightSync';
import { loadWalletState, saveWalletState } from './midnightWalletStatePersistence';

const KIND = 'dust-light9';
const VERSION = 1;

interface StoredDustSpendCheckpoint {
  version: number;
  genesisHash: string;
  chainGeneration: number;
  checkpoint: DustSpendCheckpoint;
}

export async function loadDustSpendCheckpoint(
  network: string, dustSecretSeed: Uint8Array, identity: MidnightChainIdentity,
): Promise<DustSpendCheckpoint | null> {
  try {
    const raw = await loadWalletState(network, KIND, dustSecretSeed);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredDustSpendCheckpoint>;
    if (stored?.version !== VERSION || stored.genesisHash !== identity.genesis_hash
      || stored.chainGeneration !== identity.chain_generation
      || !stored.checkpoint || typeof stored.checkpoint !== 'object') return null;
    return stored.checkpoint;
  } catch {
    return null;
  }
}

export async function saveDustSpendCheckpoint(
  network: string, dustSecretSeed: Uint8Array, identity: MidnightChainIdentity, checkpoint: DustSpendCheckpoint,
): Promise<void> {
  const stored: StoredDustSpendCheckpoint = {
    version: VERSION, genesisHash: identity.genesis_hash, chainGeneration: identity.chain_generation, checkpoint,
  };
  try {
    await saveWalletState(network, KIND, dustSecretSeed, JSON.stringify(stored));
  } catch {
    // Best-effort: the next build scans from the start.
  }
}
