import { midnightProofServerTag } from '@/chains/midnight/midnightConfig';
import type { UnprovenTransaction as Ledger8UnprovenTransaction } from '@midnight-ntwrk/ledger-v8';
import type { UnprovenTransaction as Ledger9UnprovenTransaction } from '@midnightntwrk/ledger-v9';

export type LocalProverProfile = 'legacy' | 'stagenet';

export function localProverProfile(value: unknown): LocalProverProfile {
  return value === 'stagenet' ? 'stagenet' : 'legacy';
}

/** One explicitly configured server; Cardano pairing does not choose its ledger. */
export function localProverTag(profile: LocalProverProfile): string {
  return midnightProofServerTag(profile === 'stagenet' ? 'stagenet' : 'mainnet');
}

/** Validate actual serialized bytes, not the peer's advertised version string. */
export async function assertLocalProverPayload(payload: Uint8Array, profile: LocalProverProfile): Promise<void> {
  try {
    if (profile === 'stagenet') {
      const ledger = await import('@midnightntwrk/ledger-v9');
      const tx: Ledger9UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', payload);
      ledger.Transaction.fromParts('stagenet').merge(tx);
    } else {
      const ledger = await import('@midnight-ntwrk/ledger-v8');
      const tx: Ledger8UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', payload);
      try { ledger.Transaction.fromParts('mainnet').merge(tx); }
      catch { ledger.Transaction.fromParts('preprod').merge(tx); }
    }
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
