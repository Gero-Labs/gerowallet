import { describe, it, expect } from 'vitest';
import {
  anchorHashOfBytes,
  buildCip119Anchor,
  buildCip119Document,
  encodeCip119,
  isAnchorUrl,
  isPaymentAddress,
  serializeCip119,
  validateCip119Profile,
  verifyUploadedBytes,
  MAX_ANCHOR_URL_LENGTH,
  MAX_GIVEN_NAME_LENGTH,
  MAX_PROSE_LENGTH,
  MAX_REFERENCES,
  type Cip119Profile,
} from '@/shared/utils/cip119';

const PROFILE: Cip119Profile = {
  givenName: 'Gero Test DRep',
  objectives: 'Keep self-custody simple.',
  motivations: 'I build wallets.',
  qualifications: 'Ten years shipping Cardano tooling.',
  paymentAddress:
    'addr1qxck3xjmnvlpn3lyfvrxhx0k7d2mcsz5fzhpn8v7ss4vwhk2akaxldknpvrqfrepnthdlspf98jefvcmyyhjaqx9vjqsknpe6h',
};

describe('blake2b conformance', () => {
  // The published BLAKE2b-256 digest of the empty input. If this ever fails the
  // hashing primitive changed underneath us and every anchor hash is suspect —
  // it is the reason this test exists rather than only testing our own output.
  it('matches the known BLAKE2b-256 digest of the empty input', () => {
    expect(anchorHashOfBytes(encodeCip119(''))).toBe(
      '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8'
    );
  });

  it('produces a 64-character lowercase hex digest', () => {
    expect(buildCip119Anchor(PROFILE).hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('buildCip119Document', () => {
  it('always emits an empty authors array (CIP-119 has no author witnesses)', () => {
    expect(buildCip119Document(PROFILE).authors).toEqual([]);
  });

  it('declares blake2b-256 as the hash algorithm', () => {
    expect(buildCip119Document(PROFILE).hashAlgorithm).toBe('blake2b-256');
  });

  it('carries the CIP-100 and CIP-119 context terms', () => {
    const context = buildCip119Document(PROFILE)['@context'] as Record<string, unknown>;
    expect(context['@language']).toBe('en-us');
    expect(context['CIP119']).toContain('CIP-0119');
    expect(context['CIP100']).toContain('CIP-0100');
  });

  it('trims whitespace off every field', () => {
    const body = buildCip119Document({ ...PROFILE, givenName: '  Padded Name  ' }).body;
    expect(body.givenName).toBe('Padded Name');
  });

  it('omits optional fields rather than emitting empty strings', () => {
    const body = buildCip119Document({ ...PROFILE, paymentAddress: '   ' }).body;
    expect('paymentAddress' in body).toBe(false);
  });

  it('omits required fields that are blank instead of inventing a value', () => {
    const body = buildCip119Document({ ...PROFILE, objectives: '' }).body;
    expect('objectives' in body).toBe(false);
  });

  it('emits an image as a schema.org ImageObject, with sha256 only when given', () => {
    const withHash = buildCip119Document({
      ...PROFILE,
      image: { contentUrl: 'https://example.org/a.png', sha256: 'abc' },
    }).body;
    expect(withHash.image).toEqual({
      '@type': 'ImageObject',
      contentUrl: 'https://example.org/a.png',
      sha256: 'abc',
    });

    const withoutHash = buildCip119Document({
      ...PROFILE,
      image: { contentUrl: 'https://example.org/a.png' },
    }).body;
    expect(withoutHash.image).toEqual({
      '@type': 'ImageObject',
      contentUrl: 'https://example.org/a.png',
    });
  });

  it('defaults a reference to @type Link and drops half-filled rows', () => {
    const body = buildCip119Document({
      ...PROFILE,
      references: [
        { label: 'Site', uri: 'https://example.org' },
        { label: '', uri: 'https://example.org/orphan' },
        { type: 'Identity', label: 'X', uri: 'https://x.com/example' },
      ],
    }).body;
    expect(body.references).toEqual([
      { '@type': 'Link', label: 'Site', uri: 'https://example.org' },
      { '@type': 'Identity', label: 'X', uri: 'https://x.com/example' },
    ]);
  });

  it('omits references entirely when none survive', () => {
    const body = buildCip119Document({ ...PROFILE, references: [{ label: '', uri: '' }] }).body;
    expect('references' in body).toBe(false);
  });
});

describe('serialization determinism', () => {
  it('produces identical bytes for the same profile', () => {
    expect(buildCip119Anchor(PROFILE).text).toBe(buildCip119Anchor(PROFILE).text);
  });

  it('is independent of the order the profile keys were written in', () => {
    const reordered: Cip119Profile = {
      qualifications: PROFILE.qualifications,
      paymentAddress: PROFILE.paymentAddress,
      motivations: PROFILE.motivations,
      objectives: PROFILE.objectives,
      givenName: PROFILE.givenName,
    };
    expect(buildCip119Anchor(reordered).hash).toBe(buildCip119Anchor(PROFILE).hash);
  });

  it('emits body keys in a fixed alphabetical order', () => {
    const body = buildCip119Document({
      ...PROFILE,
      image: { contentUrl: 'https://example.org/a.png' },
      references: [{ label: 'Site', uri: 'https://example.org' }],
    }).body;
    expect(Object.keys(body)).toEqual([
      'givenName',
      'image',
      'motivations',
      'objectives',
      'paymentAddress',
      'qualifications',
      'references',
    ]);
  });

  it('ends without a trailing newline, because the raw bytes are the hash', () => {
    const { text } = buildCip119Anchor(PROFILE);
    expect(text.endsWith('}')).toBe(true);
    expect(text.endsWith('\n')).toBe(false);
  });

  it('hashes exactly the bytes it hands out for hosting', () => {
    const anchor = buildCip119Anchor(PROFILE);
    expect(anchorHashOfBytes(encodeCip119(anchor.text))).toBe(anchor.hash);
    expect(anchor.bytes).toEqual(encodeCip119(anchor.text));
  });

  it('does NOT canonicalize: reserializing a reordered parse changes the hash', () => {
    // Proof that the anchor is over raw bytes. A JCS/RDF-canonicalizing
    // implementation would return the same hash for both of these.
    const anchor = buildCip119Anchor(PROFILE);
    const parsed = JSON.parse(anchor.text) as Record<string, unknown>;
    const shuffled = JSON.stringify(
      { body: parsed['body'], authors: parsed['authors'], hashAlgorithm: parsed['hashAlgorithm'] },
      null,
      2
    );
    expect(anchorHashOfBytes(encodeCip119(shuffled))).not.toBe(anchor.hash);
  });

  it('is UTF-8 encoded, so non-ASCII names change the byte length', () => {
    const ascii = buildCip119Anchor({ ...PROFILE, givenName: 'Ana' });
    const accented = buildCip119Anchor({ ...PROFILE, givenName: 'Anä' });
    expect(accented.bytes.length).toBe(ascii.bytes.length + 1);
    expect(accented.hash).not.toBe(ascii.hash);
  });
});

describe('hash stability (pinned vector)', () => {
  // Computed once from this exact PROFILE and pinned. A change here means the
  // document shape, the key order, or the indentation moved — all of which
  // invalidate anchors already published by earlier builds, so it must be a
  // deliberate decision, not a drive-by edit.
  const PINNED_HASH = '3cb47c310b41dfa8d88904a26f0501b3804ffcb6732555a6f5b69f13a53b03ef';

  it('reproduces the pinned hash', () => {
    expect(buildCip119Anchor(PROFILE).hash).toBe(PINNED_HASH);
  });

  it('reproduces the pinned byte length', () => {
    expect(buildCip119Anchor(PROFILE).bytes.length).toBe(1891);
  });

  it('changes when any published field changes', () => {
    expect(buildCip119Anchor({ ...PROFILE, givenName: 'Someone Else' }).hash).not.toBe(PINNED_HASH);
    expect(buildCip119Anchor({ ...PROFILE, paymentAddress: undefined }).hash).not.toBe(PINNED_HASH);
  });

  it('round-trips through serialize + encode', () => {
    const document = buildCip119Document(PROFILE);
    expect(anchorHashOfBytes(encodeCip119(serializeCip119(document)))).toBe(PINNED_HASH);
  });
});

describe('verifyUploadedBytes', () => {
  it('verifies the exact bytes that were built', () => {
    const anchor = buildCip119Anchor(PROFILE);
    const result = verifyUploadedBytes(anchor.hash, anchor.bytes);
    expect(result.verified).toBe(true);
    expect(result.hash).toBe(anchor.hash);
  });

  it('rejects a file the host reformatted', () => {
    const anchor = buildCip119Anchor(PROFILE);
    const reindented = encodeCip119(JSON.stringify(JSON.parse(anchor.text)));
    expect(verifyUploadedBytes(anchor.hash, reindented).verified).toBe(false);
  });

  it('rejects a file that gained a trailing newline on save', () => {
    const anchor = buildCip119Anchor(PROFILE);
    expect(verifyUploadedBytes(anchor.hash, encodeCip119(anchor.text + '\n')).verified).toBe(false);
  });

  it('rejects a file whose content was edited after download', () => {
    const anchor = buildCip119Anchor(PROFILE);
    const tampered = buildCip119Anchor({ ...PROFILE, objectives: 'Something else entirely.' });
    expect(verifyUploadedBytes(anchor.hash, tampered.bytes).verified).toBe(false);
  });

  it('is case-insensitive about the expected hash but never verifies a blank one', () => {
    const anchor = buildCip119Anchor(PROFILE);
    expect(verifyUploadedBytes(anchor.hash.toUpperCase(), anchor.bytes).verified).toBe(true);
    expect(verifyUploadedBytes('', anchor.bytes).verified).toBe(false);
  });

  it('reports the uploaded file hash so a mismatch can be shown side by side', () => {
    const anchor = buildCip119Anchor(PROFILE);
    const other = buildCip119Anchor({ ...PROFILE, givenName: 'Other' });
    const result = verifyUploadedBytes(anchor.hash, other.bytes);
    expect(result.hash).toBe(other.hash);
    expect(result.expectedHash).toBe(anchor.hash);
  });
});

describe('isPaymentAddress', () => {
  it('accepts mainnet and testnet payment addresses', () => {
    expect(isPaymentAddress(PROFILE.paymentAddress)).toBe(true);
    expect(
      isPaymentAddress(
        'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x'
      )
    ).toBe(true);
  });

  it('tolerates whitespace from a paste', () => {
    expect(isPaymentAddress(`  ${PROFILE.paymentAddress}  `)).toBe(true);
  });

  it('rejects a stake address, a DRep id and a URL', () => {
    expect(
      isPaymentAddress('stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw')
    ).toBe(false);
    expect(isPaymentAddress('drep1yfrr09kj5wtz8f2yr602k9v5ctfpl9kj54z0f8uzhsprhlcw09j6x')).toBe(false);
    expect(isPaymentAddress('https://example.org')).toBe(false);
  });

  it('rejects blank and nullish input', () => {
    expect(isPaymentAddress('')).toBe(false);
    expect(isPaymentAddress(null)).toBe(false);
    expect(isPaymentAddress(undefined)).toBe(false);
  });

  it('rejects characters outside the bech32 data charset', () => {
    expect(isPaymentAddress('addr1qxck3xjmnvlpn3lyfvrxhx0k7d2mcsz5fzhpn8v7ss4vwhkb')).toBe(false);
  });
});

describe('isAnchorUrl', () => {
  it('accepts http and https', () => {
    expect(isAnchorUrl('https://example.org/drep.jsonld')).toBe(true);
    expect(isAnchorUrl('http://example.org/drep.jsonld')).toBe(true);
  });

  it('rejects ipfs:, because the builder requires an http(s) scheme', () => {
    expect(isAnchorUrl('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).toBe(false);
  });

  it('rejects schemes that must never reach an on-chain anchor', () => {
    expect(isAnchorUrl('javascript:alert(1)')).toBe(false);
    expect(isAnchorUrl('data:application/json,{}')).toBe(false);
    expect(isAnchorUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects a URL past the builder length cap', () => {
    expect(isAnchorUrl('https://example.org/' + 'a'.repeat(MAX_ANCHOR_URL_LENGTH))).toBe(false);
    expect(isAnchorUrl('https://e.org/' + 'a'.repeat(MAX_ANCHOR_URL_LENGTH - 14))).toBe(true);
  });

  it('rejects blank input and embedded whitespace', () => {
    expect(isAnchorUrl('   ')).toBe(false);
    expect(isAnchorUrl('https://example.org/a b')).toBe(false);
  });
});

describe('validateCip119Profile', () => {
  it('passes a complete profile', () => {
    expect(validateCip119Profile(PROFILE)).toEqual([]);
  });

  it('flags each missing required field, in field order', () => {
    const issues = validateCip119Profile({
      givenName: '',
      objectives: '  ',
      motivations: '',
      qualifications: '',
    });
    expect(issues.map((issue) => issue.field)).toEqual([
      'givenName',
      'objectives',
      'motivations',
      'qualifications',
    ]);
    expect(issues.every((issue) => issue.code === 'required')).toBe(true);
  });

  it('flags over-length prose and names', () => {
    expect(
      validateCip119Profile({ ...PROFILE, givenName: 'a'.repeat(MAX_GIVEN_NAME_LENGTH + 1) })
    ).toEqual([{ field: 'givenName', code: 'tooLong' }]);
    expect(
      validateCip119Profile({ ...PROFILE, objectives: 'a'.repeat(MAX_PROSE_LENGTH + 1) })
    ).toEqual([{ field: 'objectives', code: 'tooLong' }]);
  });

  it('accepts a profile at exactly the length limits', () => {
    expect(
      validateCip119Profile({
        ...PROFILE,
        givenName: 'a'.repeat(MAX_GIVEN_NAME_LENGTH),
        objectives: 'a'.repeat(MAX_PROSE_LENGTH),
      })
    ).toEqual([]);
  });

  it('treats the payment address as optional but validates it when present', () => {
    expect(validateCip119Profile({ ...PROFILE, paymentAddress: undefined })).toEqual([]);
    expect(validateCip119Profile({ ...PROFILE, paymentAddress: 'not-an-address' })).toEqual([
      { field: 'paymentAddress', code: 'invalidAddress' },
    ]);
  });

  it('flags a half-filled reference row and an unusable reference scheme', () => {
    expect(
      validateCip119Profile({ ...PROFILE, references: [{ label: 'Site', uri: '' }] })
    ).toEqual([{ field: 'references', code: 'required' }]);
    expect(
      validateCip119Profile({ ...PROFILE, references: [{ label: 'X', uri: 'javascript:alert(1)' }] })
    ).toEqual([{ field: 'references', code: 'invalidUri' }]);
  });

  it('allows ipfs: for a reference even though the anchor URL may not use it', () => {
    expect(
      validateCip119Profile({ ...PROFILE, references: [{ label: 'Doc', uri: 'ipfs://bafy' }] })
    ).toEqual([]);
  });

  it('ignores a completely empty reference row', () => {
    expect(validateCip119Profile({ ...PROFILE, references: [{ label: '', uri: '' }] })).toEqual([]);
  });

  it('flags too many references', () => {
    const references = Array.from({ length: MAX_REFERENCES + 1 }, (_unused, index) => ({
      label: `Link ${index}`,
      uri: `https://example.org/${index}`,
    }));
    expect(validateCip119Profile({ ...PROFILE, references })).toEqual([
      { field: 'references', code: 'tooMany' },
    ]);
  });

  it('rejects an image URL with an unusable scheme', () => {
    expect(
      validateCip119Profile({ ...PROFILE, image: { contentUrl: 'javascript:alert(1)' } })
    ).toEqual([{ field: 'image', code: 'invalidUri' }]);
  });
});
