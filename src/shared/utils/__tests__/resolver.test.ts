import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cardano } from '@cardano-sdk/core';

// resolver.ts pulls in the whole static-asset barrel (PNG/SVG imports) purely for its
// placeholder avatars — stub it so the suite doesn't depend on asset transforms.
vi.mock('@/utils/assets', () => ({
  default: new Proxy({}, { get: (_t, key) => `asset:${String(key)}` }),
}));

vi.mock('@/stores/tokenMetadataStore', () => ({ default: { state: { tokens: {} } } }));
vi.mock('@/stores/networkStore', () => ({ default: { state: { assets: {} } } }));

const { debugLog } = vi.hoisted(() => ({ debugLog: vi.fn() }));
vi.mock('@/utils/debug', () => ({
  debugLog: (...args: unknown[]) => debugLog(...args),
  debugWarn: vi.fn(),
  isDebugMode: () => false,
}));

import { resolveIcon, fromPlutusData } from '../resolver';

/** Real CIDv1 from the SONG token's on-chain logo (see the ipfs.io 403 in the bug report). */
const CID_V1 = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';
const CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

const bytes = (s: string) => new TextEncoder().encode(s);

/**
 * `fromPlutusData` also returns the CIP-68 fungible-token fields (`logo`, `decimals`,
 * `ticker`, …) that the SDK's `NftMetadata` type doesn't declare — see the same gap on
 * `decimals` in resolver.ts's return literal.
 */
type Cip68Metadata = NonNullable<ReturnType<typeof fromPlutusData>> & { logo?: string };

/** Builds a CIP-68 metadata map (PlutusMap) from plain string entries. */
const plutusMap = (entries: Record<string, Cardano.PlutusData>): Cardano.PlutusMap => ({
  data: new Map<Cardano.PlutusData, Cardano.PlutusData>(
    Object.entries(entries).map(([k, v]) => [bytes(k) as Cardano.PlutusData, v]),
  ),
});

/** Wraps a metadata map in the standard CIP-68 `Constr<0>[metadata, version]` datum. */
const cip68Datum = (metadata: Cardano.PlutusMap, version = 1n): Cardano.PlutusData =>
  ({ constructor: 0n, fields: { items: [metadata, version] } }) as Cardano.PlutusData;

beforeEach(() => {
  debugLog.mockReset();
});

describe('resolveIcon — IPFS gateway URLs', () => {
  it('routes ipfs:// through the backend proxy (existing behaviour)', () => {
    expect(resolveIcon(`ipfs://${CID_V1}`)).toContain(`/api/ipfs?path=${CID_V1}`);
  });

  it('routes a bare CID through the backend proxy (existing behaviour)', () => {
    expect(resolveIcon(CID_V0)).toContain(`/api/ipfs?path=${CID_V0}`);
  });

  // The actual SONG failure: a public-gateway URL was returned verbatim, and ipfs.io
  // answers cross-origin requests with 403 + Cross-Origin-Resource-Policy, so Chrome
  // blocks it (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) and the token renders imageless.
  it('rewrites a path-style gateway URL to the backend proxy', () => {
    expect(resolveIcon(`https://ipfs.io/ipfs/${CID_V1}`)).toContain(`/api/ipfs?path=${CID_V1}`);
  });

  it('rewrites gateway URLs regardless of host', () => {
    expect(resolveIcon(`https://cloudflare-ipfs.com/ipfs/${CID_V0}`)).toContain(`/api/ipfs?path=${CID_V0}`);
    expect(resolveIcon(`https://gateway.pinata.cloud/ipfs/${CID_V1}`)).toContain(`/api/ipfs?path=${CID_V1}`);
  });

  it('rewrites subdomain-style gateway URLs', () => {
    expect(resolveIcon(`https://${CID_V1}.ipfs.dweb.link/`)).toContain(`/api/ipfs?path=${CID_V1}`);
  });

  it('keeps the sub-path when the gateway URL points at a file inside the CID', () => {
    const resolved = resolveIcon(`https://ipfs.io/ipfs/${CID_V1}/logo.png`);
    // Nexus's IpfsPathValidator rejects raw "//" and any "http://" substring, so the
    // sub-path must arrive percent-encoded in the single `path` param.
    expect(resolved).toContain(`/api/ipfs?path=${CID_V1}%2Flogo.png`);
  });

  // The proxy decodes the `path` param exactly once, and the gateway performs the
  // final URL decode — so the client must double-encode, never decode. A segment
  // whose literal name contains an encoded slash must not collapse into two segments.
  it('preserves percent-encoding in sub-path segments (double-encodes for the proxy)', () => {
    expect(resolveIcon(`https://ipfs.io/ipfs/${CID_V1}/a%2Fb.png`)).toContain(
      `/api/ipfs?path=${CID_V1}%2Fa%252Fb.png`,
    );
    expect(resolveIcon(`https://ipfs.io/ipfs/${CID_V1}/logo%20v2.png`)).toContain(
      `/api/ipfs?path=${CID_V1}%2Flogo%2520v2.png`,
    );
  });

  it('encodes ipfs:// sub-paths identically to gateway URLs for the same resource', () => {
    expect(resolveIcon(`ipfs://${CID_V1}/logo%20v2.png`)).toContain(
      `/api/ipfs?path=${CID_V1}%2Flogo%2520v2.png`,
    );
  });

  it('leaves authenticated dedicated-gateway URLs untouched', () => {
    // A gateway token is an access credential for privately-pinned content the
    // backend proxy cannot resolve — rewriting would strip it.
    const url = `https://brand.mypinata.cloud/ipfs/${CID_V1}?pinataGatewayToken=tok123`;
    expect(resolveIcon(url)).toBe(url);
  });

  it('still rewrites gateway URLs carrying only a cosmetic filename param', () => {
    expect(resolveIcon(`https://ipfs.io/ipfs/${CID_V1}?filename=logo.png`)).toContain(
      `/api/ipfs?path=${CID_V1}`,
    );
  });

  it('leaves ordinary https image URLs untouched', () => {
    const url = 'https://tokens.gerowallet.io/logo.png';
    expect(resolveIcon(url)).toBe(url);
  });

  it('does not hijack non-IPFS URLs that merely contain an /ipfs/ segment', () => {
    const url = 'https://example.com/ipfs/not-a-cid.png';
    expect(resolveIcon(url)).toBe(url);
  });

  it('leaves data: URIs untouched', () => {
    const uri = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveIcon(uri)).toBe(uri);
  });
});

describe('fromPlutusData — CIP-68 fungible tokens (label 333)', () => {
  // A 333 datum carries `logo`, never `image` (that is the 222/NFT field). Warning
  // about a missing `image` on every fungible token is noise that masks real failures.
  it('does not warn about "image" when the datum is a fungible token with a logo', () => {
    const result = fromPlutusData(
      cip68Datum(
        plutusMap({
          name: bytes('SONG') as Cardano.PlutusData,
          ticker: bytes('SONG') as Cardano.PlutusData,
          decimals: 6n,
          logo: bytes(`ipfs://${CID_V1}`) as Cardano.PlutusData,
        }),
      ),
    );

    expect(result).not.toBeNull();
    expect((result as Cip68Metadata | null)?.logo).toBe(`ipfs://${CID_V1}`);
    expect(debugLog).not.toHaveBeenCalledWith(expect.stringContaining('"image"'));
  });

  it('still warns when "image" is present but not decodable to a string', () => {
    const result = fromPlutusData(
      cip68Datum(
        plutusMap({
          name: bytes('Broken') as Cardano.PlutusData,
          // A map where a URI string was expected — genuinely malformed.
          image: plutusMap({ nested: bytes('x') as Cardano.PlutusData }) as Cardano.PlutusData,
        }),
      ),
    );

    expect(result).not.toBeNull();
    expect(result?.image).toBeUndefined();
    expect(debugLog).toHaveBeenCalledWith(expect.stringContaining('"image"'));
  });

  it('warns and drops a chunked image containing a non-bytes item instead of coercing garbage', () => {
    const result = fromPlutusData(
      cip68Datum(
        plutusMap({
          name: bytes('Mangled') as Cardano.PlutusData,
          // A chunk that is an int, not bounded bytes: naive string-coercion would
          // fabricate "ipfs://…42", which passes the typeof-string check unwarned.
          image: { items: [bytes(`ipfs://${CID_V1}`), 42n] } as Cardano.PlutusData,
        }),
      ),
    );

    expect(result?.image).toBeUndefined();
    expect(debugLog).toHaveBeenCalledWith(expect.stringContaining('"image"'));
  });

  it('reads a chunked (multi-item list) image, as long URIs are stored on chain', () => {
    const uri = `ipfs://${CID_V1}`;
    const half = Math.ceil(uri.length / 2);
    const result = fromPlutusData(
      cip68Datum(
        plutusMap({
          name: bytes('Chunked') as Cardano.PlutusData,
          image: {
            items: [bytes(uri.slice(0, half)), bytes(uri.slice(half))],
          } as Cardano.PlutusData,
        }),
      ),
    );

    expect(result?.image).toBe(uri);
    expect(debugLog).not.toHaveBeenCalledWith(expect.stringContaining('"image"'));
  });
});
