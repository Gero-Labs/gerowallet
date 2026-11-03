import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import vectors from '@/shared/utils/signedResponse.vectors.json';
import { UnsignedResponseError, type KeyResolver } from '@/shared/utils/signedResponse';
import {
  SIGNED_PATH_PREFIXES,
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
const keys: KeyResolver = {
  resolve: (keyid, hostname) => (keyid === vectors.keyid && hostname === 'api.gerowallet.io' ? PUBLIC_KEY : undefined),
};
const now = () => vectors.created + 10;

type Vector = (typeof vectors.cases)[number];
const build = vectors.cases[0];
const refused = vectors.cases[2];

/** An adapter that answers like the server would: raw text plus the signature headers. */
function serve(v: Vector, change: { body?: string; signed?: boolean } = {}): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
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

function client(v: Vector, mode: 'off' | 'shadow' | 'enforce', change?: Parameters<typeof serve>[1]) {
  const instance = axios.create({ baseURL: BASE, adapter: serve(v, change), headers: { 'Content-Type': 'application/json' } });
  installSignedResponses(instance, 'gero-backend', { mode, keys, now });
  return instance;
}

const call = (instance: ReturnType<typeof axios.create>, v: Vector) =>
  instance.request({ method: v.request.method, url: v.request.path, params: v.request.query ? Object.fromEntries(new URLSearchParams(v.request.query)) : undefined, data: v.request.body || undefined });

afterEach(() => {
  vi.unstubAllEnvs();
  resetSigningKeysForTest();
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
  });

  it('enforce: resolves keys from root-signed delegations, fetching again for a key it does not know', async () => {
    resetPrivateStoreForTest();
    // A fresh stored copy that does not know the key yet: only the unknown key id fetches.
    await setPrivate(STORE_KEY, { fetchedAt: vectors.created * 1000, delegations: [], revoked: [] });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: 1, delegations: [vectors.root.delegation], revocations: [] })));
    resetSigningKeysForTest(
      new SigningKeys({ roots: [hexToBytes(vectors.root.publicKeyHex)], baseUrl: BASE, fetchImpl, bundled: [], nowMs: () => vectors.created * 1000 }),
    );
    const instance = axios.create({ baseURL: BASE, adapter: serve(build), headers: { 'Content-Type': 'application/json' } });
    installSignedResponses(instance, 'gero-backend', { mode: 'enforce', now });
    const response = await call(instance, build);
    expect(response.data).toEqual({ cbor: '84a400', estimated_fee: '171045' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enforce: refuses an answer whose key no root approved', async () => {
    resetPrivateStoreForTest();
    await setPrivate(STORE_KEY, { fetchedAt: vectors.created * 1000, delegations: [], revoked: [] });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ delegations: [vectors.root.delegation] })));
    resetSigningKeysForTest(new SigningKeys({ roots: [new Uint8Array(32).fill(1)], baseUrl: BASE, fetchImpl, bundled: [], nowMs: () => vectors.created * 1000 }));
    const instance = axios.create({ baseURL: BASE, adapter: serve(build), headers: { 'Content-Type': 'application/json' } });
    installSignedResponses(instance, 'gero-backend', { mode: 'enforce', now });
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
