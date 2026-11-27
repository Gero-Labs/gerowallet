import { Serialization } from '@cardano-sdk/core';
import { blake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { outputRef, type TxCborSource } from '@/shared/utils/provenInputs';
import { MAX_BUILT_TX_FEE_LOVELACE } from '@/shared/utils/txIntentGuard';
import type { NetworkId } from './address';
import { bodyKeyRule, REQUIRED_BODY_KEYS, type BodyField } from './bodyKeys';
import { certificateDeposits, decodeCertificates, type CertificateView } from './certificates';
import { fromHex, isNull, readArray, readBoolean, readBytes, readMap, readUint, stateOf, toHex, type Bytes } from './cbor';
import { collateralView, type CollateralView } from './collateral';
import type { DecodeContext } from './context';
import { decodeFee, decodeNetworkId, decodeRequiredSigners, decodeSlot, type ValidityView } from './header';
import { decodeInputSet, proveInputs, provenViews, type InputRef, type ProvenInputView } from './inputs';
import { decodeMint, type MintAmount } from './mint';
import { decodeOutput, type OutputView } from './outputs';
import { FieldRefusal, Refusals, type Refusal } from './refusals';
import { ValueSum } from './value';
import { decodeWithdrawals, type WithdrawalView } from './withdrawals';

/**
 * What a vault co-signer is shown before signing, computed from the bytes it signs.
 *
 * {@link decodeVaultTransaction} returns either a complete {@link VaultTxSummary} or every
 * {@link Refusal} it found, never a partial summary. Each body field is decoded by its own rule
 * or refused by name (`bodyKeys.ts`); a key no rule names refuses. Input values are proven from
 * their creating transactions (`inputs.ts`), never taken from a server's UTxO list. The summary
 * is data for a screen: codes and typed values, no user-facing text.
 *
 * Pure: no network, no storage, no extension APIs. The caller supplies the CBOR sources.
 */

export interface DecodeVaultTxOptions {
  /** The network the signer is on. */
  networkId: NetworkId;
  /**
   * Sources of creating-transaction CBOR by hash, asked in order (`TxCborSource`, as
   * `provenInputs.ts` defines it). Their answers are not trusted: only CBOR that hashes to the
   * asked id proves anything.
   */
  inputSources: readonly TxCborSource[];
  /** The protocol's `keyDeposit`, for the Shelley-form stake certificates. */
  stakeKeyDepositLovelace?: bigint;
  /** Fees above this refuse (`fee_above_limit`). Default `MAX_BUILT_TX_FEE_LOVELACE`. */
  maxFeeLovelace?: bigint;
  /**
   * Minting policies whose minting and burning (body key 9) is decoded instead of refused. With it
   * the script data hash (body key 11) is read too, since a Plutus policy needs one. A mint under
   * any other policy still refuses (`mint_unsupported`). Without it both keys refuse, as before.
   */
  plutusMintPolicies?: readonly string[];
}

export interface VaultTxSummary {
  /** blake2b-256 of the body bytes: the id every witness signs. */
  txId: string;
  /** The network every address in the transaction is on. */
  networkId: NetworkId;
  /** The body's own network id field (key 15), or null when it has none. */
  bodyNetworkId: NetworkId | null;
  /** What the transaction spends, each proven from its creating transaction. */
  inputs: ProvenInputView[];
  outputs: OutputView[];
  fee: bigint;
  validity: ValidityView;
  /** Key hashes whose signature the body requires (key 14), lower-case hex. */
  requiredSigners: string[];
  withdrawals: WithdrawalView[];
  certificates: CertificateView[];
  /** Deposits the certificates pay and the refunds they return. */
  deposits: { paidLovelace: bigint; refundedLovelace: bigint };
  collateral: CollateralView | null;
  /** UTxOs the transaction reads without spending, each proven from its creating transaction. */
  referenceInputs: ProvenInputView[];
  /** What the transaction mints (positive) and burns (negative); empty without body key 9. */
  mint: MintAmount[];
  /** The script data hash (body key 11), lower-case hex, or null when the body has none. */
  scriptDataHash: string | null;
}

/** `decoded`: the complete summary. `refused`: every refusal found, and no summary at all. */
export type VaultTxDecodeResult =
  | { status: 'decoded'; summary: VaultTxSummary }
  | { status: 'refused'; txId: string | null; refusals: Refusal[] };

/** A transaction as hex, as bytes, or as the SDK holds it (its original bytes are decoded). */
export type VaultTxInput = string | Uint8Array | Serialization.Transaction;

function txBytes(tx: VaultTxInput): Bytes {
  if (tx instanceof Uint8Array) return tx;
  if (typeof tx === 'string') return fromHex(tx.trim());
  return fromHex(tx.toCbor());
}

interface Envelope {
  bytes: Bytes;
  body: Bytes;
}

/** `[body, witness_set, is_valid, auxiliary_data / null]`. */
function readEnvelope(tx: VaultTxInput, refusals: Refusals): Envelope | null {
  let bytes: Bytes;
  let parts: Bytes[];
  try {
    bytes = txBytes(tx);
    parts = readArray(bytes, 'tx');
  } catch {
    refusals.add('tx_undecodable', 'tx', 'not_a_transaction');
    return null;
  }
  const State = Serialization.CborReaderState;
  if (parts.length !== 4 || stateOf(parts[0]) !== State.StartMap || stateOf(parts[1]) !== State.StartMap) {
    refusals.add('tx_undecodable', 'tx', 'shape');
    return null;
  }
  try {
    if (!readBoolean(parts[2], 'tx.is_valid')) refusals.add('tx_marked_invalid', 'tx.is_valid');
  } catch {
    refusals.add('tx_undecodable', 'tx.is_valid', 'expected_boolean');
  }
  if (!isNull(parts[3])) refusals.add('auxiliary_data_unsupported', 'tx.auxiliary_data');
  return { bytes, body: parts[0] };
}

type RawFields = Partial<Record<BodyField, { item: Bytes; path: string }>>;

/** Refused keys a caller may open: mint and the script data hash, for named minting policies. */
const OPENED_BY_MINT_POLICIES: ReadonlyMap<number, BodyField> = new Map<number, BodyField>([
  [9, 'mint'],
  [11, 'script_data_hash'],
]);

/** Sort the body's entries by rule; refuse unknown, duplicate, refused and missing keys. */
function walkBody(body: Bytes, refusals: Refusals, mintOpened: boolean): RawFields | null {
  let entries: Array<[Bytes, Bytes]>;
  try {
    entries = readMap(body, 'body');
  } catch {
    refusals.add('tx_undecodable', 'body', 'not_a_map');
    return null;
  }
  const raw: RawFields = {};
  const seen = new Set<bigint>();
  entries.forEach(([keyItem, item], i) => {
    let key: bigint;
    try {
      key = readUint(keyItem, 'body');
    } catch {
      refusals.add('body_key_unknown', `body[${i}]`, 'not_an_unsigned_integer');
      return;
    }
    const path = `body.${key}`;
    if (seen.has(key)) {
      refusals.add('body_key_duplicate', path);
      return;
    }
    seen.add(key);
    const rule = bodyKeyRule(key);
    const opened = mintOpened ? OPENED_BY_MINT_POLICIES.get(Number(key)) : undefined;
    if (!rule) refusals.add('body_key_unknown', path);
    else if ('refuse' in rule && opened) raw[opened] = { item, path };
    else if ('refuse' in rule) refusals.add(rule.refuse, path, rule.name);
    else raw[rule.decode] = { item, path };
  });
  for (const key of REQUIRED_BODY_KEYS) if (!seen.has(BigInt(key))) refusals.add('body_key_missing', `body.${key}`);
  return raw;
}

function nonEmpty<T>(items: T[], path: string): T[] {
  if (items.length === 0) throw new FieldRefusal('field_malformed', path, 'empty');
  return items;
}

export async function decodeVaultTransaction(tx: VaultTxInput, options: DecodeVaultTxOptions): Promise<VaultTxDecodeResult> {
  const refusals = new Refusals();
  const ctx: DecodeContext = { networkId: options.networkId, stakeKeyDepositLovelace: options.stakeKeyDepositLovelace, refusals };
  const envelope = readEnvelope(tx, refusals);
  if (!envelope) return { status: 'refused', txId: null, refusals: refusals.list };
  const txId = blake2b.hash(HexBlob.fromBytes(envelope.body), 32).toString();
  const mintPolicies = options.plutusMintPolicies ?? [];
  const raw = walkBody(envelope.body, refusals, mintPolicies.length > 0);
  if (!raw) return { status: 'refused', txId, refusals: refusals.list };

  const field = <T>(name: BodyField, read: (item: Bytes, path: string) => T): T | undefined => {
    const entry = raw[name];
    return entry ? refusals.guard(entry.path, () => read(entry.item, entry.path)) : undefined;
  };
  const inputSet = (item: Bytes, path: string) => nonEmpty(decodeInputSet(item, path), path);

  const inputs = field('inputs', inputSet) ?? [];
  const outputs: OutputView[] = [];
  field('outputs', (item, path) => readArray(item, path).forEach((output, i) => {
    const view = refusals.guard(`${path}[${i}]`, () => decodeOutput(output, `${path}[${i}]`, ctx.networkId));
    if (view) outputs.push(view);
  }));
  const fee = field('fee', decodeFee);
  const invalidHereafter = field('ttl', decodeSlot) ?? null;
  const invalidBefore = field('validity_start', decodeSlot) ?? null;
  const certificates = field('certificates', (item, path) => decodeCertificates(item, path, ctx)) ?? [];
  const withdrawals = field('withdrawals', (item, path) => decodeWithdrawals(item, path, ctx)) ?? [];
  const collateralInputs = field('collateral_inputs', inputSet) ?? [];
  const requiredSigners = field('required_signers', (item, path) => nonEmpty(decodeRequiredSigners(item, path), path)) ?? [];
  const bodyNetworkId = field('network_id', (item, path) => decodeNetworkId(item, path, ctx)) ?? null;
  const collateralReturn = field('collateral_return', (item, path) => decodeOutput(item, path, ctx.networkId)) ?? null;
  const totalCollateral = field('total_collateral', decodeFee) ?? null;
  const referenceInputs = field('reference_inputs', inputSet) ?? [];
  const mint = field('mint', (item, path) => decodeMint(item, path, mintPolicies)) ?? [];
  const scriptDataHash = field('script_data_hash', (item, path) => toHex(readBytes(item, path, 32))) ?? null;

  const spent = new Set(inputs.map(outputRef));
  for (const ref of referenceInputs) if (spent.has(outputRef(ref))) refusals.add('reference_input_spent', ref.path);

  if (fee !== undefined && fee > (options.maxFeeLovelace ?? MAX_BUILT_TX_FEE_LOVELACE)) refusals.add('fee_above_limit', 'body.2');

  const refs: InputRef[] = [...inputs, ...collateralInputs, ...referenceInputs];
  const proven = await proveInputs(refs, options.inputSources, ctx);
  if (refusals.size > 0 || fee === undefined) return { status: 'refused', txId, refusals: refusals.list };

  const inputViews = provenViews(inputs, proven);
  const collateral = collateralView({
    inputs: provenViews(collateralInputs, proven),
    collateralReturn,
    totalCollateral,
    paths: { inputs: 'body.13', collateralReturn: 'body.16', totalCollateral: 'body.17' },
  }, ctx);

  const deposits = certificateDeposits(certificates);
  const balance = new ValueSum();
  for (const input of inputViews) balance.add(input.output.value);
  for (const withdrawal of withdrawals) balance.addLovelace(withdrawal.lovelace);
  balance.addLovelace(deposits.refunded);
  balance.add({ lovelace: 0n, tokens: mint });
  for (const output of outputs) balance.add(output.value, -1n);
  balance.addLovelace(-fee - deposits.paid);
  if (!balance.isZero()) refusals.add('value_not_balanced', 'body', balance.lovelace() !== 0n ? 'lovelace' : 'tokens');

  if (refusals.size === 0) {
    try {
      Serialization.Transaction.fromCbor(HexBlob(toHex(envelope.bytes)) as Serialization.TxCBOR);
    } catch {
      refusals.add('tx_undecodable', 'tx', 'sdk_rejected');
    }
  }
  if (refusals.size > 0) return { status: 'refused', txId, refusals: refusals.list };

  return {
    status: 'decoded',
    summary: {
      txId,
      networkId: options.networkId,
      bodyNetworkId,
      inputs: inputViews,
      outputs,
      fee,
      validity: { invalidBefore, invalidHereafter },
      requiredSigners,
      withdrawals,
      certificates,
      deposits: { paidLovelace: deposits.paid, refundedLovelace: deposits.refunded },
      collateral,
      referenceInputs: provenViews(referenceInputs, proven),
      mint,
      scriptDataHash,
    },
  };
}
