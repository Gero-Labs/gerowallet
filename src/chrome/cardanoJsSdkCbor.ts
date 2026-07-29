import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { minAdaRequired as minAdaRequiredSDK, minFee as minFeeSDK } from '@cardano-sdk/tx-construction';
import { Ed25519SignatureHex, Ed25519PublicKeyHex } from '@cardano-sdk/crypto';
import { debugLog } from '@/utils/debug';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';
import type { Keys } from '@/models/types';

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
   * @param walletContext - Optional wallet context for accurate signature estimation (keys, stakeAddress, accountIndex, paymentKeyExternal, stakeKey)
   * @returns Minimum fee in lovelace as BigInt
   */
  static minFee(
    tx: Cardano.Tx,
    resolvedInputs: Cardano.Utxo[],
    protocolParams: any,
    walletContext?: {
      keys: Keys;
      stakeAddress: string;
      accountIndex: number;
    }
  ): bigint {
    try {
      // Check if we need to add dummy witnesses for accurate fee calculation
      const hasEmptyWitnesses = !tx.witness.signatures || tx.witness.signatures.size === 0;

      if (hasEmptyWitnesses) {
        let estimatedSignatures: number;

        // Use accurate signature analysis if wallet context is available
        if (walletContext) {
          try {
            const requiredSigners = analyzeTransactionForSignatures(
              tx,
              resolvedInputs,
              walletContext.keys,
              walletContext.accountIndex,
              walletContext.stakeAddress,
            );

            estimatedSignatures = requiredSigners.length;
          } catch (error) {
            console.warn('🔧 Error analyzing signatures, falling back to heuristic:', error);
            // Fallback to conservative heuristic
            const hasCertificates = tx.body.certificates && tx.body.certificates.length > 0;
            const hasWithdrawals = tx.body.withdrawals && tx.body.withdrawals.length > 0;
            estimatedSignatures = (hasCertificates || hasWithdrawals) ? 2 : 1;
          }
        } else {
          // Fallback to conservative heuristic when wallet context is not available
          const hasCertificates = tx.body.certificates && tx.body.certificates.length > 0;
          const hasWithdrawals = tx.body.withdrawals && tx.body.withdrawals.length > 0;
          const requiresStakeKey = hasCertificates || hasWithdrawals;
          estimatedSignatures = requiresStakeKey ? 2 : 1;
        }

        // CRITICAL FIX: Create dummy witnesses with realistic structure
        // This ensures the CBOR serialization includes the actual witness Map structure
        // which has different encoding overhead than an empty Map
        const dummySignatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>();

        // Add dummy signatures (32 byte vkey + 64 byte signature in hex)
        // IMPORTANT: Each signature must have a UNIQUE key to ensure proper CBOR Map encoding
        // Using the same key for all signatures can cause CBOR to optimize the encoding
        for (let i = 0; i < estimatedSignatures; i++) {
          // Create unique dummy keys by varying the first byte
          const keyPrefix = i.toString(16).padStart(2, '0');
          const dummyVKey = (keyPrefix + '0'.repeat(62)) as Ed25519PublicKeyHex; // 32 bytes = 64 hex chars
          const dummySignature = '0'.repeat(128) as Ed25519SignatureHex; // 64 bytes = 128 hex chars
          dummySignatures.set(dummyVKey, dummySignature);
        }

        // Create a transaction copy with dummy witnesses for accurate CBOR serialization
        const txWithDummyWitnesses: Cardano.Tx = {
          ...tx,
          witness: {
            ...tx.witness,
            signatures: dummySignatures
          }
        };

        // Now call SDK's minFee with the transaction that has proper witness structure
        const baseFee = minFeeSDK(txWithDummyWitnesses, resolvedInputs, protocolParams);

        // Add a small safety margin to account for CBOR encoding variations
        // Typically 60-80 bytes (~2,640-3,520 lovelace with minFeeCoefficient=44)
        // This ensures we never underestimate the fee
        const safetyMarginBytes = BigInt(80);
        const safetyMarginFee = safetyMarginBytes * BigInt(protocolParams.minFeeCoefficient);
        const calculatedFee = baseFee + safetyMarginFee;

        return calculatedFee;
      } else {
        // Transaction already has witnesses, use it directly
        const calculatedFee = minFeeSDK(tx, resolvedInputs, protocolParams);

        return calculatedFee;
      }
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
      // the protocol's minUTxOValue calculation (per the CIP-30 standard)
      const minAda = minAdaRequiredSDK(output, coinsPerUtxoByte);

      debugLog('MinAda calculation (SDK):', {
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
