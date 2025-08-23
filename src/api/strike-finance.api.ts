import axios, { AxiosResponse } from 'axios';

/**
 * Strike Finance API client for perpetual trading
 * Proxy endpoints via GeroWallet backend API
 */

const axiosInstance = axios.create({
  // @ts-ignore
  baseURL: import.meta.env.VITE_BACKEND_URL || 'https://dev.gerowallet.io',
  timeout: 30000,
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// Types for Strike Finance API
export interface Asset {
  policyId: string;
  assetName: string;
  ticker?: string;
  fingerprint?: string;
  decimals?: number;
  quantity?: string;
}

export interface OutRef {
  txHash: string;
  outputIndex: number;
}

export interface CreatePerpetualRequest {
  address: string;
  asset: Asset;
  collateralAmount: number;
  leverage: number;
  position: string; // 'long' | 'short'
  enteredPositionTime: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface ClosePerpetualRequest {
  address: string;
  asset: Asset;
  outRef: OutRef;
  positionSize: number;
  positionType: string;
  collateralAmount: number;
  position: string;
  enteredPrice: number;
  pnl: number;
  assetTicker: string;
  enteredPositionTime: number;
  utxos: any[];
}

export interface PerpetualRequestWrapper<T> {
  request: T;
}

export interface PerpetualPosition {
  id: string;
  address: string;
  asset: Asset;
  collateralAmount: number;
  positionSize: number;
  leverage: number;
  position: 'Long' | 'Short';
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  liquidationPrice: number;
  enteredPositionTime: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  outRef: OutRef;
  status: 'open' | 'closed' | 'liquidated';
  rawPositionAssetAmount: string;
  rawEnteredAtUsdPrice: string;
  rawCurrentUsdPrice: string;
  rawPnl: string;
  rawLiquidationPrice: string;
  rawStopLossPrice?: string;
  rawTakeProfitPrice?: string;
}

/**
 * Strike Finance API service
 */
export default {
  /**
   * Open a new perpetual position
   * @param request - Create perpetual position request
   * @returns Transaction CBOR string
   */
  async openPosition(request: CreatePerpetualRequest): Promise<AxiosResponse<string>> {
    return await axiosInstance.post('/api/strike/perpetuals/openPosition', {
      request
    });
  },

  /**
   * Close an existing perpetual position
   * @param request - Close perpetual position request
   * @returns Transaction CBOR string
   */
  async closePosition(request: ClosePerpetualRequest): Promise<AxiosResponse<string>> {
      return await axiosInstance.post('/api/strike/perpetuals/closePosition', {
        request
      });
  },

  /**
   * Get all perpetual positions for an address
   * @param address - User's wallet address
   * @returns Array of perpetual positions
   */
  async getPositions(address: string): Promise<AxiosResponse<PerpetualPosition[]>> {
    return await axiosInstance.get('/api/strike/perpetuals/getPositions', {
      params: { address }
    });
  },

  /**
   * Calculate position PnL
   * @param position - Perpetual position
   * @param currentPrice - Current market price
   * @returns Calculated PnL
   */
  calculatePnL(position: PerpetualPosition, currentPrice: number): number {
    const priceDiff = position.position === 'Long'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

    return (priceDiff / position.entryPrice) * position.collateralAmount * position.leverage;
  },

  /**
   * Calculate liquidation price
   * @param entryPrice - Entry price of the position
   * @param leverage - Leverage used
   * @param position - Position type ('long' | 'short')
   * @returns Liquidation price
   */
  calculateLiquidationPrice(entryPrice: number, leverage: number, position: 'long' | 'short'): number {
    const liquidationRatio = 1 / leverage;

    if (position === 'long') {
      return entryPrice * (1 - liquidationRatio);
    } else {
      return entryPrice * (1 + liquidationRatio);
    }
  },
};
