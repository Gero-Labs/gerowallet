import { describe, it, expect, vi } from 'vitest';
import { MIDNIGHT_METHOD } from '@/chrome/config';
import { PROVING_UPLOAD_CHUNK_CHARS, decodeBase64, encodeBase64 } from '@/chrome/midnightProvingWire';
import type { ProvingUploadChunkRequest } from '@/chrome/midnightProvingWire';
import { createDappProvingProvider, encodeBase64Async } from './midnightProvingBridge';
import type { KeyMaterialProvider } from '@midnight-ntwrk/dapp-connector-api';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fakeKeyMaterialProvider(overrides: Partial<KeyMaterialProvider> = {}): KeyMaterialProvider {
  return {
    getZKIR: vi.fn(async (loc: string) => bytes(`ir:${loc}`)),
    getProverKey: vi.fn(async (loc: string) => bytes(`pk:${loc}`)),
    getVerifierKey: vi.fn(async (loc: string) => bytes(`vk:${loc}`)),
    ...overrides,
  };
}

/** Records every relay call and replays canned replies for check/prove. */
function fakeSend(replies: { check?: unknown; prove?: unknown } = {}) {
  const calls: Array<{ method: string; data: unknown }> = [];
  const send = vi.fn(async (method: string, data: unknown) => {
    calls.push({ method, data });
    if (method === MIDNIGHT_METHOD.provingCheck) return replies.check;
    if (method === MIDNIGHT_METHOD.provingProve) return replies.prove;
    return undefined;
  });
  return { send, calls };
}

/** Reassemble the uploaded parts of the single upload in `calls`. */
function assembleUploads(calls: Array<{ method: string; data: unknown }>): Record<string, Uint8Array> {
  const chunks = calls
    .filter((c) => c.method === MIDNIGHT_METHOD.provingUpload)
    .map((c) => c.data as ProvingUploadChunkRequest);
  const ids = new Set(chunks.map((c) => c.uploadId));
  expect(ids.size).toBe(1);
  const byPart = new Map<string, string[]>();
  for (const c of chunks) {
    const list = byPart.get(c.part) ?? new Array<string>(c.total).fill('');
    expect(c.total).toBe(list.length);
    list[c.index] = c.chunk;
    byPart.set(c.part, list);
  }
  const out: Record<string, Uint8Array> = {};
  for (const [part, list] of byPart) out[part] = decodeBase64(list.join(''));
  return out;
}

describe('createDappProvingProvider — prove', () => {
  it('uploads only the preimage for a protocol builtin and never asks the dapp for keys', async () => {
    const kmp = fakeKeyMaterialProvider();
    const { send, calls } = fakeSend({ prove: { proof: encodeBase64(bytes('the-proof')) } });
    const provider = createDappProvingProvider(kmp, send);

    const proof = await provider.prove(bytes('preimage'), 'midnight/zswap/spend', 7n);

    expect(new TextDecoder().decode(proof)).toBe('the-proof');
    expect(kmp.getZKIR).not.toHaveBeenCalled();
    expect(kmp.getProverKey).not.toHaveBeenCalled();
    expect(kmp.getVerifierKey).not.toHaveBeenCalled();
    const parts = assembleUploads(calls);
    expect(Object.keys(parts)).toEqual(['preimage']);
    expect(new TextDecoder().decode(parts['preimage'])).toBe('preimage');
    const proveCall = calls.find((c) => c.method === MIDNIGHT_METHOD.provingProve)!;
    expect(proveCall.data).toEqual({
      uploadId: (calls[0].data as ProvingUploadChunkRequest).uploadId,
      keyLocation: 'midnight/zswap/spend',
      overwriteBindingInput: '7',
    });
    // Upload chunks must all land before the prove request is sent.
    expect(calls.indexOf(proveCall)).toBe(calls.length - 1);
  });

  it('fetches ZKIR + prover key + verifier key from the dapp for a contract circuit and uploads all four parts', async () => {
    const kmp = fakeKeyMaterialProvider();
    const { send, calls } = fakeSend({ prove: { proof: encodeBase64(new Uint8Array([1, 2, 3])) } });
    const provider = createDappProvingProvider(kmp, send);

    const proof = await provider.prove(bytes('pre'), 'increment');

    expect(Array.from(proof)).toEqual([1, 2, 3]);
    expect(kmp.getZKIR).toHaveBeenCalledWith('increment');
    expect(kmp.getProverKey).toHaveBeenCalledWith('increment');
    expect(kmp.getVerifierKey).toHaveBeenCalledWith('increment');
    const parts = assembleUploads(calls);
    const text = (u: Uint8Array) => new TextDecoder().decode(u);
    expect(text(parts['preimage'])).toBe('pre');
    expect(text(parts['ir'])).toBe('ir:increment');
    expect(text(parts['proverKey'])).toBe('pk:increment');
    expect(text(parts['verifierKey'])).toBe('vk:increment');
    const proveCall = calls.find((c) => c.method === MIDNIGHT_METHOD.provingProve)!;
    expect((proveCall.data as { overwriteBindingInput?: string }).overwriteBindingInput).toBeUndefined();
  });

  it('splits a large prover key into fixed-size chunks that reassemble byte-for-byte', async () => {
    // 1000 bytes → 1336 base64 chars → 5 chunks of 320 + one of 56 at a
    // 320-char test chunk size (the production size is 4 MiB; only the
    // slicing arithmetic is under test).
    const chunkChars = 320;
    const big = new Uint8Array(1000);
    for (let i = 0; i < big.length; i += 1) big[i] = (i * 31 + 7) & 0xff;
    const kmp = fakeKeyMaterialProvider({ getProverKey: vi.fn(async () => big) });
    const { send, calls } = fakeSend({ prove: { proof: '' } });
    const provider = createDappProvingProvider(kmp, send, { chunkChars });

    await provider.prove(bytes('pre'), 'post');

    const pkChunks = calls
      .map((c) => c.data as ProvingUploadChunkRequest)
      .filter((c, i) => calls[i].method === MIDNIGHT_METHOD.provingUpload && c.part === 'proverKey');
    expect(pkChunks.length).toBe(5);
    expect(pkChunks.every((c) => c.total === 5)).toBe(true);
    expect(pkChunks.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
    expect(pkChunks.slice(0, 4).every((c) => c.chunk.length === chunkChars)).toBe(true);
    // Every chunk is a whole number of base64 quanta, so the background can
    // decode it on its own (see PROVING_UPLOAD_CHUNK_CHARS).
    expect(pkChunks.every((c) => c.chunk.length % 4 === 0)).toBe(true);
    const parts = assembleUploads(calls);
    expect(parts['proverKey'].length).toBe(big.length);
    expect(Buffer.from(parts['proverKey']).equals(Buffer.from(big))).toBe(true);
  });

  it('uses the production 4 MiB chunk size by default and refuses a non-quantum-aligned override', () => {
    expect(PROVING_UPLOAD_CHUNK_CHARS % 4).toBe(0);
    expect(() => createDappProvingProvider(fakeKeyMaterialProvider(), fakeSend().send, { chunkChars: 6 })).toThrow(/multiple of 4/);
  });

  it('wraps a failing dapp KeyMaterialProvider in an error that names the circuit and method', async () => {
    const kmp = fakeKeyMaterialProvider({ getProverKey: vi.fn(async () => { throw new Error('404 from CDN'); }) });
    const { send, calls } = fakeSend();
    const provider = createDappProvingProvider(kmp, send);

    await expect(provider.prove(bytes('pre'), 'vote')).rejects.toThrow(/circuit 'vote'.*getProverKey.*404 from CDN/);
    // Nothing is uploaded when the dapp cannot supply its own artifacts.
    expect(calls.filter((c) => c.method === MIDNIGHT_METHOD.provingUpload)).toHaveLength(0);
  });

  it('rejects non-Uint8Array key material from the dapp', async () => {
    const kmp = fakeKeyMaterialProvider({ getZKIR: vi.fn(async () => 'nope' as unknown as Uint8Array) });
    const provider = createDappProvingProvider(kmp, fakeSend().send);
    await expect(provider.prove(bytes('pre'), 'vote')).rejects.toThrow(/getZKIR returned string/);
  });

  it('propagates the wallet-side rejection unchanged so dapps see the DAppConnectorAPIError shape', async () => {
    const apiError = { type: 'DAppConnectorAPIError', code: 'InternalError', reason: 'proof server down', message: 'proof server down' };
    const send = vi.fn(async (method: string) => {
      if (method === MIDNIGHT_METHOD.provingProve) throw apiError;
      return undefined;
    });
    const provider = createDappProvingProvider(fakeKeyMaterialProvider(), send);
    await expect(provider.prove(bytes('pre'), 'midnight/dust/spend')).rejects.toBe(apiError);
  });
});

describe('createDappProvingProvider — check', () => {
  it('uploads preimage + ZKIR for a contract circuit and maps the reply back to bigints', async () => {
    const kmp = fakeKeyMaterialProvider();
    const { send, calls } = fakeSend({ check: { result: ['12', null, '-3'] } });
    const provider = createDappProvingProvider(kmp, send);

    const result = await provider.check(bytes('pre'), 'increment');

    expect(result).toEqual([12n, undefined, -3n]);
    expect(kmp.getZKIR).toHaveBeenCalledWith('increment');
    expect(kmp.getProverKey).not.toHaveBeenCalled();
    expect(kmp.getVerifierKey).not.toHaveBeenCalled();
    expect(Object.keys(assembleUploads(calls)).sort()).toEqual(['ir', 'preimage']);
    const checkCall = calls.find((c) => c.method === MIDNIGHT_METHOD.provingCheck)!;
    expect(checkCall.data).toMatchObject({ keyLocation: 'increment' });
  });

  it('uploads only the preimage for a builtin', async () => {
    const kmp = fakeKeyMaterialProvider();
    const { send, calls } = fakeSend({ check: { result: [] } });
    const provider = createDappProvingProvider(kmp, send);

    await expect(provider.check(bytes('pre'), 'midnight/zswap/output')).resolves.toEqual([]);
    expect(kmp.getZKIR).not.toHaveBeenCalled();
    expect(Object.keys(assembleUploads(calls))).toEqual(['preimage']);
  });
});

describe('encodeBase64Async', () => {
  it('matches the sync encoder on small input', async () => {
    const small = bytes('hello world');
    expect(await encodeBase64Async(small)).toBe(encodeBase64(small));
  });

  it('matches the sync encoder on input large enough to take the FileReader path', async () => {
    const large = new Uint8Array(300 * 1024);
    for (let i = 0; i < large.length; i += 1) large[i] = (i * 13) & 0xff;
    const encoded = await encodeBase64Async(large);
    expect(encoded).toBe(encodeBase64(large));
    expect(decodeBase64(encoded)).toEqual(large);
  });
});
