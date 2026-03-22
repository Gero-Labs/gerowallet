/**
 * Ordinals & Runes API via Hiro.so
 * https://api.hiro.so/ordinals/v1       (mainnet)
 *
 * Testnet: No public ordinals indexer exists. The navigation item is hidden
 * for testnet via networks.ts (ordinalsSupport: false).
 *
 * TODO: Migrate to Xverse/secretkeylabs API before Hiro deprecation (~March 2026).
 *   Mainnet:  https://api.secretkeylabs.io  (requires API key)
 *   Testnet4: https://api-testnet4.secretkeylabs.io (requires API key)
 */

import axios from 'axios';

const HIRO_MAINNET = 'https://api.hiro.so';

const ORDINALS_EXPLORER_MAINNET = 'https://ordinals.com';

export interface Inscription {
  id: string;
  number: number;
  address: string;
  content_type: string;
  content_length: number;
  timestamp: number;
  genesis_block_height: number;
  genesis_block_hash: string;
  genesis_tx_id: string;
  genesis_fee: string;
  genesis_timestamp: number;
  genesis_address: string;
  tx_id: string;
  location: string;
  output: string;
  value: string;
  offset: string;
  sat_ordinal: string;
  sat_rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
  sat_coinbase_height: number;
  mime_type: string;
  recursive: boolean;
  recursion_refs: string[] | null;
}

export interface InscriptionListResponse {
  limit: number;
  offset: number;
  total: number;
  results: Inscription[];
}

export interface RuneBalance {
  rune: {
    id: string;
    name: string;
    spaced_name: string;
  };
  balance: string;
}

export interface RuneInfo {
  id: string;
  name: string;
  spaced_name: string;
  cenotaph: boolean;
  etching: {
    divisibility: number;
    mint: {
      deadline: number | null;
      limit: string | null;
      term: number | null;
    };
    mints: string;
    number: string;
    premine: string;
    runestone_id: string;
    runestone_timestamp: number;
    spacers: number;
    supply: string;
    symbol: string;
    turbo: boolean;
  };
  supply: {
    current: string;
    minted: string;
    total_mints: string;
    mint_percentage: string;
    mintable: boolean;
    burned: string;
    total_burns: string;
  };
  market?: {
    price_in_usd?: number;
    market_cap_in_usd?: number;
  };
}

class OrdinalsApi {
  async getInscriptionsByAddress(address: string, offset = 0, limit = 20): Promise<InscriptionListResponse> {
    const { data } = await axios.get(`${HIRO_MAINNET}/ordinals/v1/inscriptions`, {
      params: { address, offset, limit }
    });
    return data as InscriptionListResponse;
  }

  async getInscription(id: string): Promise<Inscription> {
    const { data } = await axios.get(`${HIRO_MAINNET}/ordinals/v1/inscriptions/${id}`);
    return data as Inscription;
  }

  getInscriptionContentUrl(id: string): string {
    return `${ORDINALS_EXPLORER_MAINNET}/content/${id}`;
  }

  getInscriptionExplorerUrl(id: string): string {
    return `${ORDINALS_EXPLORER_MAINNET}/inscription/${id}`;
  }

  async getRuneBalancesByAddress(address: string): Promise<{ limit: number; offset: number; total: number; results: RuneBalance[] }> {
    const { data } = await axios.get(`${HIRO_MAINNET}/runes/v1/addresses/${address}/balances`);
    return data;
  }

  async getRuneInfo(runeNameOrId: string): Promise<RuneInfo> {
    const { data } = await axios.get(`${HIRO_MAINNET}/runes/v1/etchings/${runeNameOrId}`);
    return data as RuneInfo;
  }

  async getTopRunes(offset = 0, limit = 20): Promise<{ limit: number; offset: number; total: number; results: RuneInfo[] }> {
    const { data } = await axios.get(`${HIRO_MAINNET}/runes/v1/etchings`, {
      params: { offset, limit, order_by: 'market_cap', order: 'desc' }
    });
    return data;
  }

  getRuneExplorerUrl(runeId: string): string {
    return `${ORDINALS_EXPLORER_MAINNET}/rune/${runeId}`;
  }
}

export const ordinalsApi = new OrdinalsApi();
export default ordinalsApi;
