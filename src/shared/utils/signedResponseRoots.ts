/**
 * Which keys may sign Gero's responses.
 *
 * Two root keys, held offline on hardware wallets (one by each holder), approve
 * the online signing keys by signing a delegation statement through Cardano
 * message signing (CIP-8). The wallet pins the roots' public keys and accepts a
 * signing key only through a delegation one of them signed:
 *
 *   gero-delegation-v1\n{"kid":"…","pub":"<hex>","service":"gero-backend",
 *                        "hosts":["api.gerowallet.io"],"notBefore":"…","notAfter":"…"}
 *
 * A revocation list, signed the same way, withdraws key ids early:
 *
 *   gero-revocation-v1\n{"issued":"…","revoked":["kid", …]}
 *
 * The fixed first line keeps a signature made for any other purpose from counting.
 * The root account must never be used for anything else (a hidden wallet that holds
 * no funds and never connects to a dApp): a site that got it to sign a message
 * could otherwise ask for this exact statement.
 */
import * as ed25519 from '@noble/ed25519';
import type { KeyResolver } from './signedResponse';

/**
 * Hex Ed25519 public keys of the two root keys. Empty until the key ceremony:
 * with no roots, no signing key is accepted, so verification can only fail.
 * Never add a test key here.
 */
export const PINNED_ROOT_KEYS: readonly string[] = [];

export const DELEGATION_PREFIX = 'gero-delegation-v1\n';
export const REVOCATION_PREFIX = 'gero-revocation-v1\n';

/** Services a delegation may name. */
export type SigningService = 'gero-backend' | 'gero-sync';
const SERVICES: ReadonlySet<string> = new Set<SigningService>(['gero-backend', 'gero-sync']);

/** Longest delegation accepted (six months and a week of slack). */
export const MAX_DELEGATION_SECONDS = 190 * 24 * 3600;

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

/** COSE algorithm id for EdDSA. */
const COSE_ALG_EDDSA = -8;

function hexToBytes(hex: string): Uint8Array | undefined {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isoSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/**
 * The statement's JSON if `coseSign1Hex` is a CIP-8 signature by one of `roots`
 * over exactly `statement`, which must start with `prefix`. Undefined otherwise.
 * Unhashed payloads only: the payload must be the statement itself.
 */
export async function verifyRootStatement(
  statement: string,
  coseSign1Hex: string,
  prefix: string,
  roots: readonly Uint8Array[],
): Promise<unknown> {
  if (!statement.startsWith(prefix) || roots.length === 0) return undefined;
  const coseBytes = hexToBytes(coseSign1Hex);
  if (!coseBytes) return undefined;
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
    if (!payload || !bytesEqual(payload, new TextEncoder().encode(statement))) return undefined;

    const signedData = sign1.signed_data().to_bytes();
    const signature = sign1.signature();
    let signedByRoot = false;
    for (const root of roots) {
      if (await ed25519.verifyAsync(signature, signedData, root, { zip215: false })) {
        signedByRoot = true;
        break;
      }
    }
    if (!signedByRoot) return undefined;
    return JSON.parse(statement.slice(prefix.length)) as unknown;
  } catch {
    return undefined;
  } finally {
    sign1?.free();
  }
}

/** A delegation `coseSign1Hex` proves, or undefined. */
export async function verifyDelegation(
  statement: string,
  coseSign1Hex: string,
  roots: readonly Uint8Array[],
): Promise<Delegation | undefined> {
  const body = (await verifyRootStatement(statement, coseSign1Hex, DELEGATION_PREFIX, roots)) as
    | Record<string, unknown>
    | undefined;
  if (!body || typeof body !== 'object') return undefined;
  const { kid, pub, service, hosts } = body;
  const notBefore = isoSeconds(body['notBefore']);
  const notAfter = isoSeconds(body['notAfter']);
  const publicKey = typeof pub === 'string' ? hexToBytes(pub) : undefined;
  if (typeof kid !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(kid)) return undefined;
  if (!publicKey || publicKey.length !== 32) return undefined;
  if (typeof service !== 'string' || !SERVICES.has(service)) return undefined;
  if (!Array.isArray(hosts) || hosts.length === 0) return undefined;
  if (!hosts.every((h) => typeof h === 'string' && /^[a-z0-9.-]{1,253}$/.test(h))) return undefined;
  if (notBefore === undefined || notAfter === undefined || notAfter <= notBefore) return undefined;
  if (notAfter - notBefore > MAX_DELEGATION_SECONDS) return undefined;
  return { kid, publicKey, service: service as SigningService, hosts: hosts as string[], notBefore, notAfter };
}

/** A revocation list `coseSign1Hex` proves, or undefined. */
export async function verifyRevocationList(
  statement: string,
  coseSign1Hex: string,
  roots: readonly Uint8Array[],
): Promise<RevocationList | undefined> {
  const body = (await verifyRootStatement(statement, coseSign1Hex, REVOCATION_PREFIX, roots)) as
    | Record<string, unknown>
    | undefined;
  if (!body || typeof body !== 'object') return undefined;
  const issued = isoSeconds(body['issued']);
  const { revoked } = body;
  if (issued === undefined || !Array.isArray(revoked)) return undefined;
  if (!revoked.every((kid) => typeof kid === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(kid))) return undefined;
  return { issued, revoked: new Set(revoked as string[]) };
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
  revocations?: RevocationList,
): KeyResolver {
  return {
    resolve(keyid, hostname, nowSeconds) {
      if (revocations?.revoked.has(keyid)) return undefined;
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
