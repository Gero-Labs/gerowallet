import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import crypto from 'crypto';

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

const Provider = {
  KOIOS: 'Koios',
  BLOCKFROST: 'Blockfrost',
};

const Blockchain = {
  CARDANO: 'Cardano',
  APEX_PRIME: 'Apex Fusion Prime',
};

const Network = {
  MAINNET: 'Mainnet',
  PREVIEW: 'Preview',
  PREPROD: 'Preprod',
  TESTNET: 'Testnet',
};

function getInitialSeeds() {
  return {
    AddressSeed: crypto.randomBytes(4).readUInt32BE(0),
    TransactionSeed: crypto.randomBytes(4).readUInt32BE(0),
    BlockSeed: crypto.randomBytes(4).readUInt32BE(0),
    TokenSeed: crypto.randomBytes(4).readUInt32BE(0),
  };
}

export {
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
  getInitialSeeds,
};
