import { midnightProofServerTagForLedger } from '@/chains/midnight/midnightConfig';
import type { UnprovenTransaction as Ledger8UnprovenTransaction } from '@midnight-ntwrk/ledger-v8';
import type { UnprovenTransaction as Ledger9UnprovenTransaction } from '@midnightntwrk/ledger-v9';

/**
 * Which proof server this device serves to paired phones, by ledger, never by
 * network: `ledger9` (mainnet, preprod, Preview and Stagenet all run ledger 9)
 * or `legacy` (ledger 8, for a phone still building ledger 8 transactions).
 * The wire carries only the server's release tag (`proverLedgerVersion`).
 */
export type LocalProverProfile = 'legacy' | 'ledger9';

/** `stagenet`, the earlier name of the ledger 9 profile, still reads as it. */
export function localProverProfile(value: unknown): LocalProverProfile {
  return value === 'ledger9' || value === 'stagenet' ? 'ledger9' : 'legacy';
}

/** One explicitly configured server; Cardano pairing does not choose its ledger. */
export function localProverTag(profile: LocalProverProfile): string {
  return midnightProofServerTagForLedger(profile === 'ledger9' ? 9 : 8);
}

/** The networks a served transaction may belong to. Its own bytes say which. */
const NETWORKS = ['mainnet', 'preprod', 'preview', 'stagenet'] as const;

/** Validate actual serialized bytes, not the peer's advertised version string. */
export async function assertLocalProverPayload(payload: Uint8Array, profile: LocalProverProfile): Promise<void> {
  try {
    const ledger = profile === 'ledger9' ? await import('@midnightntwrk/ledger-v9') : await import('@midnight-ntwrk/ledger-v8');
    const tx = (ledger.Transaction as unknown as {
      deserialize(s: string, p: string, b: string, raw: Uint8Array): Ledger8UnprovenTransaction & Ledger9UnprovenTransaction;
    }).deserialize('signature', 'pre-proof', 'pre-binding', payload);
    // The ledger refuses to merge transactions of different networks: the bytes must name one we know.
    const known = NETWORKS.some((network) => {
      try { (ledger.Transaction.fromParts(network) as unknown as { merge(other: unknown): unknown }).merge(tx); return true; } catch { return false; }
    });
    if (!known) throw new Error('unknown network');
  } catch {
    // WASM errors can include serialized witness material; expose a fixed error.
    throw new Error('Transaction does not match the selected local prover profile');
  }
}

export function createLocalProverServingOptions(profile: LocalProverProfile, deps: {
  isAdvertised: () => boolean;
  isServingEnabled: (deviceId: string) => boolean;
  checkProverHealth: () => Promise<boolean>;
  prove: (payload: Uint8Array) => Promise<Uint8Array>;
}) {
  const ledgerVersion = localProverTag(profile);
  return {
    getProver: () => (deps.isAdvertised() ? { hasProver: true, proverLedgerVersion: ledgerVersion } : undefined),
    serving: {
      ledgerVersion,
      isServingEnabled: deps.isServingEnabled,
      checkProverHealth: deps.checkProverHealth,
      async prove(payload: Uint8Array): Promise<Uint8Array> {
        await assertLocalProverPayload(payload, profile);
        return deps.prove(payload);
      },
    },
  };
}
