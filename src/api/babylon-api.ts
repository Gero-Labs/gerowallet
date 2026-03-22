/**
 * Babylon Protocol Staking API — v2
 * https://staking-api.babylonlabs.io
 */

import axios from 'axios';

// Use the Vite dev proxy only when running in the Vite dev server (http://localhost).
// In the Chrome extension context (chrome-extension:// protocol), always use direct URLs —
// extensions are not bound by same-origin CORS policy and the proxy is unreachable.
const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const isDevServer = !isExtension && typeof import.meta !== 'undefined' && import.meta.env?.DEV;
const MAINNET_BASE = isDevServer ? '/babylon-mainnet' : 'https://staking-api.babylonlabs.io';
const TESTNET_BASE = isDevServer ? '/babylon-testnet' : 'https://staking-api.testnet.babylonlabs.io';

// ── Our stable interfaces (kept compatible across v1/v2 API changes) ──────────

export interface BabylonGlobalParams {
  versions: BabylonParamVersion[];
}

export interface BabylonParamVersion {
  version: number;
  activation_height: number;
  staking_cap: number;
  tag: string;
  covenant_pks: string[];
  covenant_quorum: number;
  unbonding_time: number;
  unbonding_fee: number;
  max_staking_amount: number;
  min_staking_amount: number;
  max_staking_time: number;
  min_staking_time: number;
  confirmation_depth: number;
}

export interface BabylonFinalityProvider {
  btc_pk: string;
  description: {
    moniker: string;
    identity?: string;
    website?: string;
    security_contact?: string;
    details?: string;
  };
  commission: string;
  active_tvl: number;
  total_tvl?: number;
  active_delegations: number;
  total_delegations?: number;
  logo_url?: string;
}

export interface BabylonDelegation {
  staking_tx_hash_hex: string;
  staker_pk_hex: string;
  finality_provider_pk_hex: string;
  state: 'pending' | 'active' | 'unbonding_requested' | 'unbonding' | 'withdrawable' | 'withdrawn' | 'slashed';
  staking_value: number;
  staking_tx: {
    start_height: number;
    start_timestamp: string;
    timelock: number;
    output_index: number;
  };
  unbonding_tx?: {
    timelock: number;
  };
  is_overflow: boolean;
}

export interface BabylonStats {
  total_tvl: number;
  active_tvl: number;
  total_delegations: number;
  active_delegations: number;
  total_stakers: number;
  active_stakers?: number;
  total_finality_providers: number;
  active_finality_providers: number;
  unconfirmed_tvl?: number;
  pending_tvl?: number;
  btc_price_usd?: number;
  btc_staking_apr?: number;
}

// ── v2 state → our state mapping ─────────────────────────────────────────────

function mapDelegationState(v2State: string): BabylonDelegation['state'] {
  const s = (v2State || '').toUpperCase();
  if (s === 'ACTIVE') return 'active';
  if (s === 'PENDING' || s === 'VERIFIED') return 'pending';
  if (s === 'EARLY_UNBONDING' || s === 'TIMELOCK_UNBONDING') return 'unbonding';
  if (s.includes('WITHDRAWABLE')) return 'withdrawable';
  if (s.includes('WITHDRAWN')) return 'withdrawn';
  if (s === 'SLASHED') return 'slashed';
  return 'pending';
}

// ── API class ─────────────────────────────────────────────────────────────────

class BabylonApi {
  private baseUrl(isTestnet: boolean): string {
    return isTestnet ? TESTNET_BASE : MAINNET_BASE;
  }

  /**
   * GET /v2/network-info  (replaces v1/global-params)
   * Maps BbnStakingParams[] → BabylonParamVersion[] to keep components stable.
   */
  async getGlobalParams(isTestnet = false): Promise<BabylonGlobalParams> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/v2/network-info`);
    const payload = data?.data ?? data;
    const bbnParams: any[] = payload?.params?.bbn ?? [];
    const btcParams: any[] = payload?.params?.btc ?? [];

    const versions: BabylonParamVersion[] = bbnParams.map((p: any) => {
      const btcP = btcParams.find((b: any) => b.version === p.version) ?? btcParams[0] ?? {};
      return {
        version: p.version ?? 0,
        activation_height: p.btc_activation_height ?? 0,
        staking_cap: 0,
        tag: '',
        covenant_pks: p.covenant_pks ?? [],
        covenant_quorum: p.covenant_quorum ?? 0,
        unbonding_time: p.unbonding_time_blocks ?? 0,
        unbonding_fee: p.unbonding_fee_sat ?? 0,
        max_staking_amount: p.max_staking_value_sat ?? 0,
        min_staking_amount: p.min_staking_value_sat ?? 0,
        max_staking_time: p.max_staking_time_blocks ?? 0,
        min_staking_time: p.min_staking_time_blocks ?? 0,
        confirmation_depth: btcP.btc_confirmation_depth ?? 6,
      };
    });

    return { versions };
  }

  /**
   * GET /v2/finality-providers
   */
  async getFinalityProviders(isTestnet = false, paginationKey = ''): Promise<{ data: BabylonFinalityProvider[]; pagination: { next_key: string } }> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/v2/finality-providers`, {
      params: { pagination_key: paginationKey || undefined }
    });
    return {
      data: data?.data ?? [],
      pagination: data?.pagination ?? { next_key: '' },
    };
  }

  /**
   * GET /v2/delegations  (replaces v1/staker/delegations)
   * Maps DelegationPublic[] → BabylonDelegation[] to keep components stable.
   */
  async getStakerDelegations(stakerBtcPk: string, isTestnet = false): Promise<{ data: BabylonDelegation[]; pagination: { next_key: string } }> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/v2/delegations`, {
      params: { staker_pk_hex: stakerBtcPk }
    });

    const raw: any[] = data?.data ?? [];
    const mapped: BabylonDelegation[] = raw.map((d: any) => ({
      staking_tx_hash_hex: d.delegation_staking?.staking_tx_hash_hex ?? '',
      staker_pk_hex: d.staker_btc_pk_hex ?? '',
      finality_provider_pk_hex: d.finality_provider_btc_pks_hex?.[0] ?? '',
      state: mapDelegationState(d.state),
      staking_value: d.delegation_staking?.staking_amount ?? 0,
      staking_tx: {
        start_height: d.delegation_staking?.start_height ?? 0,
        start_timestamp: d.delegation_staking?.bbn_inception_time ?? '',
        timelock: d.delegation_staking?.staking_timelock ?? 0,
        output_index: d.delegation_staking?.staking_output_idx ?? 0,
      },
      is_overflow: false,
    }));

    return { data: mapped, pagination: data?.pagination ?? { next_key: '' } };
  }

  /**
   * GET /v2/stats
   * Maps v2 field names back to our BabylonStats interface.
   */
  async getStats(isTestnet = false): Promise<BabylonStats> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/v2/stats`);
    const s = data?.data ?? data ?? {};
    return {
      total_tvl: s.total_active_tvl ?? 0,
      active_tvl: s.active_tvl ?? 0,
      total_delegations: s.total_active_delegations ?? 0,
      active_delegations: s.active_delegations ?? 0,
      total_stakers: 0,
      active_finality_providers: s.active_finality_providers ?? 0,
      total_finality_providers: s.total_finality_providers ?? 0,
      btc_staking_apr: s.btc_staking_apr,
    };
  }

  /** Format satoshis to BTC string */
  formatBtc(sats: number): string {
    return (sats / 1e8).toFixed(8);
  }

  /** Format unbonding time in blocks to approximate days (assuming ~10 min/block) */
  formatUnbondingDays(blocks: number): string {
    const days = Math.round((blocks * 10) / 60 / 24);
    return `~${days} days`;
  }
}

export const babylonApi = new BabylonApi();
export default babylonApi;