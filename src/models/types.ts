import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';

const WalletType = {
  Trezor: 'Trezor',
  Ledger: 'Ledger',
  Normal: 'Normal',
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
  CIP1852: HARDENED + 1852,
};

const CoinTypes = {
  CARDANO: HARDENED + 1815, // HARD_DERIVATION_START + 1815;
  ERGO: HARDENED + 429, // HARD_DERIVATION_START + 429;
};

/**
 * Defined by bip44
 * https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit
 */
const BIP44_SCAN_SIZE = 20;

const ChainDerivations = {
  EXTERNAL: 0,
  INTERNAL: 1,
  CHIMERIC_ACCOUNT: 2,
};

const STAKING_KEY_INDEX = 0;

enum Provider {
  UNDEFINED,
  KOIOS,
  BLOCKFROST,
  YACI
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
    enable: () => Promise<WalletInstance>;
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
  page: number,
  limit: number,
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
  cip: number
}

const Currency = {
  AUD: { short: 'aud', description: 'Australian Dollar', symbol: 'A$' },
  CAD: { short: 'cad', description: 'Canadian Dollar', symbol: 'C$' },
  EUR: { short: 'eur', description: 'Euro', symbol: '€' },
  GBP: { short: 'gbp', description: 'Sterling', symbol: '£' },
  USD: { short: 'usd', description: 'United States Dollar', symbol: '$' },
  ILS: { short: 'ils', description: 'Israeli Shekel', symbol: '₪' },
};

export type TransactionToken = {
  unit: string;
  quantity: string;
};

export const TX = {
  invalid_hereafter: 3600 * 2, //2h from current slot
};

export type TxOutput = {
  recipientAddress: string;
  value: string;
  tokens?: TransactionToken[];
};

export type Withdrawal = {
  address: string;
  amount: string;
}

export const DEFAULT_TTL: number = 14400;

export type Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string,
  curve: string,
}

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
  STAKING_KEY_INDEX,
  Provider,
  Blockchain,
  Network,
  ERROR,
  Currency
};
