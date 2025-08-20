/**
 * KaiserEx API Client
 * Implements all endpoints from OpenAPI specification
 */
import axios, { AxiosInstance } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import type {
  AuthTokens,
  UserInfo,
  CardanoAddress,
  CardsListResponse,
  CardDetails,
  CardPin,
  CardBalance,
  CardHistoryResponse,
  OrderCardResponse,
  CardUuidResponse,
  VerificationLinkResponse,
  HistoryParams,
} from '@/models/card';

export class KaiserExApi {
  private axiosInstance: AxiosInstance;
  private accessToken: string | null = null;

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: import.meta.env['VITE_BACKEND_URL'],
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

    // Add request interceptor for auth
    this.axiosInstance.interceptors.request.use(config => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      response => response,
      error => {
        throw parseHttpError(error);
      }
    );
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  clearAccessToken(): void {
    this.accessToken = null;
  }

  // ============================================================================
  // Authentication Methods
  // ============================================================================

  /**
   * Exchange OAuth code for access token
   * POST /api/kaiserex/api/token
   */
  async exchangeOAuthCode(code: string, codeVerifier: string): Promise<AuthTokens> {
    try {
      const { data, status } = await this.axiosInstance.post('/api/kaiserex/api/token', {
        code,
        codeVerifier,
      });

      if (status === 200) {
        this.setAccessToken(data.access_token);
        return data;
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Refresh access token using refresh token
   * POST /api/kaiserex/api/token (with refresh_token)
   * Note: This endpoint may not be implemented yet in the backend
   */
  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    try {
      const { data, status } = await this.axiosInstance.post('/api/kaiserex/api/token', {
        refresh_token: refreshToken,
      });

      if (status === 200) {
        this.setAccessToken(data.access_token);
        return data;
      }

      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ============================================================================
  // User Methods
  // ============================================================================

  /**
   * Get user information
   * GET /api/kaiserex/user
   */
  async getUserInfo(): Promise<UserInfo> {
    try {
      const { data, status } = await this.axiosInstance.get('/api/kaiserex/user');

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Get verification link for KYC process
   * GET /api/kaiserex/verification-link
   */
  async getVerificationLink(): Promise<VerificationLinkResponse> {
    try {
      const { data, status } = await this.axiosInstance.get('/api/kaiserex/verification-link');

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ============================================================================
  // Deposit Methods
  // ============================================================================

  /**
   * Get Cardano deposit address
   * GET /api/kaiserex/cardano-address
   */
  async getCardanoAddress(): Promise<CardanoAddress> {
    try {
      const { data, status } = await this.axiosInstance.get('/api/kaiserex/cardano-address');

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ============================================================================
  // Card Management Methods
  // ============================================================================

  /**
   * Get user's cards
   * GET /api/kaiserex/cards
   */
  async getCards(): Promise<CardsListResponse> {
    try {
      const { data, status } = await this.axiosInstance.get('/api/kaiserex/cards');

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Get card details (PAN, CVV, expiry)
   * GET /api/kaiserex/cards/details/{card_uuid}
   */
  async getCardDetails(cardUuid: string): Promise<CardDetails> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/kaiserex/cards/details/${cardUuid}`);

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Get card PIN code
   * GET /api/kaiserex/cards/pin/{card_uuid}
   */
  async getCardPin(cardUuid: string): Promise<CardPin> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/kaiserex/cards/pin/${cardUuid}`);

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Change card PIN code
   * PUT /api/kaiserex/cards/pin/{card_uuid}
   */
  async changeCardPin(cardUuid: string, newPin: string): Promise<string> {
    try {
      const { data, status } = await this.axiosInstance.put(`/api/kaiserex/cards/pin/${cardUuid}`, {
        pin: newPin,
      });

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Get card balance
   * GET /api/kaiserex/cards/balance/{card_uuid}
   */
  async getCardBalance(cardUuid: string): Promise<CardBalance> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/kaiserex/cards/balance/${cardUuid}`);

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Get card transaction history
   * GET /api/kaiserex/cards/history/{card_uuid}
   */
  async getCardHistory(cardUuid: string, params: HistoryParams = {}): Promise<CardHistoryResponse> {
    try {
      const queryParams = new URLSearchParams();

      if (params.periodFrom) queryParams.append('periodFrom', params.periodFrom);
      if (params.periodTo) queryParams.append('periodTo', params.periodTo);
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.size) queryParams.append('size', params.size.toString());

      const url = `/api/kaiserex/cards/history/${cardUuid}${
        queryParams.toString() ? `?${queryParams.toString()}` : ''
      }`;
      const { data, status } = await this.axiosInstance.get(url);

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Order a new virtual card
   * POST /api/kaiserex/cards/order
   */
  async orderCard(): Promise<OrderCardResponse> {
    try {
      const { data, status } = await this.axiosInstance.post('/api/kaiserex/cards/order');

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  /**
   * Get card UUID by order UUID
   * GET /api/kaiserex/cards/card-uuid/{order_uuid}
   */
  async getCardUuidByOrderUuid(orderUuid: string): Promise<CardUuidResponse> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/kaiserex/cards/card-uuid/${orderUuid}`);

      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Get current access token
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }
}

export default KaiserExApi;
