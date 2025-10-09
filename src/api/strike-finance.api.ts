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

export interface CreateLimitOrderRequest {
  address: string;
  asset: Asset;
  collateralAmount: number;
  leverage: number;
  position: string; // 'long' | 'short'
  stopLossPrice?: number;
  takeProfitPrice?: number;
  limitUSDPrice: number;
}

export interface UpdatePositionRequest {
  address: string;
  asset: Asset;
  outRef: OutRef;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  side: string;
}

export interface CancelLimitOrderRequest {
  address: string;
  asset: Asset;
  outRef: OutRef;
}

export interface ClosePerpetualRequest {
  address: string;
  asset: Asset;
  outRef: OutRef;
}

export interface PerpetualRequestWrapper<T> {
  request: T;
}

export interface PerpetualPosition {
  id: string;
  address: string;
  asset: {
    asset: Asset
  };
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
  status: string;
  rawPositionAssetAmount: string;
  rawEnteredAtUsdPrice: string;
  rawCurrentUsdPrice: string;
  rawPnl: string;
  rawLiquidationPrice: string;
  rawStopLossPrice?: string;
  rawTakeProfitPrice?: string;
}

export interface LimitOrder {
  id: string;
  address: string;
  asset: {
    asset: Asset
  };
  collateralAmount: number;
  leverage: number;
  position: 'Long' | 'Short';
  limitUSDPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  outRef: OutRef;
  status: 'pending' | 'filled' | 'cancelled';
  createdTime: number;
}

export interface PoolInfo {
  totalLiquidity: string;
  availableLiquidity: string;
  utilization: number;
  borrowRate: number;
  fundingRate: number;
}

export interface PerpetualTransaction {
  action: string;
  address: string;
  assetTicker: string;
  collateralAmount: number;
  contract: string;
  currentPrice: number;
  description: string;
  enteredPrice: number;
  pair: string;
  pnl: number;
  positionSize: number;
  positionType: string;
  status: string;
  time: number;
  txHash: string;
  type: string;
  originalTxHash?: string;
}

export interface PerpetualHistoryResponse {
  transactions: PerpetualTransaction[];
}

/**
 * Strike Finance API service
 */
export default {

  async submitTx(cbor: string, witness: string): Promise<AxiosResponse<string>> {
    return axiosInstance.post('/api/strike/perpetuals/submit', {
      cbor,
      witness
    });
  },

  /**
   * Open a new perpetual position
   * @param request - Create perpetual position request
   * @returns Transaction CBOR string
   */
  async openPosition(request: CreatePerpetualRequest): Promise<AxiosResponse<string>> {
    return axiosInstance.post('/api/strike/perpetuals/openPosition', {
      request
    });
  },

  /**
   * Close an existing perpetual position
   * @param request - Close perpetual position request
   * @returns Transaction CBOR string
   */
  async closePosition(request: ClosePerpetualRequest): Promise<AxiosResponse<string>> {
      return axiosInstance.post('/api/strike/perpetuals/closePosition', {
        request
      });
  },

  /**
   * Get all perpetual positions for an address
   * @param address - User's wallet address
   * @returns Array of perpetual positions
   */
  async getPositions(address: string): Promise<AxiosResponse<PerpetualPosition[]>> {
    return axiosInstance.get('/api/strike/perpetuals/getPositions', {
      params: { address }
    });
  },

  /**
   * Open a new perpetual limit order
   * @param request - Create limit order request
   * @returns Transaction CBOR string
   */
  async openLimitOrder(request: CreateLimitOrderRequest): Promise<AxiosResponse<string>> {
    return axiosInstance.post('/api/strike/perpetuals/openLimitOrder', {
      request
    });
  },

  /**
   * Cancel an existing limit order
   * @param request - Cancel limit order request
   * @returns Transaction CBOR string
   */
  async cancelLimitOrder(request: CancelLimitOrderRequest): Promise<AxiosResponse<string>> {
    return axiosInstance.post('/api/strike/perpetuals/cancelLimitOrder', {
      request
    });
  },

  /**
   * Update stop loss and take profit for an existing position
   * @param request - Update position request
   * @returns Transaction CBOR string
   */
  async updatePosition(request: UpdatePositionRequest): Promise<AxiosResponse<string>> {
    return axiosInstance.post('/api/strike/perpetuals/updatePosition', {
      request
    });
  },

  /**
   * Get all limit orders for an address
   * @param address - User's wallet address
   * @returns Array of limit orders
   */
  async getLimitOrders(address: string): Promise<AxiosResponse<LimitOrder[]>> {
    return axiosInstance.get('/api/strike/perpetuals/getLimitOrders', {
      params: { address }
    });
  },

  /**
   * Get pool information V2
   * @returns Pool information
   */
  async getPoolInfoV2(): Promise<AxiosResponse<PoolInfo>> {
    return axiosInstance.get('/api/strike/perpetuals/getPoolInfoV2');
  },

  /**
   * Get perpetual transaction history for an address
   * @param address - User's wallet address
   * @returns Perpetual transaction history
   */
  async getPerpetualHistory(address: string): Promise<AxiosResponse<PerpetualHistoryResponse>> {
    return axiosInstance.get('/api/strike/perpetuals/getPerpetualHistory', {
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
