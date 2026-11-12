import type { MidnightNetworkEndpoints } from './midnightConfig';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { withMidnightAbort } from './midnightAbort';
import { geroClientHeaders } from './midnightClientVersion';

export interface MidnightChainIdentity {
  network: string;
  chain_generation: number;
  genesis_hash: string;
}

async function authenticatedGet(url: string, signal?: AbortSignal): Promise<Response> {
  const attempt = async (token: string) => fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...geroClientHeaders() },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  let response = await attempt(await withMidnightAbort(getNexusAccessToken(), signal));
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    response = await attempt(await withMidnightAbort(reauthenticateNexus(), signal));
  }
  return response;
}

/** A saved identity alone cannot detect an indexer reset while purge is disabled. */
export async function readVerifiedMidnightChainIdentity(
  endpoints: MidnightNetworkEndpoints,
  signal?: AbortSignal,
): Promise<MidnightChainIdentity> {
  const network = `midnight-${endpoints.sdkNetworkId}`;
  const response = await authenticatedGet(`${endpoints.nexusBaseUrl}/api/midnight/${network}/chain-identity`, signal);
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
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
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

/**
 * Checkpoints written by one wallet SDK cannot be restored by another, so the
 * SDK line is part of the key: wallet SDK 2.0.0 (`sdk2`) never sees a beta
 * checkpoint. `clearMidnightNetworkCheckpoints` removes every `-ledger9-` key.
 */
export function midnightCheckpointNamespace(identity: MidnightChainIdentity): string {
  return `${identity.network}-ledger9-sdk2-${identity.genesis_hash}-${identity.chain_generation}`;
}

export async function assertMidnightChainIdentityUnchanged(
  endpoints: MidnightNetworkEndpoints,
  expected: MidnightChainIdentity,
  signal?: AbortSignal,
): Promise<void> {
  const current = await readVerifiedMidnightChainIdentity(endpoints, signal);
  if (current.network !== expected.network || current.chain_generation !== expected.chain_generation
    || current.genesis_hash !== expected.genesis_hash) {
    throw new Error('Midnight chain changed during transaction preparation; retry after synchronization');
  }
}
