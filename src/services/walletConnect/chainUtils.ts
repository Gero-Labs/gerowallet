/**
 * CAIP-2 chain identifier mapping for WalletConnect v2.
 * Maps between Gero's internal chain/network model and standard chain IDs.
 */

// ---- Cardano (CIP-34) ----
export const CARDANO_MAINNET = 'cip34:1-764824073';
export const CARDANO_PREPROD = 'cip34:0-1';
export const CARDANO_PREVIEW = 'cip34:0-2';

// ---- Bitcoin (BIP-122) ----
// First 32 hex chars of genesis block hash
export const BITCOIN_MAINNET = 'bip122:000000000019d6689c085ae165831e93';
export const BITCOIN_TESTNET = 'bip122:000000000933ea01ad0ee984209779ba';

// ---- Chain info mappings ----
interface GeroChainInfo {
  chain: 'Cardano' | 'Bitcoin';
  network: string;
}

const CAIP2_TO_GERO: Record<string, GeroChainInfo> = {
  [CARDANO_MAINNET]: { chain: 'Cardano', network: 'Mainnet' },
  [CARDANO_PREPROD]: { chain: 'Cardano', network: 'Preprod' },
  [CARDANO_PREVIEW]: { chain: 'Cardano', network: 'Preview' },
  [BITCOIN_MAINNET]: { chain: 'Bitcoin', network: 'Mainnet' },
  [BITCOIN_TESTNET]: { chain: 'Bitcoin', network: 'Testnet' },
};

export function resolveGeroChain(caip2Id: string): GeroChainInfo | undefined {
  return CAIP2_TO_GERO[caip2Id];
}

export function resolveCAIP2Chain(chain: string, network: string): string | undefined {
  for (const [caip2, info] of Object.entries(CAIP2_TO_GERO)) {
    if (info.chain === chain && info.network === network) return caip2;
  }
  return undefined;
}

export function isCardanoChain(caip2Id: string): boolean {
  return caip2Id.startsWith('cip34:');
}

export function isBitcoinChain(caip2Id: string): boolean {
  return caip2Id.startsWith('bip122:');
}

// ---- Supported methods per chain ----

export const CARDANO_METHODS = [
  'cardano_signTx',
  'cardano_signData',
  'cardano_submitTx',
  'cardano_getBalance',
  'cardano_getNetworkId',
  'cardano_getUtxos',
  'cardano_getCollateral',
  'cardano_getUsedAddresses',
  'cardano_getUnusedAddresses',
  'cardano_getChangeAddress',
  'cardano_getRewardAddress',
  'cardano_getRewardAddresses',
];

export const CARDANO_EVENTS = [
  'cardano_onNetworkChange',
  'cardano_onAccountChange',
];

export const BITCOIN_METHODS = [
  'sendTransfer',
  'getAccountAddresses',
  'signPsbt',
  'signMessage',
];

export const BITCOIN_EVENTS = [
  'bip122_addressesChanged',
];

export function getSupportedChains(chain: string, network: string): string[] {
  const caip2 = resolveCAIP2Chain(chain, network);
  return caip2 ? [caip2] : [];
}

export function getSupportedMethods(chain: string): string[] {
  if (chain === 'Cardano') return CARDANO_METHODS;
  if (chain === 'Bitcoin') return BITCOIN_METHODS;
  return [];
}

export function getSupportedEvents(chain: string): string[] {
  if (chain === 'Cardano') return CARDANO_EVENTS;
  if (chain === 'Bitcoin') return BITCOIN_EVENTS;
  return [];
}

/**
 * Build a CAIP-10 account identifier.
 * Format: <chain_id>:<address>
 */
export function buildCAIP10Account(caip2Chain: string, address: string): string {
  return `${caip2Chain}:${address}`;
}
