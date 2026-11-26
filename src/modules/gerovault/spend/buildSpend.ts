/**
 * Proposing a spend: the outputs a cosigner asked for, inputs chosen from the vault's own UTxOs,
 * the fee, and change back to the vault's full address.
 *
 * Coin selection is the SDK's `roundRobinRandomImprove`, the selector the wallet's own builder
 * uses. The fee is sized for the transaction as it will be submitted: the payment script in the
 * witness set and one vkey witness per signature the owners' branch needs (the threshold), plus
 * the same allowance for encoding variations the wallet's builder adds. The body names no
 * required signers: in phase 1 any threshold subset of owners may sign, and naming one would
 * declare a subset in advance.
 *
 * Change goes to the vault's full address with no datum and no reference script, which is the
 * only output the approval sheet counts as change.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519PublicKeyHex, Ed25519SignatureHex } from '@cardano-sdk/crypto';
import {
  InputSelectionError,
  roundRobinRandomImprove,
  type ChangeAddressResolver,
  type ProtocolParametersForInputSelection,
  type SelectionSkeleton,
} from '@cardano-sdk/input-selection';
import { computeMinimumCoinQuantity, computeSelectionLimit, minFee, tokenBundleSizeExceedsLimit } from '@cardano-sdk/tx-construction';
import { HexBlob } from '@cardano-sdk/util';
import { hexToBytes } from '@/shared/gerovault/cbor';
import { decodeAddressBytes } from '@/shared/gerovault/decode/address';
import { FieldRefusal } from '@/shared/gerovault/decode/refusals';
import type { BundleInputRef } from '@/modules/gerovault/contracts';
import { DEFAULT_VALIDITY_SLOTS, MAX_VALIDITY_SLOTS, NATIVE_FEE_MAX_LOVELACE } from './constants';
import { spendError, VaultSpendError } from './errors';
import type { VaultSpendContext } from './vaultSpendContext';

/** One payment the proposer asked for. */
export interface SpendRecipient {
  /** bech32, base or enterprise, on the vault's network. */
  readonly address: string;
  /** Lovelace. 0 with tokens means "the minimum the output needs". */
  readonly lovelace: bigint;
  /** Native tokens by asset id (policy id followed by the asset name, hex). */
  readonly assets?: ReadonlyMap<Cardano.AssetId, bigint>;
}

export type SpendProtocolParameters = ProtocolParametersForInputSelection;

export interface BuildSpendInput {
  readonly context: VaultSpendContext;
  /** UTxOs a chain reader returned for the vault's address. Others are ignored. */
  readonly utxos: readonly Cardano.Utxo[];
  readonly recipients: readonly SpendRecipient[];
  readonly protocolParameters: SpendProtocolParameters;
  /** The chain tip's slot: the proposal is valid until `currentSlot + validitySlots`. */
  readonly currentSlot: number;
  /** Default 48 hours, at most 7 days. */
  readonly validitySlots?: number;
  /** Coin selection's randomness; tests pass a seeded one. */
  readonly random?: () => number;
}

export interface BuiltSpend {
  /** The transaction body, lowercase hex: what every owner signs. */
  readonly bodyCbor: string;
  /** blake2b-256 of the body. */
  readonly txId: string;
  /** The inputs as the serialized body names them, in its order. */
  readonly inputs: readonly BundleInputRef[];
  readonly fee: bigint;
  /** The last slot the transaction is valid in. */
  readonly invalidHereafter: number;
}

/** Allowance for encoding variations, as `BrowserTxConstruction.minFee` adds for unsigned transactions. */
const FEE_PADDING_BYTES = 80n;
const DECIMAL_ADA = /^(0|[1-9][0-9]{0,10})(?:\.([0-9]{1,6}))?$/;
const TOKEN_QUANTITY = /^[1-9][0-9]{0,19}$/;
const MAX_U64 = 18446744073709551615n;

/** An ADA amount as typed ("12.5") in lovelace. Throws `INVALID_AMOUNT` for anything else. */
export function parseAdaAmount(text: string): bigint {
  const match = DECIMAL_ADA.exec(typeof text === 'string' ? text.trim() : '');
  if (!match) spendError('INVALID_AMOUNT', 'An ADA amount has at most six decimals');
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
}

/** A token quantity as typed (a positive whole number of base units). Throws `INVALID_AMOUNT`. */
export function parseTokenQuantity(text: string): bigint {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!TOKEN_QUANTITY.test(trimmed) || BigInt(trimmed) > MAX_U64) spendError('INVALID_AMOUNT', 'A token quantity is a positive whole number');
  return BigInt(trimmed);
}

/**
 * A recipient address as typed, checked with the approval sheet's own address rules: base or
 * enterprise, on the vault's network. Returns it in bech32. Throws `INVALID_RECIPIENT` with the
 * decoder's refusal code as the detail.
 */
export function readRecipientAddress(text: string, context: Pick<VaultSpendContext, 'networkId'>): string {
  let address: Cardano.Address;
  try {
    address = Cardano.Address.fromBech32(typeof text === 'string' ? text.trim() : '');
  } catch {
    return spendError('INVALID_RECIPIENT', 'Not a bech32 address', 'address_invalid');
  }
  try {
    return decodeAddressBytes(hexToBytes(address.toBytes()) ?? new Uint8Array(), 'recipient', context.networkId).bech32;
  } catch (error) {
    const code = error instanceof FieldRefusal ? error.refusal.code : 'address_invalid';
    return spendError('INVALID_RECIPIENT', 'The vault cannot pay this address', code);
  }
}

function addressHex(address: string): string | undefined {
  try {
    return Cardano.Address.fromBech32(address).toBytes();
  } catch {
    return undefined;
  }
}

/** The UTxOs at exactly the vault's full address; anything else a reader returned is dropped. */
export function vaultUtxos(utxos: readonly Cardano.Utxo[], context: Pick<VaultSpendContext, 'baseAddressHex'>): Cardano.Utxo[] {
  return utxos.filter(([, output]) => addressHex(output.address) === context.baseAddressHex);
}

/** The total of some UTxOs. A display: provider answers are never proof. */
export function utxoTotal(utxos: readonly Cardano.Utxo[]): { lovelace: bigint; assets: Map<Cardano.AssetId, bigint> } {
  let lovelace = 0n;
  const assets = new Map<Cardano.AssetId, bigint>();
  for (const [, output] of utxos) {
    lovelace += BigInt(output.value.coins);
    for (const [id, quantity] of output.value.assets ?? []) assets.set(id, (assets.get(id) ?? 0n) + BigInt(quantity));
  }
  return { lovelace, assets };
}

/** The witness set the transaction will carry, with placeholder signatures for sizing. */
function estimatedWitness(context: VaultSpendContext): Cardano.Witness {
  const signatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>();
  for (let i = 0; i < context.threshold; i++) {
    signatures.set(Ed25519PublicKeyHex(i.toString(16).padStart(64, '0')), Ed25519SignatureHex('0'.repeat(128)));
  }
  return { signatures, scripts: [context.paymentScript] };
}

function normalizedUtxo([input, output]: Cardano.Utxo): Cardano.Utxo {
  const assets = new Map<Cardano.AssetId, bigint>();
  for (const [id, quantity] of output.value.assets ?? []) assets.set(id, BigInt(quantity));
  return [input, { ...output, value: { coins: BigInt(output.value.coins), assets } }];
}

function recipientOutputs(recipients: readonly SpendRecipient[], context: VaultSpendContext, coinsPerUtxoByte: number): Cardano.TxOut[] {
  if (!Array.isArray(recipients) || recipients.length === 0) spendError('NO_RECIPIENT', 'A spend pays at least one address');
  const minimum = computeMinimumCoinQuantity(coinsPerUtxoByte);
  return recipients.map((recipient, i) => {
    const address = Cardano.PaymentAddress(readRecipientAddress(recipient.address, context));
    const assets = new Map<Cardano.AssetId, bigint>();
    for (const [id, quantity] of recipient.assets ?? []) {
      if (typeof quantity !== 'bigint' || quantity <= 0n) spendError('INVALID_AMOUNT', 'A token quantity is positive', String(i));
      assets.set(id, quantity);
    }
    if (typeof recipient.lovelace !== 'bigint' || recipient.lovelace < 0n) spendError('INVALID_AMOUNT', 'An ADA amount is not negative', String(i));
    const output: Cardano.TxOut = { address, value: { coins: recipient.lovelace, assets } };
    const required = minimum({ ...output, value: { ...output.value, coins: recipient.lovelace > 0n ? recipient.lovelace : 1n } });
    if (recipient.lovelace === 0n && assets.size > 0) return { ...output, value: { ...output.value, coins: required } };
    if (recipient.lovelace < required) spendError('BELOW_MIN_ADA', 'An output carries less ADA than it must', required.toString());
    return output;
  });
}

/**
 * Builds the body of a vault spend. Throws `VaultSpendError`: `NO_RECIPIENT`, `INVALID_RECIPIENT`,
 * `INVALID_AMOUNT`, `BELOW_MIN_ADA`, `INSUFFICIENT_FUNDS`, `FEE_TOO_HIGH`, `PARAMS_UNAVAILABLE`.
 */
export async function buildVaultSpend(input: BuildSpendInput): Promise<BuiltSpend> {
  const { context, protocolParameters: params } = input;
  if (!params || !Number.isSafeInteger(input.currentSlot) || input.currentSlot < 0) {
    spendError('PARAMS_UNAVAILABLE', 'Protocol parameters and the chain tip are needed to build');
  }
  const validitySlots = input.validitySlots ?? DEFAULT_VALIDITY_SLOTS;
  if (!Number.isSafeInteger(validitySlots) || validitySlots < 1 || validitySlots > MAX_VALIDITY_SLOTS) {
    spendError('PARAMS_UNAVAILABLE', 'A proposal is valid for at most seven days');
  }
  const invalidHereafter = input.currentSlot + validitySlots;
  const outputs = recipientOutputs(input.recipients, context, params.coinsPerUtxoByte);
  const utxos = vaultUtxos(input.utxos, context).map(normalizedUtxo);
  if (utxos.length === 0) spendError('INSUFFICIENT_FUNDS', 'The vault has no UTxOs at its address');

  const changeAddress = Cardano.PaymentAddress(context.baseAddress);
  // Change carries no datum and no reference script: only that is the vault's change.
  const changeAddressResolver: ChangeAddressResolver = {
    resolve: async ({ change }) => change.map(output => ({
      address: changeAddress,
      value: { coins: output.value.coins, assets: output.value.assets ?? new Map() },
    })),
  };
  const body = (selection: SelectionSkeleton, change: Cardano.TxOut[]): Cardano.TxBody => ({
    inputs: [...selection.inputs].map(([txIn]) => ({ txId: txIn.txId, index: txIn.index })),
    outputs: [...selection.outputs, ...change],
    fee: selection.fee,
    validityInterval: { invalidHereafter: Cardano.Slot(invalidHereafter) },
  });
  const estimated = async (selection: SelectionSkeleton): Promise<Cardano.Tx> => ({
    id: Cardano.TransactionId('0'.repeat(64)),
    body: body(selection, await changeAddressResolver.resolve(selection)),
    witness: estimatedWitness(context),
  });

  const selector = roundRobinRandomImprove({ changeAddressResolver, ...(input.random ? { random: input.random } : {}) });
  let selection: SelectionSkeleton;
  try {
    ({ selection } = await selector.select({
      preSelectedUtxo: new Set(),
      utxo: new Set(utxos),
      outputs: new Set(outputs),
      constraints: {
        computeMinimumCost: async skeleton => ({
          fee: minFee(await estimated(skeleton), [...skeleton.inputs], params) + FEE_PADDING_BYTES * BigInt(params.minFeeCoefficient),
        }),
        computeMinimumCoinQuantity: computeMinimumCoinQuantity(params.coinsPerUtxoByte),
        tokenBundleSizeExceedsLimit: tokenBundleSizeExceedsLimit(params.maxValueSize),
        computeSelectionLimit: computeSelectionLimit(params.maxTxSize, estimated),
      },
    }));
  } catch (error) {
    if (error instanceof VaultSpendError) throw error;
    if (error instanceof InputSelectionError) spendError('INSUFFICIENT_FUNDS', 'The vault cannot cover these outputs and the fee', error.failure);
    throw error;
  }
  if (selection.fee > NATIVE_FEE_MAX_LOVELACE) spendError('FEE_TOO_HIGH', 'The fee is above the native vault bound', selection.fee.toString());

  const bodyCbor = Serialization.TransactionBody.fromCore(body(selection, selection.change)).toCbor();
  // Read back what was written: the inputs in the serialized order, and the id of these exact bytes.
  const written = Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor));
  return Object.freeze({
    bodyCbor,
    txId: written.hash(),
    inputs: Object.freeze(written.inputs().toCore().map(({ txId, index }) => Object.freeze({ txId: String(txId), index }))),
    fee: selection.fee,
    invalidHereafter,
  });
}
