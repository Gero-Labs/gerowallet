import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { getErrorMessage } from '@/shared/utils/errorHandler';

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
    console.log('Serializing Cardano JS SDK transaction:', tx);
    console.log('Transaction body:', JSON.stringify(tx.body, (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      return value;
    }, 2));
    
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
    
    // Log certificates if they exist
    if (tx.body.certificates && tx.body.certificates.length > 0) {
      console.log('Transaction certificates:', tx.body.certificates);
    }
    
    // Use Cardano JS SDK's built-in serialization
    const serializedTx = Serialization.Transaction.fromCore(tx);
    const cborHex = serializedTx.toCbor();
    console.log('Successfully serialized transaction to CBOR:', cborHex);
    return cborHex;
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
    console.log('Deserializing CBOR hex string:', cborHex);
    
    // Use Cardano JS SDK's built-in deserialization
    const serializedTx = Serialization.Transaction.fromCbor(HexBlob(cborHex));
    return serializedTx.toCore();
  } catch (error) {
    console.error('Error deserializing CBOR to Cardano JS SDK transaction:', error);
    throw new Error(`Failed to deserialize transaction: ${getErrorMessage(error)}`);
  }
}

/**
 * Converts a Cardano JS SDK transaction body to CBOR for use in transaction hashing
 * @param txBody - The transaction body
 * @returns CBOR hex string of the transaction body
 */
export function serializeTxBody(txBody: Cardano.TxBody): string {
  try {
    console.log('Serializing transaction body:', txBody);
    
    // Use Cardano JS SDK's built-in serialization
    const serializedTxBody = Serialization.TransactionBody.fromCore(txBody);
    return serializedTxBody.toCbor();
  } catch (error) {
    console.error('Error serializing transaction body to CBOR:', error);
    throw new Error(`Failed to serialize transaction body: ${getErrorMessage(error)}`);
  }
}

/**
 * Computes the transaction hash from a Cardano JS SDK transaction body
 * @param txBody - The transaction body
 * @returns Transaction hash as hex string
 */
export function computeTxHash(txBody: Cardano.TxBody): Cardano.TransactionId {
  try {
    console.log('Computing transaction hash for body:', txBody);
    
    // Use Cardano JS SDK's built-in transaction body serialization and hashing
    const serializedTxBody = Serialization.TransactionBody.fromCore(txBody);
    const bodyHash = serializedTxBody.hash();
    return Cardano.TransactionId(bodyHash);
  } catch (error) {
    console.error('Error computing transaction hash:', error);
    throw new Error(`Failed to compute transaction hash: ${getErrorMessage(error)}`);
  }
}

/**
 * Creates a properly formatted transaction for signing from a transaction body
 * @param txBody - The transaction body
 * @param witness - Optional existing witness set
 * @returns Complete Cardano JS SDK transaction ready for signing
 */
export function createSignableTransaction(
  txBody: Cardano.TxBody,
  witness?: Cardano.Witness
): Cardano.Tx {
  const txId = computeTxHash(txBody);
  
  return {
    id: txId,
    body: txBody,
    witness: witness || {
      signatures: new Map()
    } as Cardano.Witness,
    auxiliaryData: undefined,
    isValid: true
  };
}

/**
 * Extracts stake credentials from Cardano JS SDK certificates for signing analysis
 * @param certificates - Array of certificates from transaction body
 * @returns Array of stake credential hashes that need to sign
 */
export function extractStakeCredentialsFromCertificates(
  certificates: Cardano.Certificate[]
): string[] {
  const stakeCredentials: string[] = [];
  
  for (const cert of certificates) {
    if (cert.__typename === Cardano.CertificateType.StakeRegistration ||
        cert.__typename === Cardano.CertificateType.StakeDeregistration ||
        cert.__typename === Cardano.CertificateType.StakeDelegation ||
        cert.__typename === Cardano.CertificateType.VoteDelegation ||
        cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation ||
        cert.__typename === Cardano.CertificateType.StakeVoteRegistrationDelegation) {
      stakeCredentials.push(cert.stakeCredential.hash);
    }
    // Add more certificate types as needed
  }
  
  return stakeCredentials;
}

/**
 * Converts a Cardano JS SDK transaction witness to CBOR hex for compatibility
 * @param witness - The transaction witness
 * @returns CBOR hex string
 */
export function serializeWitness(witness: Cardano.Witness): string {
  try {
    console.log('Serializing witness:', witness);
    console.log('Witness signatures map size:', witness.signatures?.size);
    
    // Debug: Log each signature entry
    if (witness.signatures) {
      console.log('Witness signatures entries:');
      witness.signatures.forEach((sig, key) => {
        console.log(`- Key: ${key}, Sig: ${sig.substring(0, 20)}...`);
      });
    }
    
    // Use Cardano JS SDK's built-in serialization
    const serializedWitness = Serialization.TransactionWitnessSet.fromCore(witness);
    return serializedWitness.toCbor();
  } catch (error) {
    console.error('Error serializing witness to CBOR:', error);
    console.error('Witness structure:', JSON.stringify(witness, (key, value) => {
      if (value instanceof Map) {
        return {
          dataType: 'Map',
          entries: Array.from(value.entries())
        };
      }
      return value;
    }, 2));
    throw new Error(`Failed to serialize witness: ${getErrorMessage(error)}`);
  }
}

/**
 * Deserializes CBOR hex to a Cardano JS SDK transaction witness
 * @param witnessHex - The CBOR hex string
 * @returns Cardano JS SDK witness
 */
export function deserializeWitness(witnessHex: string): Cardano.Witness {
  try {
    console.log('Deserializing witness hex string:', witnessHex);
    
    // Use Cardano JS SDK's built-in deserialization
    const serializedWitness = Serialization.TransactionWitnessSet.fromCbor(HexBlob(witnessHex));
    return serializedWitness.toCore();
  } catch (error) {
    console.error('Error deserializing CBOR to witness:', error);
    throw new Error(`Failed to deserialize witness: ${getErrorMessage(error)}`);
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
   * @param output - The transaction output
   * @param coinsPerUtxoByte - Cost per UTXO byte from protocol parameters
   * @returns Minimum ADA required as BigInt
   */
  static minAdaRequired(output: Cardano.TxOut, coinsPerUtxoByte: bigint): bigint {
    try {
      // Calculate minimum ADA required for a UTXO based on its size
      // This is a simplified version based on typical UTXO sizes
      const baseUtxoSize = 160; // Base UTXO size in bytes (address + value)
      const addressSize = output.address.length / 2; // Address is hex, so divide by 2 for bytes
      const assetSize = output.value.assets?.size ? (output.value.assets.size * 50) : 0; // ~50 bytes per asset
      
      // Additional overhead for CBOR encoding
      const encodingOverhead = 20;
      
      const totalSize = BigInt(baseUtxoSize + addressSize + assetSize + encodingOverhead);
      const minAda = totalSize * coinsPerUtxoByte;
      
      console.debug('MinAda calculation:', {
        address: output.address,
        addressSize,
        assetSize,
        totalSize: totalSize.toString(),
        coinsPerUtxoByte: coinsPerUtxoByte.toString(),
        minAda: minAda.toString()
      });
      
      // Ensure minimum is at least 1 ADA
      const minimumAda = BigInt(1000000); // 1 ADA in lovelace
      return minAda > minimumAda ? minAda : minimumAda;
    } catch (error) {
      console.error('Error calculating minimum ADA required:', error);
      // Fallback to 1 ADA minimum
      return BigInt(1000000);
    }
  }
}