/**
 * The unsigned transaction bundle (`UnsignedTxBundle`, `contracts.ts`): what a proposer hands to
 * each cosigner. It holds the body exactly as built and the creating transaction of every input,
 * so a cosigner proves every input offline, by hash, without asking any server.
 *
 * Reading one never trusts it: the shape is checked field by field, unknown fields refuse, the
 * transaction id is recomputed from the body, the inputs must be the body's own, and every
 * creating transaction must hash to the id it is filed under. Whether it belongs to the vault on
 * screen is `checkBundleForVault`; what it does is the approval sheet's job (`review.ts`).
 */
import { Serialization } from '@cardano-sdk/core';
import { blake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import {
  SIGNING_FILE_VERSION,
  UNSIGNED_BUNDLE_EXTENSION,
  UNSIGNED_BUNDLE_TYPE,
  type BundleInputRef,
  type UnsignedTxBundle,
} from '@/modules/gerovault/contracts';
import type { TxCborSource } from '@/shared/utils/provenInputs';
import type { VaultNetwork } from '@/shared/gerovault';
import { MAX_BUNDLE_FILE_BYTES, MAX_BUNDLE_INPUTS } from './constants';
import { spendError } from './errors';
import type { BuiltSpend } from './buildSpend';
import type { VaultSpendContext } from './vaultSpendContext';

const HEX32 = /^[0-9a-f]{64}$/;
const HEX_CBOR = /^(?:[0-9a-f]{2})+$/;
const NETWORKS: readonly VaultNetwork[] = ['mainnet', 'preprod', 'preview'];
const BUNDLE_KEYS = ['type', 'version', 'network', 'vaultId', 'txId', 'bodyCbor', 'inputs', 'sourceTransactions', 'createdAt'];

/** The id of a transaction's CBOR (the hash of its body), or undefined when it is not a transaction. */
export function transactionIdOf(cbor: string): string | undefined {
  try {
    return String(Serialization.Transaction.fromCbor(HexBlob(cbor) as Serialization.TxCBOR).getId());
  } catch {
    return undefined;
  }
}

/** blake2b-256 of a body's bytes, lowercase hex. */
export function bodyTxId(bodyCbor: string): string {
  return blake2b.hash(HexBlob(bodyCbor), 32).toString();
}

/** The body wrapped as a transaction with an empty witness set: `[body, {}, true, null]`. */
export function unsignedTransaction(bodyCbor: string): string {
  return `84${bodyCbor}a0f5f6`;
}

/** Every input a body names (spent, collateral, reference), in body order. */
export function bodyInputRefs(bodyCbor: string): BundleInputRef[] {
  const body = Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor));
  const refs = [...body.inputs().toCore(), ...(body.collateral()?.toCore() ?? []), ...(body.referenceInputs()?.toCore() ?? [])];
  return refs.map(({ txId, index }) => ({ txId: String(txId), index }));
}

/**
 * The bundle for a body the proposer just built. Fetches the creating transaction of each input
 * from `source` and keeps only CBOR that hashes to the id asked for. Throws `SOURCE_UNAVAILABLE`
 * when any is missing: a bundle a cosigner cannot prove offline is not handed out.
 */
export async function createUnsignedBundle(
  context: Pick<VaultSpendContext, 'vaultId' | 'network'>,
  built: Pick<BuiltSpend, 'bodyCbor' | 'txId'>,
  source: TxCborSource,
  now: number = Date.now(),
): Promise<UnsignedTxBundle> {
  const inputs = bodyInputRefs(built.bodyCbor);
  const ids = [...new Set(inputs.map(ref => ref.txId))];
  let served: Map<string, string>;
  try {
    served = await source(ids);
  } catch {
    return spendError('SOURCE_UNAVAILABLE', 'The creating transactions could not be fetched');
  }
  const sourceTransactions: Record<string, string> = {};
  for (const id of ids) {
    const cbor = served.get(id);
    const hex = typeof cbor === 'string' ? cbor.trim().toLowerCase() : '';
    if (!HEX_CBOR.test(hex) || transactionIdOf(hex) !== id) spendError('SOURCE_UNAVAILABLE', 'A creating transaction is missing or is not the one asked for', id);
    sourceTransactions[id] = hex;
  }
  return Object.freeze({
    type: UNSIGNED_BUNDLE_TYPE,
    version: SIGNING_FILE_VERSION,
    network: context.network,
    vaultId: context.vaultId,
    txId: bodyTxId(built.bodyCbor),
    bodyCbor: built.bodyCbor,
    inputs: Object.freeze(inputs.map(ref => Object.freeze(ref))),
    sourceTransactions: Object.freeze(sourceTransactions),
    createdAt: now,
  });
}

function invalid(detail: string): never {
  return spendError('BUNDLE_INVALID', 'This is not a valid unsigned vault transaction', detail);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  const own = Object.keys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) invalid(`${what}_fields`);
}

/** The JSON text of a signing file (bigint-free by construction). */
export function signingFileText(file: object): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Reads an unsigned bundle file. Throws `BUNDLE_INVALID` (with the failed check as the detail);
 * never returns anything it did not check.
 */
export function parseUnsignedBundle(text: string): UnsignedTxBundle {
  if (typeof text !== 'string' || text.length > MAX_BUNDLE_FILE_BYTES) invalid('size');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid('json');
  }
  if (!isPlainObject(parsed)) invalid('shape');
  exactKeys(parsed, BUNDLE_KEYS, 'bundle');
  const raw = parsed as { readonly [K in keyof UnsignedTxBundle]?: unknown };
  if (raw.type !== UNSIGNED_BUNDLE_TYPE) invalid('type');
  if (raw.version !== SIGNING_FILE_VERSION) invalid('version');
  if (!NETWORKS.includes(raw.network as VaultNetwork)) invalid('network');
  if (typeof raw.vaultId !== 'string' || !HEX32.test(raw.vaultId)) invalid('vault_id');
  if (typeof raw.txId !== 'string' || !HEX32.test(raw.txId)) invalid('tx_id');
  if (typeof raw.bodyCbor !== 'string' || !HEX_CBOR.test(raw.bodyCbor)) invalid('body');
  if (!Number.isSafeInteger(raw.createdAt) || (raw.createdAt as number) < 0) invalid('created_at');
  if (bodyTxId(raw.bodyCbor) !== raw.txId) invalid('tx_id_mismatch');

  if (!Array.isArray(raw.inputs) || raw.inputs.length === 0 || raw.inputs.length > MAX_BUNDLE_INPUTS) invalid('inputs');
  const inputs: BundleInputRef[] = raw.inputs.map((item: unknown) => {
    if (!isPlainObject(item)) return invalid('input_shape');
    exactKeys(item, ['txId', 'index'], 'input');
    const ref = item as { readonly txId?: unknown; readonly index?: unknown };
    if (typeof ref.txId !== 'string' || !HEX32.test(ref.txId)) invalid('input_tx_id');
    if (!Number.isSafeInteger(ref.index) || (ref.index as number) < 0 || (ref.index as number) > 0xffff) invalid('input_index');
    return Object.freeze({ txId: ref.txId, index: ref.index as number });
  });
  let bodyRefs: BundleInputRef[];
  try {
    bodyRefs = bodyInputRefs(raw.bodyCbor);
  } catch {
    return invalid('body_undecodable');
  }
  if (bodyRefs.length !== inputs.length || bodyRefs.some((ref, i) => ref.txId !== inputs[i].txId || ref.index !== inputs[i].index)) {
    invalid('inputs_not_the_body');
  }

  if (!isPlainObject(raw.sourceTransactions)) invalid('sources');
  const wanted = new Set(inputs.map(ref => ref.txId));
  const sources: Record<string, string> = {};
  for (const [id, cbor] of Object.entries(raw.sourceTransactions)) {
    if (!wanted.has(id)) invalid('source_not_an_input');
    if (typeof cbor !== 'string' || !HEX_CBOR.test(cbor) || transactionIdOf(cbor) !== id) invalid('source_hash');
    sources[id] = cbor;
  }
  if (Object.keys(sources).length !== wanted.size) invalid('source_missing');

  return Object.freeze({
    type: UNSIGNED_BUNDLE_TYPE,
    version: SIGNING_FILE_VERSION,
    network: raw.network as VaultNetwork,
    vaultId: raw.vaultId,
    txId: raw.txId,
    bodyCbor: raw.bodyCbor,
    inputs: Object.freeze(inputs),
    sourceTransactions: Object.freeze(sources),
    createdAt: raw.createdAt as number,
  });
}

/** Throws `BUNDLE_OTHER_VAULT` unless the bundle names the vault on screen and its network. */
export function checkBundleForVault(bundle: UnsignedTxBundle, context: Pick<VaultSpendContext, 'vaultId' | 'network'>): void {
  if (bundle.vaultId !== context.vaultId || bundle.network !== context.network) {
    spendError('BUNDLE_OTHER_VAULT', 'This transaction is for another vault or another network');
  }
}

/** The bundle's creating transactions as a decoder source: offline, nothing fetched. */
export function bundleTxSource(bundle: Pick<UnsignedTxBundle, 'sourceTransactions'>): TxCborSource {
  return async (ids: string[]) => {
    const found = new Map<string, string>();
    for (const id of ids) {
      const cbor = Object.prototype.hasOwnProperty.call(bundle.sourceTransactions, id) ? bundle.sourceTransactions[id] : undefined;
      if (typeof cbor === 'string') found.set(id, cbor);
    }
    return found;
  };
}

/** A file name for the bundle: the vault and the transaction, shortened, and the bundle extension. */
export function bundleFileName(bundle: Pick<UnsignedTxBundle, 'vaultId' | 'txId'>): string {
  return `vault-${bundle.vaultId.slice(0, 8)}-tx-${bundle.txId.slice(0, 8)}${UNSIGNED_BUNDLE_EXTENSION}`;
}
