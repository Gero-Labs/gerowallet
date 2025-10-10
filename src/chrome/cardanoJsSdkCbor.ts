import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { minAdaRequired as minAdaRequiredSDK } from '@cardano-sdk/tx-construction';

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
    try {
      // Linear fee calculation: fee = a * size + b
      const minFeeA = BigInt(protocolParams.minFeeCoefficient);
      const minFeeB = BigInt(protocolParams.minFeeConstant);

      // Estimate transaction size based on inputs, outputs, and certificates
      // These are conservative estimates based on CBOR encoding sizes
      const inputsSize = tx.body.inputs.length * 180; // ~180 bytes per input
      const outputsSize = tx.body.outputs.length * 50;  // ~50 bytes per output
      const certificatesSize = (tx.body.certificates?.length || 0) * 50; // ~50 bytes per certificate
      const baseSize = 300; // Base transaction overhead (includes headers, etc.)

      const estimatedSize = BigInt(baseSize + inputsSize + outputsSize + certificatesSize);

      const calculatedFee = minFeeB + (minFeeA * estimatedSize);

      console.debug('Fee calculation:', {
        minFeeA: minFeeA.toString(),
        minFeeB: minFeeB.toString(),
        estimatedSize: estimatedSize.toString(),
        calculatedFee: calculatedFee.toString()
      });

      return calculatedFee;
    } catch (error) {
      console.error('Error calculating minimum fee:', error);
      // Fallback to a reasonable default fee for delegation transactions
      return BigInt(200000); // 0.2 ADA
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
