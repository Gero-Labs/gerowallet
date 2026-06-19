/**
 * Bitcoin Transaction Parser
 *
 * Parses Bitcoin transactions into a unified format compatible with the wallet UI.
 * Handles transaction history, balance calculations, and transaction type detection.
 */

import type { BitcoinTransaction } from '@/api/bitcoin-api';

/**
 * Unified transaction format for UI display
 * Compatible with both Cardano and Bitcoin transactions
 */
export interface UnifiedTransaction {
  id: string;                    // Transaction ID (txid for Bitcoin, hash for Cardano)
  tx_timestamp: number;          // Unix timestamp in seconds
  ada: number;                   // Amount in base units (satoshis for Bitcoin, lovelace for Cardano)
  assets: TransactionAsset[];    // Additional assets transferred
  pending: boolean;              // Whether transaction is unconfirmed
  block_height?: number;         // Block height (undefined for pending)
  block_hash?: string;           // Block hash
  fee?: number;                  // Transaction fee in base units
  inputs?: TransactionInput[];   // Transaction inputs
  outputs?: TransactionOutput[]; // Transaction outputs
  type?: TransactionType;        // Transaction type (send/receive)
  confirmations?: number;        // Number of confirmations

  // Bitcoin-specific fields
  size?: number;                 // Transaction size in bytes
  weight?: number;               // Transaction weight
  vsize?: number;                // Virtual size in vbytes

  // Cardano-specific fields (not used for Bitcoin)
  epoch_no?: number;             // Epoch number
}

/**
 * Transaction asset (token or native currency)
 */
export interface TransactionAsset {
  unit: string;                  // Asset unit/policy ID
  quantity: string;              // Amount as string
  fingerprint?: string;          // Asset fingerprint
  name?: string;                 // Asset name
  ticker?: string;               // Asset ticker
}

/**
 * Transaction input
 */
export interface TransactionInput {
  address: string;               // Input address
  value: number;                 // Input value in satoshis
  txid: string;                  // Previous transaction ID
  vout: number;                  // Output index
}

/**
 * Transaction output
 */
export interface TransactionOutput {
  address: string;               // Output address
  value: number;                 // Output value in satoshis
  scriptPubKey?: string;         // Script public key
}

/**
 * Transaction type
 */
export enum TransactionType {
  SEND = 'send',                 // Outgoing transaction
  RECEIVE = 'receive',           // Incoming transaction
  SELF = 'self',                 // Self-transfer (change address)
}

/**
 * Parse Bitcoin transaction into unified format
 *
 * @param tx Bitcoin transaction from API
 * @param walletAddresses Array of wallet addresses to determine tx type
 * @param currentBlockHeight Current blockchain tip height (for confirmations)
 * @returns Unified transaction for UI display
 */
export function parseBitcoinTransaction(
  tx: BitcoinTransaction,
  walletAddresses: string[],
  currentBlockHeight?: number
): UnifiedTransaction {
  // Determine transaction type and calculate net amount
  const { type, netAmount } = analyzeTransaction(tx, walletAddresses);

  // Calculate confirmations
  const confirmations = tx.status.confirmed && tx.status.block_height && currentBlockHeight
    ? currentBlockHeight - tx.status.block_height + 1
    : 0;

  // Parse inputs
  const inputs: TransactionInput[] = tx.vin.map(input => ({
    address: input.prevout?.scriptpubkey_address || '',
    value: input.prevout?.value || 0,
    txid: input.txid,
    vout: input.vout,
  }));

  // Parse outputs
  const outputs: TransactionOutput[] = tx.vout.map(output => ({
    address: output.scriptpubkey_address || '',
    value: output.value,
    scriptPubKey: output.scriptpubkey,
  }));

  // Calculate virtual size (weight / 4)
  const vsize = Math.ceil(tx.weight / 4);

  return {
    id: tx.txid,
    tx_timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
    ada: netAmount,  // Using 'ada' field for consistency with UI (represents satoshis for Bitcoin)
    assets: [],      // Bitcoin has no native assets/tokens
    pending: !tx.status.confirmed,
    block_height: tx.status.block_height,
    block_hash: tx.status.block_hash,
    fee: tx.fee,
    inputs,
    outputs,
    type,
    confirmations,
    size: tx.size,
    weight: tx.weight,
    vsize,
  };
}

/**
 * Analyze transaction to determine type and net amount from wallet perspective
 *
 * @param tx Bitcoin transaction
 * @param walletAddresses Array of wallet addresses
 * @returns Transaction type and net amount (positive for receive, negative for send)
 */
function analyzeTransaction(
  tx: BitcoinTransaction,
  walletAddresses: string[]
): { type: TransactionType; netAmount: number } {
  // Calculate total input from wallet addresses
  let inputFromWallet = 0;
  for (const input of tx.vin) {
    if (input.prevout?.scriptpubkey_address && walletAddresses.includes(input.prevout.scriptpubkey_address)) {
      inputFromWallet += input.prevout.value;
    }
  }

  // Calculate total output to wallet addresses
  let outputToWallet = 0;
  for (const output of tx.vout) {
    if (output.scriptpubkey_address && walletAddresses.includes(output.scriptpubkey_address)) {
      outputToWallet += output.value;
    }
  }

  // Determine transaction type and net amount
  if (inputFromWallet === 0 && outputToWallet > 0) {
    // Pure receive (no inputs from wallet)
    return {
      type: TransactionType.RECEIVE,
      netAmount: outputToWallet,
    };
  } else if (inputFromWallet > 0 && outputToWallet === 0) {
    // Pure send (no outputs to wallet, all spent)
    return {
      type: TransactionType.SEND,
      netAmount: -(inputFromWallet - outputToWallet) - tx.fee,
    };
  } else if (inputFromWallet > 0 && outputToWallet > 0) {
    // Mixed transaction (send with change)
    const netAmount = outputToWallet - inputFromWallet;

    if (netAmount === -tx.fee) {
      // Self-transfer (only fee was spent)
      return {
        type: TransactionType.SELF,
        netAmount: -tx.fee,
      };
    } else if (netAmount < 0) {
      // Send (net outflow)
      return {
        type: TransactionType.SEND,
        netAmount: netAmount,
      };
    } else {
      // Receive (net inflow)
      return {
        type: TransactionType.RECEIVE,
        netAmount: netAmount,
      };
    }
  } else {
    // No wallet involvement (shouldn't happen)
    return {
      type: TransactionType.SELF,
      netAmount: 0,
    };
  }
}

/**
 * Parse Bitcoin transaction history for a wallet
 *
 * @param transactions Array of Bitcoin transactions from API
 * @param walletAddresses Array of wallet addresses (all derived addresses)
 * @param currentBlockHeight Current blockchain tip height
 * @returns Array of unified transactions sorted by timestamp (newest first)
 */
export function parseBitcoinTransactionHistory(
  transactions: BitcoinTransaction[],
  walletAddresses: string[],
  currentBlockHeight?: number
): UnifiedTransaction[] {
  const parsed = transactions.map(tx =>
    parseBitcoinTransaction(tx, walletAddresses, currentBlockHeight)
  );

  // Sort by timestamp descending (newest first)
  return parsed.sort((a, b) => b.tx_timestamp - a.tx_timestamp);
}

/**
 * Calculate total balance from transaction history
 * (Alternative to using UTXO-based balance calculation)
 *
 * @param transactions Array of unified transactions
 * @returns Total balance in satoshis
 */
export function calculateBalanceFromHistory(transactions: UnifiedTransaction[]): number {
  return transactions.reduce((balance, tx) => balance + tx.ada, 0);
}

/**
 * Filter pending transactions
 *
 * @param transactions Array of unified transactions
 * @returns Array of pending transactions
 */
export function getPendingTransactions(transactions: UnifiedTransaction[]): UnifiedTransaction[] {
  return transactions.filter(tx => tx.pending);
}

/**
 * Filter confirmed transactions
 *
 * @param transactions Array of unified transactions
 * @returns Array of confirmed transactions
 */
export function getConfirmedTransactions(transactions: UnifiedTransaction[]): UnifiedTransaction[] {
  return transactions.filter(tx => !tx.pending);
}

/**
 * Get transaction by ID
 *
 * @param transactions Array of unified transactions
 * @param txid Transaction ID
 * @returns Transaction or undefined
 */
export function getTransactionById(transactions: UnifiedTransaction[], txid: string): UnifiedTransaction | undefined {
  return transactions.find(tx => tx.id === txid);
}

/**
 * Format satoshis to BTC string (8 decimal places)
 *
 * @param satoshis Amount in satoshis
 * @returns Formatted BTC string
 */
export function formatBtc(satoshis: number): string {
  return (satoshis / 100000000).toFixed(8);
}

/**
 * Format BTC to satoshis
 *
 * @param btc Amount in BTC
 * @returns Amount in satoshis
 */
export function btcToSatoshis(btc: number): number {
  return Math.round(btc * 100000000);
}

/**
 * Get transaction status text
 *
 * @param tx Unified transaction
 * @returns Status text for UI display
 */
export function getTransactionStatusText(tx: UnifiedTransaction): string {
  if (tx.pending) {
    return 'Pending';
  }

  if (tx.confirmations !== undefined) {
    if (tx.confirmations === 1) {
      return '1 confirmation';
    } else if (tx.confirmations >= 6) {
      return 'Confirmed';
    } else {
      return `${tx.confirmations} confirmations`;
    }
  }

  return 'Confirmed';
}

/**
 * Check if transaction is pending too long (>1 hour)
 *
 * @param tx Unified transaction
 * @returns True if pending for more than 1 hour
 */
export function isPendingTooLong(tx: UnifiedTransaction): boolean {
  if (!tx.pending) return false;

  const now = Math.floor(Date.now() / 1000);
  const age = now - tx.tx_timestamp;

  // Consider pending too long if >1 hour (3600 seconds)
  return age > 3600;
}
