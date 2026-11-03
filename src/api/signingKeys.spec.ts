import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import * as MS from '@emurgo/cardano-message-signing-browser';
import vectors from '@/shared/utils/signedResponse.vectors.json';
import { getPrivate, resetPrivateStoreForTest, setPrivate } from '@/utils/privateStore';
import { buildDelegationStatement, buildRevocationStatement } from '@/shared/utils/signedResponseRoots';
import {
  DELEGATIONS_PATH,
  MIN_REFETCH_MS,
  REFRESH_AFTER_MS,
  RETRY_EMPTY_MS,
  STORE_KEY,
  SigningKeys,
  type SignedStatement,
} from './signingKeys';

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const ROOT_SEED = hexToBytes(vectors.root.seedHex);
const ROOT = hexToBytes(vectors.root.publicKeyHex);
const OTHER_SEED = new Uint8Array(32).fill(9);
const BASE = 'https://api.gerowallet.io';
const HOST = 'api.gerowallet.io';
const KEY = hexToBytes(vectors.signingPublicKeyHex);
/** Inside every delegation built below. */
const NOW_MS = Date.parse('2026-11-20T00:00:00Z');

async function cip8(statement: string, seed: Uint8Array = ROOT_SEED): Promise<string> {
  const protectedMap = MS.HeaderMap.new();
  protectedMap.set_algorithm_id(MS.Label.from_algorithm_id(MS.AlgorithmId.EdDSA));
  const builder = MS.COSESign1Builder.new(
    MS.Headers.new(MS.ProtectedHeaderMap.new(protectedMap), MS.HeaderMap.new()),
    new TextEncoder().encode(statement),
    false,
  );
  return toHex(builder.build(await ed25519.signAsync(builder.make_data_to_sign().to_bytes(), seed)).to_bytes());
}

async function delegation(kid: string, opts: { seed?: Uint8Array; from?: string; until?: string } = {}): Promise<SignedStatement> {
  const statement = buildDelegationStatement({
    kid,
    service: 'gero-backend',
    hosts: [HOST],
    from: opts.from ?? '2026-11-01',
    until: opts.until ?? '2027-01-30',
    publicKeyHex: vectors.signingPublicKeyHex,
  });
  return { statement, coseSign1: await cip8(statement, opts.seed) };
}

async function revocation(kids: string[], seed: Uint8Array = ROOT_SEED): Promise<SignedStatement> {
  const statement = buildRevocationStatement('2026-11-15', kids);
  return { statement, coseSign1: await cip8(statement, seed) };
}

function server(body: () => unknown, status = 200) {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(String(url)).toBe(`${BASE}${DELEGATIONS_PATH}`);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
    return new Response(JSON.stringify(body()), { status, headers: { 'content-type': 'application/json' } });
  });
}

function keys(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof SigningKeys>[0]> = {}) {
  let now = NOW_MS;
  const store = new SigningKeys({ roots: [ROOT], baseUrl: BASE, fetchImpl, bundled: [], nowMs: () => now, ...extra });
  return { store, advance: (ms: number) => (now += ms) };
}

const nowSeconds = NOW_MS / 1000;

beforeEach(async () => {
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

describe('SigningKeys', () => {
  it('fetches nothing and resolves nothing while no root is pinned', async () => {
    const fetchImpl = server(() => ({}));
    const store = new SigningKeys({ roots: [], baseUrl: BASE, fetchImpl });
    const resolver = await store.resolver('gero-backend');
    expect(resolver.resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resolves a delegation a root signed, and stores the verified copy privately', async () => {
    const d = await delegation('backend-2026-11');
    const { store } = keys(server(() => ({ version: 1, delegations: [d], revocations: [] })));
    const resolver = await store.resolver('gero-backend');
    expect(resolver.resolve('backend-2026-11', HOST, nowSeconds)).toEqual(KEY);
    expect(resolver.resolve('backend-2026-11', 'evil.example', nowSeconds)).toBeUndefined();
    expect(await getPrivate(STORE_KEY)).toEqual({ fetchedAt: NOW_MS, delegations: [d], revoked: [] });
  });

  it('ignores statements no pinned root signed, and anything malformed', async () => {
    const forged = await delegation('forged', { seed: OTHER_SEED });
    const good = await delegation('backend-2026-11');
    const { store } = keys(server(() => ({ delegations: [forged, { statement: 1 }, 'x', null, good], revocations: 'nope' })));
    const resolver = await store.resolver('gero-backend');
    expect(resolver.resolve('forged', HOST, nowSeconds)).toBeUndefined();
    expect(resolver.resolve('backend-2026-11', HOST, nowSeconds)).toEqual(KEY);
    expect((await getPrivate<{ delegations: unknown[] }>(STORE_KEY))?.delegations).toEqual([good]);
  });

  it('drops a delegation the server stops serving', async () => {
    let served = [await delegation('backend-2026-11')];
    const { store, advance } = keys(server(() => ({ delegations: served })));
    expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toEqual(KEY);
    served = [];
    advance(REFRESH_AFTER_MS);
    await store.resolver('gero-backend'); // stale: refreshes in the background
    await vi.waitFor(async () => expect((await getPrivate<{ delegations: unknown[] }>(STORE_KEY))?.delegations).toEqual([]));
    expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds + 1)).toBeUndefined();
  });

  it('never un-revokes: a revocation the server stops serving still counts, here and after a reload', async () => {
    const d = await delegation('backend-2026-11');
    let revocations = [await revocation(['backend-2026-11'])];
    const fetchImpl = server(() => ({ delegations: [d], revocations }));
    const { store, advance } = keys(fetchImpl);
    expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();
    revocations = [];
    advance(REFRESH_AFTER_MS);
    await store.resolver('gero-backend');
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();

    const reloaded = keys(fetchImpl).store;
    expect((await reloaded.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();
  });

  it('applies revocations shipped in the release, ignoring ones no root signed', async () => {
    const d1 = await delegation('backend-2026-11');
    const d2 = await delegation('backend-2026-12');
    const { store } = keys(server(() => ({ delegations: [d1, d2] })), {
      bundled: [await revocation(['backend-2026-11']), await revocation(['backend-2026-12'], OTHER_SEED)],
    });
    const resolver = await store.resolver('gero-backend');
    expect(resolver.resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();
    expect(resolver.resolve('backend-2026-12', HOST, nowSeconds)).toEqual(KEY);
  });

  it('verifies the stored copy again on load: a root no longer pinned takes its delegations with it', async () => {
    const d = await delegation('backend-2026-11');
    await setPrivate(STORE_KEY, { fetchedAt: NOW_MS, delegations: [d], revoked: [] });
    const fetchImpl = server(() => ({ delegations: [] }));
    const withRoot = keys(fetchImpl).store;
    expect((await withRoot.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toEqual(KEY);
    expect(fetchImpl).not.toHaveBeenCalled(); // fresh copy

    const otherRoot = await ed25519.getPublicKeyAsync(OTHER_SEED);
    const rotated = keys(server(() => ({ delegations: [] })), { roots: [otherRoot] }).store;
    expect((await rotated.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();
  });

  it('keeps the stored copy when the server is unreachable', async () => {
    const d = await delegation('backend-2026-11');
    await setPrivate(STORE_KEY, { fetchedAt: NOW_MS - REFRESH_AFTER_MS, delegations: [d], revoked: [] });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { store } = keys(fetchImpl);
    expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toEqual(KEY);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toEqual(KEY);
  });

  it('drops expired delegations', async () => {
    const d = await delegation('backend-2026-09', { from: '2026-09-01', until: '2026-11-15' });
    const { store } = keys(server(() => ({ delegations: [d] })));
    expect((await store.resolver('gero-backend')).resolve('backend-2026-09', HOST, nowSeconds)).toBeUndefined();
  });

  it('refuses a non-OK, oversized or non-JSON answer', async () => {
    for (const fetchImpl of [
      server(() => ({}), 500),
      vi.fn(async () => new Response('x'.repeat(70 * 1024), { status: 200 })),
      vi.fn(async () => new Response('<html>', { status: 200 })),
    ]) {
      const { store } = keys(fetchImpl as unknown as typeof fetch);
      expect((await store.resolver('gero-backend')).resolve('backend-2026-11', HOST, nowSeconds)).toBeUndefined();
      expect(await getPrivate(STORE_KEY)).toBeUndefined();
    }
  });

  it('fetches again for an unknown key id, at most once per interval', async () => {
    let served: SignedStatement[] = [];
    const fetchImpl = server(() => ({ delegations: served }));
    const { store, advance } = keys(fetchImpl);
    await store.resolver('gero-backend');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    served = [await delegation('backend-2026-12')];
    advance(RETRY_EMPTY_MS);
    expect((await store.refetchForUnknownKey('gero-backend')).resolve('backend-2026-12', HOST, nowSeconds)).toEqual(KEY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await store.refetchForUnknownKey('gero-backend');
    advance(MIN_REFETCH_MS - 1);
    await store.refetchForUnknownKey('gero-backend');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    advance(1);
    await store.refetchForUnknownKey('gero-backend');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('shares one fetch between concurrent callers', async () => {
    const fetchImpl = server(() => ({ delegations: [] }));
    const { store } = keys(fetchImpl);
    await Promise.all([store.resolver('gero-backend'), store.resolver('gero-backend'), store.resolver('gero-sync')]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
