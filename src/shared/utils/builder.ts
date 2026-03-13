import { Cardano } from '@cardano-sdk/core';
import {
  InputSelector,
  ChangeAddressResolver,
  SelectionSkeleton,
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
      const inValue: bigint = inputAssets.assets ? inputAssets.assets.get(assetId) : 0n;
      const outValue: bigint = outputAssets.assets ? outputAssets.assets.get(assetId) : 0n;
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
    quantity: inputAssets.coins - outputAssets.coins,
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
  withdrawals = [],
  outputs = [],
  utxos,
  epochParams,
  changeAddress,
  tip,
  implicitCoin = BigInt(0),
  walletContext,
  auxiliaryData
}: {
  certificates?: Cardano.Certificate[];
  withdrawals?: Cardano.Withdrawal[];
  outputs?: Cardano.TxOut[];
  utxos: Cardano.Utxo[];
  epochParams: any;
  changeAddress: string;
  tip: any;
  implicitCoin?: bigint; // For deposits (positive) or deposit returns (negative)
  walletContext?: {
    keys: any;
    stakeAddress: string;
    accountIndex: number;
  };
  auxiliaryData?: Cardano.AuxiliaryData;
}): Promise<Cardano.Tx> {
  // Check if we have epoch parameters
  if (!epochParams) {
    throw new Error('Epoch parameters not available');
  }

  // Calculate total withdrawals amount
  let totalWithdrawals = BigInt(0);
  if (withdrawals.length > 0) {
    totalWithdrawals = withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, BigInt(0));
  }

  // Create a change address resolver for input selection
  const changeAddressResolver: ChangeAddressResolver = {
    resolve: async (selectionSkeleton: SelectionSkeleton) => {
      // Calculate change amounts for both ADA and native tokens
      const totalInput = Array.from(selectionSkeleton.inputs).reduce((sum, [, utxo]) => sum + utxo.value.coins, BigInt(0));
      const totalOutput = Array.from(selectionSkeleton.outputs).reduce((sum, output) => sum + output.value.coins, BigInt(0));
      const implicitCost = implicitCoin + selectionSkeleton.fee;
      // Add withdrawals to the available balance (withdrawals are incoming funds)
      const changeAmount = totalInput + totalWithdrawals - totalOutput - implicitCost;

      // Calculate change assets by aggregating all input assets and subtracting output assets
      const changeAssets = new Map<Cardano.AssetId, bigint>();


      // Add all input assets
      for (const [, utxo] of selectionSkeleton.inputs) {
        if (utxo.value.assets) {
          for (const [assetId, quantity] of utxo.value.assets) {
            const currentQuantity = changeAssets.get(assetId) || BigInt(0);
            const newQuantity = currentQuantity + quantity;
            changeAssets.set(assetId, newQuantity);
          }
        }
      }


      // Subtract all output assets
      for (const output of selectionSkeleton.outputs) {
        if (output.value.assets) {
          for (const [assetId, quantity] of output.value.assets) {
            const currentQuantity = changeAssets.get(assetId) || BigInt(0);
            const newQuantity = currentQuantity - quantity;
            if (newQuantity > BigInt(0)) {
              changeAssets.set(assetId, newQuantity);
            } else {
              changeAssets.delete(assetId);
            }
          }
        }
      }


      // CRITICAL FIX: For transactions with certificates or withdrawals (and no explicit outputs),
      // we ALWAYS need a change output to return the remaining balance to the wallet.
      // The issue is that during fee estimation, the fee might be underestimated, causing
      // changeAmount to appear negative or zero. But we still need to create the change output
      // so the actual fee calculation (with witness overhead) includes its size.
      const isCertificateOrWithdrawalOnly = (certificates.length > 0 || withdrawals.length > 0) && selectionSkeleton.outputs.size === 0;

      // Only skip change output if:
      // 1. There's definitely no change (negative or zero)
      // 2. AND there are no remaining assets
      // 3. AND this is NOT a certificate/withdrawal-only transaction
      if (changeAmount <= BigInt(0) && changeAssets.size === 0 && !isCertificateOrWithdrawalOnly) {
        return []; // No change needed
      }

      // Ensure we have at least minimum ADA for the change output
      // For certificate/withdrawal transactions, use a reasonable minimum even if calculated change is low
      let finalChangeAmount: bigint;
      if (changeAmount > BigInt(0)) {
        finalChangeAmount = changeAmount;
      } else if (isCertificateOrWithdrawalOnly) {
        // For certificate/withdrawal transactions, ensure minimum change
        // This will be refined during input selection iterations
        finalChangeAmount = BigInt(1000000); // 1 ADA minimum
      } else {
        finalChangeAmount = BigInt(1000000); // 1 ADA minimum
      }

      // Create change output to a specified address
      const changeOutput: Cardano.TxOut = {
        address: changeAddress as Cardano.PaymentAddress,
        value: {
          coins: finalChangeAmount,
          assets: changeAssets
        }
      };

      return [changeOutput];
    }
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
  const buildTx: BuildTx = async (selectionSkeleton: SelectionSkeleton) => {
    // Build transaction body with selected inputs and outputs
    const txBody: Cardano.TxBody = {
      inputs: Array.from(selectionSkeleton.inputs).map(utxo => utxo[0]),
      outputs: Array.from(selectionSkeleton.outputs),
      fee: selectionSkeleton.fee,
      validityInterval: {
        invalidHereafter: Cardano.Slot(Number(tip.slot) + 3600) // 1 hour from now
      }
    };

    // Add certificates if provided
    if (certificates.length > 0) {
      txBody.certificates = certificates;
    }

    // Add withdrawals if provided
    if (withdrawals.length > 0) {
      txBody.withdrawals = withdrawals;
    }

    // Compute auxiliaryDataHash if metadata is provided
    if (auxiliaryData) {
      txBody.auxiliaryDataHash = Cardano.computeAuxiliaryDataHash(auxiliaryData);
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
  const computeMinimumCost: EstimateTxCosts = async (selectionSkeleton: SelectionSkeleton) => {
    // CRITICAL: Resolve change outputs before building transaction for fee calculation
    // The change output significantly affects transaction size and thus fee
    const changeOutputs = await changeAddressResolver.resolve(selectionSkeleton);

    // Build skeleton with change outputs included for accurate fee calculation
    const skeletonWithChange: SelectionSkeleton = {
      ...selectionSkeleton,
      outputs: new Set([...selectionSkeleton.outputs, ...changeOutputs])
    };

    // Build the transaction to get the actual structure (including change output)
    const tx = await buildTx(skeletonWithChange);

    // Convert selection skeleton inputs to resolved UTXOs for fee calculation
    const resolvedInputs = Array.from(selectionSkeleton.inputs);

    // Use our witness-aware fee calculation with wallet context for accurate signature estimation
    const fee = BrowserTxConstruction.minFee(tx, resolvedInputs, protocolParams, walletContext);

    return { fee };
  };

  // Use SDK's constraint functions but with our custom fee calculator
  const constraints = {
    computeMinimumCost,
    computeMinimumCoinQuantity: computeMinimumCoinQuantity(protocolParams.coinsPerUtxoByte),
    tokenBundleSizeExceedsLimit: tokenBundleSizeExceedsLimit(protocolParams.maxValueSize),
    computeSelectionLimit: computeSelectionLimit(protocolParams.maxTxSize, buildTx)
  };

  // Convert UTXOs to proper format with BigInt values and ensure assets is always a Map
  const formattedUtxos: Cardano.Utxo[] = utxos.map((utxo: any) => {

    // Ensure assets is always a Map (not undefined or null)
    let assets: Map<Cardano.AssetId, bigint>;

    if (utxo[1].value.assets instanceof Map) {
      assets = utxo[1].value.assets;
    } else if (utxo[1].value.assets && typeof utxo[1].value.assets === 'object') {
      // Handle case where assets might be an object instead of Map
      assets = new Map();
      Object.entries(utxo[1].value.assets).forEach(([assetId, quantity]) => {
        assets.set(assetId as Cardano.AssetId, BigInt(quantity as any));
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

  // Handle deposit/return as an implicit coin for input selection
  const implicitValue: ImplicitValue = {
    coin: implicitCoin !== BigInt(0) ? {
      // For deposits (positive): we need to pay a deposit (reduces available funds)
      // For deposit returns (negative): we get a deposit back (increases available funds)
      deposit: implicitCoin
    } : undefined
  };


  // Perform input selection with implicit value for deposits
  const selectionResult = await selector.select({
    preSelectedUtxo: new Set(),
    utxo: utxoSet,
    outputs: outputsSet,
    constraints,
    implicitValue
  });


  // Build the final transaction body - include both requested outputs and change outputs
  // Ensure change outputs also have proper asset structure
  const normalizedChange = selectionResult.selection.change.map(output => ({
    ...output,
    value: {
      ...output.value,
      assets: output.value.assets || new Map()
    }
  }));
  const finalOutputs = [...normalizedOutputs, ...normalizedChange];


  const txBody: Cardano.TxBody = {
    inputs: Array.from(selectionResult.selection.inputs).map(utxo => utxo[0]),
    outputs: finalOutputs,
    fee: selectionResult.selection.fee,
    validityInterval: {
      invalidHereafter: Cardano.Slot(Number(tip.slot) + 3600) // 1 hour from now
    }
  };

  // Add certificates if provided
  if (certificates.length > 0) {
    txBody.certificates = certificates;
  }

  // Add withdrawals if provided
  if (withdrawals.length > 0) {
    txBody.withdrawals = withdrawals;
  }

  // Compute auxiliaryDataHash if metadata is provided
  if (auxiliaryData) {
    txBody.auxiliaryDataHash = Cardano.computeAuxiliaryDataHash(auxiliaryData);
  }

  // Create a final transaction
  return {
    id: Cardano.TransactionId('0'.repeat(64)), // Temporary ID
    body: txBody,
    witness: {
      signatures: new Map()
    },
    auxiliaryData
  };
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
export function extractCip149Compensation(auxiliaryData?: Cardano.AuxiliaryData): number | null {
  if (!auxiliaryData?.blob) return null;

  const cip149Data = auxiliaryData.blob.get(CIP149_METADATA_LABEL);
  if (!cip149Data || !(cip149Data instanceof Map)) return null;

  const bps = cip149Data.get('donationBasisPoints');
  if (bps === undefined || bps === null) return null;

  return Number(bps);
}
