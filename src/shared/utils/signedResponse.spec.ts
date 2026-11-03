import { describe, expect, it } from 'vitest';
import vectors from './signedResponse.vectors.json';
import {
  buildSignatureBase,
  digestHeaderValue,
  parseSignatureInput,
  verifySignedResponse,
  type KeyResolver,
  type SignedExchange,
} from './signedResponse';

const HOST = 'https://api.gerowallet.io';
const utf8 = (text: string) => new TextEncoder().encode(text);
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const PUBLIC_KEY = hexToBytes(vectors.signingPublicKeyHex);
const NOW = vectors.created + 10;

const keys: KeyResolver = {
  resolve: (keyid, hostname) => (keyid === vectors.keyid && hostname === 'api.gerowallet.io' ? PUBLIC_KEY : undefined),
};

type Vector = (typeof vectors.cases)[number];

function signedHeaders(v: Vector): Record<string, string> {
  const headers: Record<string, string> = {
    'gero-request-digest': v.expected.requestDigest,
    'gero-body-digest': v.expected.bodyDigest,
    'signature-input': v.expected.signatureInput,
    signature: v.expected.signature,
  };
  if ('chainTip' in v.response && v.response.chainTip) headers['gero-chain-tip'] = v.response.chainTip;
  return headers;
}

function exchange(v: Vector, change: { url?: string; method?: string; requestBody?: string; status?: number; body?: string; headers?: Record<string, string | undefined> } = {}): SignedExchange {
  const headers = { ...signedHeaders(v), ...change.headers };
  const url = change.url ?? `${HOST}${v.request.path}${v.request.query ? `?${v.request.query}` : ''}`;
  const requestBody = change.requestBody ?? v.request.body;
  return {
    request: { method: change.method ?? v.request.method, url, body: requestBody ? utf8(requestBody) : undefined },
    response: {
      status: change.status ?? v.response.status,
      header: (name) => headers[name.toLowerCase()],
      body: utf8(change.body ?? v.response.body),
    },
  };
}

describe('signed responses (gero-v1)', () => {
  describe('shared vectors', () => {
    for (const v of vectors.cases) {
      it(`rebuilds the signature base and verifies: ${v.name}`, async () => {
        const input = parseSignatureInput(v.expected.signatureInput);
        expect(input).toBeDefined();
        expect(digestHeaderValue(utf8(v.request.body))).toBe(v.expected.requestDigest);
        expect(digestHeaderValue(utf8(v.response.body))).toBe(v.expected.bodyDigest);
        const base = buildSignatureBase({
          method: v.request.method,
          path: v.request.path,
          query: v.request.query,
          status: v.response.status,
          requestDigest: v.expected.requestDigest,
          bodyDigest: v.expected.bodyDigest,
          chainTip: 'chainTip' in v.response ? v.response.chainTip : undefined,
          params: input!.params,
        });
        expect(base).toBe(v.expected.signatureBase);
        const result = await verifySignedResponse(exchange(v), { keys, nowSeconds: NOW });
        expect(result).toMatchObject({ ok: true, keyid: vectors.keyid });
      });
    }

    it('returns the chain tip a signature covers', async () => {
      const v = vectors.cases.find((c) => 'chainTip' in c.response)!;
      const result = await verifySignedResponse(exchange(v), { keys, nowSeconds: NOW });
      expect(result).toEqual({
        ok: true,
        keyid: vectors.keyid,
        chainTip: { slot: 171234567, hash: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0' },
      });
    });
  });

  describe('refusals', () => {
    const v = vectors.cases[0];
    const verify = (change: Parameters<typeof exchange>[1], nowSeconds = NOW) =>
      verifySignedResponse(exchange(v, change), { keys, nowSeconds });

    it('reports an unsigned response', async () => {
      expect(await verify({ headers: { signature: undefined, 'signature-input': undefined } })).toEqual({ ok: false, reason: 'unsigned' });
    });

    it('refuses a changed body', async () => {
      expect(await verify({ body: v.response.body.replace('84a400', '84a401') })).toEqual({ ok: false, reason: 'body-digest-mismatch' });
    });

    it('refuses a changed body served with a matching digest', async () => {
      const body = v.response.body.replace('84a400', '84a401');
      expect(await verify({ body, headers: { 'gero-body-digest': digestHeaderValue(utf8(body)) } })).toEqual({ ok: false, reason: 'bad-signature' });
    });

    it('refuses an answer to a different request body', async () => {
      expect(await verify({ requestBody: v.request.body.replace('pool1abc', 'pool1evil') })).toEqual({ ok: false, reason: 'request-digest-mismatch' });
    });

    it('refuses an answer replayed for another path, query, method or status', async () => {
      expect(await verify({ url: `${HOST}/api/nexus/api/tx/build/withdrawal?network=MAINNET` })).toEqual({ ok: false, reason: 'bad-signature' });
      expect(await verify({ url: `${HOST}${v.request.path}?network=PREPROD` })).toEqual({ ok: false, reason: 'bad-signature' });
      expect(await verify({ method: 'PUT' })).toEqual({ ok: false, reason: 'bad-signature' });
      expect(await verify({ status: 201 })).toEqual({ ok: false, reason: 'bad-signature' });
    });

    it('refuses a key it cannot resolve, including on another host', async () => {
      expect(await verify({ url: `https://evil.example${v.request.path}?${v.request.query}` })).toEqual({ ok: false, reason: 'unknown-key' });
    });

    it('enforces created and expires with two minutes of skew', async () => {
      expect(await verify({}, vectors.created - 121)).toEqual({ ok: false, reason: 'not-yet-valid' });
      expect((await verify({}, vectors.created - 119)).ok).toBe(true);
      expect(await verify({}, vectors.expires + 121)).toEqual({ ok: false, reason: 'expired' });
      expect((await verify({}, vectors.expires + 119)).ok).toBe(true);
    });

    it('refuses a lifetime longer than an hour', async () => {
      const input = v.expected.signatureInput.replace(`expires=${vectors.expires}`, `expires=${vectors.created + 3601}`);
      expect(await verify({ headers: { 'signature-input': input } })).toEqual({ ok: false, reason: 'lifetime-too-long' });
    });

    it('accepts only the profile form of Signature-Input', async () => {
      const variants = [
        v.expected.signatureInput.replace('alg="ed25519"', 'alg="hmac-sha256"'),
        v.expected.signatureInput.replace('tag="gero-v1"', 'tag="gero-v2"'),
        v.expected.signatureInput.replace('"@status" ', ''),
        v.expected.signatureInput.replace('"@method";req "@path";req', '"@path";req "@method";req'),
        v.expected.signatureInput.replace(';tag="gero-v1"', ';tag="gero-v1";nonce="x"'),
        v.expected.signatureInput.replace('gero=', 'other='),
      ];
      for (const input of variants) {
        expect(await verify({ headers: { 'signature-input': input } })).toEqual({ ok: false, reason: 'malformed' });
      }
    });

    it('refuses a missing or malformed digest header', async () => {
      expect(await verify({ headers: { 'gero-body-digest': undefined } })).toEqual({ ok: false, reason: 'malformed' });
      expect(await verify({ headers: { 'gero-request-digest': 'sha-512=:abc:' } })).toEqual({ ok: false, reason: 'malformed' });
    });

    it('refuses a covered chain tip that is missing or malformed', async () => {
      const tipCase = vectors.cases.find((c) => 'chainTip' in c.response)!;
      const result = await verifySignedResponse(exchange(tipCase, { headers: { 'gero-chain-tip': '12,zz' } }), { keys, nowSeconds: NOW });
      expect(result).toEqual({ ok: false, reason: 'malformed' });
    });
  });
});
