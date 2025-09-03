/**
 * Enhanced TypeScript types for wallet functionality
 * Provides strong type safety across the wallet ecosystem
 */

import type { Cardano } from '@cardano-sdk/core'

// ============================================================================
// CORE WALLET TYPES
// ============================================================================

export enum WalletType {
  SOFTWARE = 'software',
  HARDWARE = 'hardware',
  MULTISIG = 'multisig',
}

export enum WalletStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  LOCKED = 'locked',
  SYNCING = 'syncing',
  ERROR = 'error',
}

export interface WalletMetadata {
  id: string
  name: string
  type: WalletType
  status: WalletStatus
  createdAt: string
  lastAccessedAt: string
  version: string
  isBackedUp: boolean
}

export interface WalletBalance {
  ada: {
    total: bigint
    available: bigint
    rewards: bigint
  }
  assets: Map<string, bigint>
  fiatValue?: {
    total: number
    currency: string
    lastUpdated: string
  }
}

export interface WalletAccount {
  address: string
  derivationPath: string
  publicKey: string
  balance: WalletBalance
  utxos: Cardano.Utxo[]
  transactions: WalletTransaction[]
}

// ============================================================================
// TRANSACTION TYPES
// ============================================================================

export enum TransactionType {
  SEND = 'send',
  RECEIVE = 'receive',
  STAKE = 'stake',
  UNSTAKE = 'unstake',
  REWARD = 'reward',
  CONTRACT = 'contract',
  MINT = 'mint',
  BURN = 'burn',
}

export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface TransactionInput {
  txHash: string
  outputIndex: number
  address: string
  amount: bigint
  assets?: Map<string, bigint>
}

export interface TransactionOutput {
  address: string
  amount: bigint
  assets?: Map<string, bigint>
  datumHash?: string
}

export interface WalletTransaction {
  id: string
  hash: string
  type: TransactionType
  status: TransactionStatus
  amount: bigint
  fee: bigint
  inputs: TransactionInput[]
  outputs: TransactionOutput[]
  metadata?: any
  submittedAt: string
  confirmedAt?: string
  blockHeight?: number
  blockHash?: string
}

// ============================================================================
// ASSET TYPES
// ============================================================================

export interface AssetMetadata {
  name: string
  description?: string
  image?: string
  mediaType?: string
  files?: Array<{
    name: string
    mediaType: string
    src: string
  }>
  decimals?: number
  ticker?: string
  url?: string
  logo?: string
}

export interface AssetInfo {
  assetId: string
  policyId: string
  assetName: string
  fingerprint: string
  quantity: bigint
  metadata?: AssetMetadata
  isVerified: boolean
  rating?: number
  tags?: string[]
}

export interface TokenPortfolio {
  totalValue: number
  currency: string
  assets: AssetInfo[]
  lastUpdated: string
}

// ============================================================================
// STAKING TYPES
// ============================================================================

export interface PoolInfo {
  id: string
  ticker: string
  name: string
  description?: string
  homepage?: string
  margin: number
  fixedCost: bigint
  pledge: bigint
  saturation: number
  blocks: number
  isRetiring: boolean
  retiringEpoch?: number
}

export interface StakingInfo {
  isStaking: boolean
  poolId?: string
  pool?: PoolInfo
  rewards: {
    available: bigint
    lifetime: bigint
    lastEpoch: bigint
  }
  delegation?: {
    epoch: number
    amount: bigint
  }
}

// ============================================================================
// DAPP CONNECTION TYPES
// ============================================================================

export interface DappPermission {
  type: 'read_balance' | 'read_utxos' | 'sign_tx' | 'sign_data'
  description: string
  granted: boolean
  grantedAt?: string
}

export interface ConnectedDapp {
  id: string
  name: string
  domain: string
  icon?: string
  description?: string
  permissions: DappPermission[]
  connectedAt: string
  lastUsedAt: string
  isActive: boolean
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface WalletSettings {
  currency: 'usd' | 'eur' | 'gbp' | 'jpy'
  language: string
  theme: 'light' | 'dark' | 'auto'
  notifications: {
    transactions: boolean
    staking: boolean
    security: boolean
  }
  security: {
    autoLock: boolean
    autoLockTimeout: number // minutes
    biometricAuth: boolean
    requirePasswordForTx: boolean
  }
  privacy: {
    hideBalance: boolean
    analytics: boolean
  }
}

export interface NetworkSettings {
  network: 'mainnet' | 'testnet' | 'preview'
  provider: string
  customEndpoints?: {
    blockfrost?: string
    koios?: string
  }
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface WalletError {
  code: string
  message: string
  details?: any
  timestamp: string
  context?: string
  isRetryable: boolean
}

export enum WalletErrorCode {
  // Authentication errors
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  WALLET_LOCKED = 'WALLET_LOCKED',
  SEED_PHRASE_INVALID = 'SEED_PHRASE_INVALID',
  
  // Transaction errors
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  TRANSACTION_TOO_LARGE = 'TRANSACTION_TOO_LARGE',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  NODE_UNAVAILABLE = 'NODE_UNAVAILABLE',
  SYNC_ERROR = 'SYNC_ERROR',
  
  // Hardware wallet errors
  HARDWARE_DISCONNECTED = 'HARDWARE_DISCONNECTED',
  HARDWARE_ERROR = 'HARDWARE_ERROR',
  FIRMWARE_OUTDATED = 'FIRMWARE_OUTDATED',
  
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

// ============================================================================
// STATE TYPES
// ============================================================================

export interface WalletState {
  // Core wallet data
  metadata: WalletMetadata | null
  account: WalletAccount | null
  
  // Asset information
  portfolio: TokenPortfolio | null
  staking: StakingInfo | null
  
  // Connected applications
  connectedDapps: ConnectedDapp[]
  
  // Configuration
  settings: WalletSettings
  networkSettings: NetworkSettings
  
  // State management
  isLoading: boolean
  isLocked: boolean
  isSyncing: boolean
  lastSyncAt: string | null
  
  // Error handling
  error: WalletError | null
  
  // Development
  isDevelopmentMode: boolean
}

// ============================================================================
// ACTION TYPES
// ============================================================================

export interface WalletAction {
  type: string
  payload?: any
  timestamp: string
}

export enum WalletActionType {
  // Wallet management
  CREATE_WALLET = 'CREATE_WALLET',
  RESTORE_WALLET = 'RESTORE_WALLET',
  DELETE_WALLET = 'DELETE_WALLET',
  LOCK_WALLET = 'LOCK_WALLET',
  UNLOCK_WALLET = 'UNLOCK_WALLET',
  
  // Account operations
  SYNC_ACCOUNT = 'SYNC_ACCOUNT',
  UPDATE_BALANCE = 'UPDATE_BALANCE',
  
  // Transaction operations
  SEND_TRANSACTION = 'SEND_TRANSACTION',
  SIGN_TRANSACTION = 'SIGN_TRANSACTION',
  SUBMIT_TRANSACTION = 'SUBMIT_TRANSACTION',
  
  // Staking operations
  DELEGATE_STAKE = 'DELEGATE_STAKE',
  WITHDRAW_REWARDS = 'WITHDRAW_REWARDS',
  
  // DApp operations
  CONNECT_DAPP = 'CONNECT_DAPP',
  DISCONNECT_DAPP = 'DISCONNECT_DAPP',
  APPROVE_TRANSACTION = 'APPROVE_TRANSACTION',
  
  // Settings
  UPDATE_SETTINGS = 'UPDATE_SETTINGS',
  UPDATE_NETWORK_SETTINGS = 'UPDATE_NETWORK_SETTINGS',
  
  // Error handling
  SET_ERROR = 'SET_ERROR',
  CLEAR_ERROR = 'CLEAR_ERROR',
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type WalletEventHandler<T = any> = (data: T) => void | Promise<void>

export interface WalletEventEmitter {
  on<T>(event: string, handler: WalletEventHandler<T>): void
  off<T>(event: string, handler: WalletEventHandler<T>): void
  emit<T>(event: string, data?: T): void
}

export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}

export type PartialExcept<T, K extends keyof T> = Partial<T> & Pick<T, K>

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export interface ValidationResult {
  isValid: boolean
  errors: string[]
}

export interface AddressValidation extends ValidationResult {
  address?: string
  type?: 'base' | 'enterprise' | 'pointer' | 'reward'
  network?: 'mainnet' | 'testnet'
}

export interface AmountValidation extends ValidationResult {
  amount?: bigint
  hasDecimals?: boolean
}

// ============================================================================
// EXPORT ALL TYPES
// ============================================================================

export type {
  // Re-export from other modules for convenience
  CardState,
  AuthTokens,
  UserInfo,
  CardData,
  CardBalance,
} from './card'

export type {
  Activity,
  Provider,
  Blockchain,
  Network,
} from './types'
