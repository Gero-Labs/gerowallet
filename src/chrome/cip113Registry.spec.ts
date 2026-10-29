// Issue 1267: only a policy the CIP-113 registry lists is shown as a CIP-113 token. These
// cover how the registry is read, cached and refreshed, and that it fails closed.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ fetch: vi.fn(), storage: {} as Record<string, unknown> }));
vi.mock('@/api/cip113-registry-api', () => ({ fetchAllPolicyAssets: env.fetch }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

import {
  REGISTRY_CACHE_KEY,
  REGISTRY_FAILURE_RETRY_MS,
  REGISTRY_MISS_RETRY_MS,
  REGISTRY_REFRESH_MS,
  readCip113Registry,
  registeredPoliciesFromAssets,
} from './cip113Registry';

const REGISTRY = 'e5b339ef5b16d6c460759aca1d60e5e045a6f01da4a11b4ee0fec09a';
const POLICY_A = 'a'.repeat(56);
const POLICY_B = 'b'.repeat(56);
const node = (assetName: string, quantity = '1', policyId = REGISTRY) => ({ policyId, assetName, quantity });

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: env.storage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(env.storage, items); }),
    },
  },
};

let now = 1_000_000;
const clock = () => now;

beforeEach(() => {
  env.storage = {};
  env.fetch.mockReset().mockResolvedValue([node(''), node(POLICY_A)]);
  now += 10 * REGISTRY_REFRESH_MS; // past any back-off an earlier test left in the module
});

describe('registeredPoliciesFromAssets', () => {
  it('reads the registered policies off the registry\'s node NFTs', () => {
    expect(registeredPoliciesFromAssets([
      node(''), // the origin node, nameless
      node(POLICY_A.toUpperCase()),
      node(POLICY_B, '0'), // burned: never registered
      node('c'.repeat(56), '1', 'f'.repeat(56)), // another policy's asset
      node('abcd'), // not a policy id
    ], REGISTRY)).toEqual([POLICY_A]);
  });
});

describe('readCip113Registry', () => {
  it('reads Nexus and keeps a copy', async () => {
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock)).toEqual(new Set([POLICY_A]));
    expect(env.fetch).toHaveBeenCalledWith('Preview', REGISTRY);
    expect(env.storage[REGISTRY_CACHE_KEY]).toEqual({
      Preview: { registryIds: [REGISTRY], policies: [POLICY_A], checked: [POLICY_A], fetchedAt: now },
    });
  });

  it('answers from its copy while it is fresh and lists every held policy', async () => {
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);
    now += REGISTRY_REFRESH_MS - 1;

    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock)).toEqual(new Set([POLICY_A]));
    expect(env.fetch).toHaveBeenCalledTimes(1);
  });

  it('asks at once about a held policy its copy was never asked about, so a new registration shows up', async () => {
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);
    env.fetch.mockResolvedValue([node(''), node(POLICY_A), node(POLICY_B)]);
    now += 1;

    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A, POLICY_B], clock)).toEqual(new Set([POLICY_A, POLICY_B]));
    expect(env.fetch).toHaveBeenCalledTimes(2);
  });

  it('asks again only after a while about a held policy it did not list', async () => {
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A, POLICY_B], clock);
    env.fetch.mockResolvedValue([node(''), node(POLICY_A), node(POLICY_B)]);

    now += REGISTRY_MISS_RETRY_MS - 1;
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A, POLICY_B], clock)).toEqual(new Set([POLICY_A]));
    expect(env.fetch).toHaveBeenCalledTimes(1);

    now += 1;
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A, POLICY_B], clock)).toEqual(new Set([POLICY_A, POLICY_B]));
    expect(env.fetch).toHaveBeenCalledTimes(2);
  });

  it('re-reads an old copy even when it lists everything held', async () => {
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);
    now += REGISTRY_REFRESH_MS;

    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);
    expect(env.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps its last copy when Nexus fails, and says nothing when it has none', async () => {
    env.fetch.mockRejectedValueOnce(new Error('HTTP 404'));
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock)).toBeNull();

    now += REGISTRY_FAILURE_RETRY_MS;
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);
    now += REGISTRY_REFRESH_MS;
    env.fetch.mockRejectedValueOnce(new Error('HTTP 502'));
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock)).toEqual(new Set([POLICY_A]));
  });

  it('waits a minute after a failed read before asking again', async () => {
    env.fetch.mockRejectedValueOnce(new Error('HTTP 404'));
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);

    now += REGISTRY_FAILURE_RETRY_MS - 1;
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock)).toBeNull();
    expect(env.fetch).toHaveBeenCalledTimes(1);

    now += 1;
    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock)).toEqual(new Set([POLICY_A]));
    expect(env.fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a copy read from a different registry', async () => {
    env.storage[REGISTRY_CACHE_KEY] = { Preview: { registryIds: ['f'.repeat(56)], policies: [POLICY_B], fetchedAt: now } };

    expect(await readCip113Registry('Preview', [REGISTRY], [POLICY_B], clock)).toEqual(new Set([POLICY_A]));
    expect(env.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps one copy per network', async () => {
    await readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock);
    env.fetch.mockResolvedValue([node(POLICY_B)]);
    await readCip113Registry('Preprod', [REGISTRY], [POLICY_B], clock);

    expect(Object.keys(env.storage[REGISTRY_CACHE_KEY] as object).sort()).toEqual(['Preprod', 'Preview']);
  });

  it('shares one read between callers that ask at once', async () => {
    const [first, second] = await Promise.all([
      readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock),
      readCip113Registry('Preview', [REGISTRY], [POLICY_A], clock),
    ]);

    expect(env.fetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('registers nothing where no registry is configured', async () => {
    expect(await readCip113Registry('Mainnet', [], [POLICY_A], clock)).toEqual(new Set());
    expect(env.fetch).not.toHaveBeenCalled();
  });
});
