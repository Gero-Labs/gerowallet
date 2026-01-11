const HARDENED = 2147483648;

const WalletType = {
  Trezor: 'Trezor',
  Ledger: 'Ledger',
  Keystone: 'Keystone',
  Normal: 'Normal',
  Google: 'Google',
};

type WalletTypeValue = typeof WalletType[keyof typeof WalletType];

export interface Wallet {
  id: number;
  name: string;
  chain: string;
  network: string;
  icon?: string;
  type?: WalletTypeValue;
  // PRF Encryption Support (Version 14+)
  encryptionMethod?: 'password' | 'prf'; // Encryption method for wallet keys
  prfEncryptedPrivateKey?: string; // Private key encrypted with PRF (hex)
  prfEncryptedMnemonic?: string; // Mnemonic encrypted with PRF (hex)
  webAuthnCredentialId?: string; // WebAuthn credential ID (base64)
  prfSpendingPassword?: string; // Optional spending password hash (PBKDF2-HMAC-SHA512)
}

export type NetworkScheme = {
  blockchain: string;
  network: string;
};

const Theme = {
  GERO: 'gero',
};

const purpose = {
  hdwallet: 1852,
  minting: 1855,
  multisig: 1854,
  voting: 1694,
};

const coin_type = {
  cardano: 1815,
};

const CoreAddressTypes = {
  CARDANO_LEGACY: 0,
  CARDANO_BASE: 1,
  CARDANO_PTR: 2,
  CARDANO_ENTERPRISE: 3,
  CARDANO_REWARD: 4,
  /**
   * Note: we store Shelley addresses as the full payload (not just payment key)
   * since it's easier to extract a key from a payload then the inverse
   *
   * This also matches how the remote works as it has to return the full payload
   * so we can tell the address type
   */
  JORMUNGANDR_SINGLE: 1_00,
  JORMUNGANDR_GROUP: 1_01,
  JORMUNGANDR_ACCOUNT: 1_02,
  JORMUNGANDR_MULTISIG: 1_03,
  ERGO_P2PK: 2_00,
  ERGO_P2SH: 2_01,
  ERGO_P2S: 2_02,
};

const WalletTypePurpose = {
  BIP44: HARDENED + 44,
  CIP1852: HARDENED + purpose.hdwallet,
};

const CoinTypes = {
  CARDANO: HARDENED + coin_type.cardano, // HARD_DERIVATION_START + 1815;
  ERGO: HARDENED + 429, // HARD_DERIVATION_START + 429;
};

const BIP44_SCAN_SIZE = 20;

const ChainDerivations = {
  EXTERNAL: 0,
  INTERNAL: 1,
  CHIMERIC_ACCOUNT: 2,
  DREP: 3,
  CONSTITUTIONAL_COMMITTEE_COLD: 4,
  CONSTITUTIONAL_COMMITTEE_HOT: 5,
};

enum Provider {
  UNDEFINED,
  KOIOS,
  BLOCKFROST,
  YACI,
}

const Blockchain = {
  CARDANO: 'Cardano',
  APEX_PRIME: 'Apex Fusion Prime',
  APEX_VECTOR: 'Apex Fusion Vector',
};

const Network = {
  MAINNET: 'Mainnet',
  PREVIEW: 'Preview',
  PREPROD: 'Preprod',
  TESTNET: 'Testnet',
};

const ERROR = {
  accessDenied: 'Access denied',
  wrongPassword: 'Wrong password',
  txTooBig: 'Transaction too big',
  txNotPossible: 'Transaction not possible',
  storeNotEmpty: 'Storage key is already set',
  onlyOneAccount: 'Only one account exist in the wallet',
  fullMempool: 'fullMempool',
  submit: 'submit',
};

export type Cardano = {
  [key: string]: {
    name: string;
    icon: string;
    apiVersion: string;
    enable: (extensions: Extensions) => Promise<WalletInstance>;
    isEnabled: () => Promise<boolean>;
    supportedExtensions: Extension[];
  };
};
export type TransactionSignatureRequest = {
  cbor: string;
  partialSign: boolean;
};

export type DataSignature = {
  signature: string;
  key: string;
};

export type Paginate = {
  page: number;
  limit: number;
};

export type PaginateError = {
  maxSize: number;
};

export type CollateralParams = {
  amount: string | number;
};

export type WalletInstance = {
  experimental: ExperimentalFeatures;
  getBalance(): Promise<string>;
  getChangeAddress(): Promise<string>;
  getNetworkId(): Promise<number>;
  getRewardAddresses(): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getUsedAddresses(paginate: Paginate | undefined): Promise<string[]>;
  getUtxos(amount: string | undefined): Promise<string[] | undefined>;
  signData(address: string, payload: string): Promise<DataSignature>;
  signTx(tx: string, partialSign: boolean): Promise<string>;
  signTxs?(txs: TransactionSignatureRequest[]): Promise<string[]>;
  signTxs?(txs: string[], partialSign: boolean): Promise<string[]>;
  submitTx(tx: string): Promise<string>;
};
export type ExperimentalFeatures = {
  getCollateral(): Promise<string[] | undefined>;
  signTxs?(txs: TransactionSignatureRequest[]): Promise<string[]>;
  signTxs?(txs: string[], partialSign: boolean): Promise<string[]>;
};
export type Extension = {
  cip: number;
};
export type Extensions = {
  extensions: Extension[];
};

const Currency = {
  AUD: { short: 'aud', description: 'Australian Dollar', symbol: 'A$' },
  CAD: { short: 'cad', description: 'Canadian Dollar', symbol: 'C$' },
  EUR: { short: 'eur', description: 'Euro', symbol: '€' },
  GBP: { short: 'gbp', description: 'Sterling', symbol: '£' },
  USD: { short: 'usd', description: 'United States Dollar', symbol: '$' },
  ILS: { short: 'ils', description: 'Israeli Shekel', symbol: '₪' },
};

export type Asset = {
  unit: string;
  quantity: string;
};

export const TX = {
  invalid_hereafter: 3600 * 2, //2h from current slot
};

export type TxOutput = {
  recipientAddress: string;
  value: string;
  tokens?: UTxO[];
};

export type Withdrawal = {
  address: string;
  amount: string;
};

export const DEFAULT_TTL: number = 14400;

export type Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
};

export type UTxO = {
  tx_hash: string;
  tx_index: number;
  payment_addr: {
    bech32: string;
  };
  asset_list: {
    policy_id: string;
    asset_name: string;
    quantity: string;
  }[];
  reference_script: {
    hash: string;
    size: number;
    type: string;
    bytes: string;
    value: any;
  };
  stake_addr: string;
  datum_hash: string;
  inline_datum: {
    bytes: string;
    value: any;
  };
  value: string;
};

export type Tip = {
  time: number;
  height: number;
  hash: string;
  slot: number;
  epoch: number;
  epoch_slot: number;
  slot_leader: string;
  size: number;
  tx_count: number;
  output: string;
  fees: string;
  block_vrf: string;
  previous_block: string;
  next_block: string;
  confirmations: number;
};

export {
  purpose,
  HARDENED,
  CoreAddressTypes,
  WalletType,
  Theme,
  WalletTypePurpose,
  CoinTypes,
  BIP44_SCAN_SIZE,
  ChainDerivations,
  Provider,
  Blockchain,
  Network,
  ERROR,
  Currency,
  coin_type,
};

// ============================================================================
// WALLET UI TYPES - Component Props and Interfaces
// ============================================================================

// Component Props Types
export interface ButtonProps {
  text: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

export interface FeatureCardProps {
  icon: 'conversion' | 'global' | 'track';
  title: string;
  description: string;
}

export interface FeatureListItemProps {
  text: string;
  icon?: string;
}

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
}

// Section Types
export interface SectionProps {
  className?: string;
  children?: any;
}

// Legacy Transaction Type (for backward compatibility)
export interface Transaction {
  id: number;
  date: string;
  name: string;
  avatarText?: string;
  icon?: string;
  amount: string;
  category: string;
  categoryClass: string;
  categoryDotClass: string;
}

export interface ExchangeRate {
  id: number;
  pair: string;
  value: string;
  currency: string;
  icon: string;
  change: string;
  trend: 'positive' | 'negative';
  trendIcon: string;
}

export interface Activity {
  id: number;
  type: string;
  cryptoAmount: string;
  fiatAmount: string;
  date: string;
  status: string;
}

export interface Key {
  address?: string;
  cred: string;
  path: string;
  used?: boolean;
}

export interface Keys {
  ccCold: Key[];
  ccHot: Key[];
  change: Key[];
  drep105: Key[];
  drep129: Key[];
  payment: Key[];
  script: Key[];
  stake: Key[];
}

// Pagination interfaces
export interface PaginationMeta {
  page: number;
  total_items: number;
  per_page: number;
  total_pages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface PaginationParams {
  page?: number;
  per_page?: number;
  search?: string;
  hide_saturated?: boolean;
  pledge_met?: boolean;
  sort_by?: string;
  sort_direction?: string;
}
