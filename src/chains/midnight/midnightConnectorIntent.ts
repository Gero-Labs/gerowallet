/**
 * DApp Connector `makeIntent` — request validation, the pure half.
 *
 * Spec (dapp-connector-api 4.1.0): `makeIntent(desiredInputs, desiredOutputs,
 * { intentId, payFees })` returns a SEALED but purposefully imbalanced
 * transaction: a surplus of the `desiredInputs` (what the wallet gives) and a
 * shortage of the `desiredOutputs` (what the wallet wants), for another party
 * to mirror or balance (a swap).
 *
 * This version supports public (unshielded) legs, on a chain running ledger 8
 * (midnightIntentBuilder.ts) or ledger 9 (midnightIntentBuilder9.ts), read from
 * the chain. Shielded legs, give-only intents and an unread chain reject with
 * InvalidRequest before the user is prompted. The worker re-runs this
 * validation; the page's copy is never trusted.
 *
 * Also the parts both ledgers' builders share: the check of the built intent
 * against the request, the segment choice, the TTL and the refusals. This
 * module imports no ledger: the background loads it statically.
 */

import { knownMidnightLedger, midnightNetworkName } from './midnightLedger';
import { isUnshieldedRecipient, unshieldedAddressPrefix } from './midnightConnectorTransfer';
import type { MidnightConnectorOutput } from './midnightConnectorTransfer';
import { isNativeNight, midnightTokenBalances } from './midnightTokenBalances';
import type { MidnightUnshieldedUtxo } from './midnightTypes';

/** Native NIGHT's raw colour. */
export const NIGHT_RAW_TOKEN_TYPE = '00'.repeat(32);

/** Same per-request bound as makeTransfer. */
export const CONNECTOR_INTENT_MAX_ENTRIES = 100;

/** Ledger segment ids: 0 is the guaranteed section, ids are u16. */
export const INTENT_SEGMENT_MIN = 1;
export const INTENT_SEGMENT_MAX = 65_535;

export type ConnectorIntentId = number | 'random';

export interface ConnectorIntentInput {
  /** Raw 32-byte colour, lower-case hex. */
  type: string;
  /** Base units, decimal string. */
  value: string;
}

export interface ConnectorIntentRequest {
  /** What the wallet gives, one entry per colour (duplicates summed). */
  inputs: ConnectorIntentInput[];
  /** What the wallet wants, in request order. */
  outputs: MidnightConnectorOutput[];
  intentId: ConnectorIntentId;
  payFees: boolean;
}

export type ConnectorIntentValidation =
  | ({ ok: true } & ConnectorIntentRequest)
  | { ok: false; reason: string };

/** The fields a connector entry may carry; anything else is ignored. */
type RawEntry = { kind?: unknown; type?: unknown; value?: unknown; recipient?: unknown };
type RawOptions = { intentId?: unknown; payFees?: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** An empty or missing colour means native NIGHT, as in makeTransfer. */
function parseTokenType(raw: unknown): string | undefined {
  const type = raw === undefined || raw === '' ? NIGHT_RAW_TOKEN_TYPE : raw;
  return typeof type === 'string' && /^[0-9a-fA-F]{64}$/.test(type) ? type.toLowerCase() : undefined;
}

/** The bridge sends bigints as decimal strings; bound the parse and refuse coercions. */
function parseAmount(raw: unknown): bigint | undefined {
  if (typeof raw !== 'string' || !/^[0-9]{1,80}$/.test(raw)) return undefined;
  const value = BigInt(raw);
  return value > 0n ? value : undefined;
}

function parseIntentId(raw: unknown): ConnectorIntentId | undefined {
  if (raw === 'random') return 'random';
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= INTENT_SEGMENT_MIN && raw <= INTENT_SEGMENT_MAX) return raw;
  return undefined;
}

/** Validate and normalize a `makeIntent` request against the wallet's network. */
export function validateConnectorIntentRequest(data: unknown, network: string): ConnectorIntentValidation {
  if (!isRecord(data)) return { ok: false, reason: 'Invalid intent request' };
  // The caller reads the chain's ledger first (resolveMidnightLedger).
  const version = knownMidnightLedger(network);
  if (version === undefined) return { ok: false, reason: `Could not read which ledger Midnight ${midnightNetworkName(network)} runs` };
  if (version !== 8 && version !== 9) {
    return { ok: false, reason: `makeIntent is not supported on Midnight ${midnightNetworkName(network)} (ledger ${version}) in this version` };
  }

  const { desiredInputs, desiredOutputs } = data as { desiredInputs?: unknown; desiredOutputs?: unknown };
  const rawOptions = (data as { options?: unknown }).options;
  if (!Array.isArray(desiredInputs)) return { ok: false, reason: 'desiredInputs must be an array' };
  if (!Array.isArray(desiredOutputs)) return { ok: false, reason: 'desiredOutputs must be an array' };
  if (desiredInputs.length > CONNECTOR_INTENT_MAX_ENTRIES) return { ok: false, reason: 'too many inputs (max 100 per intent)' };
  if (desiredOutputs.length > CONNECTOR_INTENT_MAX_ENTRIES) return { ok: false, reason: 'too many outputs (max 100 per intent)' };
  // Inputs with no outputs give tokens to whoever balances the intent and ask
  // for nothing back: refuse rather than ask the user to approve a giveaway.
  if (!desiredOutputs.length) {
    return { ok: false, reason: 'desiredOutputs must name at least one output; an intent that only gives tokens away is not supported' };
  }

  // The type marks `options` required and the docs say to set payFees
  // explicitly on makeIntent, so neither is defaulted.
  if (!isRecord(rawOptions)) return { ok: false, reason: 'options with intentId and payFees are required' };
  const options = rawOptions as RawOptions;
  if (typeof options.payFees !== 'boolean') return { ok: false, reason: 'options.payFees must be true or false' };
  const intentId = parseIntentId(options.intentId);
  if (intentId === undefined) {
    return { ok: false, reason: `options.intentId must be 'random' or an integer from ${INTENT_SEGMENT_MIN} to ${INTENT_SEGMENT_MAX}` };
  }

  const totals = new Map<string, bigint>();
  for (const entry of desiredInputs) {
    if (!isRecord(entry)) return { ok: false, reason: 'Each desiredInput must be an object' };
    const raw = entry as RawEntry;
    if (raw.kind !== 'unshielded') return { ok: false, reason: 'Only public (unshielded) tokens are supported by makeIntent' };
    const type = parseTokenType(raw.type);
    if (!type) return { ok: false, reason: 'Token type must be a 32-byte hexadecimal color' };
    const value = parseAmount(raw.value);
    if (value === undefined) return { ok: false, reason: 'Amount must be a positive decimal integer' };
    totals.set(type, (totals.get(type) ?? 0n) + value);
  }

  const prefix = unshieldedAddressPrefix(network);
  const outputs: MidnightConnectorOutput[] = [];
  for (const entry of desiredOutputs) {
    if (!isRecord(entry)) return { ok: false, reason: 'Each desiredOutput must be an object' };
    const raw = entry as RawEntry;
    if (raw.kind !== 'unshielded') return { ok: false, reason: 'Only public (unshielded) tokens are supported by makeIntent' };
    const type = parseTokenType(raw.type);
    if (!type) return { ok: false, reason: 'Token type must be a 32-byte hexadecimal color' };
    const value = parseAmount(raw.value);
    if (value === undefined) return { ok: false, reason: 'Amount must be a positive decimal integer' };
    if (!isUnshieldedRecipient(raw.recipient, prefix)) {
      return { ok: false, reason: 'Recipient must be a valid public address on the connected Midnight network' };
    }
    outputs.push({ kind: 'unshielded', type, value: value.toString(), recipient: raw.recipient });
  }

  const inputs = [...totals].map(([type, value]) => ({ type, value: value.toString() }));
  return { ok: true, inputs, outputs, intentId, payFees: options.payFees };
}

/**
 * Per-colour net the built intent must show on the guaranteed section:
 * `+given - wanted`. Zero entries are dropped, as `Transaction.imbalances()`
 * reports none for a balanced colour.
 */
export function expectedIntentImbalances(request: Pick<ConnectorIntentRequest, 'inputs' | 'outputs'>): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const input of request.inputs) net.set(input.type, (net.get(input.type) ?? 0n) + BigInt(input.value));
  for (const output of request.outputs) net.set(output.type, (net.get(output.type) ?? 0n) - BigInt(output.value));
  for (const [type, value] of net) if (value === 0n) net.delete(type);
  return net;
}

/**
 * The first colour the wallet's synced unshielded UTxOs cannot cover, or
 * `undefined` when every input is covered OR the UTxO view is not known yet.
 * Lets the worker answer `InsufficientFunds` without prompting; the builder's
 * coin selection is the authoritative check.
 *
 * `lastSync` gates it: the worker's store starts with no UTxOs after every
 * service-worker restart and after a wallet switch, and only a validated sync
 * message for the logged wallet sets `lastSync` (after the snapshot's UTxOs
 * are applied). Without that gate a funded wallet would be told it is broke.
 */
export function uncoveredIntentInput(
  inputs: ReadonlyArray<ConnectorIntentInput>,
  view: { readonly lastSync: number | null; readonly utxos: ReadonlyArray<MidnightUnshieldedUtxo> },
): ConnectorIntentInput | undefined {
  if (view.lastSync === null) return undefined;
  const { utxos } = view;
  let night = 0n;
  for (const utxo of utxos) if (isNativeNight(utxo.tokenType)) night += utxo.value;
  // Indexer colours may arrive in either case; inputs are lower-case.
  const tokens = new Map<string, bigint>();
  for (const [color, amount] of Object.entries(midnightTokenBalances(utxos))) {
    tokens.set(color.toLowerCase(), (tokens.get(color.toLowerCase()) ?? 0n) + amount);
  }
  for (const input of inputs) {
    const held = input.type === NIGHT_RAW_TOKEN_TYPE ? night : (tokens.get(input.type) ?? 0n);
    if (held < BigInt(input.value)) return input;
  }
  return undefined;
}

/**
 * How long a counterparty has to fill the intent: 55 minutes. The ledger
 * refuses an intent whose TTL is more than an hour past the block that
 * includes it, so the TTL keeps a 5-minute margin for a wallet clock running
 * ahead of the chain's when the intent is filled at once (an exact hour was
 * refused then). Below the ledger's DUST grace period (3 h on ledgers 8 and
 * 9), so the fee spend stays valid for the intent's whole life.
 */
export const CONNECTOR_INTENT_TTL_MS = 55 * 60_000;

/** Raised when the wallet cannot cover what the intent gives; the worker answers `InsufficientFunds`. */
export class IntentInsufficientFundsError extends Error {
  constructor(message = 'Not enough funds to give what this intent offers') {
    super(message);
    this.name = 'IntentInsufficientFundsError';
  }
}

/** The SDK's coin selection fails with `Wallet.InsufficientFunds` (or a message saying so). */
export function isSdkInsufficientFunds(error: unknown): boolean {
  const tag = (error as { _tag?: unknown } | null)?._tag;
  if (typeof tag === 'string' && /insufficient/i.test(tag)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /insufficient/i.test(message);
}

/** The ledger's `SegmentSpecifier` for the dapp's `intentId` (the same shape on ledgers 8 and 9). */
export function connectorSegmentSpecifier(intentId: ConnectorIntentId): { tag: 'random' } | { tag: 'specific'; value: number } {
  return intentId === 'random' ? { tag: 'random' } : { tag: 'specific', value: intentId };
}

/**
 * The message of a ledger 9 intent refused because the wallet's UTxO view is
 * not synced for the signing key. A code, like MIDNIGHT_LEDGER_UNKNOWN: the
 * extension pages say it in the user's language (midnight-tx.service.ts).
 */
export const MIDNIGHT_WALLET_NOT_SYNCED = 'MIDNIGHT_WALLET_NOT_SYNCED';

/** What the dapp is told when a ledger 9 intent is asked for before the wallet has synced. */
export const CONNECTOR_NOT_SYNCED_REASON = 'The wallet is still syncing. Try again in a moment.';

/**
 * Whether the worker's UTxO view can fund a ledger 9 intent (review S1). The
 * ledger 9 builder selects coins from the UTxOs the wallet synced, not from an
 * SDK wallet it syncs itself, so it needs a validated sync for the logged
 * wallet (`lastSync`, reset on every worker restart and wallet switch) and, when
 * `ownAddress` is given, the store following that address (its bech32 names
 * the network too). The builder checks against the signing key's own address.
 */
export function connectorIntentSyncReady(
  view: { readonly lastSync: number | null; readonly addresses: { readonly unshielded?: string | null } },
  ownAddress?: string,
): boolean {
  if (view.lastSync === null) return false;
  const synced = view.addresses.unshielded;
  if (typeof synced !== 'string' || !synced) return false;
  return ownAddress === undefined || synced.toLowerCase() === ownAddress.toLowerCase();
}

type IntentOfferView<Key> = {
  readonly inputs: ReadonlyArray<{ readonly owner: Key }>;
  readonly outputs: ReadonlyArray<{ readonly owner: string; readonly value: bigint; readonly type: string }>;
};
type IntentView<Key> = {
  readonly guaranteedUnshieldedOffer?: IntentOfferView<Key>;
  readonly fallibleUnshieldedOffer?: IntentOfferView<Key>;
  readonly actions?: ReadonlyArray<unknown>;
  readonly dustActions?: unknown;
};
/** The parts of a ledger 8 or ledger 9 transaction the check reads. */
export type IntentTxView = {
  readonly intents?: Map<number, unknown>;
  readonly guaranteedOffer?: unknown;
  readonly fallibleOffer?: Map<number, unknown>;
  imbalances(segment: number): Map<{ readonly tag: string; readonly raw?: string }, bigint>;
};

/** A requested output, with its recipient as `UserAddress` hex. */
export interface ExpectedIntentOutput {
  readonly owner: string;
  readonly type: string;
  readonly value: bigint;
}

/**
 * Refuse a built intent that is not exactly what the user approved: one
 * intent at `segmentId`, a guaranteed unshielded offer only (no contract
 * or DUST actions, no shielded offers, even balanced ones), inputs spent
 * only from the wallet, every requested output present, every other output
 * change to the wallet, and a guaranteed-section imbalance of exactly
 * `+given - wanted` per colour with nothing shielded. The SDK built it from
 * the request, so this is the same "check the bytes, not the builder"
 * stance as midnightBuiltTxGuard. `addressOfKey` is the ledger's own
 * `addressFromKey` (ledger 9 keys are tagged).
 */
export function assertIntentMatchesRequest<Key>(
  tx: IntentTxView,
  args: {
    segmentId: number;
    request: Pick<ConnectorIntentRequest, 'inputs' | 'outputs'>;
    expectedOutputs: ReadonlyArray<ExpectedIntentOutput>;
    ownAddress: string;
    addressOfKey: (key: Key) => string;
  },
): void {
  const own = args.ownAddress.toLowerCase();
  const intents = tx.intents;
  if (!intents || intents.size !== 1 || !intents.has(args.segmentId)) {
    throw new Error('The built intent is not a single intent at the requested segment');
  }
  if (tx.guaranteedOffer || (tx.fallibleOffer && tx.fallibleOffer.size > 0)) {
    throw new Error('The built intent has an unexpected shielded offer');
  }
  const intent = intents.get(args.segmentId) as IntentView<Key>;
  if (intent.fallibleUnshieldedOffer) throw new Error('The built intent has an unexpected fallible offer');
  if ((intent.actions?.length ?? 0) > 0 || intent.dustActions) {
    throw new Error('The built intent has unexpected contract or DUST actions');
  }
  const offer = intent.guaranteedUnshieldedOffer;
  if (!offer) throw new Error('The built intent has no unshielded offer');

  for (const input of offer.inputs) {
    if (args.addressOfKey(input.owner).toLowerCase() !== own) throw new Error('The built intent spends coins that are not this wallet\'s');
  }

  // Each requested output must appear once; whatever remains must be change.
  const remaining = [...offer.outputs];
  for (const want of args.expectedOutputs) {
    const at = remaining.findIndex((out) => out.owner.toLowerCase() === want.owner.toLowerCase()
      && out.type.toLowerCase() === want.type.toLowerCase() && out.value === want.value);
    if (at < 0) throw new Error('The built intent is missing a requested output');
    remaining.splice(at, 1);
  }
  if (remaining.some((out) => out.owner.toLowerCase() !== own)) {
    throw new Error('The built intent pays an address that was not requested');
  }

  const expected = expectedIntentImbalances(args.request);
  const actual = new Map<string, bigint>();
  for (const segment of [0, args.segmentId]) {
    for (const [token, value] of tx.imbalances(segment)) {
      if (value === 0n) continue;
      if (token.tag !== 'unshielded' || typeof token.raw !== 'string') {
        throw new Error('The built intent has an unexpected shielded or DUST imbalance');
      }
      const key = token.raw.toLowerCase();
      actual.set(key, (actual.get(key) ?? 0n) + value);
    }
  }
  const same = actual.size === expected.size && [...expected].every(([type, value]) => actual.get(type) === value);
  if (!same) throw new Error('The built intent does not give and ask for exactly the approved amounts');
}
