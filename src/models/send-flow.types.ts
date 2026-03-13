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

export interface WalletSelectorConfig {
  wallets: any[];
  labelKey: string;
  showSelector: boolean;
}

export interface PriceGetter {
  (token: Token): number;
}
