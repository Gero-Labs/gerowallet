/**
 * DApp Connector `balanceUnsealedTransaction` — the pure, testable half:
 * request validation, decoding of the dapp's proven-but-unbound transaction,
 * and the "what will the wallet contribute" summary the approval panel shows.
 * The balancing pipeline itself lives in `midnightDappBalancer.ts`.
 *
 * Ledger 8 only (Preprod / Mainnet). Stagenet balancing is rejected up front.
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { midnightLedgerVersion } from './midnightLedger';

/** 2 MiB of transaction bytes; a contract call is a few hundred KB at most. */
export const CONNECTOR_BALANCE_MAX_BYTES = 2 * 1024 * 1024;

export type ConnectorBalanceValidation =
  | { ok: true; tx: string; payFees: true }
  | { ok: false; reason: string };

/**
 * Shape-check a `balanceUnsealedTransaction` request BEFORE prompting the
 * user, so an unsupported request rejects cleanly without an approval dialog.
 */
export function validateConnectorBalanceRequest(data: unknown, network: string): ConnectorBalanceValidation {
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'request must be an object' };
  const { tx, options } = data as { tx?: unknown; options?: unknown };
  if (typeof tx !== 'string' || tx.length === 0) return { ok: false, reason: 'tx is required' };
  if (tx.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(tx)) return { ok: false, reason: 'tx must be hex' };
  if (tx.length / 2 > CONNECTOR_BALANCE_MAX_BYTES) return { ok: false, reason: 'tx is too large to balance' };
  const payFees = (options as { payFees?: unknown } | undefined)?.payFees;
  if (payFees !== undefined && payFees !== true) {
    return { ok: false, reason: 'payFees:false is not supported in this version (GeroWallet pays DUST fees; fee delegation is planned)' };
  }
  let version: number;
  try {
    version = midnightLedgerVersion(network);
  } catch {
    return { ok: false, reason: `Unsupported Midnight network: ${network}` };
  }
  if (version !== 8) return { ok: false, reason: 'balanceUnsealedTransaction is not supported on Stagenet in this version' };
  return { ok: true, tx, payFees: true };
}

/** `Transaction<SignatureEnabled, Proof, PreBinding>` — what the spec passes to balanceUnsealedTransaction. */
export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

type DeserializableTx = {
  deserialize: (s: string, p: string, b: string, raw: Uint8Array) => UnboundTransaction;
};

/**
 * A prover that must never be reached. Proving a circuit-free envelope makes
 * no `/check` or `/prove` call, so this only turns marker types, and throws
 * loudly if that assumption ever breaks.
 */
const unreachableProver: ledger.ProvingProvider = {
  check: async () => { throw new Error('unexpected proof-server call while building an empty envelope'); },
  prove: async () => { throw new Error('unexpected proof-server call while building an empty envelope'); },
};

/**
 * Decode `signature / proof / pre-binding` and prove it belongs to
 * `sdkNetworkId`: the ledger refuses to merge transactions from different
 * networks, so merging into an empty PROVEN envelope of the expected network
 * (the markers must match too) is the check. The merge result is discarded.
 */
export async function decodeUnboundTransaction(hex: string, sdkNetworkId: string): Promise<UnboundTransaction> {
  const Tx = ledger.Transaction as unknown as DeserializableTx;
  const tx = Tx.deserialize('signature', 'proof', 'pre-binding', Buffer.from(hex, 'hex'));
  const envelope = await ledger.Transaction.fromParts(sdkNetworkId)
    .prove(unreachableProver, ledger.CostModel.initialCostModel()) as unknown as { merge: (other: unknown) => unknown };
  envelope.merge(tx);
  return tx;
}

export interface ConnectorContribution {
  /** Raw 32-byte colour as hex; the all-zero colour is native NIGHT. */
  token: string;
  /** Base units, decimal string. */
  amount: string;
}

/**
 * What the wallet must supply, per unshielded colour, across the guaranteed
 * section and every intent — the deficits `Transaction.imbalances()` reports.
 * Surpluses (change the wallet will receive) are not listed.
 */
export function summarizeContributions(
  tx: { intents?: Map<number, unknown>; imbalances(segment: number): Map<ledger.TokenType, bigint> },
): ConnectorContribution[] {
  const totals = new Map<string, bigint>();
  const segments = new Set<number>([0, ...(tx.intents ? [...tx.intents.keys()] : [])]);
  for (const segment of segments) {
    for (const [token, value] of tx.imbalances(segment)) {
      if (token.tag !== 'unshielded' || value >= 0n) continue;
      totals.set(token.raw, (totals.get(token.raw) ?? 0n) - value);
    }
  }
  return [...totals].map(([token, amount]) => ({ token, amount: amount.toString() }));
}

/**
 * True when `hex` parses as a sealed (`signature / proof / binding`)
 * transaction under the network's ledger — i.e. it must go to Nexus's
 * submit-proven relay, not the prove-and-finalize one.
 */
export async function isSealedMidnightTransaction(hex: string, sdkNetworkId: string): Promise<boolean> {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return false;
  let version: number;
  try {
    version = midnightLedgerVersion(sdkNetworkId);
  } catch {
    return false;
  }
  const mod = version === 9 ? await import('@midnightntwrk/ledger-v9') : await import('@midnight-ntwrk/ledger-v8');
  try {
    (mod.Transaction as unknown as { deserialize: (s: string, p: string, b: string, raw: Uint8Array) => unknown })
      .deserialize('signature', 'proof', 'binding', Buffer.from(hex, 'hex'));
    return true;
  } catch {
    return false;
  }
}
