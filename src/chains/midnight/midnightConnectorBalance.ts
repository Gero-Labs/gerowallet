/**
 * DApp Connector `balanceUnsealedTransaction` — the pure, testable half:
 * request validation, decoding of the dapp's proven-but-unbound transaction,
 * and the "what will the wallet contribute" summary the approval panel shows.
 * The balancing pipeline itself lives in `midnightDappBalancer.ts`.
 *
 * Routed by the ledger the chain runs: ledger 8 decodes with ledger-v8 and
 * balances in `midnightDappBalancer.ts`, ledger 9 with ledger-v9 in
 * `midnightDappBalancer9.ts`. Never by the network's name.
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as ledger9 from '@midnightntwrk/ledger-v9';
import { knownMidnightLedger, midnightLedgerKey, midnightNetworkName, type MidnightLedger } from './midnightLedger';
import { resolveMidnightLedger } from './midnightChainLedger';
import { decodeUnboundTransaction9 } from './midnightDappBalancer9';
// Static: in the background's single iife an inlined dynamic import is read through a
// namespace const that lands after this module (scripts/check-bundle-tdz.mjs).
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';

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
  // The caller reads the chain's ledger first (resolveMidnightLedger); both ledgers balance.
  if (knownMidnightLedger(network) === undefined) {
    return { ok: false, reason: `Could not read which ledger Midnight ${midnightNetworkName(network)} runs` };
  }
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
export const unreachableProver: ledger.ProvingProvider = {
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

/** The unshielded offers of `tx`, guaranteed and fallible, across every intent. */
type OfferView = {
  readonly inputs: ReadonlyArray<{ readonly owner: ledger.SignatureVerifyingKey }>;
  readonly outputs: ReadonlyArray<{ readonly owner: ledger.UserAddress; readonly value: bigint; readonly type: ledger.RawTokenType }>;
};
type TxWithIntents = { intents?: Map<number, unknown> };

function unshieldedOffers(tx: TxWithIntents): OfferView[] {
  const offers: OfferView[] = [];
  for (const intent of tx.intents?.values() ?? []) {
    const { guaranteedUnshieldedOffer, fallibleUnshieldedOffer } = intent as {
      guaranteedUnshieldedOffer?: OfferView; fallibleUnshieldedOffer?: OfferView;
    };
    if (guaranteedUnshieldedOffer) offers.push(guaranteedUnshieldedOffer);
    if (fallibleUnshieldedOffer) offers.push(fallibleUnshieldedOffer);
  }
  return offers;
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * How many unshielded inputs of the dapp's `tx` spend from the wallet's own
 * address (`ownAddress`, a `UserAddress` hex). A dapp never needs one: the
 * wallet adds its own inputs when it balances. The signer signs every input
 * the wallet owns, so an input the dapp put in would spend the user's coins
 * without appearing in the approval, which lists only what balancing adds.
 */
export function countWalletOwnedInputs(
  tx: TxWithIntents,
  ownAddress: string,
  addressOfKey: (key: ledger.SignatureVerifyingKey) => ledger.UserAddress = ledger.addressFromKey,
): number {
  let count = 0;
  for (const offer of unshieldedOffers(tx)) {
    for (const input of offer.inputs) if (sameAddress(addressOfKey(input.owner), ownAddress)) count++;
  }
  return count;
}

export interface ConnectorPayment {
  /** Raw 32-byte colour as hex; the all-zero colour is native NIGHT. */
  token: string;
  /** Base units, decimal string. */
  amount: string;
  /** The receiving `UserAddress`, as hex (callers render it as bech32m). */
  recipient: string;
}

/**
 * Where the dapp's `tx` sends unshielded value: every output that does not pay
 * the wallet, totalled per recipient and colour, so the approval shows who
 * gets paid and not only what the wallet adds.
 */
export function summarizeForeignPayments(tx: TxWithIntents, ownAddress: string): ConnectorPayment[] {
  const totals = new Map<string, ConnectorPayment & { sum: bigint }>();
  for (const offer of unshieldedOffers(tx)) {
    for (const output of offer.outputs) {
      if (sameAddress(output.owner, ownAddress)) continue;
      const key = `${output.owner.toLowerCase()}:${output.type}`;
      const entry = totals.get(key) ?? { token: output.type, recipient: output.owner, amount: '0', sum: 0n };
      entry.sum += output.value;
      totals.set(key, entry);
    }
  }
  return [...totals.values()].map(({ token, recipient, sum }) => ({ token, recipient, amount: sum.toString() }));
}

/** Converts between an unshielded bech32m address (`mn_addr_…`) and its `UserAddress` hex. */
export async function unshieldedAddressCodec(sdkNetworkId: string): Promise<{
  toHex(bech32: string): string;
  toBech32(hex: string): string;
}> {
  return {
    toHex: (bech32) => UnshieldedAddress.codec.decode(sdkNetworkId, MidnightBech32m.parse(bech32)).hexString,
    toBech32: (hex) => UnshieldedAddress.codec.encode(sdkNetworkId, new UnshieldedAddress(Buffer.from(hex, 'hex'))).asString(),
  };
}

export type ConnectorBalancePrompt =
  | { ok: true; contributions: ConnectorContribution[]; payments: ConnectorPayment[] }
  | { ok: false; reason: string };

/**
 * What the `balanceUnsealedTransaction` approval shows, built before the user
 * is asked: what the wallet adds (`contributions`) and whom the dapp's
 * transaction pays (`payments`, recipients as bech32m). Refuses a transaction
 * that already spends from the wallet (see countWalletOwnedInputs).
 *
 * `ownAddress` is the wallet's unshielded bech32m address. When it is unknown
 * every output is listed as a payment, and the balancer, which knows the
 * signing key, makes the own-input check before signing in any case.
 */
export async function connectorBalancePrompt(
  txHex: string,
  sdkNetworkId: string,
  ownAddress: string,
): Promise<ConnectorBalancePrompt> {
  let version: MidnightLedger;
  try {
    version = await resolveMidnightLedger(sdkNetworkId);
  } catch {
    return { ok: false, reason: `Could not read which ledger Midnight ${midnightNetworkName(sdkNetworkId)} runs` };
  }
  let tx: UnboundTransaction;
  try {
    tx = version === 9
      ? decodeUnboundTransaction9(txHex, sdkNetworkId) as unknown as UnboundTransaction
      : await decodeUnboundTransaction(txHex, sdkNetworkId);
  } catch {
    return { ok: false, reason: `tx is not a valid unsealed ledger ${version} transaction for Midnight ${midnightNetworkName(sdkNetworkId)}` };
  }
  const codec = await unshieldedAddressCodec(sdkNetworkId);
  let ownHex = '';
  try {
    ownHex = ownAddress ? codec.toHex(ownAddress) : '';
  } catch {
    ownHex = '';
  }
  // Ledger 9 tags verifying keys ({ tag, value }); its own addressFromKey reads them.
  const addressOfKey = version === 9
    ? (key: ledger.SignatureVerifyingKey) => ledger9.addressFromKey(key as unknown as ledger9.SignatureVerifyingKey)
    : ledger.addressFromKey;
  if (ownHex && countWalletOwnedInputs(tx, ownHex, addressOfKey) > 0) {
    return { ok: false, reason: 'tx already spends from this wallet; the wallet adds its own inputs when it balances' };
  }
  const payments = summarizeForeignPayments(tx, ownHex).map((payment) => {
    try {
      return { ...payment, recipient: codec.toBech32(payment.recipient) };
    } catch {
      return payment;
    }
  });
  return { ok: true, contributions: summarizeContributions(tx), payments };
}

type Deserializer = { deserialize: (s: string, p: string, b: string, raw: Uint8Array) => unknown };

/** Whether `bytes` read as a transaction of this ledger module with these markers. */
function readsAs(mod: { Transaction: unknown }, bytes: Uint8Array, proof: string, binding: string): boolean {
  try {
    (mod.Transaction as Deserializer).deserialize('signature', proof, binding, bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * How a dapp's `submitTransaction` bytes relate to the chain: `sealed` (proven
 * and bound for the chain's ledger: Nexus's submit-proven relay), `unsealed`
 * (anything else; only Gero Cloud's prove-and-submit can take it), or
 * `otherLedger` (a transaction of the ledger the chain does not run, which no
 * route can submit). Judged by the ledger the chain reports, never the name.
 */
export type ConnectorSubmission =
  | { kind: 'sealed' | 'unsealed'; ledger: MidnightLedger }
  | { kind: 'otherLedger'; ledger: MidnightLedger; txLedger: MidnightLedger };

export async function classifyConnectorSubmission(hex: string, sdkNetworkId: string): Promise<ConnectorSubmission> {
  const version = await resolveMidnightLedger(sdkNetworkId);
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return { kind: 'unsealed', ledger: version };
  const bytes = Buffer.from(hex, 'hex');
  const own = version === 9 ? ledger9 : ledger;
  const other = version === 9 ? ledger : ledger9;
  if (readsAs(own, bytes, 'proof', 'binding')) return { kind: 'sealed', ledger: version };
  const markers: Array<[string, string]> = [['proof', 'binding'], ['proof', 'pre-binding'], ['pre-proof', 'pre-binding']];
  if (markers.some(([proof, binding]) => readsAs(other, bytes, proof, binding))) {
    return { kind: 'otherLedger', ledger: version, txLedger: version === 9 ? 8 : 9 };
  }
  return { kind: 'unsealed', ledger: version };
}

/** The reason a dapp gets for a transaction of the other ledger. */
export function otherLedgerSubmissionReason(sdkNetworkId: string, submission: Extract<ConnectorSubmission, { kind: 'otherLedger' }>): string {
  return `This is a ledger ${submission.txLedger} transaction; Midnight ${midnightNetworkName(midnightLedgerKey(sdkNetworkId))} runs ledger ${submission.ledger}. Build it again with a library for ledger ${submission.ledger}.`;
}

/**
 * True when `hex` parses as a sealed (`signature / proof / binding`)
 * transaction under the chain's ledger — i.e. it must go to Nexus's
 * submit-proven relay, not the prove-and-finalize one. False when the chain's
 * ledger can't be read.
 */
export async function isSealedMidnightTransaction(hex: string, sdkNetworkId: string): Promise<boolean> {
  try {
    return (await classifyConnectorSubmission(hex, sdkNetworkId)).kind === 'sealed';
  } catch {
    return false;
  }
}
