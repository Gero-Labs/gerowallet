/**
 * DEX-sourced token metadata — the fallback when the Cardano token registry has
 * nothing.
 *
 * `/api/assets/info` resolves `metadata` from the Cardano Foundation token registry,
 * which is MAINNET-ONLY. Any asset not listed there — everything on a testnet, and
 * every mainnet token during the window between launch and registration — comes back
 * with `metadata: null`, and the wallet then has no decimals. A 6dp balance rendered
 * at 0dp is a million times too large, which is worse than showing nothing.
 *
 * The DEXes maintain their own asset lists covering both mainnet and preprod, so they
 * fill that gap. See gerowallet issue 1003.
 *
 * SCOPE, deliberately narrow: this supplies DISPLAY facts only — decimals, ticker,
 * name. It must never influence `verified`. That flag exists to keep scam airdrops
 * out of the holdings list, and a DEX listing is not the same assurance as registry
 * curation. Minswap even returns `is_verified: false` alongside perfectly good
 * decimals, which is exactly the distinction being preserved here.
 */

import axios from 'axios';
import { debugLog } from '@/utils/debug';

export interface DexAssetMetadata {
  decimals: number;
  ticker?: string;
  name?: string;
}

/** Per-network hosts. Minswap has no preview deployment; Sundae covers all three. */
const MINSWAP_HOSTS: Record<string, string> = {
  Mainnet: 'https://api-mainnet-prod.minswap.org',
  Preprod: 'https://api-preprod.minswap.org',
};

const SUNDAE_HOSTS: Record<string, string> = {
  Mainnet: 'https://api.sundae.fi/graphql',
  Preprod: 'https://api.preprod.sundae.fi/graphql',
  Preview: 'https://api.preview.sundae.fi/graphql',
};

const REQUEST_TIMEOUT_MS = 8000;

/**
 * Sundae keys assets by the DOTTED `policyId.assetName`; the wallet uses Cardano
 * Core's concatenated form. Policy IDs are always 56 hex chars, so the split is
 * unambiguous.
 */
function toDottedAssetId(unit: string): string | null {
  if (!unit || unit.length < 56) return null;
  return `${unit.slice(0, 56)}.${unit.slice(56)}`;
}

function toDecimals(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Minswap. Accepts either asset-id form on this route; returns richer data. */
async function fromMinswap(unit: string, network: string): Promise<DexAssetMetadata | null> {
  const host = MINSWAP_HOSTS[network];
  if (!host) return null;
  try {
    const { data } = await axios.get(`${host}/v1/assets/${unit}/metrics`, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const metadata = data?.asset?.metadata;
    const decimals = toDecimals(metadata?.decimals);
    if (decimals === null) return null;
    return { decimals, ticker: metadata?.ticker, name: metadata?.name };
  } catch {
    return null;
  }
}

/** SundaeSwap. Backstop — fewer fields, but it covers preview too. */
async function fromSundae(unit: string, network: string): Promise<DexAssetMetadata | null> {
  const endpoint = SUNDAE_HOSTS[network];
  const assetId = toDottedAssetId(unit);
  if (!endpoint || !assetId) return null;
  try {
    const { data } = await axios.post(
      endpoint,
      {
        query: 'query($id:ID!){ assets { byId(id:$id) { assetName decimals ticker } } }',
        variables: { id: assetId },
      },
      { timeout: REQUEST_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } },
    );
    const asset = data?.data?.assets?.byId;
    const decimals = toDecimals(asset?.decimals);
    if (decimals === null) return null;
    return { decimals, ticker: asset?.ticker, name: asset?.assetName };
  } catch {
    return null;
  }
}

/**
 * Best-effort metadata for one asset. Minswap first (richer), Sundae as backstop.
 * Returns null rather than throwing — a missing decimal is a display degradation,
 * never a reason to fail a sync.
 */
export async function fetchDexAssetMetadata(
  unit: string,
  network: string,
): Promise<DexAssetMetadata | null> {
  return (await fromMinswap(unit, network)) ?? (await fromSundae(unit, network));
}

/**
 * Resolve several assets, bounded so a wallet holding many unregistered tokens does
 * not open dozens of sockets at once.
 */
export async function fetchDexAssetMetadataBatch(
  units: string[],
  network: string,
  concurrency = 4,
): Promise<Record<string, DexAssetMetadata>> {
  const out: Record<string, DexAssetMetadata> = {};
  const queue = [...units];

  async function worker(): Promise<void> {
    for (let unit = queue.shift(); unit; unit = queue.shift()) {
      const found = await fetchDexAssetMetadata(unit, network);
      if (found) out[unit] = found;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, units.length) }, worker));
  if (units.length > 0) {
    debugLog(`🔬 dexRegistry: resolved ${Object.keys(out).length}/${units.length} on ${network}`);
  }
  return out;
}
