import { Cardano } from '@cardano-sdk/core';
import {
  InputSelector,
  InputSelectionError,
  InputSelectionFailure,
  ChangeAddressResolver,
  roundRobinRandomImprove,
  ImplicitValue,
  ProtocolParametersForInputSelection,
  EstimateTxCosts
} from '@cardano-sdk/input-selection';
import {
  computeMinimumCoinQuantity,
  tokenBundleSizeExceedsLimit,
  computeSelectionLimit
} from '@cardano-sdk/tx-construction';
import type { BuildTx } from '@cardano-sdk/tx-construction';
import { BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';
import { filterOutCollateralFromUTxOs } from '@/chrome/serialization';
import { Keys } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import { DEFAULT_TX_TTL_SLOTS } from './transaction';

/** CIP-0149 metadata label for voluntary DRep compensation */
export const CIP149_METADATA_LABEL = BigInt(3692);

export function diffAssetsFromIncomingToOutgoing(inputAssets: Cardano.Value, outputAssets: Cardano.Value) {
  if (!inputAssets || !outputAssets) {
    return null;
  }
  const allAssets: Set<Cardano.AssetId> = new Set([
    ...(inputAssets.assets ? inputAssets.assets.keys() : []),
    ...(outputAssets.assets ? outputAssets.assets.keys() : []),
  ]);
  const assetsArray = Array.from(allAssets)
    .map(assetId => {
      const inValue: bigint = inputAssets.assets ? BigInt(inputAssets.assets.get(assetId) ?? 0) : 0n;
      const outValue: bigint = outputAssets.assets ? BigInt(outputAssets.assets.get(assetId) ?? 0) : 0n;
      const difference: bigint = inValue - outValue;
      return {
        assetName: Cardano.AssetId(assetId),
        policy: Cardano.AssetId.getPolicyId(assetId),
        quantity: difference,
        id: assetId,
      };
    }).filter(asset => asset.quantity !== 0n);
  const cardano = {
    assetName: 'cardano',
    policy: '',
    quantity: BigInt(inputAssets.coins) - BigInt(outputAssets.coins),
    id: 'cardano'
  }
  return [cardano, ...assetsArray]
}

export function getPayAndReceiveTokens(diff) {
  const payTokens = [];
  const receiveTokens = [];
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].quantity > BigInt(0)) {
      payTokens.push({
        name: diff[i].assetName,
        amount: diff[i].quantity.toString(),
        id: diff[i].id,
      });
    } else if (diff[i].quantity < BigInt(0)) {
      receiveTokens.push({
        name: diff[i].assetName,
        amount: (diff[i].quantity * BigInt(-1)).toString(),
        id: diff[i].id,
      });
    }
  }
  return { payTokens, receiveTokens };
}

/**
 * Generic transaction builder using Cardano JS SDK
 * Supports any transaction with certificates, withdrawals, and outputs
 */
export async function buildCardanoTransaction({
  certificates = [],
  votingProcedures,
  withdrawals = [],
  outputs = [],
  utxos,
  epochParams,
  changeAddress,
  tip,
  implicitCoin = BigInt(0),
  walletContext,
  auxiliaryData,
  requiredExtraSignatures,
  invalidHereafter,
  excludeCollateral = true
}: {
  certificates?: Cardano.Certificate[];
  votingProcedures?: Cardano.VotingProcedures;
  withdrawals?: Cardano.Withdrawal[];
  outputs?: Cardano.TxOut[];
  utxos: Cardano.Utxo[];
  /** Only the input-selection subset is read; the store's full ProtocolParameters satisfies it. */
  epochParams: ProtocolParametersForInputSelection;
  changeAddress: string;
  /**
   * Only `slot` is read. Optional so the store's Cardano/Bitcoin tip union stays
   * assignable; `time` exists on both tip shapes and keeps this from being an
   * all-optional "weak" type the union could not satisfy.
   */
  tip: { slot?: number | string; time?: number };
  implicitCoin?: bigint; // For deposits (positive) or deposit returns (negative)
  walletContext?: {
    /** `Keys | null` because callers pass the store's nullable keys straight through. */
    keys: Keys | null;
  };
  auxiliaryData?: Cardano.AuxiliaryData;
  requiredExtraSignatures?: Cardano.TxBody['requiredExtraSignatures'];
  /** Optional cap on the usual one-hour validity window. */
  invalidHereafter?: Cardano.Slot;
  excludeCollateral?: boolean;
}): Promise<Cardano.Tx> {
  // Check if we have epoch parameters
  if (!epochParams) {
    throw new Error('Epoch parameters not available');
  }

  // Fee estimation and the body handed to the signer must commit to the same
  // metadata, witness requirements and validity interval.
  const bodyFields = {
    validityInterval: { invalidHereafter: Cardano.Slot(Math.min(Number(tip.slot) + DEFAULT_TX_TTL_SLOTS, invalidHereafter ?? Infinity)) },
    ...(auxiliaryData && { auxiliaryDataHash: Cardano.computeAuxiliaryDataHash(auxiliaryData) }),
    ...(requiredExtraSignatures?.length && { requiredExtraSignatures }),
  };

  // The selector has already split change to satisfy maxValueSize and minimum ADA.
  // Only replace the placeholder address; recombining the values invalidates that split.
  const changeAddressResolver: ChangeAddressResolver = {
    resolve: async ({ change }) => change.map(output => ({
      ...output,
      address: changeAddress as Cardano.PaymentAddress,
      value: { ...output.value, assets: output.value.assets ?? new Map() },
    })),
  };

  // Use Cardano JS SDK input selection
  const selector: InputSelector = roundRobinRandomImprove({
    changeAddressResolver
  });

  // Create protocol parameters for fee calculation
  const protocolParams: ProtocolParametersForInputSelection = {
    coinsPerUtxoByte: epochParams.coinsPerUtxoByte,
    maxTxSize: epochParams.maxTxSize,
    maxValueSize: epochParams.maxValueSize,
    minFeeCoefficient: epochParams.minFeeCoefficient,
    minFeeConstant: epochParams.minFeeConstant,
    prices: epochParams.prices,
    minFeeRefScriptCostPerByte: epochParams.minFeeRefScriptCostPerByte
  };

  // Create a buildTx function that properly constructs the transaction
  const buildTx: BuildTx = async selectionSkeleton => {
    // Build transaction body with selected inputs and outputs
    const txBody: Cardano.TxBody = {
      inputs: Array.from(selectionSkeleton.inputs).map(utxo => utxo[0]),
      outputs: [...selectionSkeleton.outputs, ...selectionSkeleton.change],
      fee: selectionSkeleton.fee,
      ...bodyFields
    };

    // Add certificates if provided
    if (certificates.length > 0) {
      txBody.certificates = certificates;
    }

    if (votingProcedures && votingProcedures.length > 0) {
      txBody.votingProcedures = votingProcedures;
    }

    // Add withdrawals if provided
    if (withdrawals.length > 0) {
      txBody.withdrawals = withdrawals;
    }

    // Return the complete transaction
    return {
      id: Cardano.TransactionId('0'.repeat(64)),
      body: txBody,
      witness: { signatures: new Map() },
      auxiliaryData
    };
  };

  // Create custom computeMinimumCost that uses our witness-aware fee calculation
  const computeMinimumCost: EstimateTxCosts = async selectionSkeleton => {
    const tx = await buildTx({
      ...selectionSkeleton,
      change: await changeAddressResolver.resolve(selectionSkeleton),
    });

    // Convert selection skeleton inputs to resolved UTXOs for fee calculation
    const resolvedInputs = Array.from(selectionSkeleton.inputs);

    const fee = BrowserTxConstruction.minFee(tx, resolvedInputs, protocolParams, walletContext);

    return { fee };
  };

  // Use SDK's constraint functions but with our custom fee calculator
  const constraints = {
    computeMinimumCost,
    computeMinimumCoinQuantity: computeMinimumCoinQuantity(protocolParams.coinsPerUtxoByte),
    tokenBundleSizeExceedsLimit: tokenBundleSizeExceedsLimit(protocolParams.maxValueSize),
    computeSelectionLimit: computeSelectionLimit(protocolParams.maxTxSize, async selection =>
      BrowserTxConstruction.withEstimatedWitnesses(await buildTx(selection), [...selection.inputs], walletContext)),
  };

  // exclude the auto-picked collateral UTxO from coin selection
  // so a regular send doesn't accidentally spend the UTxO that dApps will use
  // for collateral. Callers that explicitly need to use the collateral UTxO
  // (e.g. CollateralTab.vue's "Set Collateral" flow) pass excludeCollateral: false.
  let inputUtxos = utxos;
  if (excludeCollateral && walletStore.collateral) {
    const filtered = filterOutCollateralFromUTxOs(utxos, walletStore.collateral);
    // Edge case: if filtering leaves no UTxOs (e.g. wallet has only the collateral
    // UTxO), fall back to the unfiltered list so the tx can still be built.
    if (filtered.length === 0) {
      debugLog('[builder] Only UTxO is collateral; falling back to unfiltered set');
      inputUtxos = utxos;
    } else {
      inputUtxos = filtered;
    }
  }

  // Convert UTXOs to proper format with BigInt values and ensure assets is always a Map
  const formattedUtxos: Cardano.Utxo[] = inputUtxos.map(utxo => {

    // Ensure assets is always a Map (not undefined or null)
    let assets: Map<Cardano.AssetId, bigint>;

    if (utxo[1].value.assets instanceof Map) {
      assets = utxo[1].value.assets;
    } else if (utxo[1].value.assets && typeof utxo[1].value.assets === 'object') {
      // Handle case where assets might be an object instead of Map
      assets = new Map();
      Object.entries(utxo[1].value.assets).forEach(([assetId, quantity]) => {
        assets.set(assetId as Cardano.AssetId, BigInt(quantity as string | number | bigint));
      });
    } else {
      assets = new Map();
    }


    return [
      utxo[0], // TxIn remains the same
      {
        ...utxo[1], // TxOut
        value: {
          coins: BigInt(utxo[1].value.coins), // Ensure BigInt
          assets: assets
        }
      }
    ];
  });


  // Convert arrays to Sets for input selection
  const utxoSet = new Set(formattedUtxos);

  // Ensure outputs have proper asset structure (Map, not undefined)
  const normalizedOutputs = outputs.map(output => ({
    ...output,
    value: {
      ...output.value,
      assets: output.value.assets || new Map()
    }
  }));

  const outputsSet = new Set<Cardano.TxOut>(normalizedOutputs);

  const withdrawalsTotal = withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, 0n);
  const refund = implicitCoin < 0n ? -implicitCoin : 0n;
  const implicitValue: ImplicitValue = {
    coin: {
      input: withdrawalsTotal + refund,
      withdrawals: withdrawalsTotal,
      reclaimDeposit: refund,
      deposit: implicitCoin > 0n ? implicitCoin : 0n,
    },
  };

  // Perform input selection with implicit value for deposits
  const selectionParams = {
    preSelectedUtxo: new Set(),
    utxo: utxoSet,
    outputs: outputsSet,
    constraints,
    implicitValue
  } satisfies Parameters<InputSelector['select']>[0];
  let selectionResult;
  try {
    selectionResult = await selector.select(selectionParams);
  } catch (error) {
    // Packing up to maxValueSize can split a policy between two outputs. Its
    // repeated policy ID then needs more minimum ADA than the wallet has.
    // For fee-only metadata try whole policies before reporting insufficient funds.
    const feeOnlyMetadata = auxiliaryData && !outputs.length && !certificates.length &&
      !withdrawals.length && !votingProcedures?.length && !implicitCoin;
    const hasTokens = formattedUtxos.some(([, output]) => output.value.assets?.size);
    if (!feeOnlyMetadata || !hasTokens || !(error instanceof InputSelectionError) ||
        error.failure !== InputSelectionFailure.UtxoFullyDepleted) {
      throw error;
    }
    selectionResult = await selector.select({
      ...selectionParams,
      constraints: {
        ...constraints,
        tokenBundleSizeExceedsLimit: assets => constraints.tokenBundleSizeExceedsLimit(assets) ||
          new Set(Array.from(assets?.keys() ?? [], id => Cardano.AssetId.getPolicyId(id))).size > 1,
      },
    });
  }
  return buildTx(selectionResult.selection);
}

/**
 * Build CIP-0149 auxiliary data for voluntary DRep compensation.
 * @param donationBasisPoints - Donation percentage in thousandths (1 = 0.1%, 10 = 1%, 50 = 5%, 100 = 10%)
 * @returns AuxiliaryData with metadata label 3692
 */
export function buildCip149AuxiliaryData(donationBasisPoints: number): Cardano.AuxiliaryData {
  const metadataMap: Cardano.MetadatumMap = new Map();
  metadataMap.set('donationBasisPoints', BigInt(donationBasisPoints));

  const blob: Cardano.TxMetadata = new Map();
  blob.set(CIP149_METADATA_LABEL, metadataMap);

  return { blob };
}

/**
 * Extract CIP-0149 donationBasisPoints from transaction auxiliary data.
 * @returns The basis points value, or null if not present
 */
export function extractCip149Compensation(auxiliaryData?: unknown): number | null {
  if (!auxiliaryData || typeof auxiliaryData !== 'object' || !('blob' in auxiliaryData)) return null;

  // Chrome messaging/storage serialize SDK Maps to objects and BigInts to
  // strings. Read both representations without rewriting transaction data.
  const entry = (value: unknown, key: string | bigint): unknown => {
    if (value instanceof Map) return value.get(key);
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        Object.prototype.hasOwnProperty.call(value, String(key))) {
      return (value as Record<string, unknown>)[String(key)];
    }
    return undefined;
  };
  const cip149Data = entry(auxiliaryData.blob, CIP149_METADATA_LABEL);
  const bps = entry(cip149Data, 'donationBasisPoints');
  if (typeof bps !== 'number' && typeof bps !== 'bigint' &&
      !(typeof bps === 'string' && /^\d+$/.test(bps))) return null;

  const rate = Number(bps);
  return Number.isSafeInteger(rate) && rate >= 0 ? rate : null;
}
