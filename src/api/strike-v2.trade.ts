// Strike Finance v2 API — Trade Module (orders, leverage, margin)

import { strikeClient } from './strike-v2.client';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  Order,
  CancelOrderRequest,
  CancelOrderResponse,
  CancelAllOrdersRequest,
  CancelAllOrdersResponse,
  OpenOrdersResponse,
  CreateStrategyOrderRequest,
  CreateStrategyOrderResponse,
  LeverageRequest,
  LeverageResponse,
  MarginModeRequest,
  ModifyMarginRequest,
} from './strike-v2.types';

export const strikeTradeApi = {
  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
    const { data } = await strikeClient.post('/v2/order', req);
    return data;
  },

  async getOrder(symbol: string, orderId?: string, clientOrderId?: string): Promise<Order> {
    const { data } = await strikeClient.get('/v2/order', {
      params: { symbol, order_id: orderId, client_order_id: clientOrderId },
    });
    return data;
  },

  async cancelOrder(req: CancelOrderRequest): Promise<CancelOrderResponse> {
    const { data } = await strikeClient.delete('/v2/order/cancel', { data: req });
    return data;
  },

  async cancelAllOrders(req: CancelAllOrdersRequest): Promise<CancelAllOrdersResponse> {
    const { data } = await strikeClient.delete('/v2/order/cancel-all', { data: req });
    return data;
  },

  async getOpenOrders(symbol?: string, vaultId?: string): Promise<OpenOrdersResponse> {
    const { data } = await strikeClient.get('/v2/openOrders', {
      params: { symbol, vault_id: vaultId },
    });
    return data;
  },

  async createStrategyOrder(req: CreateStrategyOrderRequest): Promise<CreateStrategyOrderResponse> {
    const { data } = await strikeClient.post('/v2/order/strategy', req);
    return data;
  },

  async createBatchOrders(orders: CreateOrderRequest[], vaultId?: string): Promise<unknown> {
    const { data } = await strikeClient.post('/v2/orders/batch', { orders, vault_id: vaultId });
    return data;
  },

  async replaceOrder(
    cancel: CancelOrderRequest,
    newOrder: CreateOrderRequest,
    vaultId?: string,
  ): Promise<unknown> {
    const { data } = await strikeClient.post('/v2/order/replace', {
      cancel,
      new_order: newOrder,
      vault_id: vaultId,
    });
    return data;
  },

  // ---------------------------------------------------------------------------
  // Trading settings
  // ---------------------------------------------------------------------------

  async setLeverage(req: LeverageRequest): Promise<LeverageResponse> {
    const { data } = await strikeClient.post('/v2/leverage', req);
    return data;
  },

  async setMarginMode(req: MarginModeRequest): Promise<unknown> {
    const { data } = await strikeClient.post('/v2/marginMode', req);
    return data;
  },

  async modifyIsolatedMargin(req: ModifyMarginRequest): Promise<unknown> {
    const { data } = await strikeClient.post('/v2/isoMargin', req);
    return data;
  },
};
