// Strike Finance v2 API — Trade Module (orders, leverage, margin)

import { strikeClient } from './strike-v2.client';
import { normalizeOrder } from './strike-v2.normalize';
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
  CreateTwapRequest,
  CreateTwapResponse,
  CancelTwapRequest,
  CancelTwapResponse,
  TwapListResponse,
  TwapStrategyView,
  ListTwapParams,
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
    // Wire casing drifts from the docs (see strike-v2.normalize.ts).
    return normalizeOrder(data ?? {});
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
    // Tolerate both a bare array and the documented { orders, count } envelope,
    // and normalize each entry (wire casing drifts from the docs).
    const raw: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.orders) ? data.orders : [];
    const orders = raw.map((o) => normalizeOrder((o ?? {}) as Record<string, unknown>));
    const count = typeof data?.count === 'number' ? data.count : orders.length;
    return { orders, count };
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

  // ---------------------------------------------------------------------------
  // Algo — TWAP strategies (/v2/algo/twap)
  // ---------------------------------------------------------------------------

  /** Create a TWAP strategy. Returns 201 with `strategy_id` and `status`. */
  async createTwap(req: CreateTwapRequest): Promise<CreateTwapResponse> {
    const { data } = await strikeClient.post('/v2/algo/twap', req);
    return data;
  },

  /**
   * List TWAP strategies for the authenticated account.
   * Default (no status / "active") returns only active + cancelling strategies.
   */
  async getTwapOrders(params?: ListTwapParams): Promise<TwapListResponse> {
    const { data } = await strikeClient.get('/v2/algo/twap', {
      params: { status: params?.status },
    });
    return data;
  },

  /** Fetch a single TWAP strategy by id. */
  async getTwapOrder(id: string): Promise<TwapStrategyView> {
    const { data } = await strikeClient.get(`/v2/algo/twap/${encodeURIComponent(id)}`);
    return data;
  },

  /**
   * Cancel a TWAP strategy. The strategy transitions to `cancelling`
   * immediately; finalisation is async on the server side.
   *
   * Note: per OpenAPI the cancel endpoint is `DELETE /v2/algo/twap/{id}`.
   * The `req` object is accepted for API symmetry with other cancel methods.
   */
  async cancelTwap(req: CancelTwapRequest): Promise<CancelTwapResponse> {
    const { data } = await strikeClient.delete(`/v2/algo/twap/${encodeURIComponent(req.id)}`);
    return data;
  },
};
