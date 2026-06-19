/**
 * Chain Adapter Interfaces
 *
 * Blockchain-agnostic interfaces for multi-chain support.
 * Both Cardano and Bitcoin implementations should conform to these interfaces.
 */

/**
 * Unified UTXO interface that works across UTXO-based chains
 */
export interface IUnifiedUtxo {
  txHash: string;
  index: number;
  address: string;
  value: bigint;                    // Satoshis (BTC) or Lovelace (ADA)
  assets?: Map<string, bigint>;     // Only for Cardano (native tokens)
  scriptPubKey?: string;            // Only for Bitcoin
  confirmed: boolean;
  // BIP32 derivation info for Bitcoin (chain=0 external, chain=1 change)
  derivationChain?: number;         // 0 = external (receive), 1 = internal (change)
  derivationIndex?: number;         // Address index within the chain
  // Chain-specific raw data stored as any
  raw?: any;
}

/**
 * Output for transaction building
 */
export interface IOutput {
  address: string;
  value: bigint;
  assets?: Map<string, bigint>;    // Cardano-only
}

/**
 * Balance breakdown
 */
export interface IBalance {
  available: bigint;
  total: bigint;
  locked?: bigint;                 // For staking, etc.
}

/**
 * Blockchain tip information
 */
export interface IBlockTip {
  height: number;
  hash: string;
  timestamp: number;
}

/**
 * Transaction building parameters
 */
export interface IBuildTxParams {
  outputs: IOutput[];
  withdrawals?: any[];             // Cardano-only
  certificates?: any[];            // Cardano-only
  changeAddress: string;
  feeRate?: number;                // Bitcoin-specific (sat/vbyte)
  utxos: IUnifiedUtxo[];
  metadata?: any;
}

/**
 * Unsigned transaction (pre-signing)
 */
export interface IUnsignedTx {
  raw: any;                        // Chain-specific format (PSBT for Bitcoin, Cardano.Tx)
  id?: string;
  fee: bigint;
  inputs: IUnifiedUtxo[];
  outputs: IOutput[];
}

/**
 * Signed transaction (ready for broadcast)
 */
export interface ISignedTx {
  raw: any;                        // Chain-specific format
  id: string;                      // Transaction hash
  hex: string;                     // Serialized hex
}

/**
 * Coin selection result
 */
export interface ICoinSelection {
  selectedUtxos: IUnifiedUtxo[];
  changeAmount: bigint;
  fee: bigint;
}

/**
 * Chain Adapter - Interface for blockchain-specific operations
 */
export interface IChainAdapter {
  // Identity
  readonly chainId: string;        // 'Cardano' | 'Bitcoin'
  readonly coinType: number;       // 1815 (Cardano) | 0 (Bitcoin)

  // Key Management
  deriveKeysFromMnemonic(mnemonic: string, network: string, addressType?: string): any;
  derivePublicKey(mnemonic: string, accountIndex: number): string;
  deriveAddress(publicKey: string, network: string, addressType: string, index: number): string;
  getReceiveAddress(publicKey: string, network: string, addressType: string): string;

  // UTXO Management
  parseUtxos(rawUtxos: any[]): IUnifiedUtxo[];
  selectCoins(utxos: IUnifiedUtxo[], outputs: IOutput[], feeRate?: number): ICoinSelection;

  // Balance
  getBalance(utxos: IUnifiedUtxo[]): IBalance;

  // Address Validation
  validateAddress(address: string, network: string): boolean;

  // Encryption (reuses existing crypto.ts utilities)
  encryptPrivateKey(keyBytes: Uint8Array, password: string): string;
  decryptPrivateKey(encrypted: string, password: string): Uint8Array;
}
