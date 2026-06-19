/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Types for the shared send flow components
 * Used by dashboard and multisig modules
 */

export interface Token {
  ticker: string;
  unit: string;
  quantity: string | number;
  decimals: number;
  verified?: boolean;
  image?: string;
  last_price?: number;
  fingerprint?: string;
  policy_id?: string;
  asset_name?: string;
}

export interface Collectible {
  asset_name: string;
  policy_id: string;
  fingerprint: string;
  quantity: number;
  toSendQuantity?: number;
  image?: string;
  name?: string;
  collection?: string;
}

export interface Collection {
  policy_id: string;
  name: string;
  items: Collectible[];
}

export interface SendFlowData {
  selectedTokens: Token[];
  selectedCollectibles: Collectible[];
  recipientAddress: string;
  selectedWallet?: string;
  minAda?: number;
  adaShortage?: number;
  isMultisigFunding?: boolean;
  availableWallets?: any[];
}

export interface SendRecipient {
  /** Stable key for v-for — generated with crypto.randomUUID() */
  id: string;
  /** Raw input: payment address or $handle string */
  address: string;
  /** Resolved payment address (null when address is not yet valid or handle not yet resolved) */
  resolvedAddress: string | null;
  /** Selected tokens; first entry is always ADA (locked, cannot remove) */
  selectedTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
  /** Selected collectibles keyed by NFT name */
  selectedCollectibles: Record<string, Collectible & { unit: string }>;
  /** Min ADA required for this output (calculated from non-native assets) */
  minAda: number;
  /** > 0 when ADA in this card is less than required */
  adaShortage: number;
}

export interface WalletSelectorConfig {
  wallets: any[];
  labelKey: string;
  showSelector: boolean;
}

export interface PriceGetter {
  (token: Token): number;
}
