/**
 * Thorchain Cross-Chain Swap API
 * Enables BTC ↔ ADA (via intermediary) swaps without bridges
 * https://thornode.ninerealms.com
 */

import axios from 'axios';

const THORNODE_BASE = 'https://thornode.ninerealms.com';

export interface ThorPool {
  asset: string;
  status: 'Available' | 'Staged' | 'Suspended';
  balance_asset: string;
  balance_rune: string;
  pool_units: string;
  LP_units: string;
  synth_units: string;
  synth_supply: string;
  pending_inbound_asset: string;
  pending_inbound_rune: string;
  decimals: number;
  derived_depth_bps: string;
}

export interface ThorQuote {
  inbound_address: string;
  inbound_confirmation_blocks: number;
  inbound_confirmation_seconds: number;
  outbound_delay_blocks: number;
  outbound_delay_seconds: number;
  fees: {
    asset: string;
    affiliate: string;
    outbound: string;
    liquidity: string;
    total: string;
    slippage_bps: number;
    total_bps: number;
  };
  expiry: number;
  warning: string;
  notes: string;
  dust_threshold: string;
  recommended_min_amount_in: string;
  memo: string;
  expected_amount_out: string;
  expected_amount_out_streaming: string;
  max_streaming_quantity: number;
  streaming_swap_blocks: number;
  streaming_swap_seconds: number;
  total_swap_seconds: number;
}

export interface ThorAssetPrice {
  asset: string;
  price_usd: number;
}

class ThorchainApi {
  /** Get swap quote from Thorchain */
  async getSwapQuote(
    fromAsset: string,  // e.g. 'BTC.BTC'
    toAsset: string,    // e.g. 'ADA.ADA'
    amount: number,     // in smallest units (sats for BTC)
    destinationAddress: string,
    affiliateAddress?: string,
    affiliateBps = 0,
  ): Promise<ThorQuote> {
    const { data } = await axios.get(`${THORNODE_BASE}/thorchain/quote/swap`, {
      params: {
        from_asset: fromAsset,
        to_asset: toAsset,
        amount: String(amount),
        destination: destinationAddress,
        affiliate: affiliateAddress,
        affiliate_bps: affiliateBps,
        streaming_interval: 1,
        streaming_quantity: 0,
      }
    });
    return data as ThorQuote;
  }

  /** Get available pools */
  async getPools(): Promise<ThorPool[]> {
    const { data } = await axios.get(`${THORNODE_BASE}/thorchain/pools`);
    return data as ThorPool[];
  }

  /** Get inbound addresses (where to send funds for a swap) */
  async getInboundAddresses(): Promise<{ chain: string; address: string; router?: string; halted: boolean }[]> {
    const { data } = await axios.get(`${THORNODE_BASE}/thorchain/inbound_addresses`);
    return data;
  }

  /** Check if a specific chain/asset is supported */
  async isAssetSupported(asset: string): Promise<boolean> {
    try {
      const pools = await this.getPools();
      return pools.some(p => p.asset === asset && p.status === 'Available');
    } catch {
      return false;
    }
  }

  /** Format Thorchain asset string */
  formatAsset(chain: string, symbol: string): string {
    return `${chain}.${symbol}`;
  }

  /** Common asset identifiers */
  readonly ASSETS = {
    BTC: 'BTC.BTC',
    ADA: 'ADA.ADA',
    ETH: 'ETH.ETH',
    RUNE: 'THOR.RUNE',
  };

  /** Format a Thorchain memo for a swap */
  buildSwapMemo(toAsset: string, destinationAddress: string, minAmountOut: string, affiliate?: string, bps?: number): string {
    let memo = `=:${toAsset}:${destinationAddress}:${minAmountOut}`;
    if (affiliate && bps) {
      memo += `:${affiliate}:${bps}`;
    }
    return memo;
  }
}

export const thorchainApi = new ThorchainApi();
export default thorchainApi;