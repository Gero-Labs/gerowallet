/**
 * Bitcoin Chain Adapter
 *
 * Implements IChainAdapter interface for Bitcoin blockchain operations.
 * Provides a unified API for Bitcoin key management, UTXO handling, and transactions.
 */

import type {
  IChainAdapter,
  IUnifiedUtxo,
  IOutput,
  ICoinSelection,
  IBalance,
  IBuildTxParams,
  IUnsignedTx,
} from '@/chains/common/interfaces';
import type { BitcoinUtxo } from '@/api/bitcoin-api';
import {
  parseBitcoinUtxos,
  calculateBitcoinBalance,
  getConfirmedUtxos,
} from './bitcoinUtxoManager';
import {
  selectCoins as selectCoinsInternal,
  CoinSelectionStrategy,
  estimateMaxSendable,
} from './bitcoinCoinSelection';
import {
  deriveBitcoinAccountXpub,
  deriveBitcoinAddress,
  validateBitcoinAddress,
} from './bitcoinKeyManager';
import { encryptWithPassword, decryptWithPassword } from '@/shared/utils/crypto';
import {
  buildPsbt,
  buildSimpleSendPsbt,
  buildSendAllPsbt,
  type PsbtBuildOptions,
} from './bitcoinPsbtBuilder';
import {
  getBitcoinFeeEstimator,
  type FeePriority,
  type FeeEstimate,
  type TransactionFeeBreakdown,
} from './bitcoinFeeEstimator';

/**
 * Bitcoin Chain Adapter implementation
 */
export class BitcoinAdapter implements IChainAdapter {
  readonly chainId: string = 'Bitcoin';
  readonly coinType: number = 0; // BIP44 coin type for Bitcoin

  private network: string;
  private defaultAddressType: string;
  private changeAddress: string | null = null;
  private feeEstimator = getBitcoinFeeEstimator();

  constructor(network: string = 'Mainnet', addressType: string = 'segwit') {
    this.network = network;
    this.defaultAddressType = addressType;
  }

  /**
   * Initialize fee estimator with Bitcoin API
   */
  initializeFeeEstimator(api: any): void {
    this.feeEstimator.setApi(api);
  }

  /**
   * Set change address for coin selection
   */
  setChangeAddress(address: string): void {
    this.changeAddress = address;
  }

  /**
   * Derive keys from mnemonic (not used for Bitcoin adapter, kept for interface compatibility)
   */
  deriveKeysFromMnemonic(mnemonic: string, network: string, addressType?: string): any {
    const actualAddressType = addressType || this.defaultAddressType;
    const xpub = deriveBitcoinAccountXpub(mnemonic, network, actualAddressType, 0);
    return { xpub, addressType: actualAddressType };
  }

  /**
   * Derive extended public key (xpub) from mnemonic
   */
  derivePublicKey(mnemonic: string, accountIndex: number = 0): string {
    return deriveBitcoinAccountXpub(mnemonic, this.network, this.defaultAddressType, accountIndex);
  }

  /**
   * Derive address from extended public key
   */
  deriveAddress(
    publicKey: string,
    network: string,
    addressType: string,
    index: number
  ): string {
    return deriveBitcoinAddress(publicKey, network, addressType, 0, index);
  }

  /**
   * Get receive address (first external address)
   */
  getReceiveAddress(publicKey: string, network: string, addressType: string): string {
    return deriveBitcoinAddress(publicKey, network, addressType, 0, 0);
  }

  /**
   * Parse raw Bitcoin UTXOs to unified format
   */
  parseUtxos(rawUtxos: BitcoinUtxo[], address?: string): IUnifiedUtxo[] {
    if (!address) {
      throw new Error('Address is required for Bitcoin UTXO parsing');
    }
    return parseBitcoinUtxos(rawUtxos, address);
  }

  /**
   * Select UTXOs for a transaction
   * Implements the IChainAdapter interface with optional parameters
   */
  selectCoins(
    utxos: IUnifiedUtxo[],
    outputs: IOutput[],
    feeRate: number = 3
  ): ICoinSelection {
    // Use the first output address as change address fallback
    const changeAddr = this.changeAddress || outputs[0]?.address;

    if (!changeAddr) {
      throw new Error('Change address is required for coin selection');
    }

    return selectCoinsInternal(
      utxos,
      outputs,
      feeRate,
      changeAddr,
      CoinSelectionStrategy.ACCUMULATIVE // Default strategy
    );
  }

  /**
   * Select UTXOs with custom strategy
   */
  selectCoinsWithStrategy(
    utxos: IUnifiedUtxo[],
    outputs: IOutput[],
    feeRate: number,
    changeAddress: string,
    strategy: CoinSelectionStrategy = CoinSelectionStrategy.ACCUMULATIVE
  ): ICoinSelection {
    return selectCoinsInternal(utxos, outputs, feeRate, changeAddress, strategy);
  }

  /**
   * Get balance from UTXOs
   */
  getBalance(utxos: IUnifiedUtxo[]): IBalance {
    return calculateBitcoinBalance(utxos);
  }

  /**
   * Get spendable (confirmed) UTXOs
   */
  getSpendableUtxos(utxos: IUnifiedUtxo[]): IUnifiedUtxo[] {
    return getConfirmedUtxos(utxos);
  }

  /**
   * Validate Bitcoin address
   */
  validateAddress(address: string, network: string): boolean {
    return validateBitcoinAddress(address, network);
  }

  /**
   * Encrypt private key bytes (reuses existing crypto utilities)
   */
  encryptPrivateKey(keyBytes: Uint8Array, password: string): string {
    return encryptWithPassword(password, keyBytes);
  }

  /**
   * Decrypt private key (reuses existing crypto utilities)
   */
  decryptPrivateKey(encrypted: string, password: string): Uint8Array {
    const decrypted = decryptWithPassword(password, encrypted);
    return new Uint8Array(decrypted);
  }

  /**
   * Build unsigned PSBT transaction
   */
  buildTransaction(params: IBuildTxParams, feeRate: number): IUnsignedTx {
    const changeAddr = this.changeAddress || params.changeAddress;
    if (!changeAddr) {
      throw new Error('Change address is required for transaction building');
    }

    const options: PsbtBuildOptions = {
      feeRate,
      changeAddress: changeAddr,
      rbfEnabled: true,
    };

    return buildPsbt(params, this.network, options);
  }

  /**
   * Build simple send transaction
   */
  buildSendTransaction(
    utxos: IUnifiedUtxo[],
    recipientAddress: string,
    amount: bigint,
    feeRate: number
  ): IUnsignedTx {
    const changeAddr = this.changeAddress;
    if (!changeAddr) {
      throw new Error('Change address is required for transaction building');
    }

    return buildSimpleSendPsbt(utxos, recipientAddress, amount, changeAddr, feeRate, this.network);
  }

  /**
   * Build send-all transaction (sweep wallet)
   */
  buildSendAllTransaction(
    utxos: IUnifiedUtxo[],
    recipientAddress: string,
    feeRate: number
  ): IUnsignedTx {
    return buildSendAllPsbt(utxos, recipientAddress, feeRate, this.network);
  }

  /**
   * Estimate maximum sendable amount
   */
  getMaxSendable(utxos: IUnifiedUtxo[], feeRate: number): bigint {
    return estimateMaxSendable(utxos, feeRate, 1);
  }

  /**
   * Get fee estimate for specific priority
   */
  async getFeeEstimate(priority: FeePriority): Promise<FeeEstimate> {
    return this.feeEstimator.getFeeEstimate(priority);
  }

  /**
   * Get all fee estimates (Fast/Medium/Slow)
   */
  async getAllFeeEstimates(): Promise<FeeEstimate[]> {
    return this.feeEstimator.getAllFeeEstimates();
  }

  /**
   * Estimate transaction fee
   */
  async estimateTransactionFee(
    utxos: IUnifiedUtxo[],
    outputs: IOutput[],
    priority: FeePriority
  ): Promise<TransactionFeeBreakdown> {
    return this.feeEstimator.estimateTransactionFee(utxos, outputs, priority);
  }

  /**
   * Get recommended fee rate
   */
  async getRecommendedFeeRate(urgency: 'high' | 'medium' | 'low' = 'medium'): Promise<number> {
    return this.feeEstimator.getRecommendedFeeRate(urgency);
  }
}

/**
 * Factory function to create a Bitcoin adapter instance
 */
export function createBitcoinAdapter(
  network: string = 'Mainnet',
  addressType: string = 'segwit'
): BitcoinAdapter {
  return new BitcoinAdapter(network, addressType);
}
