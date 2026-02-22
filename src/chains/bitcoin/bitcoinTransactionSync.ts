/**
 * Bitcoin Transaction Sync Service
 *
 * Handles fetching, parsing, and caching Bitcoin transaction history.
 * Integrates with the wallet sync service for real-time updates.
 */

import { BitcoinApi } from '@/api/bitcoin-api';
import type { BitcoinTransaction } from '@/api/bitcoin-api';
import {
  parseBitcoinTransactionHistory,
  type UnifiedTransaction,
} from './bitcoinTransactionParser';
import { deriveBitcoinAddress } from './bitcoinKeyManager';

/**
 * Bitcoin transaction sync configuration
 */
export interface BitcoinSyncConfig {
  maxAddressGap: number;         // Maximum gap for address scanning (BIP44 gap limit)
  batchSize: number;             // Number of addresses to check per batch
  maxTransactions: number;       // Maximum transactions to store in memory
}

/**
 * Default sync configuration
 */
const DEFAULT_SYNC_CONFIG: BitcoinSyncConfig = {
  maxAddressGap: 20,             // BIP44 gap limit
  batchSize: 10,                 // Check 10 addresses at a time
  maxTransactions: 1000,         // Store up to 1000 transactions
};

/**
 * Bitcoin Transaction Sync Manager
 *
 * Manages transaction history fetching and address discovery for Bitcoin wallets.
 */
export class BitcoinTransactionSync {
  private api: BitcoinApi;
  private network: string;
  private addressType: string;
  private xpub: string;
  private config: BitcoinSyncConfig;

  // Address tracking
  private discoveredAddresses: Map<number, string> = new Map(); // index -> address
  private usedAddresses: Set<string> = new Set();              // addresses with transactions
  private highestUsedIndex: number = -1;                       // highest index with txs

  // Transaction cache
  private transactionCache: Map<string, BitcoinTransaction> = new Map(); // txid -> tx

  constructor(
    api: BitcoinApi,
    network: string,
    addressType: string,
    xpub: string,
    config: Partial<BitcoinSyncConfig> = {}
  ) {
    this.api = api;
    this.network = network;
    this.addressType = addressType;
    this.xpub = xpub;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  /**
   * Perform full transaction history sync
   * Discovers all used addresses and fetches their transactions
   *
   * @param currentBlockHeight Current blockchain tip height
   * @returns Promise<UnifiedTransaction[]> Array of unified transactions
   */
  async syncTransactionHistory(currentBlockHeight?: number): Promise<UnifiedTransaction[]> {
    console.log('🔄 Starting Bitcoin transaction sync...');

    // Step 1: Discover all used addresses (BIP44 gap limit)
    await this.discoverUsedAddresses();

    // Step 2: Fetch transactions for all discovered addresses
    const allTransactions = await this.fetchAllTransactions();

    // Step 3: Parse transactions into unified format
    const walletAddresses = Array.from(this.usedAddresses);
    const unifiedTransactions = parseBitcoinTransactionHistory(
      allTransactions,
      walletAddresses,
      currentBlockHeight
    );

    console.log(`✅ Bitcoin transaction sync complete: ${unifiedTransactions.length} transactions found`);

    return unifiedTransactions;
  }

  /**
   * Discover all used addresses following BIP44 gap limit
   * Scans addresses until maxAddressGap consecutive unused addresses are found
   */
  private async discoverUsedAddresses(): Promise<void> {
    console.log('🔍 Discovering used Bitcoin addresses...');

    let currentIndex = 0;
    let consecutiveUnused = 0;

    while (consecutiveUnused < this.config.maxAddressGap) {
      // Derive address for current index
      const address = deriveBitcoinAddress(
        this.xpub,
        this.network,
        this.addressType,
        0, // External chain (receive addresses)
        currentIndex
      );

      this.discoveredAddresses.set(currentIndex, address);

      // Check if address has been used (has transactions)
      const hasTransactions = await this.checkAddressUsage(address);

      if (hasTransactions) {
        this.usedAddresses.add(address);
        this.highestUsedIndex = currentIndex;
        consecutiveUnused = 0; // Reset gap counter
        console.log(`📍 Found used address at index ${currentIndex}: ${address}`);
      } else {
        consecutiveUnused++;
      }

      currentIndex++;
    }

    console.log(`✅ Address discovery complete: ${this.usedAddresses.size} used addresses found (highest index: ${this.highestUsedIndex})`);
  }

  /**
   * Check if an address has been used (has transaction history)
   *
   * @param address Bitcoin address
   * @returns Promise<boolean> True if address has transactions
   */
  private async checkAddressUsage(address: string): Promise<boolean> {
    try {
      const transactions = await this.api.getTransactions(address);
      return transactions.length > 0;
    } catch (error) {
      console.error(`Failed to check address usage for ${address}:`, error);
      return false;
    }
  }

  /**
   * Fetch all transactions for all discovered addresses
   *
   * @returns Promise<BitcoinTransaction[]> Array of all transactions
   */
  private async fetchAllTransactions(): Promise<BitcoinTransaction[]> {
    console.log('📥 Fetching transactions for all addresses...');

    const allTransactions: BitcoinTransaction[] = [];
    const txidsSeen = new Set<string>(); // Deduplicate transactions

    for (const address of this.usedAddresses) {
      try {
        const transactions = await this.api.getTransactions(address);

        for (const tx of transactions) {
          // Deduplicate (same tx may appear in multiple addresses)
          if (!txidsSeen.has(tx.txid)) {
            txidsSeen.add(tx.txid);
            allTransactions.push(tx);
            this.transactionCache.set(tx.txid, tx);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch transactions for ${address}:`, error);
      }
    }

    console.log(`✅ Fetched ${allTransactions.length} unique transactions`);

    return allTransactions;
  }

  /**
   * Get next unused receive address
   *
   * @returns string Next unused address for receiving payments
   */
  getNextUnusedAddress(): string {
    const nextIndex = this.highestUsedIndex + 1;

    // Check if we already derived this address
    if (this.discoveredAddresses.has(nextIndex)) {
      return this.discoveredAddresses.get(nextIndex)!;
    }

    // Derive new address
    const address = deriveBitcoinAddress(
      this.xpub,
      this.network,
      this.addressType,
      0, // External chain
      nextIndex
    );

    this.discoveredAddresses.set(nextIndex, address);

    return address;
  }

  /**
   * Get address at specific index
   *
   * @param index Address index
   * @returns string Address at index
   */
  getAddressAtIndex(index: number): string {
    if (this.discoveredAddresses.has(index)) {
      return this.discoveredAddresses.get(index)!;
    }

    const address = deriveBitcoinAddress(
      this.xpub,
      this.network,
      this.addressType,
      0, // External chain
      index
    );

    this.discoveredAddresses.set(index, address);

    return address;
  }

  /**
   * Get all wallet addresses (for transaction parsing)
   *
   * @returns string[] Array of all wallet addresses
   */
  getAllAddresses(): string[] {
    return Array.from(this.discoveredAddresses.values());
  }

  /**
   * Get highest used address index
   *
   * @returns number Highest index with transaction history
   */
  getHighestUsedIndex(): number {
    return this.highestUsedIndex;
  }

  /**
   * Check if transaction exists in cache
   *
   * @param txid Transaction ID
   * @returns boolean True if transaction is cached
   */
  hasTransaction(txid: string): boolean {
    return this.transactionCache.has(txid);
  }

  /**
   * Get transaction from cache
   *
   * @param txid Transaction ID
   * @returns BitcoinTransaction | undefined Cached transaction
   */
  getTransaction(txid: string): BitcoinTransaction | undefined {
    return this.transactionCache.get(txid);
  }

  /**
   * Clear transaction cache
   */
  clearCache(): void {
    this.transactionCache.clear();
    this.discoveredAddresses.clear();
    this.usedAddresses.clear();
    this.highestUsedIndex = -1;
  }
}

/**
 * Create Bitcoin transaction sync manager
 *
 * @param wallet Wallet object with Bitcoin credentials
 * @param provider API provider name
 * @param config Optional sync configuration
 * @returns BitcoinTransactionSync Sync manager instance
 */
export function createBitcoinTransactionSync(
  wallet: any,
  provider: any,
  config?: Partial<BitcoinSyncConfig>
): BitcoinTransactionSync {
  const api = new BitcoinApi(wallet, provider);

  return new BitcoinTransactionSync(
    api,
    wallet.network,
    wallet.addressType || 'segwit',
    wallet.publicKey, // xpub
    config
  );
}

/**
 * Sync Bitcoin transactions and update wallet store
 *
 * @param wallet Wallet object
 * @param provider API provider
 * @param currentBlockHeight Current blockchain tip height
 * @returns Promise<UnifiedTransaction[]> Array of unified transactions
 */
export async function syncBitcoinTransactions(
  wallet: any,
  provider: any,
  currentBlockHeight?: number
): Promise<UnifiedTransaction[]> {
  const sync = createBitcoinTransactionSync(wallet, provider);
  return await sync.syncTransactionHistory(currentBlockHeight);
}
