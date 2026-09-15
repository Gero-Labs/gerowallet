/**
 * CIP-119 DRep metadata: build the JSON-LD document from the registration form,
 * serialize it, and compute the anchor hash that goes on-chain.
 *
 * ## The hashing rule (read before changing anything here)
 *
 * The anchor `dataHash` in a `reg_drep_cert` is `blake2b-256` over the RAW BYTES
 * of the hosted file — the exact octets an anchor resolver downloads. It is NOT
 * computed over a canonicalized form. CIP-100 canonicalization (RDF/URDNA2015)
 * exists only so that *author witnesses* can be signed over a stable form, and
 * CIP-119 deliberately omits author witnesses: `authors` stays an empty array.
 * So: serialize once, hash those bytes, publish those same bytes. No re-indent,
 * no key reordering, no trailing-newline games — every one of those changes the
 * hash and breaks verification for everyone reading the chain.
 *
 * `serializeCip119` is therefore the single source of the bytes: the download,
 * the clipboard copy, and the hash all go through it, and the file the user
 * uploads back must be byte-identical.
 *
 * ## blake2b
 *
 * Uses `blakejs` (already a direct dependency; `src/services/crossDevice/envelope.ts`
 * hashes the same way). It is pure JS and synchronous, so this module stays a pure
 * util that runs unchanged in the extension and under vitest. No WASM init, no
 * new dependency.
 */

import { blake2bHex } from 'blakejs';

/** A CIP-119 `references[]` entry. `Link` is the ordinary "here is my website" case. */
export interface Cip119Reference {
  /** CIP-119 reference class. Defaults to `Link`. */
  type?: 'Identity' | 'Link' | 'Other';
  label: string;
  uri: string;
}

/** A CIP-119 `image` (schema.org ImageObject). `contentUrl` may be a data: URI. */
export interface Cip119Image {
  contentUrl: string;
  /** Optional integrity hash of the image bytes, as CIP-119 defines it. */
  sha256?: string;
}

/** The form fields the Become-a-DRep flow collects. */
export interface Cip119Profile {
  givenName: string;
  objectives: string;
  motivations: string;
  qualifications: string;
  /** Optional address delegators can send CIP-149 support to. */
  paymentAddress?: string;
  image?: Cip119Image;
  references?: Cip119Reference[];
}

/** The `body` object as it is serialized. Optional fields are omitted, never emitted empty. */
export interface Cip119Body {
  givenName?: string;
  image?: { '@type': 'ImageObject'; contentUrl: string; sha256?: string };
  motivations?: string;
  objectives?: string;
  paymentAddress?: string;
  qualifications?: string;
  references?: { '@type': string; label: string; uri: string }[];
}

/** The full JSON-LD document. `authors` is always empty — CIP-119 has no author witnesses. */
export interface Cip119Document {
  '@context': Record<string, unknown>;
  hashAlgorithm: 'blake2b-256';
  authors: never[];
  body: Cip119Body;
}

/** Everything the UI needs after building: the doc, the exact bytes, and their hash. */
export interface Cip119Anchor {
  document: Cip119Document;
  /** The exact text that must be hosted, byte-for-byte. */
  text: string;
  /** UTF-8 encoding of `text` — what the hash is taken over. */
  bytes: Uint8Array;
  /** blake2b-256 of `bytes`, lowercase hex, 64 chars. */
  hash: string;
}

/** Result of comparing a re-uploaded file against the locally built document. */
export interface Cip119Verification {
  verified: boolean;
  /** Hash of the bytes that were uploaded. */
  hash: string;
  expectedHash: string;
}

/** A validation failure, as a stable code the view maps to an i18n key. */
export interface Cip119Issue {
  field: keyof Cip119Profile | 'anchorUrl';
  code: 'required' | 'tooLong' | 'invalidAddress' | 'invalidUri' | 'tooMany';
}

// ── Limits ──
//
// givenName/objectives/motivations/qualifications lengths follow the CIP-119
// recommendations that the ecosystem tools (gov.tools) also enforce. The
// anchor-URL limit is NOT ours: Nexus's BuildDRepRegistrationTxRequest caps
// anchorUrl at 128 characters and requires an http(s) scheme, so a longer or
// ipfs:// URL is rejected server-side. Catch it in the form instead.

export const MAX_GIVEN_NAME_LENGTH = 80;
export const MAX_PROSE_LENGTH = 1000;
export const MAX_PAYMENT_ADDRESS_LENGTH = 256;
export const MAX_ANCHOR_URL_LENGTH = 128;
export const MAX_REFERENCES = 10;

/**
 * The CIP-119 `@context`. Frozen and emitted verbatim: it is part of the hashed
 * bytes, so editing it changes every hash this module produces.
 */
export const CIP119_CONTEXT: Record<string, unknown> = {
  '@language': 'en-us',
  CIP100: 'https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#',
  CIP119: 'https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#',
  hashAlgorithm: 'CIP100:hashAlgorithm',
  body: {
    '@id': 'CIP119:body',
    '@context': {
      references: {
        '@id': 'CIP119:references',
        '@container': '@set',
        '@context': {
          GovernanceMetadata: 'CIP100:GovernanceMetadataReference',
          Identity: 'CIP119:IdentityReference',
          Link: 'CIP119:LinkReference',
          Other: 'CIP100:OtherReference',
          label: 'CIP100:reference-label',
          uri: 'CIP100:reference-uri',
        },
      },
      paymentAddress: 'CIP119:paymentAddress',
      givenName: 'CIP119:givenName',
      image: 'CIP119:image',
      objectives: 'CIP119:objectives',
      motivations: 'CIP119:motivations',
      qualifications: 'CIP119:qualifications',
      doNotList: 'CIP119:doNotList',
    },
  },
  authors: {
    '@id': 'CIP100:authors',
    '@container': '@set',
    '@context': {
      name: 'http://xmlns.com/foaf/0.1/name',
      witness: {
        '@id': 'CIP100:witness',
        '@context': {
          witnessAlgorithm: 'CIP100:witnessAlgorithm',
          publicKey: 'CIP100:publicKey',
          signature: 'CIP100:signature',
        },
      },
    },
  },
};

const trimmed = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * True when `value` looks like a Cardano payment address for either network.
 *
 * This is a prefix + shape check, matching the guard `useWithdrawal.ts` already
 * applies to a DRep's CIP-149 payment address — it does NOT verify the bech32
 * checksum. It exists to stop obvious paste errors (a stake address, a DRep id,
 * a URL) from being published as a payment address, not to prove spendability.
 */
export function isPaymentAddress(value: string | null | undefined): boolean {
  const address = trimmed(value);
  if (address.length < 20 || address.length > MAX_PAYMENT_ADDRESS_LENGTH) return false;
  if (!address.startsWith('addr1') && !address.startsWith('addr_test1')) return false;
  const body = address.slice(address.indexOf('1') + 1);
  // bech32 data charset: no 1, b, i or o.
  return body.length > 0 && /^[023456789acdefghjklmnpqrstuvwxyz]+$/.test(body);
}

/**
 * True when `value` is usable as the on-chain anchor URL.
 *
 * http(s) only, and within Nexus's 128-character cap. Deliberately narrow: the
 * wallet never fetches this URL, but it is published on-chain for everyone else
 * to open, so `javascript:`, `data:` and friends must never reach the certificate.
 * `ipfs://` is rejected too — Nexus's validator requires an http(s) scheme, so
 * IPFS has to be given as a gateway URL.
 */
export function isAnchorUrl(value: string | null | undefined): boolean {
  const url = trimmed(value);
  if (!url || url.length > MAX_ANCHOR_URL_LENGTH) return false;
  return /^https?:\/\/[^\s]+$/i.test(url);
}

/** Same scheme rule as the anchor, but reference URIs may also be ipfs:. */
function isReferenceUri(value: string | null | undefined): boolean {
  const uri = trimmed(value);
  if (!uri) return false;
  return /^(https?|ipfs):\/\/[^\s]+$/i.test(uri);
}

/**
 * Build the CIP-119 document. Total and deterministic: the same profile always
 * produces the same object with the same key order. Blank optional fields are
 * omitted rather than emitted as empty strings, so an untouched field never
 * lands in the published metadata.
 */
export function buildCip119Document(profile: Cip119Profile): Cip119Document {
  const body: Cip119Body = {};

  // Key order is fixed here and is part of the hashed bytes. Alphabetical, to
  // match how the rest of the ecosystem emits CIP-119.
  const givenName = trimmed(profile.givenName);
  if (givenName) body.givenName = givenName;

  const contentUrl = trimmed(profile.image?.contentUrl);
  if (contentUrl) {
    const sha256 = trimmed(profile.image?.sha256);
    body.image = sha256
      ? { '@type': 'ImageObject', contentUrl, sha256 }
      : { '@type': 'ImageObject', contentUrl };
  }

  const motivations = trimmed(profile.motivations);
  if (motivations) body.motivations = motivations;

  const objectives = trimmed(profile.objectives);
  if (objectives) body.objectives = objectives;

  const paymentAddress = trimmed(profile.paymentAddress);
  if (paymentAddress) body.paymentAddress = paymentAddress;

  const qualifications = trimmed(profile.qualifications);
  if (qualifications) body.qualifications = qualifications;

  const references = (profile.references ?? [])
    .map((reference) => ({
      '@type': reference.type ?? 'Link',
      label: trimmed(reference.label),
      uri: trimmed(reference.uri),
    }))
    .filter((reference) => reference.label !== '' && reference.uri !== '');
  if (references.length > 0) body.references = references;

  return {
    '@context': CIP119_CONTEXT,
    hashAlgorithm: 'blake2b-256',
    authors: [],
    body,
  };
}

/**
 * The document as the exact text to publish. Two-space indent, no trailing
 * newline — chosen once and never varied, because the bytes are the hash.
 */
export function serializeCip119(document: Cip119Document): string {
  return JSON.stringify(document, null, 2);
}

/** UTF-8 encode the serialized text. This is what gets hashed. */
export function encodeCip119(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** blake2b-256 of raw bytes, lowercase hex. The anchor `dataHash`. */
export function anchorHashOfBytes(bytes: Uint8Array): string {
  return blake2bHex(bytes, undefined, 32);
}

/** Build, serialize and hash in one step — everything the registration flow needs. */
export function buildCip119Anchor(profile: Cip119Profile): Cip119Anchor {
  const document = buildCip119Document(profile);
  const text = serializeCip119(document);
  const bytes = encodeCip119(text);
  return { document, text, bytes, hash: anchorHashOfBytes(bytes) };
}

/**
 * Compare bytes the user re-uploaded against the hash computed locally.
 *
 * This is how the flow proves the hosted file is the file that was built: the
 * wallet never fetches the anchor URL itself (the extension CSP forbids calling
 * out to an arbitrary author-controlled origin, and doing so would leak the
 * user's IP to that host), so the user downloads the file, hosts it, then hands
 * the same file back for a byte comparison.
 */
export function verifyUploadedBytes(expectedHash: string, bytes: Uint8Array): Cip119Verification {
  const hash = anchorHashOfBytes(bytes);
  const expected = trimmed(expectedHash).toLowerCase();
  return { verified: hash === expected && expected.length === 64, hash, expectedHash: expected };
}

/**
 * Field-level validation for the profile form. Returns stable codes; mapping to
 * copy is the view's job. Order is field order, so the first issue is the first
 * field to focus.
 */
export function validateCip119Profile(profile: Cip119Profile): Cip119Issue[] {
  const issues: Cip119Issue[] = [];

  const required: [keyof Cip119Profile, string, number][] = [
    ['givenName', trimmed(profile.givenName), MAX_GIVEN_NAME_LENGTH],
    ['objectives', trimmed(profile.objectives), MAX_PROSE_LENGTH],
    ['motivations', trimmed(profile.motivations), MAX_PROSE_LENGTH],
    ['qualifications', trimmed(profile.qualifications), MAX_PROSE_LENGTH],
  ];
  for (const [field, value, max] of required) {
    if (!value) issues.push({ field, code: 'required' });
    else if (value.length > max) issues.push({ field, code: 'tooLong' });
  }

  const paymentAddress = trimmed(profile.paymentAddress);
  if (paymentAddress && !isPaymentAddress(paymentAddress)) {
    issues.push({ field: 'paymentAddress', code: 'invalidAddress' });
  }

  const contentUrl = trimmed(profile.image?.contentUrl);
  if (contentUrl && !/^(https?|ipfs|data):/i.test(contentUrl)) {
    issues.push({ field: 'image', code: 'invalidUri' });
  }

  const references = profile.references ?? [];
  if (references.length > MAX_REFERENCES) issues.push({ field: 'references', code: 'tooMany' });
  // A half-filled row (label without uri, or an unusable scheme) is an error
  // rather than something to silently drop — the user typed it on purpose.
  for (const reference of references) {
    const label = trimmed(reference.label);
    const uri = trimmed(reference.uri);
    if (!label && !uri) continue;
    if (!label || !uri) {
      issues.push({ field: 'references', code: 'required' });
    } else if (!isReferenceUri(uri)) {
      issues.push({ field: 'references', code: 'invalidUri' });
    }
  }

  return issues;
}
