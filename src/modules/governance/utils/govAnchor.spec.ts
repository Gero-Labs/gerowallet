// The DRep avatar source.
//
// This replaced `drepImageUrl`, which resolved through `safeExternalHref` and so
// allowed http(s) only. Roughly half of mainnet's DReps publish an `ipfs://`
// avatar, and those were discarded before `DRepAvatar` could map them onto the
// backend proxy — so a DRep with a picture rendered as one without, silently.
// The two properties below are the ones that must both hold: `ipfs://` survives,
// and a hostile scheme still does not.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { drepImageSource, drepPayoutAddress } from './govAnchor';

const CID = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';

/** A CIP-119 record carrying whatever `contentUrl` the DRep published. */
const withImage = (contentUrl: unknown) => ({
  metadata: { meta_json: { body: { image: { contentUrl } } } },
});

describe('drepImageSource', () => {
  it('keeps an ipfs uri exactly as published, unmapped', () => {
    // Unmapped on purpose: `DRepAvatar` runs it through `toInAppImageUrl` and must
    // stay the single place that turns one into something loadable.
    expect(drepImageSource(withImage(`ipfs://${CID}`))).toBe(`ipfs://${CID}`);
  });

  it('keeps an https url', () => {
    expect(drepImageSource(withImage('https://example.org/a.png'))).toBe('https://example.org/a.png');
  });

  it('drops a plain http url, which could only be fetched in the clear and direct', () => {
    expect(drepImageSource(withImage('http://example.org/a.png'))).toBeUndefined();
  });

  it('drops a scheme the avatar could never load', () => {
    expect(drepImageSource(withImage('javascript:alert(1)'))).toBeUndefined();
    expect(drepImageSource(withImage('data:text/html,<script>x</script>'))).toBeUndefined();
  });

  it('is undefined when there is no picture, rather than an empty string', () => {
    expect(drepImageSource({})).toBeUndefined();
    expect(drepImageSource(null)).toBeUndefined();
    expect(drepImageSource(withImage('   '))).toBeUndefined();
    expect(drepImageSource(withImage(42))).toBeUndefined();
    expect(drepImageSource({ metadata: { meta_json: { body: {} } } })).toBeUndefined();
  });
});

// The CIP-149 payout address.
//
// `metadata` is upstream JSON-LD typed `unknown`, so this has to be WALKED. The
// view dotted straight through it, which TypeScript rejects on `unknown` — and
// nothing caught it, because `tsc --noEmit` skips `.vue` files and `vue-tsc` is
// not in CI.
//
// The property worth protecting is the address test itself. This is where a
// supporter's rewards are sent, and `isPaymentAddress` is NOT the right check:
// it is `Cardano.Address.isValid`, which accepts a stake address, and a stake
// address cannot receive a payout.
describe('drepPayoutAddress', () => {
  const withPayout = (paymentAddress: unknown) => ({
    metadata: { meta_json: { body: { paymentAddress } } },
  });

  it('returns a published mainnet or testnet payment address', () => {
    expect(drepPayoutAddress(withPayout('addr1qxyz'))).toBe('addr1qxyz');
    expect(drepPayoutAddress(withPayout('addr_test1qxyz'))).toBe('addr_test1qxyz');
  });

  it('rejects a stake address, which cannot receive a payout', () => {
    expect(drepPayoutAddress(withPayout('stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fce'))).toBeNull();
    expect(drepPayoutAddress(withPayout('stake_test1uq'))).toBeNull();
  });

  it('is null when the DRep published nothing usable', () => {
    for (const nothing of [undefined, null, '', 42, {}, [], '   ']) {
      expect(drepPayoutAddress(withPayout(nothing))).toBeNull();
    }
  });

  it('walks a missing or malformed metadata blob without throwing', () => {
    for (const record of [undefined, null, 42, 'string', {}, { metadata: null }, { metadata: 7 },
      { metadata: { meta_json: null } }, { metadata: { meta_json: { body: null } } }]) {
      expect(drepPayoutAddress(record)).toBeNull();
    }
  });

  it('trims surrounding whitespace rather than failing the prefix test', () => {
    expect(drepPayoutAddress(withPayout('  addr1qxyz  '))).toBe('addr1qxyz');
  });
});

describe('toInAppImageUrl', () => {
  const BACKEND = 'https://api.gerowallet.io';
  afterEach(() => vi.unstubAllEnvs());
  async function load() {
    vi.resetModules();
    vi.stubEnv('VITE_BACKEND_URL', BACKEND);
    return import('./govAnchor');
  }

  it('sends an https avatar through the image proxy, so the DRep\'s host never sees who looks', async () => {
    const { toInAppImageUrl } = await load();
    const avatar = 'https://drep.example/me.png';
    expect(toInAppImageUrl(avatar)).toBe(`${BACKEND}/api/img?url=${encodeURIComponent(avatar)}`);
  });

  it('sends IPFS through the IPFS proxy and drops everything else', async () => {
    const { toInAppImageUrl } = await load();
    expect(toInAppImageUrl(`ipfs://${CID}`)).toContain('/api/ipfs?path=');
    for (const bad of ['http://drep.example/me.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null]) {
      expect(toInAppImageUrl(bad)).toBeNull();
    }
  });

  it('sends a document through the anchor proxy, not the image proxy (images only)', async () => {
    const { toInAppDocumentUrl } = await load();
    const doc = 'https://drep.example/rationale.jsonld';
    expect(toInAppDocumentUrl(doc)).toBe(`${BACKEND}/api/anchor?url=${encodeURIComponent(doc)}`);
    expect(toInAppDocumentUrl(`ipfs://${CID}`)).toContain('/api/ipfs?path=');
  });

  it('does not fetch a plain http document at all', async () => {
    const { toInAppDocumentUrl, toExternalHref } = await load();
    expect(toInAppDocumentUrl('http://drep.example/rationale.jsonld')).toBeNull();
    // A new tab can still open it: the browser, not the wallet, contacts the host.
    expect(toExternalHref('http://drep.example/rationale.jsonld')).toBe('http://drep.example/rationale.jsonld');
  });
});

