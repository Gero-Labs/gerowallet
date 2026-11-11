/**
 * Which ledger a Midnight chain runs, read from the chain itself.
 *
 * A network can change ledger without changing its name (preprod moved to
 * ledger 9 in place), so nothing chooses a ledger from the network name. The
 * indexer the wallet already syncs from answers with the protocol version of
 * its tip and of its first block; `ledgerForProtocolVersion` maps them.
 */
import { getMidnightEndpoints, type MidnightNetworkEndpoints } from './midnightConfig';
import { withMidnightAbort } from './midnightAbort';
import {
  MidnightLedgerUnknownError, midnightLedgerKey, noteMidnightProtocolVersion, observedMidnightChain, requireMidnightLedger8,
  type MidnightChainLedger, type MidnightLedger,
} from './midnightLedger';

/** A read this recent is reused. A chain changes ledger once, at a governance-scheduled upgrade. */
export const MIDNIGHT_LEDGER_FRESH_MS = 60_000;

/** One query, two answers: the tip's protocol version and the first block's. */
export const MIDNIGHT_LEDGER_QUERY = '{ tip: block { protocolVersion } genesis: block(offset: { height: 0 }) { protocolVersion } }';

const inFlight = new Map<string, Promise<MidnightChainLedger>>();

function protocolVersionOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Midnight protocol version');
  return value;
}

/** Read the chain's ledger from `endpoints`' indexer and record it. */
export async function readMidnightChainLedger(
  endpoints: Pick<MidnightNetworkEndpoints, 'publicIndexerUrl' | 'sdkNetworkId'>,
  signal?: AbortSignal,
): Promise<MidnightChainLedger> {
  const timeout = AbortSignal.timeout(30_000);
  const response = await withMidnightAbort(fetch(endpoints.publicIndexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: MIDNIGHT_LEDGER_QUERY }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }), signal);
  if (!response.ok) throw new MidnightLedgerUnknownError(endpoints.sdkNetworkId);
  let body: { data?: { tip?: { protocolVersion?: unknown }; genesis?: { protocolVersion?: unknown } }; errors?: unknown[] };
  try { body = await response.json(); } catch { throw new MidnightLedgerUnknownError(endpoints.sdkNetworkId); }
  try {
    if (body?.errors?.length) throw new Error('indexer error');
    const tip = protocolVersionOf(body?.data?.tip?.protocolVersion);
    const genesis = body?.data?.genesis ? protocolVersionOf(body.data.genesis.protocolVersion) : undefined;
    return noteMidnightProtocolVersion(endpoints.sdkNetworkId, tip, genesis);
  } catch {
    throw new MidnightLedgerUnknownError(endpoints.sdkNetworkId);
  }
}

/** The endpoints of `network` in any spelling the wallet uses (`Preprod`, `preprod`, `midnight-preprod`). */
export function midnightEndpointsFor(network: string): MidnightNetworkEndpoints | undefined {
  const direct = getMidnightEndpoints(network);
  if (direct) return direct;
  const key = midnightLedgerKey(network);
  for (const name of ['Mainnet', 'Preprod', 'Preview', 'Stagenet']) {
    const endpoints = getMidnightEndpoints(name);
    if (endpoints?.sdkNetworkId === key) return endpoints;
  }
  return undefined;
}

/**
 * The chain's ledger for `network`, read when the last read is older than
 * {@link MIDNIGHT_LEDGER_FRESH_MS} (or `maxAgeMs`). Fails closed: a network
 * the wallet has no endpoints for, or a failed read, throws
 * `MidnightLedgerUnknownError`. Concurrent callers share one read.
 */
export async function resolveMidnightChain(
  network: string,
  options: { signal?: AbortSignal; maxAgeMs?: number } = {},
): Promise<MidnightChainLedger> {
  const known = observedMidnightChain(network);
  const maxAge = options.maxAgeMs ?? MIDNIGHT_LEDGER_FRESH_MS;
  if (known && Date.now() - known.observedAt < maxAge && known.bornOnLedger9 !== undefined) return known;
  const endpoints = midnightEndpointsFor(network);
  if (!endpoints) throw new MidnightLedgerUnknownError(network);
  const key = midnightLedgerKey(network);
  const running = inFlight.get(key);
  if (running) return withMidnightAbort(running, options.signal);
  // The shared read is not tied to one caller's signal; each caller can stop waiting.
  const read = readMidnightChainLedger(endpoints).finally(() => inFlight.delete(key));
  inFlight.set(key, read);
  return withMidnightAbort(read, options.signal);
}

/** {@link resolveMidnightChain}'s ledger. */
export async function resolveMidnightLedger(
  network: string,
  options: { signal?: AbortSignal; maxAgeMs?: number } = {},
): Promise<MidnightLedger> {
  return (await resolveMidnightChain(network, options)).ledger;
}

/** Throws unless `network`'s chain runs ledger 8, read from the chain. For the ledger 8 paths. */
export async function requireChainLedger8(network: string, operation: string): Promise<void> {
  await resolveMidnightLedger(network);
  requireMidnightLedger8(network, operation);
}
