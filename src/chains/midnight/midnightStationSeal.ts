// Seal an unshielded send WITHOUT a DUST fee, for Gero's fee station to pay.
//
// The normal send adds the wallet's own DUST fee intent before proving
// (midnightLedger9.ts). Here nothing is added: the transaction Nexus built is
// checked, turned into a proven one (a plain unshielded send has no circuit,
// so no prover runs), signed and bound. The station merges its own sealed fee
// transaction into these bytes; a merge needs both sides sealed.
//
// A sealed transaction can be merged by ANYONE who sees it, so it must be
// exactly balanced: a surplus of any token would be there for the merging
// party to take. The built-transaction guard (midnightBuiltTxGuard.ts) checks
// who is paid; this file checks that nothing is left over.
//
// PRIVACY: never log tx hex or keys. Sizes and counts only.

import * as ledger from '@midnightntwrk/ledger-v9';
import { MidnightLedgerChangedError, midnightLedgerKey, midnightLedgerVersion } from './midnightLedger';
import { resolveMidnightLedger } from './midnightChainLedger';
import { deserializeLedger9Transaction, ledger9Keystore, signLedger9Intents } from './midnightLedger9';
import { normalizeMidnightTxHash } from './midnightTxHash';

/** The transaction is not a single fee-less unshielded intent. */
export const MIDNIGHT_STATION_TX_SHAPE = 'MIDNIGHT_STATION_TX_SHAPE';
/** Inputs and outputs differ in some token: a merging party could take the difference. */
export const MIDNIGHT_STATION_TX_UNBALANCED = 'MIDNIGHT_STATION_TX_UNBALANCED';

export interface SealForStationArgs {
  /** SDK network ID: 'mainnet' / 'preprod' / ... */
  readonly sdkNetworkId: string;
  /** Hex of the unproven transfer Nexus built, already checked by `assertMidnightTransferMatches`. */
  readonly unprovenTxHex: string;
  /** Sender's NightExternal secret key. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
}

export interface SealedForStation {
  /** Sealed (`signature / proof / binding`) ledger 9 tx hex, with no fee in it. */
  readonly sealedTxHex: string;
  /** The transaction's ledger identifiers: they survive the station's merge. */
  readonly identifiers: string[];
}

/** A transaction without a DUST spend has no circuit: proving only turns the markers. */
const noCircuitProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call while sealing a fee-less send'); },
  prove: async () => { throw new Error('unexpected proof-server call while sealing a fee-less send'); },
  lookupKey: async () => undefined,
};

function requireLedger9(network: string, current: number | undefined): void {
  if (current !== 9) throw new MidnightLedgerChangedError(network, midnightLedgerVersion(network));
}

/** Throws unless `tx` is one intent holding only unshielded offers, balanced in every token. */
function assertFeelessBalancedSend(tx: ledger.UnprovenTransaction): void {
  const intents = [...(tx.intents?.entries() ?? [])];
  if (intents.length !== 1) throw new Error(MIDNIGHT_STATION_TX_SHAPE);
  const [segment, intent] = intents[0];
  if (tx.guaranteedOffer || (tx.fallibleOffer && tx.fallibleOffer.size > 0)) throw new Error(MIDNIGHT_STATION_TX_SHAPE);
  if (intent.dustActions !== undefined || intent.actions.length > 0) throw new Error(MIDNIGHT_STATION_TX_SHAPE);
  if (!intent.guaranteedUnshieldedOffer && !intent.fallibleUnshieldedOffer) throw new Error(MIDNIGHT_STATION_TX_SHAPE);
  // Segment 0 is the guaranteed section; the intent's own segment holds its fallible offer.
  for (const section of new Set([0, segment])) {
    for (const [, value] of tx.imbalances(section)) {
      if (value !== 0n) throw new Error(MIDNIGHT_STATION_TX_UNBALANCED);
    }
  }
}

export async function sealTransferForStation(args: SealForStationArgs): Promise<SealedForStation> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  requireLedger9(network, await resolveMidnightLedger(network));
  const tx = deserializeLedger9Transaction(network, args.unprovenTxHex);
  assertFeelessBalancedSend(tx);
  const proven = await tx.prove(noCircuitProver, ledger.CostModel.initialCostModel());
  const sealed = signLedger9Intents(proven, ledger9Keystore(args.unshieldedSecretKey, network)).bind();
  // Never hand out ledger 9 bytes for a chain that has moved on while this ran.
  requireLedger9(network, await resolveMidnightLedger(network));
  return {
    sealedTxHex: Buffer.from(sealed.serialize()).toString('hex'),
    identifiers: sealed.identifiers().map(normalizeMidnightTxHash).filter(id => id.length > 0),
  };
}
