import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { minAdaRequired as minAdaRequiredSDK, minFee as minFeeSDK } from '@cardano-sdk/tx-construction';

/**
 * CBOR Serialization utilities for Cardano JS SDK transactions
 *
 * This utility provides functions to convert between Cardano JS SDK transaction objects
 * and CBOR hex strings for compatibility with the existing signing infrastructure.
 */

/**
 * Serializes a Cardano JS SDK transaction to CBOR hex string
 * @param tx - The Cardano JS SDK transaction
 * @returns CBOR hex string
 */
export function serializeCardanoJsSdkTx(tx: Cardano.Tx): string {
  try {
    // Validate transaction structure before serialization
    if (!tx.body) {
      throw new Error('Transaction body is missing');
    }

    if (!tx.body.inputs || tx.body.inputs.length === 0) {
      throw new Error('Transaction inputs are missing or empty');
    }

    if (!tx.body.outputs || tx.body.outputs.length === 0) {
      throw new Error('Transaction outputs are missing or empty');
    }

    // Use Cardano JS SDK's built-in serialization
    const serializedTx = Serialization.Transaction.fromCore(tx);
    return serializedTx.toCbor();
  } catch (error) {
    console.error('Error serializing Cardano JS SDK transaction to CBOR:', error);
    console.error('Transaction structure that failed:', JSON.stringify(tx, (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      return value;
    }, 2));
    throw new Error(`Failed to serialize transaction: ${getErrorMessage(error)}`);
  }
}

/**
 * Deserializes a CBOR hex string to a Cardano JS SDK transaction
 * @param cborHex - The CBOR hex string
 * @returns Cardano JS SDK transaction
 */
export function deserializeCardanoJsSdkTx(cborHex: string): Cardano.Tx {
  try {
    // Use Cardano JS SDK's built-in deserialization
    const serializedTx = Serialization.Transaction.fromCbor(HexBlob(cborHex));
    return serializedTx.toCore();
  } catch (error) {
    console.error('Error deserializing CBOR to Cardano JS SDK transaction:', error);
    throw new Error(`Failed to deserialize transaction: ${getErrorMessage(error)}`);
  }
}

/**
 * Browser-compatible transaction construction utilities
 * Alternative to @cardano-sdk/tx-construction that works in browser environments
 */
export class BrowserTxConstruction {
  /**
   * Calculate minimum transaction fee using linear fee formula
   * @param tx - The Cardano JS SDK transaction
   * @param resolvedInputs - Array of input UTXOs
   * @param protocolParams - Protocol parameters with fee coefficients
   * @returns Minimum fee in lovelace as BigInt
   */
  static minFee(tx: Cardano.Tx, resolvedInputs: Cardano.Utxo[], protocolParams: any): bigint {
    console.log('🔧 BrowserTxConstruction.minFee called!', {
      hasWitness: !!tx.witness,
      signaturesSize: tx.witness?.signatures?.size
    });
    try {
      // Use the official Cardano SDK minFee function (same as Lace wallet)
      // This properly serializes the transaction and calculates the actual fee
      let calculatedFee = minFeeSDK(tx, resolvedInputs, protocolParams);
      console.log('🔧 SDK minFee returned:', calculatedFee.toString());

      // IMPORTANT: The SDK's minFee serializes the transaction with actual witnesses
      // If the transaction has empty witnesses, we need to add the estimated witness size
      // Each VKeyWitness is approximately 100-110 bytes (32 byte vkey + 64 byte signature + CBOR overhead)
      const hasEmptyWitnesses = !tx.witness.signatures || tx.witness.signatures.size === 0;

      if (hasEmptyWitnesses) {
        console.log('🔧 Transaction structure:', {
          hasCertificates: tx.body.certificates !== undefined,
          certificatesLength: tx.body.certificates?.length,
          hasWithdrawals: tx.body.withdrawals !== undefined,
          withdrawalsLength: tx.body.withdrawals?.length
        });

        // Estimate number of required signatures
        // For staking operations: payment key + stake key = 2 signatures
        // For regular sends: payment key = 1 signature
        const hasCertificates = tx.body.certificates && tx.body.certificates.length > 0;
        const hasWithdrawals = tx.body.withdrawals && tx.body.withdrawals.length > 0;
        const requiresStakeKey = hasCertificates || hasWithdrawals;

        console.log('🔧 Signature estimation:', {
          hasCertificates,
          hasWithdrawals,
          requiresStakeKey,
          estimatedSignatures: requiresStakeKey ? 2 : 1
        });

        const estimatedSignatures = requiresStakeKey ? 2 : 1;
        const witnessSize = estimatedSignatures * 110; // 110 bytes per witness

        // Add witness overhead to fee: witnessSize * minFeeCoefficient
        const witnessFeeOverhead = BigInt(witnessSize) * BigInt(protocolParams.minFeeCoefficient);
        calculatedFee += witnessFeeOverhead;

        console.log('🔧 Fee calculation (SDK + witness overhead):', {
          baseFee: (calculatedFee - witnessFeeOverhead).toString(),
          witnessSize,
          witnessOverhead: witnessFeeOverhead.toString(),
          totalFee: calculatedFee.toString(),
          totalFeeAda: (Number(calculatedFee) / 1000000).toFixed(6),
          minFeeCoefficient: protocolParams.minFeeCoefficient
        });
      } else {
        console.log('🔧 Fee calculation (SDK with actual witnesses):', {
          fee: calculatedFee.toString(),
          feeAda: (Number(calculatedFee) / 1000000).toFixed(6),
          witnessCount: tx.witness.signatures.size
        });
      }

      return calculatedFee;
    } catch (error) {
      console.error('Error calculating minimum fee with SDK:', error);
      // Fallback to a reasonable default fee for complex transactions
      return BigInt(300000); // 0.3 ADA
    }
  }

  /**
   * Calculate minimum ADA required for a UTXO based on protocol parameters
   * Uses the official Cardano SDK implementation from @cardano-sdk/tx-construction
   * @param output - The transaction output
   * @param coinsPerUtxoByte - Cost per UTXO byte from protocol parameters
   * @returns Minimum ADA required as BigInt
   */
  static minAdaRequired(output: Cardano.TxOut, coinsPerUtxoByte: bigint): bigint {
    try {
      // Use the official Cardano SDK function which correctly implements
      // the protocol's minUTxOValue calculation (same as Lace wallet uses)
      const minAda = minAdaRequiredSDK(output, coinsPerUtxoByte);

      console.debug('MinAda calculation (SDK):', {
        coinsPerUtxoByte: coinsPerUtxoByte.toString(),
        minAda: minAda.toString(),
        minAdaInAda: (Number(minAda) / 1000000).toFixed(6)
      });

      return minAda;
    } catch (error) {
      console.error('Error calculating minAda:', error);
      // Fallback to a reasonable minimum based on typical UTXOs
      // Typical min is around 1 ADA for outputs with assets
      return BigInt(1000000);
    }
  }
}
