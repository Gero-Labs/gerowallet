/**
 * Verifies a response signed by one of Gero's services (profile `gero-v1`).
 *
 * The profile is a fixed subset of HTTP Message Signatures (RFC 9421) with
 * Ed25519. A signed response carries:
 *
 *   Gero-Body-Digest:    sha-256=:<SHA-256 of the body as the wallet receives it, decompressed>:
 *   Gero-Request-Digest: sha-256=:<SHA-256 of the request body the server read>:
 *   Gero-Chain-Tip:      <slot>,<block hash>          (optional, chain-state answers only)
 *   Signature-Input:     gero=("@method";req "@path";req "@query";req "@status"
 *                          "gero-request-digest" "gero-body-digest"[ "gero-chain-tip"]);
 *                          created=<s>;expires=<s>;keyid="<kid>";alg="ed25519";tag="gero-v1"
 *   Signature:           gero=:<base64 Ed25519 signature over the signature base>:
 *
 * The signature covers the request's method, path and query, and the digest of
 * the body the wallet sent, so a signed answer to one request cannot be served
 * as the answer to another. `created` and `expires` bound how long it may be
 * replayed for the identical request.
 *
 * Only this exact form of the `gero` signature is accepted: any other component
 * list, parameter order or algorithm is refused, so the signature base rebuilt
 * here is byte for byte the one the server signed. Other labels in the same
 * headers (a newer profile sent beside this one during a migration) are ignored.
 * The shared vectors in `signedResponse.vectors.json` pin it across the wallet
 * and gero-backend.
 *
 * This module decides nothing about keys. `KeyResolver` maps a key id and the
 * host that answered to a public key (`signedResponseRoots.ts` builds one from
 * root-signed delegations); an unknown key is a failure.
 */
import * as ed25519 from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha2.js';

export const SIGNED_RESPONSE_PROFILE = 'gero-v1';

const BASE_COMPONENTS = [
  '"@method";req',
  '"@path";req',
  '"@query";req',
  '"@status"',
  '"gero-request-digest"',
  '"gero-body-digest"',
] as const;
const TIP_COMPONENT = '"gero-chain-tip"';

/** Clock skew allowed on `created` and `expires`. */
export const SIGNED_RESPONSE_SKEW_SECONDS = 120;
/** Longest `expires - created` accepted. */
export const SIGNED_RESPONSE_MAX_LIFETIME_SECONDS = 3600;

export type SignedResponseFailure =
  | 'unsigned'
  | 'malformed'
  | 'unverifiable-request'
  | 'unverifiable-response'
  | 'unknown-key'
  | 'not-yet-valid'
  | 'expired'
  | 'lifetime-too-long'
  | 'request-digest-mismatch'
  | 'body-digest-mismatch'
  | 'bad-signature';

export class UnsignedResponseError extends Error {
  constructor(readonly reason: SignedResponseFailure) {
    super(`The answer could not be verified as coming from Gero (${reason}).`);
    this.name = 'UnsignedResponseError';
  }
}

export interface KeyResolver {
  /** The 32-byte Ed25519 public key `keyid` may sign with for `hostname`, or undefined. */
  resolve(keyid: string, hostname: string, nowSeconds: number): Uint8Array | undefined;
}

export interface SignedExchange {
  request: {
    method: string;
    /** The full URL as sent, query included. */
    url: string;
    /** The request body as sent; undefined or empty for none. Undefined is not "unknown". */
    body: Uint8Array | undefined;
  };
  response: {
    status: number;
    /** Header lookup, case-insensitive; undefined when absent. */
    header: (name: string) => string | undefined;
    /** The body as received, after content decoding. */
    body: Uint8Array;
  };
}

export interface ChainTip {
  slot: number;
  hash: string;
}

export type SignedResponseResult =
  | { ok: true; keyid: string; chainTip?: ChainTip }
  | { ok: false; reason: SignedResponseFailure };

/** The failure reason of a result, or undefined when it verified. */
export function failureReason(result: SignedResponseResult): SignedResponseFailure | undefined {
  return result.ok ? undefined : (result as Extract<SignedResponseResult, { ok: false }>).reason;
}

export interface VerifyOptions {
  keys: KeyResolver;
  nowSeconds: number;
  skewSeconds?: number;
  maxLifetimeSeconds?: number;
}

const DIGEST_RE = /^sha-256=:([A-Za-z0-9+/]{43}=):$/;
/** The label this profile signs under. Other labels in the same headers belong to other profiles. */
export const SIGNATURE_LABEL = 'gero';

const SIGNATURE_RE = /^:([A-Za-z0-9+/]{86}==):$/;
const SIGNATURE_INPUT_RE =
  /^\(([^()]*)\);created=(\d{1,12});expires=(\d{1,12});keyid="([A-Za-z0-9._-]{1,64})";alg="ed25519";tag="gero-v1"$/;
const CHAIN_TIP_RE = /^(\d{1,15}),([0-9a-f]{64})$/;

export function bytesFromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** The `sha-256=:…:` header value for `bytes`. */
export function digestHeaderValue(bytes: Uint8Array): string {
  return `sha-256=:${base64FromBytes(sha256(bytes))}:`;
}

export interface ParsedSignatureInput {
  /** The member value after `gero=`, used verbatim as `@signature-params`. */
  params: string;
  withChainTip: boolean;
  created: number;
  expires: number;
  keyid: string;
}

/**
 * Splits an RFC 8941 dictionary at its top-level commas, leaving commas inside inner lists and
 * quoted strings alone. Null for unbalanced parentheses or an unterminated string.
 */
function splitDictionary(text: string): string[] | null {
  const members: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth < 0) return null;
    } else if (c === ',' && depth === 0) {
      members.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (inString || depth !== 0) return null;
  members.push(text.slice(start));
  return members;
}

/**
 * The value of member `label` in an RFC 8941 dictionary header (Signature, Signature-Input).
 * Other members are ignored, so a server can send a newer profile's signature beside this one
 * and released wallets keep verifying theirs. Undefined when the member is absent; null when
 * the header does not parse or names the member twice (ambiguous, so never chosen between).
 */
export function dictionaryMember(header: string | undefined, label: string): string | null | undefined {
  if (!header) return undefined;
  const members = splitDictionary(header);
  if (!members) return null;
  let value: string | undefined;
  let seen = 0;
  for (const member of members) {
    const eq = member.indexOf('=');
    const key = (eq < 0 ? member : member.slice(0, eq)).trim();
    if (key !== label) continue;
    seen++;
    value = eq < 0 ? '' : member.slice(eq + 1).trim();
  }
  if (seen > 1) return null;
  return value;
}

/** Parses the one Signature-Input form this profile allows; undefined for anything else. */
export function parseSignatureInput(value: string | undefined): ParsedSignatureInput | undefined {
  const member = dictionaryMember(value, SIGNATURE_LABEL);
  if (!member) return undefined;
  const match = SIGNATURE_INPUT_RE.exec(member);
  if (!match) return undefined;
  const [, items, created, expires, keyid] = match;
  const base = BASE_COMPONENTS.join(' ');
  let withChainTip: boolean;
  if (items === base) withChainTip = false;
  else if (items === `${base} ${TIP_COMPONENT}`) withChainTip = true;
  else return undefined;
  return {
    params: member,
    withChainTip,
    created: Number(created),
    expires: Number(expires),
    keyid,
  };
}

export interface SignatureBaseParts {
  method: string;
  path: string;
  /** The raw query string without `?`; empty for none. */
  query: string;
  status: number;
  requestDigest: string;
  bodyDigest: string;
  chainTip?: string;
  params: string;
}

/** The RFC 9421 signature base for this profile. Lines joined by LF, no trailing LF. */
export function buildSignatureBase(parts: SignatureBaseParts): string {
  const lines = [
    `"@method";req: ${parts.method.toUpperCase()}`,
    `"@path";req: ${parts.path || '/'}`,
    `"@query";req: ?${parts.query}`,
    `"@status": ${parts.status}`,
    `"gero-request-digest": ${parts.requestDigest}`,
    `"gero-body-digest": ${parts.bodyDigest}`,
  ];
  if (parts.chainTip !== undefined) lines.push(`"gero-chain-tip": ${parts.chainTip}`);
  lines.push(`"@signature-params": ${parts.params}`);
  return lines.join('\n');
}

/**
 * Checks one exchange. Never throws: every failure comes back as a reason, and
 * the caller decides what a failure means (shadow: report; enforce: refuse).
 */
export async function verifySignedResponse(
  exchange: SignedExchange,
  options: VerifyOptions,
): Promise<SignedResponseResult> {
  try {
    return await verify(exchange, options);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

async function verify(exchange: SignedExchange, options: VerifyOptions): Promise<SignedResponseResult> {
  const { request, response } = exchange;
  const signatureHeader = response.header('signature');
  const inputHeader = response.header('signature-input');
  const signatureMember = dictionaryMember(signatureHeader, SIGNATURE_LABEL);
  const inputMember = dictionaryMember(inputHeader, SIGNATURE_LABEL);
  // No `gero` signature at all (none, or only another profile's): unsigned for this profile.
  if (signatureMember === undefined && inputMember === undefined) return { ok: false, reason: 'unsigned' };

  const input = parseSignatureInput(inputHeader);
  const signatureMatch = typeof signatureMember === 'string' ? SIGNATURE_RE.exec(signatureMember) : null;
  if (!input || !signatureMatch) return { ok: false, reason: 'malformed' };

  // Freshness before anything costly.
  const skew = options.skewSeconds ?? SIGNED_RESPONSE_SKEW_SECONDS;
  const maxLifetime = options.maxLifetimeSeconds ?? SIGNED_RESPONSE_MAX_LIFETIME_SECONDS;
  if (input.expires <= input.created) return { ok: false, reason: 'malformed' };
  if (input.expires - input.created > maxLifetime) return { ok: false, reason: 'lifetime-too-long' };
  if (input.created > options.nowSeconds + skew) return { ok: false, reason: 'not-yet-valid' };
  if (input.expires < options.nowSeconds - skew) return { ok: false, reason: 'expired' };

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { ok: false, reason: 'unverifiable-request' };
  }

  const publicKey = options.keys.resolve(input.keyid, url.hostname, options.nowSeconds);
  if (!publicKey || publicKey.length !== 32) return { ok: false, reason: 'unknown-key' };

  // The server states what it read; it must be what the wallet sent.
  const requestDigest = digestHeaderValue(request.body ?? new Uint8Array(0));
  const statedRequestDigest = response.header('gero-request-digest')?.trim();
  if (!statedRequestDigest || !DIGEST_RE.test(statedRequestDigest)) return { ok: false, reason: 'malformed' };
  if (statedRequestDigest !== requestDigest) return { ok: false, reason: 'request-digest-mismatch' };

  const bodyDigest = digestHeaderValue(response.body);
  const statedBodyDigest = response.header('gero-body-digest')?.trim();
  if (!statedBodyDigest || !DIGEST_RE.test(statedBodyDigest)) return { ok: false, reason: 'malformed' };
  if (statedBodyDigest !== bodyDigest) return { ok: false, reason: 'body-digest-mismatch' };

  let chainTip: ChainTip | undefined;
  let chainTipValue: string | undefined;
  if (input.withChainTip) {
    chainTipValue = response.header('gero-chain-tip')?.trim();
    const tip = chainTipValue ? CHAIN_TIP_RE.exec(chainTipValue) : null;
    if (!tip) return { ok: false, reason: 'malformed' };
    chainTip = { slot: Number(tip[1]), hash: tip[2] };
  }

  const base = buildSignatureBase({
    method: request.method,
    path: url.pathname,
    query: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    status: response.status,
    requestDigest,
    bodyDigest,
    chainTip: chainTipValue,
    params: input.params,
  });
  const signature = bytesFromBase64(signatureMatch[1]);
  const valid = await ed25519.verifyAsync(signature, new TextEncoder().encode(base), publicKey, { zip215: false });
  if (!valid) return { ok: false, reason: 'bad-signature' };
  return chainTip ? { ok: true, keyid: input.keyid, chainTip } : { ok: true, keyid: input.keyid };
}
