/**
 * Which keys may sign Gero's responses.
 *
 * Two root keys, held offline on hardware wallets (one by each holder), approve
 * the online signing keys by signing a short statement through Cardano message
 * signing (CIP-8). The wallet pins the roots' public keys and accepts a signing
 * key only through a delegation one of them signed:
 *
 *   gero-signing/v1|delegation|kid=backend-2026-11|service=gero-backend|
 *     hosts=api.gerowallet.io|from=2026-11-01|until=2027-01-30|key=<64 hex>
 *
 * (one line, no spaces). `from` and `until` are UTC days; the key is valid from the
 * start of `from` until the start of `until`. A revocation, signed the same way,
 * withdraws key ids early:
 *
 *   gero-signing/v1|revocation|issued=2026-11-15|revoked=backend-2026-11,backend-2026-08
 *
 * Both are short enough (at most MAX_STATEMENT_BYTES) for a Ledger to show the whole
 * text and sign it unhashed, so the holder reads the key id, hosts, dates and key on
 * the device itself. A hashed signature is never accepted: the device would have shown
 * only a hash, and a hashed CIP-8 signature is the same bytes as a signature over the
 * 28-byte hash sent as an ordinary message.
 *
 * `gero-signing/` is a reserved signing domain (reservedSigningDomains.ts): Gero never
 * signs it for a dApp. The root account must still never be used for anything else
 * (a hidden wallet that holds no funds and never connects to a dApp), since another
 * wallet would sign it.
 */
import * as ed25519 from '@noble/ed25519';
import type { KeyResolver } from './signedResponse';

/**
 * Hex Ed25519 public keys of the two root keys. Empty until the key ceremony:
 * with no roots, no signing key is accepted, so verification can only fail.
 * Never add a test key here.
 */
export const PINNED_ROOT_KEYS: readonly string[] = [];

/** The reserved domain every root statement starts with. */
export const SIGNING_DOMAIN = 'gero-signing/v1';
export const DELEGATION_PREFIX = `${SIGNING_DOMAIN}|delegation|`;
export const REVOCATION_PREFIX = `${SIGNING_DOMAIN}|revocation|`;

/**
 * Longest statement a Ledger signs unhashed (cardano-js-sdk hashes a CIP-8 payload of
 * 198 bytes or more, the most the Cardano app shows as text).
 */
export const MAX_STATEMENT_BYTES = 197;

/** Services a delegation may name. */
export type SigningService = 'gero-backend' | 'gero-sync';
export const SIGNING_SERVICES: readonly SigningService[] = ['gero-backend', 'gero-sync'];

/** Longest delegation accepted: 90 days as issued, plus slack for an early ceremony. */
export const MAX_DELEGATION_DAYS = 100;
const DAY_SECONDS = 24 * 3600;

export interface Delegation {
  kid: string;
  publicKey: Uint8Array;
  service: SigningService;
  hosts: string[];
  notBefore: number;
  notAfter: number;
}

export interface RevocationList {
  issued: number;
  revoked: Set<string>;
}

/** `text` as a regular-expression literal. */
function literal(text: string): string {
  return text.replace(/[|.\\]/g, (c) => `\\${c}`);
}

const KID = '[A-Za-z0-9._-]{1,32}';
const HOST = '[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?';
const DAY = '\\d{4}-\\d{2}-\\d{2}';
const DELEGATION_RE = new RegExp(
  `^${literal(DELEGATION_PREFIX)}kid=(${KID})\\|service=(gero-backend|gero-sync)\\|hosts=(${HOST}(?:,${HOST})*)` +
    `\\|from=(${DAY})\\|until=(${DAY})\\|key=([0-9a-f]{64})$`,
);
const REVOCATION_RE = new RegExp(`^${literal(REVOCATION_PREFIX)}issued=(${DAY})\\|revoked=(${KID}(?:,${KID})*)$`);
const KID_RE = new RegExp(`^${KID}$`);
const HOST_RE = new RegExp(`^${HOST}$`);

/** Whether `kid` is a key id a statement may carry. */
export function isKeyId(kid: string): boolean {
  return KID_RE.test(kid);
}

/** Whether `host` is a host name a delegation may carry (lower case). */
export function isHost(host: string): boolean {
  return HOST_RE.test(host);
}

/** COSE algorithm id for EdDSA. */
const COSE_ALG_EDDSA = -8;

export function hexToBytes(hex: string): Uint8Array | undefined {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Seconds at the start of a UTC day written `YYYY-MM-DD`, or undefined for a date that does not exist. */
export function daySeconds(day: string): number | undefined {
  if (!new RegExp(`^${DAY}$`).test(day)) return undefined;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return undefined;
  return ms / 1000;
}

/** The delegation a statement states (its signature not checked), or undefined. */
export function parseDelegationStatement(statement: string): Delegation | undefined {
  const m = DELEGATION_RE.exec(statement);
  if (!m) return undefined;
  const [, kid, service, hostList, from, until, keyHex] = m;
  const notBefore = daySeconds(from);
  const notAfter = daySeconds(until);
  if (notBefore === undefined || notAfter === undefined || notAfter <= notBefore) return undefined;
  if (notAfter - notBefore > MAX_DELEGATION_DAYS * DAY_SECONDS) return undefined;
  const hosts = hostList.split(',');
  if (new Set(hosts).size !== hosts.length) return undefined;
  return { kid, publicKey: hexToBytes(keyHex)!, service: service as SigningService, hosts, notBefore, notAfter };
}

/** The revocation a statement states (its signature not checked), or undefined. */
export function parseRevocationStatement(statement: string): RevocationList | undefined {
  const m = REVOCATION_RE.exec(statement);
  if (!m) return undefined;
  const issued = daySeconds(m[1]);
  if (issued === undefined) return undefined;
  return { issued, revoked: new Set(m[2].split(',')) };
}

function checkLength(statement: string): string {
  const bytes = new TextEncoder().encode(statement).length;
  if (bytes > MAX_STATEMENT_BYTES) {
    throw new Error(`Statement is ${bytes} bytes; a Ledger shows at most ${MAX_STATEMENT_BYTES}. Shorten the key id.`);
  }
  return statement;
}

export interface DelegationFields {
  kid: string;
  service: SigningService;
  hosts: readonly string[];
  /** First UTC day, `YYYY-MM-DD`. */
  from: string;
  /** UTC day the key stops being valid, `YYYY-MM-DD`. */
  until: string;
  publicKeyHex: string;
}

/** Writes a delegation statement; throws for any field the verifier would refuse. */
export function buildDelegationStatement(fields: DelegationFields): string {
  const statement =
    `${DELEGATION_PREFIX}kid=${fields.kid}|service=${fields.service}|hosts=${fields.hosts.join(',')}` +
    `|from=${fields.from}|until=${fields.until}|key=${fields.publicKeyHex.toLowerCase()}`;
  if (!isKeyId(fields.kid)) throw new Error('Key id: 1 to 32 letters, digits, dot, dash or underscore');
  if (!fields.hosts.length || !fields.hosts.every(isHost)) throw new Error('Hosts: lower-case host names');
  if (!/^[0-9a-f]{64}$/i.test(fields.publicKeyHex)) throw new Error('Public key: 64 hex characters (32 bytes)');
  if (!parseDelegationStatement(statement)) {
    throw new Error(`Dates: real UTC days, until after from, at most ${MAX_DELEGATION_DAYS} days apart`);
  }
  return checkLength(statement);
}

/** Writes a revocation statement; throws for any field the verifier would refuse. */
export function buildRevocationStatement(issued: string, revoked: readonly string[]): string {
  const statement = `${REVOCATION_PREFIX}issued=${issued}|revoked=${revoked.join(',')}`;
  if (!parseRevocationStatement(statement)) throw new Error('Issued must be a UTC day and every key id 1 to 32 characters');
  return checkLength(statement);
}

/** What a CIP-8 COSE_Sign1 signs, and the raw Ed25519 signature over it. */
export interface CoseSign1Parts {
  payload: Uint8Array;
  signedData: Uint8Array;
  signature: Uint8Array;
}

/**
 * Opens a CIP-8 COSE_Sign1: EdDSA only, unhashed only. Undefined for anything
 * else, including bytes that are not a COSE_Sign1.
 */
export async function openCoseSign1(coseSign1Hex: string): Promise<CoseSign1Parts | undefined> {
  const coseBytes = hexToBytes(coseSign1Hex);
  if (!coseBytes || coseBytes.length === 0) return undefined;
  const MS = await import('@emurgo/cardano-message-signing-browser');
  let sign1: InstanceType<typeof MS.COSESign1> | undefined;
  try {
    sign1 = MS.COSESign1.from_bytes(coseBytes);
    const headers = sign1.headers();
    const algorithm = headers.protected().deserialized_headers().algorithm_id()?.as_int()?.as_i32();
    if (algorithm !== COSE_ALG_EDDSA) return undefined;
    const hashed = headers.unprotected().header(MS.Label.new_text('hashed'))?.as_special()?.as_bool();
    if (hashed === true) return undefined;
    const payload = sign1.payload();
    if (!payload) return undefined;
    return { payload, signedData: sign1.signed_data().to_bytes(), signature: sign1.signature() };
  } catch {
    return undefined;
  } finally {
    sign1?.free();
  }
}

/**
 * The root key, among `roots`, whose CIP-8 signature `coseSign1Hex` is over exactly
 * `statement`. Undefined otherwise.
 */
export async function rootSigning(
  statement: string,
  coseSign1Hex: string,
  roots: readonly Uint8Array[],
): Promise<Uint8Array | undefined> {
  if (roots.length === 0 || !statement.startsWith(`${SIGNING_DOMAIN}|`)) return undefined;
  const parts = await openCoseSign1(coseSign1Hex);
  if (!parts || !bytesEqual(parts.payload, new TextEncoder().encode(statement))) return undefined;
  for (const root of roots) {
    try {
      if (await ed25519.verifyAsync(parts.signature, parts.signedData, root, { zip215: false })) return root;
    } catch {
      // A malformed signature or key verifies nothing.
    }
  }
  return undefined;
}

/** A delegation `coseSign1Hex` proves, or undefined. */
export async function verifyDelegation(
  statement: string,
  coseSign1Hex: string,
  roots: readonly Uint8Array[],
): Promise<Delegation | undefined> {
  const delegation = parseDelegationStatement(statement);
  if (!delegation || !(await rootSigning(statement, coseSign1Hex, roots))) return undefined;
  return delegation;
}

/** A revocation list `coseSign1Hex` proves, or undefined. */
export async function verifyRevocationList(
  statement: string,
  coseSign1Hex: string,
  roots: readonly Uint8Array[],
): Promise<RevocationList | undefined> {
  const revocation = parseRevocationStatement(statement);
  if (!revocation || !(await rootSigning(statement, coseSign1Hex, roots))) return undefined;
  return revocation;
}

/** The pinned roots, decoded. */
export function pinnedRoots(hexKeys: readonly string[] = PINNED_ROOT_KEYS): Uint8Array[] {
  return hexKeys.map((hex) => hexToBytes(hex)).filter((key): key is Uint8Array => key?.length === 32);
}

/**
 * Resolves a key id for one service from verified delegations: the delegation
 * must name that service and the answering host, be current, and not be revoked.
 */
export function delegationResolver(
  service: SigningService,
  delegations: readonly Delegation[],
  revoked: ReadonlySet<string> = new Set(),
): KeyResolver {
  return {
    resolve(keyid, hostname, nowSeconds) {
      if (revoked.has(keyid)) return undefined;
      const match = delegations.find(
        (d) =>
          d.kid === keyid &&
          d.service === service &&
          d.hosts.includes(hostname.toLowerCase()) &&
          d.notBefore <= nowSeconds &&
          nowSeconds < d.notAfter,
      );
      return match?.publicKey;
    },
  };
}
