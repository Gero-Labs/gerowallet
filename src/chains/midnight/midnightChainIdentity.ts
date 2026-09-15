import type { MidnightNetworkEndpoints } from './midnightConfig';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';

export interface MidnightChainIdentity {
  network: string;
  chain_generation: number;
  genesis_hash: string;
}

async function authenticatedGet(url: string): Promise<Response> {
  const attempt = async (token: string) => fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  let response = await attempt(await getNexusAccessToken());
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    response = await attempt(await reauthenticateNexus());
  }
  return response;
}

/** A saved identity alone cannot detect an indexer reset while purge is disabled. */
export async function readVerifiedMidnightChainIdentity(
  endpoints: MidnightNetworkEndpoints,
): Promise<MidnightChainIdentity> {
  const network = `midnight-${endpoints.sdkNetworkId}`;
  const response = await authenticatedGet(`${endpoints.nexusBaseUrl}/api/midnight/${network}/chain-identity`);
  if (!response.ok) throw new Error('Midnight chain identity is unavailable; synchronization or reset recovery is required');
  const identity: MidnightChainIdentity = await response.json();
  if (identity.network !== network || !Number.isSafeInteger(identity.chain_generation)
    || identity.chain_generation < 1 || !/^0x[0-9a-fA-F]{64}$/.test(identity.genesis_hash)) {
    throw new Error('Invalid Midnight chain identity');
  }
  const indexer = await fetch(endpoints.publicIndexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ block(offset: { height: 0 }) { hash } }' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!indexer.ok) throw new Error('Cannot verify Midnight indexer genesis');
  const body = await indexer.json();
  const hash = body?.data?.block?.hash;
  if (body.errors?.length || typeof hash !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error('Cannot verify Midnight indexer genesis');
  }
  if (hash.replace(/^0x/, '').toLowerCase() !== identity.genesis_hash.slice(2).toLowerCase()) {
    throw new Error('Midnight chain reset detected; server reset recovery is required before sending');
  }
  return { ...identity, genesis_hash: identity.genesis_hash.toLowerCase() };
}

export function midnightCheckpointNamespace(identity: MidnightChainIdentity): string {
  return `${identity.network}-ledger9-rc3-${identity.genesis_hash}-${identity.chain_generation}`;
}

export async function assertMidnightChainIdentityUnchanged(
  endpoints: MidnightNetworkEndpoints,
  expected: MidnightChainIdentity,
): Promise<void> {
  const current = await readVerifiedMidnightChainIdentity(endpoints);
  if (current.network !== expected.network || current.chain_generation !== expected.chain_generation
    || current.genesis_hash !== expected.genesis_hash) {
    throw new Error('Midnight chain changed during transaction preparation; retry after synchronization');
  }
}

/** Snapshots are optional accelerators; unverified or incompatible state is never restored. */
export async function fetchLedger9DustSnapshot(
  endpoints: MidnightNetworkEndpoints,
  identity: MidnightChainIdentity,
  registeredAt: Date,
): Promise<string | null> {
  if (!Number.isFinite(registeredAt.getTime())) return null;
  try {
    const response = await authenticatedGet(`${endpoints.nexusBaseUrl}/api/midnight/${identity.network}`
      + `/dust/state-snapshot?registeredAt=${encodeURIComponent(registeredAt.toISOString())}`);
    if (!response.ok) return null;
    const body = await response.json();
    if (body.chain_generation !== identity.chain_generation || body.genesis_hash?.toLowerCase() !== identity.genesis_hash
      || body.sdk_version !== 'dust-wallet@5.0.0-beta.2/ledger-v9@1.0.0-rc.3'
      || typeof body.serialized_state !== 'string' || !body.serialized_state
      || !Number.isFinite(body.chain_time_ms) || body.chain_time_ms < 0 || body.chain_time_ms > registeredAt.getTime()) return null;
    return body.serialized_state;
  } catch { return null; }
}
