import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import vectors from '@/shared/utils/signedResponse.vectors.json';
import { REQUEST_NONCE_HEADER, UnsignedResponseError, isRequestNonce, type KeyResolver } from '@/shared/utils/signedResponse';
import {
  SIGNED_PATH_PREFIXES,
  installSignedFetch,
  installSignedResponses,
  isSignedPath,
  signedResponseMode,
  signedResponseReport,
} from './signedResponses';
import { STORE_KEY, SigningKeys, resetSigningKeysForTest } from './signingKeys';
import { resetPrivateStoreForTest, setPrivate } from '@/utils/privateStore';

const BASE = 'https://api.gerowallet.io';
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const PUBLIC_KEY = hexToBytes(vectors.signingPublicKeyHex);
const ROOTS = vectors.root.keys.map((key) => hexToBytes(key.publicKeyHex));
const keys: KeyResolver = {
  resolve: (keyid, hostname) => (keyid === vectors.keyid && hostname === 'api.gerowallet.io' ? PUBLIC_KEY : undefined),
};
const now = () => vectors.created + 10;

type Vector = (typeof vectors.cases)[number];
const build = vectors.cases[0];
const refused = vectors.cases[2];

/** Nonces the fake server received, in order. */
let sentNonces: (string | undefined)[] = [];

/** An adapter that answers like the server would: raw text plus the signature headers. */
function serve(v: Vector, change: { body?: string; signed?: boolean } = {}): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
    const nonce = AxiosHeaders.from(config.headers).get(REQUEST_NONCE_HEADER);
    sentNonces.push(typeof nonce === 'string' ? nonce : undefined);
    const headers = new AxiosHeaders({ 'content-type': 'application/json' });
    if (change.signed !== false) {
      headers.set('gero-request-digest', v.expected.requestDigest);
      headers.set('gero-body-digest', v.expected.bodyDigest);
      headers.set('signature-input', v.expected.signatureInput);
      headers.set('signature', v.expected.signature);
    }
    const response = { data: change.body ?? v.response.body, status: v.response.status, statusText: '', headers, config, request: {} };
    if (v.response.status >= 400) {
      throw new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, {}, response);
    }
    return response;
  };
}

/** A client whose requests carry the vector's nonce, so the vector's signature fits them. */
function client(v: Vector, mode: 'off' | 'shadow' | 'enforce', change?: Parameters<typeof serve>[1]) {
  const instance = axios.create({ baseURL: BASE, adapter: serve(v, change), headers: { 'Content-Type': 'application/json' } });
  installSignedResponses(instance, 'gero-backend', { mode, keys, now, nonce: () => v.request.nonce });
  return instance;
}

const call = (instance: ReturnType<typeof axios.create>, v: Vector) =>
  instance.request({ method: v.request.method, url: v.request.path, params: v.request.query ? Object.fromEntries(new URLSearchParams(v.request.query)) : undefined, data: v.request.body || undefined });

afterEach(() => {
  vi.unstubAllEnvs();
  resetSigningKeysForTest();
  sentNonces = [];
});

describe('installSignedResponses', () => {
  it('reads the mode from the build only, defaulting to off', () => {
    expect(signedResponseMode(undefined)).toBe('off');
    expect(signedResponseMode('ENFORCE')).toBe('off');
    expect(signedResponseMode('shadow')).toBe('shadow');
    expect(signedResponseMode('enforce')).toBe('enforce');
  });

  it('installs nothing when off', () => {
    const instance = axios.create({ baseURL: BASE });
    const before = instance.defaults.transformResponse;
    installSignedResponses(instance, 'gero-backend', { mode: 'off', keys, now });
    expect(instance.defaults.transformResponse).toBe(before);
    expect((instance.interceptors.response as unknown as { handlers: unknown[] }).handlers).toHaveLength(0);
  });

  it('enforce: hands on a verified answer, parsed as before', async () => {
    const response = await call(client(build, 'enforce'), build);
    expect(response.data).toEqual({ cbor: '84a400', estimated_fee: '171045' });
    expect(sentNonces).toEqual([build.request.nonce]);
  });

  it('sends a fresh nonce with every checked request, so a recorded answer never fits another', async () => {
    const instance = axios.create({ baseURL: BASE, adapter: serve(build), headers: { 'Content-Type': 'application/json' } });
    installSignedResponses(instance, 'gero-backend', { mode: 'enforce', keys, now });
    // The server replays the vector's signed answer, made for the vector's nonce.
    await expect(call(instance, build)).rejects.toMatchObject({ reason: 'bad-signature' });
    await expect(call(instance, build)).rejects.toMatchObject({ reason: 'bad-signature' });
    expect(sentNonces).toHaveLength(2);
    expect(sentNonces.every(isRequestNonce)).toBe(true);
    expect(new Set(sentNonces).size).toBe(2);
    expect(sentNonces).not.toContain(build.request.nonce);
  });

  it('enforce: refuses a changed body before the caller sees it', async () => {
    const tampered = build.response.body.replace('84a400', '84a401');
    await expect(call(client(build, 'enforce', { body: tampered }), build)).rejects.toMatchObject({
      name: 'UnsignedResponseError',
      reason: 'body-digest-mismatch',
    });
  });

  it('enforce: refuses an unsigned answer', async () => {
    await expect(call(client(build, 'enforce', { signed: false }), build)).rejects.toBeInstanceOf(UnsignedResponseError);
  });

  it('enforce: keeps a verified error response as the original error', async () => {
    const error = await call(client(refused, 'enforce'), refused).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AxiosError);
    expect((error as AxiosError).response?.data).toEqual({ message: 'Handle not found' });
  });

  it('enforce: replaces an unverified error response', async () => {
    await expect(call(client(refused, 'enforce', { signed: false }), refused)).rejects.toMatchObject({ reason: 'unsigned' });
  });

  it('shadow: hands every answer on and only counts the outcome', async () => {
    const before = signedResponseReport();
    const tampered = build.response.body.replace('84a400', '84a401');
    const response = await call(client(build, 'shadow', { body: tampered }), build);
    expect(response.data).toEqual({ cbor: '84a401', estimated_fee: '171045' });
    await call(client(build, 'shadow'), build);
    await vi.waitFor(() => {
      const after = signedResponseReport();
      expect((after['gero-backend:body-digest-mismatch'] ?? 0) - (before['gero-backend:body-digest-mismatch'] ?? 0)).toBe(1);
      expect((after['gero-backend:verified'] ?? 0) - (before['gero-backend:verified'] ?? 0)).toBe(1);
    });
  });

  it('checks exactly the paths gero-backend signs, as the shared vectors pin them', () => {
    expect(SIGNED_PATH_PREFIXES).toEqual(vectors.signedPathPrefixes);
    expect(isSignedPath('/api/nexus/api/tx/build/delegation')).toBe(true);
    expect(isSignedPath('/api/assets/handle')).toBe(true);
    expect(isSignedPath('/api/pools')).toBe(true);
    expect(isSignedPath('/api/pools/pool1abc/history')).toBe(true);
    expect(isSignedPath('/api/mpc/login-share')).toBe(true);
    expect(isSignedPath('/api/poolsfoo')).toBe(false);
    expect(isSignedPath('/api/mpc')).toBe(false);
    expect(isSignedPath('/api/account/info')).toBe(false);
    expect(isSignedPath('/api/transactions/submit-tx')).toBe(false);
    expect(isSignedPath('/api/tx/build')).toBe(false);
  });

  it('enforce: passes an unsigned answer on a path gero-backend does not sign', async () => {
    const instance = axios.create({
      baseURL: BASE,
      adapter: async (config) => ({ data: '{"balance":"1"}', status: 200, statusText: '', headers: new AxiosHeaders(), config, request: {} }),
    });
    installSignedResponses(instance, 'gero-backend', { mode: 'enforce', keys, now });
    const response = await instance.get('/api/account/info', { params: { stakeAddress: 'stake1u' } });
    expect(response.data).toEqual({ balance: '1' });
    expect(AxiosHeaders.from(response.config.headers).has(REQUEST_NONCE_HEADER)).toBe(false);
  });

  it('enforce: resolves keys from root-signed delegations, fetching again for a key it does not know', async () => {
    resetPrivateStoreForTest();
    // A fresh stored copy that does not know the key yet: only the unknown key id fetches.
    await setPrivate(STORE_KEY, { fetchedAt: vectors.created * 1000, delegations: [], revoked: [] });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: 1, delegations: vectors.root.delegation.entries, revocations: [] })));
    resetSigningKeysForTest(
      new SigningKeys({ roots: ROOTS, baseUrl: BASE, fetchImpl, bundled: [], nowMs: () => vectors.created * 1000 }),
    );
    const instance = axios.create({ baseURL: BASE, adapter: serve(build), headers: { 'Content-Type': 'application/json' } });
    installSignedResponses(instance, 'gero-backend', { mode: 'enforce', now, nonce: () => build.request.nonce });
    const response = await call(instance, build);
    expect(response.data).toEqual({ cbor: '84a400', estimated_fee: '171045' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enforce: refuses an answer whose key no root approved', async () => {
    resetPrivateStoreForTest();
    await setPrivate(STORE_KEY, { fetchedAt: vectors.created * 1000, delegations: [], revoked: [] });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ delegations: vectors.root.delegation.entries })));
    // Only one of the two signers is pinned here (beside an unrelated root): one approval is not enough.
    resetSigningKeysForTest(new SigningKeys({ roots: [ROOTS[0], new Uint8Array(32).fill(1)], baseUrl: BASE, fetchImpl, bundled: [], nowMs: () => vectors.created * 1000 }));
    const instance = axios.create({ baseURL: BASE, adapter: serve(build), headers: { 'Content-Type': 'application/json' } });
    installSignedResponses(instance, 'gero-backend', { mode: 'enforce', now, nonce: () => build.request.nonce });
    await expect(call(instance, build)).rejects.toMatchObject({ reason: 'unknown-key' });
  });

  it('runs before interceptors registered after it', async () => {
    const instance = client(build, 'enforce', { signed: false });
    const later = vi.fn((r) => r);
    instance.interceptors.response.use(later);
    await expect(call(instance, build)).rejects.toBeInstanceOf(UnsignedResponseError);
    expect(later).not.toHaveBeenCalled();
  });
});

describe('installSignedFetch', () => {
  /** A fake `fetch` answering like the server: records what it was sent. */
  function fakeServer(v: Vector, change: { body?: string; signed?: boolean } = {}) {
    const seen: { url: string; method: string; nonce: string | null; body: string }[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({ url: request.url, method: request.method, nonce: request.headers.get(REQUEST_NONCE_HEADER), body: await request.text() });
      const headers = new Headers({ 'content-type': 'application/json' });
      if (change.signed !== false) {
        headers.set('gero-request-digest', v.expected.requestDigest);
        headers.set('gero-body-digest', v.expected.bodyDigest);
        headers.set('signature-input', v.expected.signatureInput);
        headers.set('signature', v.expected.signature);
        if ('chainTip' in v.response && v.response.chainTip) headers.set('gero-chain-tip', v.response.chainTip);
      }
      const body = change.body ?? v.response.body;
      return new Response([101, 103, 204, 205, 304].includes(v.response.status) ? null : body, { status: v.response.status, headers });
    });
    return { impl, seen };
  }

  /** `nonce: null` leaves the real random nonce in place. */
  function wrapped(v: Vector, mode: 'off' | 'shadow' | 'enforce', change?: Parameters<typeof fakeServer>[1], nonce: (() => string) | null = () => v.request.nonce) {
    const server = fakeServer(v, change);
    const target = { fetch: server.impl as unknown as typeof fetch };
    installSignedFetch(target, 'gero-backend', { mode, keys, now, backendUrl: BASE, ...(nonce ? { nonce } : {}) });
    return { target, ...server };
  }

  const urlOf = (v: Vector) => `${BASE}${v.request.path}${v.request.query ? `?${v.request.query}` : ''}`;
  const send = (target: { fetch: typeof fetch }, v: Vector, headers: Record<string, string> = {}) =>
    target.fetch(urlOf(v), { method: v.request.method, body: v.request.body || undefined, headers: { 'Content-Type': 'application/json', ...headers } });

  it('installs nothing when off', () => {
    const { target, impl } = wrapped(build, 'off');
    expect(target.fetch).toBe(impl);
  });

  it('enforce: hands on a verified answer with its exact body, having sent the nonce and the body', async () => {
    const { target, seen } = wrapped(build, 'enforce');
    const response = await send(target, build);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cbor: '84a400', estimated_fee: '171045' });
    expect(seen).toEqual([{ url: urlOf(build), method: 'POST', nonce: build.request.nonce, body: build.request.body }]);
  });

  it('enforce: checks GETs, refused answers and empty answers too', async () => {
    for (const v of vectors.cases.slice(1)) {
      const { target } = wrapped(v, 'enforce');
      const response = await send(target, v);
      expect(response.status).toBe(v.response.status);
      expect(await response.text()).toBe(v.response.body);
    }
  });

  it('enforce: refuses a changed body, an unsigned answer and an answer made for another nonce', async () => {
    const tampered = build.response.body.replace('84a400', '84a401');
    await expect(send(wrapped(build, 'enforce', { body: tampered }).target, build)).rejects.toMatchObject({ reason: 'body-digest-mismatch' });
    await expect(send(wrapped(build, 'enforce', { signed: false }).target, build)).rejects.toBeInstanceOf(UnsignedResponseError);
    const fresh = wrapped(build, 'enforce', undefined, null);
    await expect(send(fresh.target, build)).rejects.toMatchObject({ reason: 'bad-signature' });
    expect(isRequestNonce(fresh.seen[0].nonce)).toBe(true);
  });

  it('a nonce the caller set does not exempt the request from the check', async () => {
    const tampered = build.response.body.replace('84a400', '84a401');
    const { target, seen } = wrapped(build, 'enforce', { body: tampered });
    await expect(send(target, build, { [REQUEST_NONCE_HEADER]: build.request.nonce })).rejects.toMatchObject({ reason: 'body-digest-mismatch' });
    expect(seen[0].nonce).toBe(build.request.nonce);
    // A malformed one is replaced, not used.
    const other = wrapped(build, 'enforce', undefined, () => build.request.nonce);
    await send(other.target, build, { [REQUEST_NONCE_HEADER]: 'bad' });
    expect(other.seen[0].nonce).toBe(build.request.nonce);
  });

  it('passes other hosts and paths gero-backend does not sign through untouched', async () => {
    const { target, impl, seen } = wrapped(build, 'enforce', { signed: false });
    await target.fetch('https://nexus.example/api/nexus/api/tx/build/delegation', { method: 'POST', body: '{}' });
    await target.fetch(`${BASE}/api/account/info?stakeAddress=stake1u`);
    expect(impl).toHaveBeenCalledTimes(2);
    expect(seen.map((s) => s.nonce)).toEqual([null, null]);
  });

  it('shadow: hands every answer on and only counts the outcome', async () => {
    const before = signedResponseReport();
    const tampered = build.response.body.replace('84a400', '84a401');
    const response = await send(wrapped(build, 'shadow', { body: tampered }).target, build);
    expect(await response.json()).toEqual({ cbor: '84a401', estimated_fee: '171045' });
    await send(wrapped(build, 'shadow').target, build);
    const after = signedResponseReport();
    expect((after['gero-backend/fetch:body-digest-mismatch'] ?? 0) - (before['gero-backend/fetch:body-digest-mismatch'] ?? 0)).toBe(1);
    expect((after['gero-backend/fetch:verified'] ?? 0) - (before['gero-backend/fetch:verified'] ?? 0)).toBe(1);
  });
});
