import { ref, computed } from 'vue';
import { strikeVaultApi } from '@/api/strike-v2.vaults';
import type {
  VaultInfo,
  VaultListResponse,
  VaultPortfolioResponse,
  VaultDepositor,
  UserVaultPosition,
  VaultPeriod,
} from '@/api/strike-v2.types';

// ---------------------------------------------------------------------------
// Singleton state — shared across all component instances in the same context.
// Only one vault list fetch should be in flight at a time.
// ---------------------------------------------------------------------------

const vaults = ref<VaultInfo[]>([]);
const totalCount = ref(0);
const userPositions = ref<UserVaultPosition[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

/** Vaults with status === 'active'. */
const activeVaults = computed(() =>
  vaults.value.filter((v) => v.status === 'active')
);

/** Vaults that have been verified by Strike. */
const verifiedVaults = computed(() =>
  vaults.value.filter((v) => v.is_verified)
);

/** Sum of current_value across all user vault positions (USD). */
const totalVaultEquity = computed(() =>
  userPositions.value.reduce((sum, p) => sum + parseFloat(p.current_value ?? '0'), 0)
);

/** Sum of pnl across all user vault positions (USD). */
const totalVaultPnl = computed(() =>
  userPositions.value.reduce((sum, p) => sum + parseFloat(p.pnl ?? '0'), 0)
);

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/**
 * Load the public vault list.
 *
 * Defaults to fetching up to 50 active vaults. Pass additional params to
 * filter by type, verification status, or pagination offset.
 */
async function loadVaults(params: Parameters<typeof strikeVaultApi.listVaults>[0] = {}): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const merged = { limit: 50, status: 'active' as const, ...params };
    const result: VaultListResponse = await strikeVaultApi.listVaults(merged);
    vaults.value = result.vaults ?? [];
    totalCount.value = result.count ?? 0;
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

/**
 * Load all vault positions for the currently authenticated user.
 *
 * Requires the user to be logged in to Strike (Ed25519 auth headers present
 * on the authenticated client).
 */
async function loadUserPositions(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    const result = await strikeVaultApi.getAllUserVaultPositions();
    // The API returns either an array or an object with a positions field.
    userPositions.value = Array.isArray(result)
      ? (result as UserVaultPosition[])
      : ((result as any)?.positions ?? []);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

/**
 * Fetch a single vault by ID.
 *
 * @param id - The vault's unique identifier.
 * @returns The VaultInfo record, or null if the request fails.
 */
async function getVaultDetail(id: string): Promise<VaultInfo | null> {
  error.value = null;

  try {
    return await strikeVaultApi.getVault(id);
  } catch (e: any) {
    error.value = e.message;
    return null;
  }
}

/**
 * Fetch a vault's performance data and time-series history.
 *
 * @param id     - The vault's unique identifier.
 * @param period - Time window for the portfolio history. Defaults to '30d'.
 * @returns The VaultPortfolioResponse, or null if the request fails.
 */
async function getVaultPortfolio(id: string, period: VaultPeriod = '30d'): Promise<VaultPortfolioResponse | null> {
  error.value = null;

  try {
    return await strikeVaultApi.getVaultPortfolio(id, period);
  } catch (e: any) {
    error.value = e.message;
    return null;
  }
}

/**
 * Fetch the list of depositors for a given vault.
 *
 * @param id     - The vault's unique identifier.
 * @param params - Optional pagination params (limit, offset).
 * @returns Array of VaultDepositor records, or an empty array on failure.
 */
async function getVaultDepositors(id: string, params: { limit?: number; offset?: number } = {}): Promise<VaultDepositor[]> {
  error.value = null;

  try {
    const result = await strikeVaultApi.getVaultDepositors(id, params);
    return Array.isArray(result)
      ? (result as VaultDepositor[])
      : ((result as any)?.depositors ?? []);
  } catch (e: any) {
    error.value = e.message;
    return [];
  }
}

/**
 * Fetch the authenticated user's position in a specific vault.
 *
 * @param vaultId - The vault's unique identifier.
 * @returns The UserVaultPosition record, or null if the request fails.
 */
async function getUserPosition(vaultId: string): Promise<UserVaultPosition | null> {
  error.value = null;

  try {
    return await strikeVaultApi.getUserVaultPosition(vaultId);
  } catch (e: any) {
    error.value = e.message;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Composable export
// ---------------------------------------------------------------------------

/**
 * Composable for browsing Strike Finance vaults and reading the user's vault
 * positions.
 *
 * Follows the singleton pattern — all callers share the same reactive state.
 * Call `loadVaults()` to populate the public vault list and
 * `loadUserPositions()` (after authentication) to populate position data.
 */
export function useStrikeVaults() {
  return {
    // State
    vaults,
    totalCount,
    userPositions,
    loading,
    error,
    // Computed
    activeVaults,
    verifiedVaults,
    totalVaultEquity,
    totalVaultPnl,
    // Methods
    loadVaults,
    loadUserPositions,
    getVaultDetail,
    getVaultPortfolio,
    getVaultDepositors,
    getUserPosition,
  };
}
