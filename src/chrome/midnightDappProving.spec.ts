import { describe, it, expect, vi } from 'vitest';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { Network } from '@/models/types';
import { MidnightErrorCode } from '@/chrome/config';
import { DappProvingUnavailableError } from '@/chains/midnight/midnightProvingTarget';
import type { ProofServerPreference } from '@/chains/midnight/midnightProvingTarget';
import type { ProverRequestOptions } from '@/chains/midnight/midnightLocalProver';
import { decodeBase64, encodeBase64 } from '@/chrome/midnightProvingWire';
import {
  DAPP_PROVING_TIMEOUT_MS,
  DappProvingFailedError,
  PROVING_UPLOAD_MAX_BYTES,
  PROVING_UPLOAD_MAX_PER_ORIGIN,
  PROVING_UPLOAD_TTL_MS,
  ProvingUploadError,
  ProvingUploadStore,
  assertDappProvingAvailable,
  dappProvingErrorCode,
  runDappProvingCheck,
  runDappProvingProve,
} from './midnightDappProving';
import type { DappProvingDeps } from './midnightDappProving';

vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));

const ORIGIN = 'https://dapp.example';
const OTHER_ORIGIN = 'https://other.example';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function text(u: Uint8Array | undefined): string | undefined {
  return u === undefined ? undefined : new TextDecoder().decode(u);
}

/**
 * Push `data` as `total` chunks (optionally in a shuffled order), slicing
 * on 4-char base64 quanta exactly like the page bridge does.
 */
function uploadPart(
  store: ProvingUploadStore,
  origin: string,
  uploadId: string,
  part: string,
  data: Uint8Array,
  total = 1,
  order?: number[],
): void {
  const encoded = encodeBase64(data);
  const size = Math.max(4, Math.ceil(encoded.length / total / 4) * 4);
  const indices = order ?? Array.from({ length: total }, (_, i) => i);
  for (const index of indices) {
    store.addChunk(origin, { uploadId, part, index, total, chunk: encoded.slice(index * size, (index + 1) * size) });
  }
}

const localPref: ProofServerPreference = {
  mode: 'local',
  localUrl: 'http://localhost:6300',
  zkpaasUrl: '',
  zkpaasApiKey: '',
  zkpaasApiSecret: '',
};

const ctx = { origin: ORIGIN, network: Network.PREPROD, sdkNetworkId: 'preprod', proofServer: localPref };

/** A fake prover that records how it was built and what it was asked. */
function fakeDeps(impl: {
  prove?: (preimage: Uint8Array, keyLocation: string, binding?: bigint) => Promise<Uint8Array>;
  check?: (preimage: Uint8Array, keyLocation: string) => Promise<(bigint | undefined)[]>;
} = {}) {
  const built: Array<{ url: string; options?: ProverRequestOptions }> = [];
  const deps: DappProvingDeps = {
    makeProvider: (url, options) => {
      built.push({ url, options });
      const provider: ledger.ProvingProvider = {
        check: impl.check ?? (async () => []),
        prove: impl.prove ?? (async () => new Uint8Array([9, 9])),
      };
      return provider;
    },
  };
  return { deps, built };
}

describe('ProvingUploadStore', () => {
  it('reassembles out-of-order chunks byte-for-byte and removes the upload on take', () => {
    const store = new ProvingUploadStore();
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i += 1) data[i] = i & 0xff;
    uploadPart(store, ORIGIN, 'u1', 'proverKey', data, 4, [2, 0, 3, 1]);
    uploadPart(store, ORIGIN, 'u1', 'preimage', bytes('pre'));

    const assembled = store.take(ORIGIN, 'u1');

    expect(assembled.proverKey).toEqual(data);
    expect(text(assembled.preimage)).toBe('pre');
    expect(assembled.ir).toBeUndefined();
    expect(store.size).toBe(0);
    expect(() => store.take(ORIGIN, 'u1')).toThrow(/not found or expired/);
  });

  it('keeps uploads private to the origin that started them', () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'shared-id', 'preimage', bytes('mine'));
    expect(() => store.take(OTHER_ORIGIN, 'shared-id')).toThrow(ProvingUploadError);
    // Same id from another origin is a separate upload, not a collision.
    uploadPart(store, OTHER_ORIGIN, 'shared-id', 'preimage', bytes('theirs'));
    expect(text(store.take(ORIGIN, 'shared-id').preimage)).toBe('mine');
    expect(text(store.take(OTHER_ORIGIN, 'shared-id').preimage)).toBe('theirs');
  });

  it('refuses to hand back a part with missing chunks', () => {
    const store = new ProvingUploadStore();
    store.addChunk(ORIGIN, { uploadId: 'u', part: 'preimage', index: 0, total: 2, chunk: encodeBase64(bytes('a')) });
    expect(() => store.take(ORIGIN, 'u')).toThrow(/'preimage' is incomplete \(1\/2 chunks\)/);
  });

  it('rejects malformed chunk requests with ProvingUploadError', () => {
    const store = new ProvingUploadStore();
    const ok = { uploadId: 'u', part: 'preimage', index: 0, total: 1, chunk: encodeBase64(bytes('x')) };
    const bad: Array<[unknown, RegExp]> = [
      [null, /must be an object/],
      [{ ...ok, uploadId: '../etc' }, /uploadId/],
      [{ ...ok, uploadId: '' }, /uploadId/],
      [{ ...ok, part: 'secretKey' }, /unknown upload part/],
      [{ ...ok, total: 0 }, /total/],
      [{ ...ok, total: 1.5 }, /total/],
      [{ ...ok, index: 1 }, /index/],
      [{ ...ok, index: -1 }, /index/],
      [{ ...ok, chunk: 42 }, /chunk must be/],
      // 16 chars (a whole number of quanta) so the base64 check itself is what rejects it.
      [{ ...ok, chunk: '@@@@not-base64@@' }, /not valid base64/],
      // A mid-quantum split: atob would silently accept 'QUJ' → wrong bytes.
      [{ ...ok, chunk: 'QUJ' }, /multiple of 4/],
    ];
    for (const [data, pattern] of bad) {
      expect(() => store.addChunk(ORIGIN, data), JSON.stringify(data)).toThrow(ProvingUploadError);
      expect(() => store.addChunk(ORIGIN, data), JSON.stringify(data)).toThrow(pattern);
    }
    expect(store.size).toBe(0);
  });

  it('drops the upload on a duplicate chunk or a changed total', () => {
    const store = new ProvingUploadStore();
    const chunk = { uploadId: 'u', part: 'preimage', index: 0, total: 2, chunk: encodeBase64(bytes('a')) };
    store.addChunk(ORIGIN, chunk);
    expect(() => store.addChunk(ORIGIN, chunk)).toThrow(/duplicate chunk 0/);
    expect(store.size).toBe(0);

    store.addChunk(ORIGIN, chunk);
    expect(() => store.addChunk(ORIGIN, { ...chunk, index: 1, total: 3 })).toThrow(/changed mid-upload/);
    expect(store.size).toBe(0);
  });

  it('caps in-flight uploads per origin', () => {
    const store = new ProvingUploadStore({ maxPerOrigin: 3 });
    for (let i = 0; i < 3; i += 1) {
      uploadPart(store, ORIGIN, `u${i}`, 'preimage', bytes('p'));
    }
    expect(() => uploadPart(store, ORIGIN, 'one-too-many', 'preimage', bytes('p'))).toThrow(/too many in-flight proof uploads \(max 3/);
    // Another origin is unaffected by the first origin's quota.
    expect(() => uploadPart(store, OTHER_ORIGIN, 'u0', 'preimage', bytes('p'))).not.toThrow();
  });

  it('caps the decoded size of a single upload and drops it', () => {
    const store = new ProvingUploadStore({ maxBytes: 100 });
    uploadPart(store, ORIGIN, 'big', 'ir', new Uint8Array(60));
    expect(() => uploadPart(store, ORIGIN, 'big', 'proverKey', new Uint8Array(41))).toThrow(/exceeds 100 bytes/);
    expect(store.size).toBe(0);
  });

  it('rejects a single oversized chunk message outright', () => {
    const store = new ProvingUploadStore({ maxChunkChars: 8 });
    expect(() => store.addChunk(ORIGIN, { uploadId: 'u', part: 'preimage', index: 0, total: 1, chunk: 'QUJDREVGR0g=' }))
      .toThrow(/at most 8 characters/);
  });

  it('ships with production limits that fit the spec\'s 80 MB+ prover keys', () => {
    expect(PROVING_UPLOAD_MAX_BYTES).toBeGreaterThanOrEqual(128 * 1024 * 1024);
    expect(PROVING_UPLOAD_MAX_PER_ORIGIN).toBeGreaterThanOrEqual(8);
    expect(PROVING_UPLOAD_TTL_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('sweeps uploads idle for longer than the TTL', () => {
    let now = 1_000_000;
    const store = new ProvingUploadStore({ now: () => now, ttlMs: 1_000 });
    uploadPart(store, ORIGIN, 'stale', 'preimage', bytes('p'));
    now += 999;
    uploadPart(store, ORIGIN, 'fresh', 'preimage', bytes('p'));
    now += 2;
    expect(() => store.take(ORIGIN, 'stale')).toThrow(/not found or expired/);
    expect(text(store.take(ORIGIN, 'fresh').preimage)).toBe('p');
  });
});

describe('runDappProvingProve', () => {
  it('proves a builtin circuit with no key material and returns the proof as base64', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('preimage-bytes'));
    const prove = vi.fn(async () => bytes('proof-bytes'));
    const { deps, built } = fakeDeps({ prove });

    const reply = await runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: 'midnight/zswap/spend', overwriteBindingInput: '42' });

    expect(text(decodeBase64(reply.proof))).toBe('proof-bytes');
    expect(built).toHaveLength(1);
    expect(built[0].url).toBe('http://localhost:6300');
    expect(built[0].options?.headers).toBeUndefined();
    // The prover picks its ledger-8 vs ledger-9 codec from this, and contract
    // circuits get the longer midnight-js-style timeout.
    expect(built[0].options?.sdkNetworkId).toBe('preprod');
    expect(built[0].options?.timeoutMs).toBe(DAPP_PROVING_TIMEOUT_MS);
    await expect(built[0].options!.resolveKeyMaterial!('midnight/zswap/spend')).resolves.toBeUndefined();
    expect(prove).toHaveBeenCalledTimes(1);
    const [preimage, keyLocation, binding] = prove.mock.calls[0] as unknown as [Uint8Array, string, bigint | undefined];
    expect(text(preimage)).toBe('preimage-bytes');
    expect(keyLocation).toBe('midnight/zswap/spend');
    expect(binding).toBe(42n);
    expect(store.size).toBe(0);
  });

  it('hands the dapp\'s full key material to the prover for a contract circuit', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    uploadPart(store, ORIGIN, 'u', 'ir', bytes('IR'), 3);
    uploadPart(store, ORIGIN, 'u', 'proverKey', bytes('PK'), 2);
    uploadPart(store, ORIGIN, 'u', 'verifierKey', bytes('VK'));
    const { deps, built } = fakeDeps();

    await runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: 'increment' });

    const material = await built[0].options!.resolveKeyMaterial!('increment');
    expect(text(material?.ir)).toBe('IR');
    expect(text(material?.proverKey)).toBe('PK');
    expect(text(material?.verifierKey)).toBe('VK');
  });

  it('rejects partial key material instead of proving without it', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    uploadPart(store, ORIGIN, 'u', 'proverKey', bytes('PK'));
    const { deps, built } = fakeDeps();
    await expect(runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: 'increment' }))
      .rejects.toThrow(/incomplete key material for circuit 'increment'/);
    expect(built).toHaveLength(0);
  });

  it('passes zkPaaS auth headers to the prover and never exposes them in the reply', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    const { deps, built } = fakeDeps();
    const zkpaasCtx = { ...ctx, proofServer: { ...localPref, mode: 'zkpaas' as const, zkpaasApiKey: 'KEY' } };

    const reply = await runDappProvingProve(store, deps, zkpaasCtx, { uploadId: 'u', keyLocation: 'midnight/zswap/sign' });

    expect(built[0].options?.headers).toEqual({ 'x-api-key': 'KEY' });
    expect(JSON.stringify(reply)).not.toContain('KEY');
  });

  it('validates the request shape before touching the upload', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    const { deps } = fakeDeps();
    await expect(runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: '' })).rejects.toThrow(/keyLocation/);
    await expect(runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: 'x', overwriteBindingInput: 'abc' })).rejects.toThrow(/decimal string/);
    await expect(runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: 'x', overwriteBindingInput: 5 })).rejects.toThrow(/decimal string/);
    // The upload is still there for a corrected retry.
    expect(store.size).toBe(1);
    await expect(runDappProvingProve(store, deps, ctx, { uploadId: 'missing', keyLocation: 'x' })).rejects.toThrow(/not found/);
  });

  it('fails with a missing preimage', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'ir', bytes('IR'));
    await expect(runDappProvingProve(store, fakeDeps().deps, ctx, { uploadId: 'u', keyLocation: 'x' })).rejects.toThrow(/preimage was not uploaded/);
  });

  it('turns a proof-server failure into an actionable DappProvingFailedError', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    const { deps } = fakeDeps({ prove: async () => { throw new Error('proof server /prove: HTTP 500'); } });
    const err = await runDappProvingProve(store, deps, ctx, { uploadId: 'u', keyLocation: 'increment' }).catch((e) => e);
    expect(err).toBeInstanceOf(DappProvingFailedError);
    expect(err.message).toContain('http://localhost:6300');
    expect(err.message).toContain('HTTP 500');
    expect(dappProvingErrorCode(err)).toBe(MidnightErrorCode.InternalError);
  });

  it('rejects when zkPaaS is selected but unconfigured, before consuming the upload', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    const zkpaasCtx = { ...ctx, proofServer: { ...localPref, mode: 'zkpaas' as const } };
    await expect(runDappProvingProve(store, fakeDeps().deps, zkpaasCtx, { uploadId: 'u', keyLocation: 'x' }))
      .rejects.toBeInstanceOf(DappProvingUnavailableError);
  });
});

describe('runDappProvingCheck', () => {
  it('proves with ZKIR-only material and serialises the result for the wire', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    uploadPart(store, ORIGIN, 'u', 'ir', bytes('IR'));
    const check = vi.fn(async () => [1n, undefined, 123456789012345678901234567890n]);
    const { deps, built } = fakeDeps({ check });

    const reply = await runDappProvingCheck(store, deps, ctx, { uploadId: 'u', keyLocation: 'increment' });

    expect(reply).toEqual({ result: ['1', null, '123456789012345678901234567890'] });
    const material = await built[0].options!.resolveKeyMaterial!('increment');
    expect(text(material?.ir)).toBe('IR');
    expect(material?.proverKey).toBeUndefined();
  });

  it('sends no material for a builtin', async () => {
    const store = new ProvingUploadStore();
    uploadPart(store, ORIGIN, 'u', 'preimage', bytes('pre'));
    const { deps, built } = fakeDeps();
    await runDappProvingCheck(store, deps, ctx, { uploadId: 'u', keyLocation: 'midnight/dust/spend' });
    await expect(built[0].options!.resolveKeyMaterial!('midnight/dust/spend')).resolves.toBeUndefined();
  });
});

describe('assertDappProvingAvailable / dappProvingErrorCode', () => {
  it('reports the resolved source and rejects an unusable preference', () => {
    expect(assertDappProvingAvailable(ctx)).toBe('local');
    expect(assertDappProvingAvailable({ ...ctx, proofServer: { ...localPref, mode: 'remote' } })).toBe('default');
    expect(() => assertDappProvingAvailable({ ...ctx, proofServer: { ...localPref, mode: 'zkpaas' } }))
      .toThrow(DappProvingUnavailableError);
  });

  it('maps upload errors to InvalidRequest and everything else to InternalError', () => {
    expect(dappProvingErrorCode(new ProvingUploadError('x'))).toBe(MidnightErrorCode.InvalidRequest);
    expect(dappProvingErrorCode(new DappProvingFailedError('x'))).toBe(MidnightErrorCode.InternalError);
    expect(dappProvingErrorCode(new Error('x'))).toBe(MidnightErrorCode.InternalError);
  });
});
