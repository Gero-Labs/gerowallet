/**
 * Observable Wallet Service
 *
 * Wraps @cardano-sdk/wallet's ObservableWallet for Gero Wallet integration.
 * Provides reactive wallet state management with automatic blockchain sync.
 */

import { ObservableWallet, createPersonalWallet } from '@cardano-sdk/wallet';
import { InMemoryKeyAgent } from '@cardano-sdk/key-management';
import { Cardano } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { Subscription } from 'rxjs';
import { createCardanoProviders, WalletProvidersDependencies, cleanupProviders } from './cardanoProviders.service';
import { Blockchain, Network } from '@/models/types';
import walletStore from '@/stores/walletStore';
import networkStore from '@/stores/networkStore';

let bip32Ed25519: Promise<Crypto.SodiumBip32Ed25519> | undefined;

export const getBip32Ed25519 = async (): Promise<Crypto.SodiumBip32Ed25519> =>
  bip32Ed25519 || (bip32Ed25519 = Crypto.SodiumBip32Ed25519.create());

/**
 * Wallet metadata stored with ObservableWallet
 */
export interface GeroWalletMetadata {
  walletId: string;
  name: string;
  icon: string;
  theme: string;
  type: 'Normal' | 'Ledger' | 'Trezor' | 'Keystone' | 'Google';
  createdAt: number;
}

/**
 * Observable Wallet Manager
 * Manages wallet lifecycle, state subscriptions, and blockchain sync
 */
export class ObservableWalletService {
  private wallet: ObservableWallet | null = null;
  private keyAgent: InMemoryKeyAgent | null = null;
  private providers: WalletProvidersDependencies | null = null;
  private subscriptions: Subscription[] = [];
  private metadata: GeroWalletMetadata | null = null;

  /**
   * Initialize wallet from mnemonic
   */
  async initializeFromMnemonic(
    mnemonic: string[],
    password: string,
    chain: Blockchain,
    network: Network,
    metadata: GeroWalletMetadata
  ): Promise<ObservableWallet> {
    console.log('⏱️ PERF: ObservableWalletService.initializeFromMnemonic START');
    const startTime = performance.now();

    try {
      this.metadata = metadata;

      // Get network ID
      const networkId = this.getNetworkId(network);
      const chainId = this.getChainId(chain, network);

      // Create key agent
      console.log('⏱️ PERF: Creating key agent...');
      const keyAgentStart = performance.now();
      this.keyAgent = await InMemoryKeyAgent.fromBip39MnemonicWords(
        {
          mnemonicWords: mnemonic,
          chainId,
          getPassphrase: async () => Buffer.from(password),
          accountIndex: 0
        },
        {
          logger: console,
          bip32Ed25519: await getBip32Ed25519()
        }
      );
      console.log(`⏱️ PERF: Key agent created in ${performance.now() - keyAgentStart}ms`);

      // Create providers
      console.log('⏱️ PERF: Creating providers...');
      const providersStart = performance.now();
      this.providers = await createCardanoProviders({
        chain,
        network,
        blockfrostApiKey: process.env.BLOCKFROST_API_KEY || '',
        logger: console,
        experiments: {
          useWebSocket: false, // Start with HTTP, can enable WebSocket later
          useBlockfrostCredentialQueries: true
        }
      });
      console.log(`⏱️ PERF: Providers created in ${performance.now() - providersStart}ms`);

      // Create observable wallet
      console.log('⏱️ PERF: Creating ObservableWallet...');
      const walletStart = performance.now();
      this.wallet = await createPersonalWallet(
        {
          name: metadata.name,
          networkId,
          accountIndex: 0,
          keyAgent: this.keyAgent,
          ...this.providers
        },
        {
          logger: console,
          stores: {
            // Enable persistent storage for wallet state
            addresses: true,
            transactions: true,
            utxo: true,
            stake: true
          }
        }
      );
      console.log(`⏱️ PERF: ObservableWallet created in ${performance.now() - walletStart}ms`);

      // Subscribe to wallet observables
      this.subscribeToWalletState();

      console.log(`⏱️ PERF: ObservableWalletService.initializeFromMnemonic TOTAL: ${performance.now() - startTime}ms`);
      return this.wallet;
    } catch (error) {
      console.error('Failed to initialize ObservableWallet:', error);
      throw error;
    }
  }

  /**
   * Initialize wallet from encrypted root key
   */
  async initializeFromEncryptedKey(
    encryptedRootKey: HexBlob,
    password: string,
    chain: Blockchain,
    network: Network,
    metadata: GeroWalletMetadata
  ): Promise<ObservableWallet> {
    console.log('⏱️ PERF: ObservableWalletService.initializeFromEncryptedKey START');
    const startTime = performance.now();

    try {
      this.metadata = metadata;

      // Get network ID
      const networkId = this.getNetworkId(network);
      const chainId = this.getChainId(chain, network);

      // Decrypt and create key agent
      const bip32Ed25519Instance = await getBip32Ed25519();
      const passphrase = Buffer.from(password);

      // Decrypt the root key
      const decryptedKey = await bip32Ed25519Instance.fromEncryptedBip32PrivateKey(
        encryptedRootKey,
        passphrase
      );

      this.keyAgent = await InMemoryKeyAgent.fromBip32PrivateKey(
        {
          bip32PrivateKey: decryptedKey,
          chainId,
          accountIndex: 0,
          getPassphrase: async () => passphrase
        },
        {
          logger: console,
          bip32Ed25519: bip32Ed25519Instance
        }
      );

      // Create providers
      this.providers = await createCardanoProviders({
        chain,
        network,
        blockfrostApiKey: process.env.BLOCKFROST_API_KEY || '',
        logger: console,
        experiments: {
          useWebSocket: false,
          useBlockfrostCredentialQueries: true
        }
      });

      // Create observable wallet
      this.wallet = await createPersonalWallet(
        {
          name: metadata.name,
          networkId,
          accountIndex: 0,
          keyAgent: this.keyAgent,
          ...this.providers
        },
        {
          logger: console,
          stores: {
            addresses: true,
            transactions: true,
            utxo: true,
            stake: true
          }
        }
      );

      // Subscribe to wallet observables
      this.subscribeToWalletState();

      console.log(`⏱️ PERF: ObservableWalletService.initializeFromEncryptedKey TOTAL: ${performance.now() - startTime}ms`);
      return this.wallet;
    } catch (error) {
      console.error('Failed to initialize ObservableWallet from encrypted key:', error);
      throw error;
    }
  }

  /**
   * Subscribe to wallet state observables and update stores
   */
  private subscribeToWalletState(): void {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    console.log('📡 Subscribing to wallet state observables...');

    // Subscribe to balance changes
    this.subscriptions.push(
      this.wallet.balance.utxo.available$.subscribe({
        next: (balance) => {
          console.log('💰 Balance updated:', balance);
          walletStore.setBalance({
            available: balance.coins.toString(),
            rewards: '0', // Will be updated by delegation$ subscription
            total: balance.coins.toString()
          });
        },
        error: (error) => console.error('Balance subscription error:', error)
      })
    );

    // Subscribe to transactions
    this.subscriptions.push(
      this.wallet.transactions.history$.subscribe({
        next: (transactions) => {
          console.log(`📜 Transactions updated: ${transactions.length} transactions`);
          // Convert SDK transactions to Gero format
          const geroTransactions = transactions.map(tx => this.convertSdkTransactionToGero(tx));
          walletStore.setTransactions(geroTransactions);
        },
        error: (error) => console.error('Transactions subscription error:', error)
      })
    );

    // Subscribe to blockchain tip
    this.subscriptions.push(
      this.wallet.tip$.subscribe({
        next: (tip) => {
          console.log('🔗 Tip updated:', tip);
          networkStore.setTip({
            blockNo: Number(tip.blockNo),
            slot: Number(tip.slot),
            hash: tip.hash,
            time: 0, // SDK doesn't provide time directly
            epoch: 0, // Calculate from slot if needed
            epoch_slot: 0
          });
        },
        error: (error) => console.error('Tip subscription error:', error)
      })
    );

    // Subscribe to addresses
    this.subscriptions.push(
      this.wallet.addresses$.subscribe({
        next: (addresses) => {
          console.log(`🏠 Addresses updated: ${addresses.length} addresses`);
          walletStore.setAddresses(addresses.map(addr => ({
            address: addr.address,
            index: addr.index,
            type: addr.type === Cardano.AddressType.EnterpriseKey ? 'enterprise' : 'base',
            networkId: addr.networkId
          })));
        },
        error: (error) => console.error('Addresses subscription error:', error)
      })
    );

    // Subscribe to delegation/staking info
    this.subscriptions.push(
      this.wallet.delegation.rewardAccounts$.subscribe({
        next: (rewardAccounts) => {
          console.log('🎁 Reward accounts updated:', rewardAccounts);
          const totalRewards = Array.from(rewardAccounts.values())
            .reduce((sum, account) => sum + account.rewardBalance, BigInt(0));

          walletStore.setRewards(totalRewards.toString());
        },
        error: (error) => console.error('Reward accounts subscription error:', error)
      })
    );

    // Subscribe to UTXOs
    this.subscriptions.push(
      this.wallet.utxo.available$.subscribe({
        next: (utxos) => {
          console.log(`💎 UTXOs updated: ${utxos.length} UTXOs`);
          walletStore.setUtxos(utxos);
        },
        error: (error) => console.error('UTXOs subscription error:', error)
      })
    );

    console.log('✅ Subscribed to all wallet state observables');
  }

  /**
   * Convert SDK transaction to Gero format
   */
  private convertSdkTransactionToGero(tx: Cardano.HydratedTx): any {
    return {
      tx_hash: tx.id,
      block_height: tx.blockHeader?.blockNo || 0,
      block_hash: tx.blockHeader?.hash || '',
      epoch_no: 0, // Calculate from slot if needed
      absolute_slot: tx.blockHeader?.slot || 0,
      tx_timestamp: 0, // Calculate from slot if needed
      tx_size: 0, // Not available in HydratedTx
      cbor: '', // Not stored in HydratedTx by default
      pending: false,
      body: tx.body,
      witness: tx.witness,
      auxiliaryData: tx.auxiliaryData
    };
  }

  /**
   * Get network ID from network enum
   */
  private getNetworkId(network: Network): Cardano.NetworkId {
    switch (network) {
      case Network.MAINNET:
        return Cardano.NetworkId.Mainnet;
      case Network.PREPROD:
      case Network.PREVIEW:
        return Cardano.NetworkId.Testnet;
      default:
        throw new Error(`Unsupported network: ${network}`);
    }
  }

  /**
   * Get chain ID from chain and network
   */
  private getChainId(chain: Blockchain, network: Network): Cardano.ChainId {
    if (chain === Blockchain.CARDANO) {
      switch (network) {
        case Network.MAINNET:
          return Cardano.ChainIds.Mainnet;
        case Network.PREPROD:
          return Cardano.ChainIds.Preprod;
        case Network.PREVIEW:
          return Cardano.ChainIds.Preview;
        default:
          throw new Error(`Unsupported network: ${network}`);
      }
    }
    throw new Error(`Unsupported chain: ${chain}`);
  }

  /**
   * Get the wallet instance
   */
  getWallet(): ObservableWallet {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }
    return this.wallet;
  }

  /**
   * Get the key agent
   */
  getKeyAgent(): InMemoryKeyAgent {
    if (!this.keyAgent) {
      throw new Error('Key agent not initialized');
    }
    return this.keyAgent;
  }

  /**
   * Get wallet metadata
   */
  getMetadata(): GeroWalletMetadata {
    if (!this.metadata) {
      throw new Error('Metadata not available');
    }
    return this.metadata;
  }

  /**
   * Shutdown wallet and cleanup resources
   */
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down ObservableWallet...');

    // Unsubscribe from all observables
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Shutdown wallet
    if (this.wallet) {
      await this.wallet.shutdown();
      this.wallet = null;
    }

    // Cleanup providers
    await cleanupProviders();
    this.providers = null;

    // Clear key agent
    this.keyAgent = null;
    this.metadata = null;

    console.log('✅ ObservableWallet shutdown complete');
  }

  /**
   * Check if wallet is initialized
   */
  isInitialized(): boolean {
    return this.wallet !== null;
  }

  /**
   * Force sync with blockchain
   */
  async forceSync(): Promise<void> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    console.log('🔄 Forcing wallet sync...');
    // ObservableWallet automatically syncs, but we can trigger a sync if needed
    // The SDK doesn't expose a direct sync method, but we can get fresh data
    await this.wallet.syncStatus.isSettled$.toPromise();
    console.log('✅ Wallet sync complete');
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): 'idle' | 'syncing' | 'error' {
    if (!this.wallet) {
      return 'idle';
    }

    // Check if wallet is currently syncing
    // This is a simplified version - the SDK has more detailed sync status
    return 'idle';
  }
}

/**
 * Singleton instance
 */
let observableWalletServiceInstance: ObservableWalletService | null = null;

/**
 * Get or create ObservableWalletService instance
 */
export function getObservableWalletService(): ObservableWalletService {
  if (!observableWalletServiceInstance) {
    observableWalletServiceInstance = new ObservableWalletService();
  }
  return observableWalletServiceInstance;
}

/**
 * Reset singleton instance (for testing)
 */
export function resetObservableWalletService(): void {
  if (observableWalletServiceInstance) {
    observableWalletServiceInstance.shutdown();
    observableWalletServiceInstance = null;
  }
}