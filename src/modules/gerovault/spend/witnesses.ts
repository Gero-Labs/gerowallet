/**
 * Witness files (`VaultWitnessFile`, `contracts.ts`), collecting them, and assembling the final
 * transaction once the owners' threshold has signed.
 *
 * A witness file is accepted only when it names this vault and network, was made for this exact
 * bundle (`signingBundleHash`) and transaction id, its signer is an owner of the vault as this
 * device's record holds them, its key is that owner's payment key in the payment script, and the
 * signature verifies over the transaction id. Anything else is refused with a reason.
 *
 * A stake or DUST operation (`dust/operations.ts`) needs more, as its witness plan says: each
 * signer's stake key witness too (when the stake script is its own), and the collateral wallet's
 * witness (when a Plutus script runs). A witness file then carries the signer's stake witness,
 * which must be that owner's key in the stake script, and may carry the collateral witness, whose
 * key must hash to the collateral the body names. A plain spend takes neither.
 *
 * The final transaction is `[body, witnesses, true, null]` with the body bytes exactly as signed:
 * the witness set holds the collected vkey witnesses (exactly the threshold of payment witnesses,
 * and for an operation exactly the threshold of stake witnesses and the collateral witness, so the
 * fee sized for them covers it) and the scripts the body needs, from this device's record: the
 * payment script always, the stake script for an operation, the mapping validator and its
 * redeemers for a DUST operation. The ledger refuses a script witness the transaction does not need.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
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
import { mappingValidatorFor } from '@/modules/gerovault/dust/mappingValidator';
import { operationRedeemers, PLAIN_SPEND_PLAN, witnessPlanOf, type WitnessPlan } from '@/modules/gerovault/dust/operations';
import { redeemersCbor, scriptDataHashOf } from '@/modules/gerovault/dust/scriptData';
import { MAX_WITNESS_FILE_BYTES } from './constants';
import { spendError } from './errors';
import { transactionIdOf } from './bundle';
import type { SpendReviewReady } from './review';
import { participantByCredential, type VaultSpendContext, type VaultSpendParticipant } from './vaultSpendContext';

const HEX28 = /^[0-9a-f]{56}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;
const NETWORKS: readonly VaultNetwork[] = ['mainnet', 'preprod', 'preview'];
const FILE_KEYS = ['type', 'version', 'network', 'vaultId', 'txId', 'bundleHash', 'signerKeyHash', 'vkeyWitnesses', 'createdAt'];
/** A payment witness, a stake witness and a collateral witness at most. */
const MAX_WITNESSES = 3;

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
 * - `stake_missing`: an operation needs the signer's stake witness, and the file has none.
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
  | 'stake_missing'
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

/** One owner's verified witnesses over one bundle's transaction. */
export interface VerifiedSignature {
  readonly signer: VaultSpendParticipant;
  /** The payment witness. */
  readonly witness: VaultVkeyWitness;
  /** The stake witness, present when the plan needs one. */
  readonly stakeWitness?: VaultVkeyWitness;
  /** The collateral wallet's witness, when this signer's file carried it. */
  readonly collateralWitness?: VaultVkeyWitness;
}

async function keyHashOf(vkey: string): Promise<string> {
  await ready();
  return Ed25519PublicKey.fromHex(Ed25519PublicKeyHex(vkey)).hash().hex();
}

/**
 * Checks a witness file against the bundle, this device's vault record and the witness plan of
 * what the bundle does (`PLAIN_SPEND_PLAN` for a plain spend; for an operation, `witnessPlanOf`
 * the sheet's operation). Returns the signer's verified witnesses; throws `WITNESS_INVALID` with
 * the reason otherwise.
 */
export async function verifyWitnessFile(
  file: VaultWitnessFile,
  bundle: UnsignedTxBundle,
  context: VaultSpendContext,
  plan: WitnessPlan = PLAIN_SPEND_PLAN,
): Promise<VerifiedSignature> {
  if (file.vaultId !== context.vaultId || bundle.vaultId !== context.vaultId) refuse('other_vault');
  if (file.network !== context.network || bundle.network !== context.network) refuse('other_network');
  if (file.txId !== bundle.txId || file.bundleHash !== signingBundleHash(bundle.vaultId, bundle.bodyCbor)) refuse('other_body');
  const signer = participantByCredential(context, file.signerKeyHash);
  if (!signer) refuse('signer_unknown');
  if (signer.role !== 'owner' || !context.owners.includes(signer.credential)) refuse('signer_not_owner');

  let payment: VaultVkeyWitness | undefined;
  let stake: VaultVkeyWitness | undefined;
  let collateral: VaultVkeyWitness | undefined;
  for (const witness of file.vkeyWitnesses) {
    const hash = await keyHashOf(witness.vkey).catch(() => refuse('malformed'));
    let slot: 'payment' | 'stake' | 'collateral';
    if (hash === signer.stakeKeyHash && !context.sharedStakeCredential) {
      if (!plan.stake) refuse('not_needed');
      if (witness.vkey !== signer.stakeKey || !context.stakeOwners.includes(hash)) refuse('key_not_signer');
      slot = 'stake';
    } else if (plan.collateralPayer !== null && hash === plan.collateralPayer && hash !== signer.credential) {
      slot = 'collateral';
    } else {
      if (!context.owners.includes(hash)) refuse('key_not_in_script');
      if (hash !== signer.credential || witness.vkey !== signer.paymentKey) refuse('key_not_signer');
      slot = 'payment';
    }
    if ((slot === 'payment' && payment) || (slot === 'stake' && stake) || (slot === 'collateral' && collateral)) refuse('malformed');
    const valid = await verifyEd25519(hexToBytes(witness.vkey) ?? new Uint8Array(), hexToBytes(witness.signature) ?? new Uint8Array(), hexToBytes(bundle.txId) ?? new Uint8Array());
    if (!valid) refuse('bad_signature');
    if (slot === 'payment') payment = witness;
    else if (slot === 'stake') stake = witness;
    else collateral = witness;
  }
  if (!payment) return refuse('malformed');
  if (plan.stake && !stake) refuse('stake_missing');
  return Object.freeze({
    signer,
    witness: payment,
    ...(stake ? { stakeWitness: stake } : {}),
    ...(collateral ? { collateralWitness: collateral } : {}),
  });
}

/** Verifies this wallet's own fresh witnesses the same way a cosigner's file is verified. */
export async function verifyOwnWitness(
  witness: VaultVkeyWitness | readonly VaultVkeyWitness[],
  bundle: UnsignedTxBundle,
  context: VaultSpendContext,
  plan: WitnessPlan = PLAIN_SPEND_PLAN,
): Promise<VerifiedSignature> {
  const witnesses = Array.isArray(witness) ? witness : [witness as VaultVkeyWitness];
  return verifyWitnessFile(createWitnessFile(bundle, context.self, witnesses), bundle, context, plan);
}

/** Every witness of a verified signature, in file order: payment, stake, collateral. */
export function signatureWitnesses(signature: VerifiedSignature): VaultVkeyWitness[] {
  return [signature.witness, ...(signature.stakeWitness ? [signature.stakeWitness] : []), ...(signature.collateralWitness ? [signature.collateralWitness] : [])];
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
  /** For a Plutus operation: whether the collateral wallet's witness is in. Null when none is needed. */
  readonly collateralSigned: boolean | null;
}

export function signingProgress(collection: SignatureCollection, context: VaultSpendContext, plan: WitnessPlan = PLAIN_SPEND_PLAN): SigningProgress {
  const signed = new Set(collection.signatures.filter(s => !plan.stake || s.stakeWitness).map(s => s.signer.credential));
  const owners = context.owners.map(credential => ({ participant: participantByCredential(context, credential)!, signed: signed.has(credential) }));
  const collected = owners.filter(o => o.signed).length;
  const collateralSigned = plan.collateralPayer === null ? null : collection.signatures.some(s => s.collateralWitness);
  return { collected, threshold: context.threshold, complete: collected >= context.threshold && collateralSigned !== false, owners, collateralSigned };
}

export interface AssembleOptions {
  /** The sheet of this bundle, as this device computed it: what the transaction does. */
  readonly review?: SpendReviewReady;
  /** The Plutus V3 cost model of the current protocol parameters, for a DUST operation's script data hash. */
  readonly plutusV3CostModel?: readonly number[];
}

/**
 * The fully witnessed transaction, hex: the body exactly as signed, the vkey witnesses its witness
 * plan needs (`threshold` payment witnesses; for an operation also `threshold` stake witnesses of
 * the same owners and the collateral witness) and the scripts from this device's record. Throws
 * `NOT_AT_THRESHOLD` before enough owners signed or before the collateral wallet signed,
 * `SCRIPT_DATA_MISMATCH` when the rebuilt redeemers do not give the body's script data hash, and
 * refuses a result whose id is not the bundle's.
 */
export function assembleTransaction(bundle: UnsignedTxBundle, context: VaultSpendContext, collection: SignatureCollection, options: AssembleOptions = {}): string {
  if (collection.txId !== bundle.txId || bundle.vaultId !== context.vaultId) spendError('NOT_AT_THRESHOLD', 'These signatures are for another transaction');
  const review = options.review;
  if (review && review.txId !== bundle.txId) spendError('NOT_AT_THRESHOLD', 'This sheet is for another transaction');
  const operation = review?.operation;
  const plan = witnessPlanOf(operation, context);
  const owners = collection.signatures.filter(s => s.signer.role === 'owner' && context.owners.includes(s.signer.credential) && (!plan.stake || s.stakeWitness));
  if (owners.length < context.threshold) spendError('NOT_AT_THRESHOLD', 'Not enough owners have signed yet');
  const chosen = owners.slice(0, context.threshold);
  const vkeys: VaultVkeyWitness[] = chosen.map(s => s.witness);
  if (plan.stake) vkeys.push(...chosen.map(s => s.stakeWitness!));
  if (plan.collateralPayer !== null) {
    const collateral = collection.signatures.find(s => s.collateralWitness)?.collateralWitness;
    if (!collateral) spendError('NOT_AT_THRESHOLD', 'The collateral wallet has not signed yet', 'collateral');
    vkeys.push(collateral);
  }
  const signatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>(vkeys.map(w => [Ed25519PublicKeyHex(w.vkey), Ed25519SignatureHex(w.signature)]));
  const scripts: Cardano.Script[] = [context.paymentScript];
  if (plan.stakeScript) scripts.push(context.stakeScript);
  let redeemers: string | undefined;
  if (plan.plutus) {
    const validator = mappingValidatorFor(context.network);
    if (!validator || !review) return spendError('SCRIPT_DATA_MISMATCH', 'No mapping validator for this network');
    scripts.push({ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(validator.scriptCbor) });
    redeemers = redeemersCbor(operationRedeemers(operation, review.summary.inputs));
    const costModel = options.plutusV3CostModel;
    if (!costModel || scriptDataHashOf(redeemers, costModel) !== review.summary.scriptDataHash) {
      spendError('SCRIPT_DATA_MISMATCH', 'The redeemers rebuilt here do not give the script data hash the owners signed');
    }
  }
  const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures, scripts });
  // The redeemers go in as the bytes the script data hash covers.
  if (redeemers) witnessSet.setRedeemers(Serialization.Redeemers.fromCbor(HexBlob(redeemers)));
  // `[body, witness_set, true, null]`, with the body bytes untouched.
  const tx = `84${bundle.bodyCbor}${witnessSet.toCbor()}f5f6`;
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
