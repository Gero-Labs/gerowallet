/**
 * Proposing a stake or DUST operation from a native vault (`operations.ts` names the shapes): the
 * body every owner signs, built from the vault's own UTxOs, with everything left over back to the
 * vault's full address.
 *
 * - Inputs: vault UTxOs only, ADA-only ones first and UTxOs holding cNIGHT last, since spending a
 *   cNIGHT UTxO ends its DUST generation entry and starts a new one from zero. A deregistration
 *   also spends the registration UTxO.
 * - The fee is paid from the vault and sized for the transaction as it will be submitted: the
 *   threshold of payment signatures, the threshold of stake signatures when the stake script is its
 *   own, the collateral signature, the scripts and, for a DUST operation, the mapping validator,
 *   the redeemers with their declared budgets, and the same encoding allowance as a spend.
 * - Collateral (DUST operations only): one ADA-only UTxO of the proposer's own first address, with
 *   a collateral return to that address and the total stated, so at most the total can be lost,
 *   and only if the validator fails. A script address cannot give collateral, so a vault cannot.
 * - Validity: 48 hours for a stake operation; 24 hours for a DUST operation, inside the ledger's
 *   time forecast for Plutus scripts.
 *
 * The wallet never builds a second registration for a credential that has one, never registers
 * the stake credential twice, and never deregisters it while a DUST registration still needs its
 * withdrawal. Chain state comes from the caller's reads; a server's word is a display, and the
 * ledger is the judge of the rest.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519PublicKeyHex, Ed25519SignatureHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import type { BundleInputRef } from '@/modules/gerovault/contracts';
import type { BuiltSpend, SpendProtocolParameters } from '@/modules/gerovault/spend/buildSpend';
import { vaultUtxos } from '@/modules/gerovault/spend/buildSpend';
import { DEFAULT_VALIDITY_SLOTS, MAX_VALIDITY_SLOTS, NATIVE_FEE_MAX_LOVELACE } from '@/modules/gerovault/spend/constants';
import { spendError } from '@/modules/gerovault/spend/errors';
import type { VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import {
  cnightAssetOf,
  decodeScriptMappingDatum,
  dustAddressHex,
  encodeScriptMappingDatum,
  mappingValidatorFor,
  MAX_OPERATION_INPUTS,
  type MappingValidator,
} from './mappingValidator';

export { MAX_OPERATION_INPUTS };
import { operationRedeemers, type VaultOperation } from './operations';
import { plutusV3CostModel, redeemersCbor, scriptDataHashOf, type OperationRedeemer } from './scriptData';

/** A DUST operation is valid for 24 hours: inside the ledger's slot-to-time forecast (about 36 hours). */
export const DUST_OPERATION_VALIDITY_SLOTS = 24 * 3600;
/** The collateral UTxO holds at least this much ADA, so its return holds the minimum easily. */
export const MIN_COLLATERAL_INPUT_LOVELACE = 5_000_000n;
/** Allowance for encoding variations, as the spend builder adds. */
const FEE_PADDING_BYTES = 80n;
const MAX_FEE_ROUNDS = 8;

export interface OperationProtocolParameters extends SpendProtocolParameters {
  readonly stakeKeyDeposit: number;
  readonly collateralPercentage: number;
  readonly costModels: Cardano.CostModels;
}

/** What the chain says about the vault's stake credential, read by the caller. */
export interface StakeChainState {
  /** Whether the reward account is registered; null when the provider could not say. */
  readonly stakeRegistered: boolean | null;
  /** Withdrawable rewards, lovelace. A withdrawal must take all of them. */
  readonly rewards: bigint;
  /** The deposit the registration paid, when the provider says; otherwise the protocol's. */
  readonly deposit?: bigint;
  /** UTxOs at the mapping validator whose datum names this vault's stake credential. */
  readonly registrations: readonly Cardano.Utxo[];
}

export type OperationRequest =
  | { readonly kind: 'stake_register' }
  | { readonly kind: 'dust_register'; readonly dustAddress: string }
  | { readonly kind: 'dust_deregister'; readonly deregisterStake: boolean; readonly registration?: BundleInputRef }
  | { readonly kind: 'stake_deregister' };

/** The proposer's own first address and the UTxOs a reader returned for it. */
export interface CollateralSource {
  readonly address: string;
  readonly utxos: readonly Cardano.Utxo[];
}

export interface BuildOperationInput {
  readonly context: VaultSpendContext;
  /** UTxOs a chain reader returned for the vault's address. Others are ignored. */
  readonly utxos: readonly Cardano.Utxo[];
  readonly request: OperationRequest;
  readonly chain: StakeChainState;
  readonly protocolParameters: OperationProtocolParameters;
  readonly currentSlot: number;
  /** Required for a DUST operation. */
  readonly collateral?: CollateralSource;
  readonly validitySlots?: number;
}

export interface BuiltOperation extends BuiltSpend {
  readonly kind: VaultOperation['kind'];
}

const normalized = ([input, output]: Cardano.Utxo): Cardano.Utxo => {
  const assets = new Map<Cardano.AssetId, bigint>();
  for (const [id, quantity] of output.value.assets ?? []) assets.set(id, BigInt(quantity));
  return [input, { ...output, value: { coins: BigInt(output.value.coins), assets } }];
};

/** Whether a registration UTxO is one of this vault's: the validator's address, its token, our datum. */
export function isVaultRegistration(utxo: Cardano.Utxo, context: Pick<VaultSpendContext, 'network' | 'stakeScriptHash'>): boolean {
  const validator = mappingValidatorFor(context.network);
  if (!validator) return false;
  const [, output] = utxo;
  let addressHex: string;
  try {
    addressHex = Cardano.Address.fromBech32(output.address).toBytes();
  } catch {
    return false;
  }
  const assets = [...(output.value.assets ?? [])];
  const datum = output.datum ? Serialization.PlutusData.fromCore(output.datum).toCbor() : undefined;
  return addressHex === validator.addressHex
    && assets.length === 1 && assets[0][0] === Cardano.AssetId(validator.scriptHash) && BigInt(assets[0][1]) === 1n
    && !!datum && decodeScriptMappingDatum(datum)?.scriptHash === context.stakeScriptHash;
}

/** The registrations of this vault among the UTxOs a reader returned for the validator's address. */
export function vaultRegistrations(utxos: readonly Cardano.Utxo[], context: Pick<VaultSpendContext, 'network' | 'stakeScriptHash'>): Cardano.Utxo[] {
  return utxos.filter(utxo => isVaultRegistration(utxo, context));
}

function holdsCnight(utxo: Cardano.Utxo, unit: string | undefined): boolean {
  return !!unit && [...(utxo[1].value.assets ?? [])].some(([id]) => id === unit);
}

/** Vault UTxOs in the order an operation spends them. */
function orderedVaultUtxos(utxos: readonly Cardano.Utxo[], context: VaultSpendContext): Cardano.Utxo[] {
  const asset = cnightAssetOf(context.network);
  const unit = asset ? `${asset.policyId}${asset.assetNameHex}` : undefined;
  const rank = (utxo: Cardano.Utxo) => (holdsCnight(utxo, unit) ? 2 : (utxo[1].value.assets?.size ?? 0) > 0 ? 1 : 0);
  return vaultUtxos(utxos, context).map(normalized).sort((a, b) => rank(a) - rank(b) || (b[1].value.coins > a[1].value.coins ? 1 : b[1].value.coins < a[1].value.coins ? -1 : 0));
}

/** The ADA-only UTxO of the proposer's first address the collateral comes from: the smallest that is large enough. */
export function pickCollateral(source: CollateralSource | undefined): Cardano.Utxo {
  const address = source?.address;
  const candidates = (source?.utxos ?? [])
    .map(normalized)
    .filter(([, output]) => output.address === address && (output.value.assets?.size ?? 0) === 0 && !output.datum && !output.datumHash && !output.scriptReference
      && output.value.coins >= MIN_COLLATERAL_INPUT_LOVELACE)
    .sort((a, b) => (a[1].value.coins < b[1].value.coins ? -1 : a[1].value.coins > b[1].value.coins ? 1 : 0));
  let payment: Cardano.Credential | undefined;
  try {
    payment = address ? Cardano.Address.fromBech32(address).asBase()?.getPaymentCredential() : undefined;
  } catch {
    payment = undefined;
  }
  if (!candidates.length || payment?.type !== Cardano.CredentialType.KeyHash) return spendError('NO_COLLATERAL', 'The wallet has no ADA-only UTxO for collateral');
  return candidates[0];
}

/** The least lovelace an output needs: (160 + its size) per byte, with the coin's own size settled. */
function minLovelace(output: Serialization.TransactionOutput, coinsPerUtxoByte: number): bigint {
  let coins = 0n;
  for (let round = 0; round < 4; round++) {
    const next = BigInt(160 + withCoins(output, coins).toCbor().length / 2) * BigInt(coinsPerUtxoByte);
    if (next === coins) break;
    coins = next;
  }
  return coins;
}

function withCoins(output: Serialization.TransactionOutput, coins: bigint): Serialization.TransactionOutput {
  const core = output.toCore();
  const copy = Serialization.TransactionOutput.fromCore({ ...core, datum: undefined, value: { ...core.value, coins } });
  const datum = output.datum();
  if (datum) copy.setDatum(datum);
  return copy;
}

function sumAssets(utxos: readonly Cardano.Utxo[], skip?: Cardano.AssetId): Map<Cardano.AssetId, bigint> {
  const assets = new Map<Cardano.AssetId, bigint>();
  for (const [, output] of utxos) {
    for (const [id, quantity] of output.value.assets ?? []) {
      if (id === skip) continue;
      assets.set(id, (assets.get(id) ?? 0n) + BigInt(quantity));
    }
  }
  return assets;
}

const lovelaceOf = (utxos: readonly Cardano.Utxo[]) => utxos.reduce((sum, [, output]) => sum + BigInt(output.value.coins), 0n);

interface Shape {
  readonly kind: VaultOperation['kind'];
  readonly validator?: MappingValidator;
  readonly certificate?: Cardano.Certificate;
  /** Lovelace the certificate pays (registration) or returns (deregistration). */
  readonly deposit: bigint;
  readonly refund: bigint;
  readonly withdrawal: bigint | null;
  readonly mint: bigint;
  readonly registrationInput?: Cardano.Utxo;
  readonly datumCbor?: string;
  readonly collateral?: Cardano.Utxo;
}

function shapeOf(input: BuildOperationInput): Shape {
  const { context, request, chain, protocolParameters: params } = input;
  const stakeCredential: Cardano.Credential = { type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(context.stakeScriptHash) };
  const deposit = BigInt(params.stakeKeyDeposit);
  const registeredDeposit = chain.deposit !== undefined && chain.deposit > 0n ? chain.deposit : deposit;
  const registrations = chain.registrations.filter(utxo => isVaultRegistration(utxo, context));
  const unregister = (): Cardano.Certificate => ({ __typename: Cardano.CertificateType.Unregistration, stakeCredential, deposit: registeredDeposit });
  if (request.kind === 'stake_register') {
    if (chain.stakeRegistered === true) spendError('STAKE_ALREADY_REGISTERED', 'The vault\'s stake credential is already registered');
    return { kind: 'stake_register', certificate: { __typename: Cardano.CertificateType.Registration, stakeCredential, deposit }, deposit, refund: 0n, withdrawal: null, mint: 0n };
  }
  if (request.kind === 'stake_deregister') {
    if (chain.stakeRegistered === false) spendError('STAKE_NOT_REGISTERED', 'The vault\'s stake credential is not registered');
    if (registrations.length > 0) spendError('DUST_ALREADY_REGISTERED', 'Remove the DUST registration first: it needs the stake credential', 'deregister_dust_first');
    return { kind: 'stake_deregister', certificate: unregister(), deposit: 0n, refund: registeredDeposit, withdrawal: chain.rewards > 0n ? chain.rewards : null, mint: 0n };
  }
  const validator = mappingValidatorFor(context.network);
  if (!validator) return spendError('OPERATION_UNAVAILABLE', 'This network has no DUST mapping validator in this release');
  const collateral = pickCollateral(input.collateral);
  if (chain.stakeRegistered === false) spendError('STAKE_NOT_REGISTERED', 'Register the vault\'s stake credential first: the mapping validator needs its withdrawal');
  if (request.kind === 'dust_register') {
    if (registrations.length > 0) spendError('DUST_ALREADY_REGISTERED', 'This stake credential already has a DUST registration');
    const dust = dustAddressHex(context.network, request.dustAddress);
    if (!dust) return spendError('INVALID_DUST_ADDRESS', 'Not a DUST address of this network');
    return {
      kind: 'dust_register', validator, deposit: 0n, refund: 0n, withdrawal: chain.rewards, mint: 1n,
      datumCbor: encodeScriptMappingDatum(context.stakeScriptHash, dust), collateral,
    };
  }
  const wanted = request.registration;
  const registration = wanted
    ? registrations.find(([ref]) => ref.txId === wanted.txId && ref.index === wanted.index)
    : registrations.length === 1 ? registrations[0] : undefined;
  if (!registration) spendError('DUST_NOT_REGISTERED', 'No DUST registration of this vault to remove', registrations.length > 1 ? 'choose' : undefined);
  return {
    kind: 'dust_deregister', validator, deposit: 0n, refund: request.deregisterStake ? registeredDeposit : 0n, withdrawal: chain.rewards, mint: -1n,
    registrationInput: normalized(registration), collateral,
    ...(request.deregisterStake ? { certificate: unregister() } : {}),
  };
}

/** Placeholder vkey witnesses, for sizing: distinct keys, fixed-size signatures. */
function placeholderSignatures(count: number): Map<Ed25519PublicKeyHex, Ed25519SignatureHex> {
  const signatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>();
  for (let i = 0; i < count; i++) signatures.set(Ed25519PublicKeyHex(i.toString(16).padStart(64, '0')), Ed25519SignatureHex('0'.repeat(128)));
  return signatures;
}

/**
 * Builds the body of a stake or DUST operation. Throws `VaultSpendError`: `STAKE_ALREADY_REGISTERED`,
 * `STAKE_NOT_REGISTERED`, `DUST_ALREADY_REGISTERED`, `DUST_NOT_REGISTERED`, `INVALID_DUST_ADDRESS`,
 * `NO_COLLATERAL`, `OPERATION_UNAVAILABLE`, `INSUFFICIENT_FUNDS`, `FEE_TOO_HIGH`, `PARAMS_UNAVAILABLE`.
 */
export async function buildVaultOperation(input: BuildOperationInput): Promise<BuiltOperation> {
  const { context, protocolParameters: params } = input;
  if (!params || !Number.isSafeInteger(input.currentSlot) || input.currentSlot < 0) {
    spendError('PARAMS_UNAVAILABLE', 'Protocol parameters and the chain tip are needed to build');
  }
  const shape = shapeOf(input);
  const plutus = !!shape.validator;
  const costModel = plutus ? plutusV3CostModel(params.costModels) : undefined;
  if (plutus && (!costModel || !Number.isSafeInteger(params.collateralPercentage) || params.collateralPercentage <= 0)) {
    spendError('PARAMS_UNAVAILABLE', 'A DUST operation needs the Plutus V3 cost model and the collateral percentage');
  }
  const validitySlots = input.validitySlots ?? (plutus ? DUST_OPERATION_VALIDITY_SLOTS : DEFAULT_VALIDITY_SLOTS);
  if (!Number.isSafeInteger(validitySlots) || validitySlots < 1 || validitySlots > (plutus ? DUST_OPERATION_VALIDITY_SLOTS : MAX_VALIDITY_SLOTS)) {
    spendError('PARAMS_UNAVAILABLE', 'The validity window is too long for this operation');
  }
  const invalidHereafter = input.currentSlot + validitySlots;
  const candidates = orderedVaultUtxos(input.utxos, context);
  if (candidates.length === 0) spendError('INSUFFICIENT_FUNDS', 'The vault has no UTxOs at its address');

  const registrationToken = shape.validator ? Cardano.AssetId(shape.validator.scriptHash) : undefined;
  const changeAddress = Cardano.PaymentAddress(context.baseAddress);
  const witnessCount = context.threshold + (context.sharedStakeCredential ? 0 : context.stakeThreshold) + (plutus ? 1 : 0);
  const scripts: Cardano.Script[] = [context.paymentScript];
  if (!context.sharedStakeCredential) scripts.push(context.stakeScript);
  if (shape.validator) scripts.push({ __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V3, bytes: HexBlob(shape.validator.scriptCbor) });

  // The registration output (a registration only), with the datum's exact bytes.
  let registrationOutput: Serialization.TransactionOutput | undefined;
  if (shape.kind === 'dust_register' && shape.validator && shape.datumCbor && registrationToken) {
    const draft = Serialization.TransactionOutput.fromCore({
      address: Cardano.PaymentAddress(shape.validator.address),
      value: { coins: 0n, assets: new Map([[registrationToken, 1n]]) },
    });
    draft.setDatum(Serialization.Datum.newInlineData(Serialization.PlutusData.fromCbor(HexBlob(shape.datumCbor))));
    registrationOutput = withCoins(draft, minLovelace(draft, params.coinsPerUtxoByte));
  }
  const lockedLovelace = registrationOutput ? registrationOutput.amount().coin() : 0n;

  for (let count = 1; count <= Math.min(candidates.length, MAX_OPERATION_INPUTS); count++) {
    const chosen = candidates.slice(0, count);
    const spent = shape.registrationInput ? [...chosen, shape.registrationInput] : chosen;
    const inputs = spent.map(([txIn]) => ({ txId: txIn.txId, index: txIn.index }));
    const lovelaceIn = lovelaceOf(spent) + (shape.withdrawal ?? 0n) + shape.refund;
    const changeAssets = sumAssets(spent, registrationToken);
    const operationRead = shape.kind === 'dust_deregister' && shape.registrationInput
      ? { kind: 'dust_deregister', registration: { txId: String(shape.registrationInput[0].txId), index: shape.registrationInput[0].index } } as VaultOperation
      : shape.kind === 'dust_register' ? { kind: 'dust_register' } as VaultOperation : undefined;
    const redeemers: OperationRedeemer[] = operationRedeemers(operationRead, inputs.map(i => ({ txId: String(i.txId), index: i.index })));
    const redeemersField = redeemers.length > 0 ? redeemersCbor(redeemers) : undefined;
    const scriptFee = (() => {
      const memory = redeemers.reduce((sum, r) => sum + r.exUnits.memory, 0);
      const steps = redeemers.reduce((sum, r) => sum + r.exUnits.steps, 0);
      return BigInt(Math.ceil(memory * params.prices.memory + steps * params.prices.steps));
    })();

    const bodyFor = (fee: bigint, changeLovelace: bigint): Serialization.TransactionBody => {
      const change = Serialization.TransactionOutput.fromCore({ address: changeAddress, value: { coins: changeLovelace, assets: changeAssets } });
      let collateral: Partial<Cardano.TxBody> = {};
      if (shape.collateral && redeemersField && costModel) {
        const totalCollateral = (fee * BigInt(params.collateralPercentage) + 99n) / 100n;
        const [collateralIn, collateralOut] = shape.collateral;
        collateral = {
          collaterals: [{ txId: collateralIn.txId, index: collateralIn.index }],
          collateralReturn: { address: collateralOut.address, value: { coins: collateralOut.value.coins - totalCollateral } },
          totalCollateral,
          scriptIntegrityHash: Hash32ByteBase16(scriptDataHashOf(redeemersField, costModel)),
        };
      }
      const core: Cardano.TxBody = {
        inputs,
        outputs: [],
        fee,
        validityInterval: { invalidHereafter: Cardano.Slot(invalidHereafter) },
        ...(shape.certificate ? { certificates: [shape.certificate] } : {}),
        ...(shape.withdrawal !== null ? { withdrawals: [{ stakeAddress: Cardano.RewardAccount(context.rewardAccount), quantity: shape.withdrawal }] } : {}),
        ...(registrationToken && shape.mint !== 0n ? { mint: new Map([[registrationToken, shape.mint]]) } : {}),
        ...collateral,
      };
      const body = Serialization.TransactionBody.fromCore(core);
      // Outputs as objects, so the registration datum keeps the exact bytes the sheet reads.
      body.setOutputs(registrationOutput ? [registrationOutput, change] : [change]);
      return body;
    };
    const feeOf = (body: Serialization.TransactionBody): bigint => {
      const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures: placeholderSignatures(witnessCount), scripts });
      if (redeemersField) witnessSet.setRedeemers(Serialization.Redeemers.fromCbor(HexBlob(redeemersField)));
      const size = BigInt((`84${body.toCbor()}${witnessSet.toCbor()}f5f6`.length) / 2) + FEE_PADDING_BYTES;
      return size * BigInt(params.minFeeCoefficient) + BigInt(params.minFeeConstant) + scriptFee;
    };

    let fee = 0n;
    let body: Serialization.TransactionBody | undefined;
    let short = false;
    for (let round = 0; round < MAX_FEE_ROUNDS; round++) {
      const changeLovelace = lovelaceIn - lockedLovelace - shape.deposit - fee;
      const probe = bodyFor(fee, changeLovelace > 0n ? changeLovelace : 0n);
      const changeOutput = probe.outputs()[probe.outputs().length - 1];
      if (changeLovelace < minLovelace(changeOutput, params.coinsPerUtxoByte)) {
        short = true;
        break;
      }
      const needed = feeOf(probe);
      if (needed <= fee) {
        body = probe;
        break;
      }
      fee = needed;
    }
    if (short || !body) continue;
    if (fee > NATIVE_FEE_MAX_LOVELACE) spendError('FEE_TOO_HIGH', 'The fee is above the native vault bound', fee.toString());
    if (shape.collateral) {
      const back = body.collateralReturn();
      if (!back || back.amount().coin() < minLovelace(back, params.coinsPerUtxoByte)) spendError('NO_COLLATERAL', 'The collateral UTxO is too small for its return');
    }
    const bodyCbor = body.toCbor();
    const written = Serialization.TransactionBody.fromCbor(HexBlob(bodyCbor));
    return Object.freeze({
      kind: shape.kind,
      bodyCbor,
      txId: written.hash(),
      inputs: Object.freeze(written.inputs().toCore().map(({ txId, index }) => Object.freeze({ txId: String(txId), index }))),
      fee,
      invalidHereafter,
    });
  }
  return spendError('INSUFFICIENT_FUNDS', 'The vault cannot cover this operation and its fee');
}
