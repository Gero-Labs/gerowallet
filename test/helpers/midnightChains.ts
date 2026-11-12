import { forgetMidnightLedgersForTests, noteMidnightProtocolVersion } from '@/chains/midnight/midnightLedger';

/** A protocol version below the ledger 9 fork (2000000): a chain on ledger 8. */
export const LEDGER8_PROTOCOL_VERSION = 1_000_000;
/** A ledger 9 protocol version (runtime 9.1.0.1 reports 2001100). */
export const LEDGER9_PROTOCOL_VERSION_SAMPLE = 2_001_100;

/**
 * What the chain reports, as `network → [tip protocol version, first block's]`.
 * Nothing is fetched: the wallet's ledger cache is filled as a read would.
 */
export function useMidnightChains(chains: Record<string, readonly [number, number]>): void {
  forgetMidnightLedgersForTests();
  for (const [network, [tip, genesis]] of Object.entries(chains)) noteMidnightProtocolVersion(network, tip, genesis);
}

/**
 * The chains most specs were written against: mainnet and preprod before the
 * ledger 9 upgrade, stagenet born on ledger 9. Specs about ledger selection,
 * or about mainnet and preprod on ledger 9, set their own with
 * `useMidnightChains` or clear it with `forgetMidnightLedgersForTests`.
 */
export function useDefaultMidnightChainsForTests(): void {
  useMidnightChains({
    mainnet: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION],
    preprod: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION],
    testnet: [LEDGER8_PROTOCOL_VERSION, LEDGER8_PROTOCOL_VERSION],
    stagenet: [LEDGER9_PROTOCOL_VERSION_SAMPLE, LEDGER9_PROTOCOL_VERSION_SAMPLE],
  });
}
