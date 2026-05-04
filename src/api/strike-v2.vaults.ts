// Strike Finance v2 API — Vault API

import { strikeMarketClient, strikeClient } from './strike-v2.client';
import type {
  VaultListResponse,
  VaultInfo,
  VaultPortfolioResponse,
  UserVaultPosition,
  VaultStatus,
  VaultPeriod,
  TransactionStatus,
} from './strike-v2.types';

export const strikeVaultApi = {
  // ---------------------------------------------------------------------------
  // Public endpoints (no auth)
  // ---------------------------------------------------------------------------

  async listVaults(params: {
    limit?: number;
    offset?: number;
    period?: VaultPeriod;
    type?: string;
    is_verified?: boolean;
    status?: VaultStatus;
  } = {}): Promise<VaultListResponse> {
    const { data } = await strikeMarketClient.get('/v2/vaults', { params });
    return data;
  },

  async getVault(id: string): Promise<VaultInfo> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}`);
    return data;
  },

  async getVaultHistory(id: string, params: {
    limit?: number;
    offset?: number;
    type?: string;
    status?: TransactionStatus;
  } = {}): Promise<unknown> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}/history`, { params });
    return data;
  },

  async getVaultPortfolio(id: string, period: VaultPeriod = '30d'): Promise<VaultPortfolioResponse> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}/portfolio`, { params: { period } });
    return data;
  },

  async getVaultDepositors(id: string, params: {
    limit?: number;
    offset?: number;
  } = {}): Promise<unknown> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}/depositors`, { params });
    return data;
  },

  // ---------------------------------------------------------------------------
  // Authenticated endpoints
  // ---------------------------------------------------------------------------

  async getUserVaultPosition(vaultId: string): Promise<UserVaultPosition> {
    const { data } = await strikeClient.get('/v2/vault/position', { params: { vault_id: vaultId } });
    return data;
  },

  async getAllUserVaultPositions(): Promise<unknown> {
    const { data } = await strikeClient.get('/v2/vault/positions');
    return data;
  },

  async getUserVaultHistory(params: {
    vault_id?: string;
    limit?: number;
    offset?: number;
    type?: string;
    status?: TransactionStatus;
  } = {}): Promise<unknown> {
    const { data } = await strikeClient.get('/v2/vault/history', { params });
    return data;
  },

  async getMyDepositsHistory(vaultId?: string): Promise<unknown> {
    const { data } = await strikeClient.get('/v2/vault/my-deposits/history', {
      params: vaultId ? { vault_id: vaultId } : undefined,
    });
    return data;
  },
};
