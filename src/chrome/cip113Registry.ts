/**
 * Which token policies the CIP-113 registry lists, per network (issue 1267).
 *
 * A UTxO at the shared programmable-logic-base address can hold any token: paying into a
 * script runs no validator. So only a policy the deployment's registry lists is shown as a
 * CIP-113 token; anything else at that address is an ordinary unverified token (still locked,
 * still refused for signing). The registry is read through the backend's Nexus proxy (see
 * cip113-registry-api.ts) and kept in `chrome.storage.local` under REGISTRY_CACHE_KEY: a few
 * dozen 56-character ids, far from the multi-MB values CLAUDE.md warns about.
 *
 * The registry only ever grows (nodes are never removed), so a cached copy can only be MISSING
 * a policy registered since it was read, never list one that is not registered. A stale copy
 * therefore shows a newly registered token as unverified for a while, and never a spam token
 * as CIP-113. Until the registry has been read at all, nothing counts as registered. A policy
 * the copy was never asked about is asked about at once, so a token that arrives just after
 * its registration is not held back by the copy's age.
 */
import { fetchAllPolicyAssets, type PolicyAssetRow } from '@/api/cip113-registry-api';
import { debugLog } from '@/utils/debug';

export const REGISTRY_CACHE_KEY = 'cip113Registry';
/** Re-read at least this often. */
export const REGISTRY_REFRESH_MS = 6 * 60 * 60 * 1000;
/** A held policy the cached copy doesn't list is asked about again after this long. */
export const REGISTRY_MISS_RETRY_MS = 10 * 60 * 1000;
/** After a failed read, wait this long before asking Nexus again. */
export const REGISTRY_FAILURE_RETRY_MS = 60 * 1000;

interface CachedRegistry {
  /** The registry policies this copy was read from; a different configuration ignores it. */
  registryIds: string[];
  policies: string[];
  /** The held policies this copy was read for: registered or not as of `fetchedAt`. */
  checked?: string[];
  fetchedAt: number;
}
type RegistryCache = Record<string, CachedRegistry>;

/** The registered policies the rows of registry policy `registryId` name. */
export function registeredPoliciesFromAssets(rows: readonly PolicyAssetRow[], registryId: string): string[] {
  const registry = registryId.toLowerCase();
  const policies = new Set<string>();
  for (const row of rows) {
    if ((row.policyId ?? '').toLowerCase() !== registry) continue;
    const name = (row.assetName ?? '').toLowerCase();
    // The origin node is nameless; every other node is named after a 28-byte policy id.
    if (!/^[0-9a-f]{56}$/.test(name)) continue;
    let quantity = 0n;
    try {
      quantity = BigInt(row.quantity ?? '0');
    } catch {
      quantity = 0n;
    }
    if (quantity > 0n) policies.add(name);
  }
  return [...policies];
}

function configKey(registryIds: readonly string[]): string {
  return registryIds.map((id) => id.toLowerCase()).sort().join(',');
}

async function readCache(network: string, registryIds: readonly string[]): Promise<CachedRegistry | null> {
  try {
    const stored = (await chrome.storage.local.get(REGISTRY_CACHE_KEY))?.[REGISTRY_CACHE_KEY] as RegistryCache | undefined;
    const entry = stored?.[network];
    if (!entry || !Array.isArray(entry.policies) || configKey(entry.registryIds ?? []) !== configKey(registryIds)) return null;
    return entry;
  } catch {
    return null;
  }
}

async function writeCache(network: string, entry: CachedRegistry): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(REGISTRY_CACHE_KEY))?.[REGISTRY_CACHE_KEY] as RegistryCache | undefined;
    await chrome.storage.local.set({ [REGISTRY_CACHE_KEY]: { ...(stored ?? {}), [network]: entry } });
  } catch (e) {
    debugLog('CIP-113: could not cache the registry', e);
  }
}

const inFlight = new Map<string, Promise<ReadonlySet<string> | null>>();
/** When a read last failed, per network and registry. In memory: a restart may ask at once. */
const lastFailure = new Map<string, number>();

/**
 * The registered policies on `network`, or null while the registry has never been read and
 * cannot be read now. Asks Nexus when one of `held` is missing from the cached copy and was not
 * asked about when it was read, when the copy is older than REGISTRY_MISS_RETRY_MS while one of
 * `held` is missing from it, or when it is older than REGISTRY_REFRESH_MS. Otherwise, and
 * whenever a read fails or another failed under REGISTRY_FAILURE_RETRY_MS ago, the cached copy
 * answers.
 */
export async function readCip113Registry(
  network: string,
  registryIds: readonly string[],
  held: readonly string[],
  now: () => number = Date.now,
): Promise<ReadonlySet<string> | null> {
  if (registryIds.length === 0) return new Set();
  const heldPolicies = held.map((policy) => policy.toLowerCase());
  const cached = await readCache(network, registryIds);
  const key = `${network}|${configKey(registryIds)}`;
  if (cached) {
    const age = now() - cached.fetchedAt;
    const known = new Set(cached.policies);
    const checked = new Set(cached.checked ?? []);
    const missing = heldPolicies.filter((policy) => !known.has(policy));
    const unasked = missing.some((policy) => !checked.has(policy));
    const fresh = missing.length === 0 ? age < REGISTRY_REFRESH_MS : !unasked && age < REGISTRY_MISS_RETRY_MS;
    if (fresh || now() - (lastFailure.get(key) ?? -Infinity) < REGISTRY_FAILURE_RETRY_MS) return known;
  } else if (now() - (lastFailure.get(key) ?? -Infinity) < REGISTRY_FAILURE_RETRY_MS) {
    return null;
  }

  const pending = inFlight.get(key);
  if (pending) return pending;
  const read = (async (): Promise<ReadonlySet<string> | null> => {
    try {
      const policies = new Set<string>();
      for (const registryId of registryIds) {
        const rows = await fetchAllPolicyAssets(network, registryId);
        registeredPoliciesFromAssets(rows, registryId).forEach((policy) => policies.add(policy));
      }
      lastFailure.delete(key);
      await writeCache(network, {
        registryIds: [...registryIds],
        policies: [...policies],
        checked: [...new Set(heldPolicies)],
        fetchedAt: now(),
      });
      return policies;
    } catch (e) {
      lastFailure.set(key, now());
      debugLog('CIP-113: registry read failed; keeping the last copy', e);
      return cached ? new Set(cached.policies) : null;
    }
  })();
  inFlight.set(key, read);
  try {
    return await read;
  } finally {
    inFlight.delete(key);
  }
}
