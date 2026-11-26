/**
 * Witness files (`VaultWitnessFile`, `contracts.ts`), collecting them, and assembling the final
 * transaction once the owners' threshold has signed.
 *
 * A witness file is accepted only when it names this vault and network, was made for this exact
 * bundle (`signingBundleHash`) and transaction id, its signer is an owner of the vault as this
 * device's record holds them, its key is that owner's payment key in the payment script, and the
 * signature verifies over the transaction id. Anything else is refused with a reason.
 *
 * The final transaction is `[body, witnesses, true, null]` with the body bytes exactly as signed:
 * the witness set holds the collected vkey witnesses (exactly the threshold, so the fee sized for
 * them covers it) and the vault's payment script from this device's record. The stake script is
 * left out: a plain spend does not need it, and the ledger refuses a script witness it does not need.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Ed25519PublicKey, Ed25519PublicKeyHex, Ed25519SignatureHex, ready } from '@cardano-sdk/crypto';
import { verifyEd25519, type VaultNetwork } from '@/shared/gerovault';
import { hexToBytes } from '@/shared/gerovault/cbor';
import {
  SIGNING_FILE_VERSION,
  WITNESS_FILE_EXTENSION,
  WITNESS_FILE_TYPE,
  signingBundleHash,
  type UnsignedTxBundle,
  type VaultVkeyWitness,
  type VaultWitnessFile,
} from '@/modules/gerovault/contracts';
import { MAX_WITNESS_FILE_BYTES } from './constants';
import { spendError } from './errors';
import { transactionIdOf } from './bundle';
import { participantByCredential, type VaultSpendContext, type VaultSpendParticipant } from './vaultSpendContext';

const HEX28 = /^[0-9a-f]{56}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;
const NETWORKS: readonly VaultNetwork[] = ['mainnet', 'preprod', 'preview'];
const FILE_KEYS = ['type', 'version', 'network', 'vaultId', 'txId', 'bundleHash', 'signerKeyHash', 'vkeyWitnesses', 'createdAt'];
/** A payment witness and a stake witness at most. */
const MAX_WITNESSES = 2;

/**
 * Why a witness file is refused (`VaultSpendError` `WITNESS_INVALID`, the reason as `detail`).
 * - `malformed`: not a witness file.
 * - `other_vault`, `other_network`: made for another vault or network.
 * - `other_body`: made for another transaction (bundle hash or id).
 * - `signer_unknown`: the signer is not a participant of this vault.
 * - `signer_not_owner`: the signer is a backup holder; this spend counts owners only.
 * - `key_not_in_script`: a witness key is not a key of this vault's payment script.
 * - `key_not_signer`: a witness key belongs to another participant than the signer named.
 * - `not_needed`: a stake key witness, which a plain spend does not use.
 * - `bad_signature`: a signature does not verify over the transaction id.
 */
export type WitnessRefusalReason =
  | 'malformed'
  | 'other_vault'
  | 'other_network'
  | 'other_body'
  | 'signer_unknown'
  | 'signer_not_owner'
  | 'key_not_in_script'
  | 'key_not_signer'
  | 'not_needed'
  | 'bad_signature';

function refuse(reason: WitnessRefusalReason): never {
  return spendError('WITNESS_INVALID', 'This signature cannot be used for this transaction', reason);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** The witness file for one signer's witnesses over a bundle. */
export function createWitnessFile(
  bundle: UnsignedTxBundle,
  signer: Pick<VaultSpendParticipant, 'credential'>,
  witnesses: readonly VaultVkeyWitness[],
  now: number = Date.now(),
): VaultWitnessFile {
  return Object.freeze({
    type: WITNESS_FILE_TYPE,
    version: SIGNING_FILE_VERSION,
    network: bundle.network,
    vaultId: bundle.vaultId,
    txId: bundle.txId,
    bundleHash: signingBundleHash(bundle.vaultId, bundle.bodyCbor),
    signerKeyHash: signer.credential,
    vkeyWitnesses: Object.freeze(witnesses.map(w => Object.freeze({ vkey: w.vkey, signature: w.signature }))),
    createdAt: now,
  });
}

/** Reads a witness file's shape. Throws `WITNESS_INVALID` (`malformed`); whether it fits is `verifyWitnessFile`. */
export function parseWitnessFile(text: string): VaultWitnessFile {
  if (typeof text !== 'string' || text.length > MAX_WITNESS_FILE_BYTES) refuse('malformed');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse('malformed');
  }
  if (!isPlainObject(parsed)) refuse('malformed');
  const keys = Object.keys(parsed);
  const raw = parsed as { readonly [K in keyof VaultWitnessFile]?: unknown };
  if (keys.length !== FILE_KEYS.length || keys.some(key => !FILE_KEYS.includes(key))) refuse('malformed');
  if (raw.type !== WITNESS_FILE_TYPE || raw.version !== SIGNING_FILE_VERSION) refuse('malformed');
  if (!NETWORKS.includes(raw.network as VaultNetwork)) refuse('malformed');
  for (const field of ['vaultId', 'txId', 'bundleHash'] as const) {
    if (typeof raw[field] !== 'string' || !HEX32.test(raw[field] as string)) refuse('malformed');
  }
  if (typeof raw.signerKeyHash !== 'string' || !HEX28.test(raw.signerKeyHash)) refuse('malformed');
  if (!Number.isSafeInteger(raw.createdAt) || (raw.createdAt as number) < 0) refuse('malformed');
  if (!Array.isArray(raw.vkeyWitnesses) || raw.vkeyWitnesses.length === 0 || raw.vkeyWitnesses.length > MAX_WITNESSES) refuse('malformed');
  const vkeyWitnesses = raw.vkeyWitnesses.map((item: unknown) => {
    if (!isPlainObject(item) || Object.keys(item).length !== 2) return refuse('malformed');
    const w = item as { readonly vkey?: unknown; readonly signature?: unknown };
    if (typeof w.vkey !== 'string' || !HEX32.test(w.vkey) || typeof w.signature !== 'string' || !HEX64.test(w.signature)) refuse('malformed');
    return Object.freeze({ vkey: w.vkey, signature: w.signature });
  });
  return Object.freeze({
    type: WITNESS_FILE_TYPE,
    version: SIGNING_FILE_VERSION,
    network: raw.network as VaultNetwork,
    vaultId: raw.vaultId as string,
    txId: raw.txId as string,
    bundleHash: raw.bundleHash as string,
    signerKeyHash: raw.signerKeyHash,
    vkeyWitnesses: Object.freeze(vkeyWitnesses),
    createdAt: raw.createdAt as number,
  });
}

/** One owner's verified payment witness over one bundle's transaction. */
export interface VerifiedSignature {
  readonly signer: VaultSpendParticipant;
  readonly witness: VaultVkeyWitness;
}

async function keyHashOf(vkey: string): Promise<string> {
  await ready();
  return Ed25519PublicKey.fromHex(Ed25519PublicKeyHex(vkey)).hash().hex();
}

/**
 * Checks a witness file against the bundle and this device's vault record. Returns the signer's
 * verified payment witness; throws `WITNESS_INVALID` with the reason otherwise.
 */
export async function verifyWitnessFile(
  file: VaultWitnessFile,
  bundle: UnsignedTxBundle,
  context: VaultSpendContext,
): Promise<VerifiedSignature> {
  if (file.vaultId !== context.vaultId || bundle.vaultId !== context.vaultId) refuse('other_vault');
  if (file.network !== context.network || bundle.network !== context.network) refuse('other_network');
  if (file.txId !== bundle.txId || file.bundleHash !== signingBundleHash(bundle.vaultId, bundle.bodyCbor)) refuse('other_body');
  const signer = participantByCredential(context, file.signerKeyHash);
  if (!signer) refuse('signer_unknown');
  if (signer.role !== 'owner' || !context.owners.includes(signer.credential)) refuse('signer_not_owner');

  let payment: VaultVkeyWitness | undefined;
  for (const witness of file.vkeyWitnesses) {
    const hash = await keyHashOf(witness.vkey).catch(() => refuse('malformed'));
    if (hash === signer.stakeKeyHash) refuse('not_needed');
    if (!context.owners.includes(hash)) refuse('key_not_in_script');
    if (hash !== signer.credential || witness.vkey !== signer.paymentKey) refuse('key_not_signer');
    const valid = await verifyEd25519(hexToBytes(witness.vkey) ?? new Uint8Array(), hexToBytes(witness.signature) ?? new Uint8Array(), hexToBytes(bundle.txId) ?? new Uint8Array());
    if (!valid) refuse('bad_signature');
    payment = witness;
  }
  if (!payment) return refuse('malformed');
  return Object.freeze({ signer, witness: payment });
}

/** Verifies this wallet's own fresh witness the same way a cosigner's file is verified. */
export async function verifyOwnWitness(witness: VaultVkeyWitness, bundle: UnsignedTxBundle, context: VaultSpendContext): Promise<VerifiedSignature> {
  return verifyWitnessFile(createWitnessFile(bundle, context.self, [witness]), bundle, context);
}

/** The signatures collected for one bundle, one per owner, in the order they arrived. */
export interface SignatureCollection {
  readonly txId: string;
  readonly signatures: readonly VerifiedSignature[];
}

export function emptyCollection(bundle: Pick<UnsignedTxBundle, 'txId'>): SignatureCollection {
  return Object.freeze({ txId: bundle.txId, signatures: Object.freeze([]) });
}

/**
 * Adds a verified signature. A second signature from the same owner is not added (`added` false):
 * Ed25519 signatures are deterministic, so it is the same one.
 */
export function addSignature(collection: SignatureCollection, signature: VerifiedSignature): { collection: SignatureCollection; added: boolean } {
  if (collection.signatures.some(s => s.signer.credential === signature.signer.credential)) return { collection, added: false };
  return { collection: Object.freeze({ txId: collection.txId, signatures: Object.freeze([...collection.signatures, signature]) }), added: true };
}

export interface SigningProgress {
  readonly collected: number;
  readonly threshold: number;
  readonly complete: boolean;
  /** Every owner, in script order, and whether they signed. */
  readonly owners: readonly { readonly participant: VaultSpendParticipant; readonly signed: boolean }[];
}

export function signingProgress(collection: SignatureCollection, context: VaultSpendContext): SigningProgress {
  const signed = new Set(collection.signatures.map(s => s.signer.credential));
  const owners = context.owners.map(credential => ({ participant: participantByCredential(context, credential)!, signed: signed.has(credential) }));
  const collected = owners.filter(o => o.signed).length;
  return { collected, threshold: context.threshold, complete: collected >= context.threshold, owners };
}

/**
 * The fully witnessed transaction, hex: the body exactly as signed, `threshold` vkey witnesses and
 * the payment script. Throws `NOT_AT_THRESHOLD` before enough owners signed, and refuses a result
 * whose id is not the bundle's.
 */
export function assembleTransaction(bundle: UnsignedTxBundle, context: VaultSpendContext, collection: SignatureCollection): string {
  if (collection.txId !== bundle.txId || bundle.vaultId !== context.vaultId) spendError('NOT_AT_THRESHOLD', 'These signatures are for another transaction');
  const owners = collection.signatures.filter(s => s.signer.role === 'owner' && context.owners.includes(s.signer.credential));
  if (owners.length < context.threshold) spendError('NOT_AT_THRESHOLD', 'Not enough owners have signed yet');
  const chosen = owners.slice(0, context.threshold);
  const signatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>(
    chosen.map(s => [Ed25519PublicKeyHex(s.witness.vkey), Ed25519SignatureHex(s.witness.signature)]),
  );
  const witness: Cardano.Witness = { signatures, scripts: [context.paymentScript] };
  const witnessSet = Serialization.TransactionWitnessSet.fromCore(witness).toCbor();
  // `[body, witness_set, true, null]`, with the body bytes untouched.
  const tx = `84${bundle.bodyCbor}${witnessSet}f5f6`;
  if (transactionIdOf(tx) !== bundle.txId) spendError('NOT_AT_THRESHOLD', 'The assembled transaction is not the one signed');
  return tx;
}

/** The key hashes of the vkey witnesses an assembled transaction carries. For tests and the sheet. */
export async function witnessKeyHashes(txCbor: string): Promise<string[]> {
  await ready();
  const tx = Serialization.Transaction.fromCbor(txCbor as Serialization.TxCBOR);
  const vkeys = tx.witnessSet().vkeys()?.toCore() ?? [];
  return vkeys.map(([vkey]) => Ed25519PublicKey.fromHex(vkey).hash().hex() as Ed25519KeyHashHex);
}

/** A file name for one signer's witness file. */
export function witnessFileName(file: Pick<VaultWitnessFile, 'txId' | 'signerKeyHash'>): string {
  return `vault-tx-${file.txId.slice(0, 8)}-signer-${file.signerKeyHash.slice(0, 8)}${WITNESS_FILE_EXTENSION}`;
}
