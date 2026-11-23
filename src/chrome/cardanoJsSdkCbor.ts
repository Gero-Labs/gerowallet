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
  /** Use the same witness set to price and size the transaction during coin selection. */
  static withEstimatedWitnesses(tx: Cardano.Tx, inputs: Cardano.Utxo[], wallet?: { keys: Keys | null }): Cardano.Tx {
    if (tx.witness.signatures?.size) return tx;
    const hasStakeOperation = !!(tx.body.certificates?.length || tx.body.withdrawals?.length);
    let count = Math.max(hasStakeOperation ? 2 : 1, 1 + (tx.body.requiredExtraSignatures?.length ?? 0));
    if (wallet?.keys) {
      try {
        count = analyzeTransactionForSignatures(tx, inputs, wallet.keys).length;
      } catch (error) {
        console.warn('Could not resolve transaction signers for estimation', error);
      }
    }
    const signatures = new Map<Ed25519PublicKeyHex, Ed25519SignatureHex>();
    for (let i = 0; i < count; i++) {
      signatures.set(i.toString(16).padStart(64, '0') as Ed25519PublicKeyHex, '0'.repeat(128) as Ed25519SignatureHex);
    }
    return { ...tx, witness: { ...tx.witness, signatures } };
  }

  /**
   * Calculate minimum transaction fee using linear fee formula
   * @param tx - The Cardano JS SDK transaction
   * @param resolvedInputs - Array of input UTXOs
   * @param protocolParams - Protocol parameters with fee coefficients
   * @param walletContext - Optional wallet context for accurate signature estimation (its key set)
   * @returns Minimum fee in lovelace as BigInt
   */
  static minFee(
    tx: Cardano.Tx,
    resolvedInputs: Cardano.Utxo[],
    protocolParams: Parameters<typeof minFeeSDK>[2],
    walletContext?: {
      keys: Keys | null;
    }
  ): bigint {
    try {
      const signed = BrowserTxConstruction.withEstimatedWitnesses(tx, resolvedInputs, walletContext);
      const fee = minFeeSDK(signed, resolvedInputs, protocolParams);
      // Allow for encoding variations before the real witnesses are available.
      return signed === tx ? fee : fee + 80n * BigInt(protocolParams.minFeeCoefficient);
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
