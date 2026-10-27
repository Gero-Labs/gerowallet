import axios from 'axios';
import { toNexusNetwork } from '@/api/nexus-tx-api';

/**
 * Reads the CIP-113 token registry through the backend's Nexus proxy (issue 1267).
 *
 * Every registered programmable-token policy has a node NFT minted under the registry's
 * policy and named after the registered policy id, so Nexus's asset list for the registry
 * policy (`GET /api/policy/{policyId}/assets`) lists the registered policies. See
 * cip113Deployments.ts for why that holds.
 */

/** One row of Nexus's `PolicyAssetDto`. */
export interface PolicyAssetRow {
  policyId?: string;
  assetName?: string;
  quantity?: string;
}

/** Nexus's largest page. A shorter page is the last one. */
export const REGISTRY_PAGE_SIZE = 100;
/** Stop after this many pages (10,000 registered tokens) rather than walk an endless list. */
export const REGISTRY_MAX_PAGES = 100;

const registryClient = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

/** One page of assets minted under `policyId`. Throws on any failure or malformed body. */
export async function fetchPolicyAssetsPage(
  network: string,
  policyId: string,
  page: number,
): Promise<PolicyAssetRow[]> {
  const { data } = await registryClient.get(`/api/policy/${encodeURIComponent(policyId)}/assets`, {
    params: { network: toNexusNetwork(network), page, pageSize: REGISTRY_PAGE_SIZE },
  });
  if (!Array.isArray(data)) throw new Error('Malformed CIP-113 registry page');
  return data as PolicyAssetRow[];
}

/** Every asset minted under `policyId`, page by page. Throws if any page fails. */
export async function fetchAllPolicyAssets(network: string, policyId: string): Promise<PolicyAssetRow[]> {
  const rows: PolicyAssetRow[] = [];
  for (let page = 1; page <= REGISTRY_MAX_PAGES; page += 1) {
    const batch = await fetchPolicyAssetsPage(network, policyId, page);
    rows.push(...batch);
    if (batch.length < REGISTRY_PAGE_SIZE) break;
  }
  return rows;
}
