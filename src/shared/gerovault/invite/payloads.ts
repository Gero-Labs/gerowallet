/**
 * The payloads of `gero-vault-invite/v1` (`PROTOCOL.md` section 4): INVITE, ACCEPT, DECLINE and
 * REVOKE, their canonical CBOR, their digests and their checks. Pure: no clock, no randomness, no
 * storage. Times are unix seconds and come in as arguments.
 *
 *   INVITE  { body: InviteBody, sig: { method, proof } }   sig: the inviter's vault payment key
 *   ACCEPT  { body: AcceptBody, sig: { method, proof }, mac? } sig: the cosigner's vault payment key
 *   DECLINE { v, kind: "decline", setupId, invite }        no signature, nothing about the wallet
 *   REVOKE  { v, kind: "revoke", setupId, secret, revokedAt } not encrypted; the secret opens revokeHash
 *
 * `sig` is an attestation in the stored form of `../attestation.ts` (CIP-8 or the expired
 * transaction) over `blake2b-256(tag || canonical CBOR of body)`, tags `INVITE_DIGEST_TAG` and
 * `ACCEPT_DIGEST_TAG`, kinds `invite` and `inviteAccept`.
 *
 * Decoders never throw for untrusted input: they answer `{ ok: false, code }`.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ATTESTATION_METHOD, AttestedDigest, MAX_ATTESTATION_BYTES, OwnerAttestation, isUsableEd25519Key, verifyAttestation } from '../attestation';
import { CborValue } from '../cbor';
import { CborWritable, CborWritableMap, encodeCanonicalCbor } from '../canonicalCbor';
import { writeLabel } from '../labels';
import {
  ACCEPT_DIGEST_TAG,
  ACCEPT_MAC_TAG,
  CLOCK_SKEW_S,
  CREDENTIAL_BYTES,
  HANDLE_PATTERN,
  INVITE_DIGEST_TAG,
  INVITE_TEMPLATES,
  INVITE_VERSION,
  InviteNetwork,
  KEY_BYTES,
  MAX_INVITE_LIFETIME_S,
  MAX_INVITE_OWNERS,
  MAX_PLAINTEXT_BYTES,
  MIN_INVITE_OWNERS,
  MIN_INVITE_THRESHOLD,
  PARTICIPANT_STATUSES,
  PAYLOAD_KIND,
  ParticipantStatus,
  SETUP_ID_BYTES,
  vaultNetworkOf,
} from './constants';
import {
  Fields,
  InviteResult,
  ascii,
  attempt,
  attemptAsync,
  bytesToHex,
  concatBytes,
  decodeStrict,
  expectHeader,
  hexToBytes,
  refuse,
  requireCanonical,
  sameBytes,
} from './codec';

/** A vault's two raw Ed25519 public keys (32 bytes each), never an extended key. */
export interface InviteVaultKeys {
  readonly payment: Uint8Array;
  readonly stake: Uint8Array;
}

export interface InviteParticipant {
  readonly label: string;
  readonly status: ParticipantStatus;
}

export interface InviteBody {
  readonly network: InviteNetwork;
  /** 16 random bytes, chosen by the initiator. */
  readonly setupId: Uint8Array;
  readonly vault: { readonly name: string; readonly template: 'standard'; readonly threshold: number; readonly owners: number };
  readonly inviter: { readonly label: string; readonly stakeCredential: Uint8Array; readonly handle?: string };
  /** The stake credential the invitation was addressed to; absent on a link copy. */
  readonly invitee?: Uint8Array;
  /** The other participants, for display: never the inviter. */
  readonly participants: readonly InviteParticipant[];
  /** The initiator device's X25519 invite key: where ACCEPT and DECLINE are sealed to. */
  readonly replyKey: Uint8Array;
  readonly vaultKeys: InviteVaultKeys;
  /** SHA-256 of this invitation's revoke secret (`REVOKE`). */
  readonly revokeHash: Uint8Array;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface SignedInvite {
  readonly body: InviteBody;
  readonly sig: OwnerAttestation;
  /** The invite digest, lowercase hex: what `sig` attests and what an ACCEPT or DECLINE names. */
  readonly digest: string;
}

export interface AcceptBody {
  readonly network: InviteNetwork;
  readonly setupId: Uint8Array;
  /** The digest of the INVITE body accepted (32 bytes). */
  readonly invite: Uint8Array;
  readonly label: string;
  /** The accepting wallet's stake credential, so the initiator can keep the cosigner as a contact. */
  readonly stakeCredential: Uint8Array;
  readonly vaultKeys: InviteVaultKeys;
  readonly acceptedAt: number;
}

export interface SignedAccept {
  readonly body: AcceptBody;
  readonly sig: OwnerAttestation;
  /** HMAC-SHA256 under the link's MAC key; present exactly when the cosigner joined by QR or link. */
  readonly mac?: Uint8Array;
  readonly digest: string;
}

export interface DeclineBody {
  readonly setupId: Uint8Array;
  readonly invite: Uint8Array;
}

export interface RevokeBody {
  readonly setupId: Uint8Array;
  /** 32 bytes whose SHA-256 is the invitation's `revokeHash`. */
  readonly secret: Uint8Array;
  readonly revokedAt: number;
}

const MAX_PARTICIPANTS = MAX_INVITE_OWNERS - 1;
const MAX_REVOKE_BYTES = 128;
const blake2b256 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });
const credentialOf = (key: Uint8Array) => blake2b(key, { dkLen: CREDENTIAL_BYTES });
/** Builders normalise labels (the write rule); readers keep them exactly as read. */
type LabelRule = (label: string) => string;
const asRead: LabelRule = label => label;
const taggedDigest = (tag: string, bytes: Uint8Array) => bytesToHex(blake2b256(concatBytes(ascii(tag), bytes)));

// ---------------------------------------------------------------------------------------------
// Writers

function vaultKeysCbor(keys: InviteVaultKeys): CborWritableMap {
  return { payment: keys.payment, stake: keys.stake };
}

function attestationCbor(sig: OwnerAttestation): CborWritableMap {
  const proof = hexToBytes(sig.proof);
  if (!proof) throw new TypeError('An attestation proof is hex');
  return { method: sig.method, proof };
}

/** The INVITE body as a canonical CBOR value. Labels go through the write rule of `../labels.ts`. */
function inviteBodyValue(body: InviteBody, label: LabelRule = writeLabel): CborWritableMap {
  const inviter: Record<string, CborWritable> = { label: label(body.inviter.label), stakeCredential: body.inviter.stakeCredential };
  if (body.inviter.handle !== undefined) inviter['handle'] = body.inviter.handle;
  const out: Record<string, CborWritable> = {
    v: INVITE_VERSION,
    kind: PAYLOAD_KIND.INVITE,
    network: body.network,
    setupId: body.setupId,
    vault: { name: label(body.vault.name), template: body.vault.template, threshold: body.vault.threshold, owners: body.vault.owners },
    inviter,
    participants: body.participants.map(p => ({ label: label(p.label), status: p.status })),
    replyKey: body.replyKey,
    vaultKeys: vaultKeysCbor(body.vaultKeys),
    revokeHash: body.revokeHash,
    issuedAt: body.issuedAt,
    expiresAt: body.expiresAt,
  };
  if (body.invitee !== undefined) out['invitee'] = body.invitee;
  return out;
}

function acceptBodyValue(body: AcceptBody, label: LabelRule = writeLabel): CborWritableMap {
  return {
    v: INVITE_VERSION,
    kind: PAYLOAD_KIND.ACCEPT,
    network: body.network,
    setupId: body.setupId,
    invite: body.invite,
    label: label(body.label),
    stakeCredential: body.stakeCredential,
    vaultKeys: vaultKeysCbor(body.vaultKeys),
    acceptedAt: body.acceptedAt,
  };
}

/** Encodes, then checks the result with the decoder: a builder never emits what a reader refuses. */
function checked<T>(bytes: Uint8Array, decode: (b: Uint8Array) => InviteResult<T>): Uint8Array {
  const back = decode(bytes);
  if (back.ok === false) throw new TypeError(`Invitation payload refused by its own reader: ${back.code}${back.field ? ` (${back.field})` : ''}`);
  return bytes;
}

/** The canonical CBOR of an INVITE body (what is hashed). Throws for a body the reader would refuse. */
export function encodeInviteBody(body: InviteBody): Uint8Array {
  return checked(encodeCanonicalCbor(inviteBodyValue(body)), b => attempt(() => readInviteBody(decodeStrict(b, MAX_PLAINTEXT_BYTES.INVITE).value)));
}

/** `blake2b-256("gero-vault-invite/v1|INVITE|" || canonical CBOR of body)`, lowercase hex. */
export function inviteDigest(body: InviteBody): string {
  return taggedDigest(INVITE_DIGEST_TAG, encodeInviteBody(body));
}

/** What the inviter's vault payment key attests (`../attestation.ts`). */
export function inviteSubject(body: InviteBody): AttestedDigest {
  return { kind: 'invite', digest: inviteDigest(body), network: vaultNetworkOf(body.network) };
}

/** The signed INVITE: `{ body, sig }`, canonical CBOR. This is the plaintext that is sealed. */
export function encodeSignedInvite(body: InviteBody, sig: OwnerAttestation): Uint8Array {
  const bytes = encodeCanonicalCbor({ body: inviteBodyValue(body), sig: attestationCbor(sig) });
  return checked(bytes, decodeSignedInvite);
}

export function encodeAcceptBody(body: AcceptBody): Uint8Array {
  return checked(encodeCanonicalCbor(acceptBodyValue(body)), b => attempt(() => readAcceptBody(decodeStrict(b, MAX_PLAINTEXT_BYTES.ACCEPT).value)));
}

/** `blake2b-256("gero-vault-invite/v1|ACCEPT|" || canonical CBOR of body)`, lowercase hex. */
export function acceptDigest(body: AcceptBody): string {
  return taggedDigest(ACCEPT_DIGEST_TAG, encodeAcceptBody(body));
}

export function acceptSubject(body: AcceptBody): AttestedDigest {
  return { kind: 'inviteAccept', digest: acceptDigest(body), network: vaultNetworkOf(body.network) };
}

/** `HMAC-SHA256(macKey, "gero-vault-invite/v1|ACCEPT-MAC|" || acceptDigest bytes)`. */
export function acceptMac(macKey: Uint8Array, digest: string): Uint8Array {
  const d = hexToBytes(digest);
  if (macKey?.length !== KEY_BYTES || d?.length !== 32) throw new TypeError('A MAC key and a digest are 32 bytes');
  return hmac(sha256, macKey, concatBytes(ascii(ACCEPT_MAC_TAG), d));
}

/** The signed ACCEPT: `{ body, sig }`, plus `mac` when the cosigner joined by QR or link. */
export function encodeSignedAccept(body: AcceptBody, sig: OwnerAttestation, mac?: Uint8Array): Uint8Array {
  const value: Record<string, CborWritable> = { body: acceptBodyValue(body), sig: attestationCbor(sig) };
  if (mac !== undefined) value['mac'] = mac;
  return checked(encodeCanonicalCbor(value), decodeSignedAccept);
}

export function encodeDecline(body: DeclineBody): Uint8Array {
  return checked(encodeCanonicalCbor({ v: INVITE_VERSION, kind: PAYLOAD_KIND.DECLINE, setupId: body.setupId, invite: body.invite }), decodeDecline);
}

export function encodeRevoke(body: RevokeBody): Uint8Array {
  return checked(
    encodeCanonicalCbor({ v: INVITE_VERSION, kind: PAYLOAD_KIND.REVOKE, setupId: body.setupId, secret: body.secret, revokedAt: body.revokedAt }),
    decodeRevoke,
  );
}

/** The revoke hash an INVITE carries for a revoke secret: SHA-256 of the 32 secret bytes. */
export function revokeHashOf(secret: Uint8Array): Uint8Array {
  if (secret?.length !== KEY_BYTES) throw new TypeError('A revoke secret is 32 bytes');
  return sha256(secret);
}

// ---------------------------------------------------------------------------------------------
// Readers (structure only; `open*` add signatures, MACs and time)

function readVaultKeys(f: Fields, key: string): InviteVaultKeys {
  const k = f.record(key, ['payment', 'stake']);
  const payment = k.bytes('payment', KEY_BYTES);
  const stake = k.bytes('stake', KEY_BYTES);
  if (!isUsableEd25519Key(bytesToHex(payment))) refuse('BAD_KEY', `${key}.payment`);
  if (!isUsableEd25519Key(bytesToHex(stake))) refuse('BAD_KEY', `${key}.stake`);
  if (sameBytes(payment, stake)) refuse('BAD_KEY', key);
  return { payment, stake };
}

function readAttestation(value: CborValue): OwnerAttestation {
  const f = new Fields(value, ['method', 'proof'], [], 'sig');
  const method = f.uint('method', 1);
  if (method !== ATTESTATION_METHOD.CIP8 && method !== ATTESTATION_METHOD.EXPIRED_TX) refuse('BAD_FIELD', 'sig.method');
  return { method, proof: bytesToHex(f.boundedBytes('proof', MAX_ATTESTATION_BYTES)) };
}

function readInviteBody(value: CborValue): InviteBody {
  const f = new Fields(value, ['v', 'kind', 'network', 'setupId', 'vault', 'inviter', 'participants', 'replyKey', 'vaultKeys', 'revokeHash', 'issuedAt', 'expiresAt'], ['invitee'], 'body');
  expectHeader(f, PAYLOAD_KIND.INVITE);
  const network = f.network('network');
  const setupId = f.bytes('setupId', SETUP_ID_BYTES);

  const v = f.record('vault', ['name', 'template', 'threshold', 'owners']);
  const template = v.text('template');
  if (!(INVITE_TEMPLATES as readonly string[]).includes(template)) refuse('BAD_FIELD', 'body.vault.template');
  const owners = v.uint('owners', MAX_INVITE_OWNERS);
  if (owners < MIN_INVITE_OWNERS) refuse('BAD_FIELD', 'body.vault.owners');
  const threshold = v.uint('threshold', owners);
  if (threshold < MIN_INVITE_THRESHOLD) refuse('BAD_FIELD', 'body.vault.threshold');
  const vault = { name: v.label('name'), template: 'standard' as const, threshold, owners };

  const i = f.record('inviter', ['label', 'stakeCredential'], ['handle']);
  const inviter: { label: string; stakeCredential: Uint8Array; handle?: string } = { label: i.label('label'), stakeCredential: i.bytes('stakeCredential', CREDENTIAL_BYTES) };
  if (i.has('handle')) {
    const handle = i.text('handle');
    if (!HANDLE_PATTERN.test(handle)) refuse('BAD_FIELD', 'body.inviter.handle');
    inviter.handle = handle;
  }

  const participants = f.list('participants', Math.min(MAX_PARTICIPANTS, owners - 1)).map((p, n) => {
    const pf = new Fields(p, ['label', 'status'], [], `body.participants.${n}`);
    const status = pf.text('status');
    if (!(PARTICIPANT_STATUSES as readonly string[]).includes(status)) refuse('BAD_FIELD', `body.participants.${n}.status`);
    return { label: pf.label('label'), status: status as ParticipantStatus };
  });

  const issuedAt = f.uint('issuedAt');
  const expiresAt = f.uint('expiresAt');
  if (expiresAt <= issuedAt) refuse('BAD_FIELD', 'body.expiresAt');
  if (expiresAt - issuedAt > MAX_INVITE_LIFETIME_S) refuse('LIFETIME_TOO_LONG');

  const body: { -readonly [K in keyof InviteBody]: InviteBody[K] } = {
    network,
    setupId,
    vault,
    inviter,
    participants,
    replyKey: f.x25519('replyKey'),
    vaultKeys: readVaultKeys(f, 'vaultKeys'),
    revokeHash: f.bytes('revokeHash', 32),
    issuedAt,
    expiresAt,
  };
  if (f.has('invitee')) body.invitee = f.bytes('invitee', CREDENTIAL_BYTES);
  return body;
}

function readAcceptBody(value: CborValue): AcceptBody {
  const f = new Fields(value, ['v', 'kind', 'network', 'setupId', 'invite', 'label', 'stakeCredential', 'vaultKeys', 'acceptedAt'], [], 'body');
  expectHeader(f, PAYLOAD_KIND.ACCEPT);
  return {
    network: f.network('network'),
    setupId: f.bytes('setupId', SETUP_ID_BYTES),
    invite: f.bytes('invite', 32),
    label: f.label('label'),
    stakeCredential: f.bytes('stakeCredential', CREDENTIAL_BYTES),
    vaultKeys: readVaultKeys(f, 'vaultKeys'),
    acceptedAt: f.uint('acceptedAt'),
  };
}

/** Structure of a signed INVITE (no signature or time check). */
export function decodeSignedInvite(bytes: Uint8Array): InviteResult<SignedInvite> {
  return attempt(() => {
    const item = decodeStrict(bytes, MAX_PLAINTEXT_BYTES.INVITE);
    const f = new Fields(item.value, ['body', 'sig'], [], 'invite');
    const body = readInviteBody(f.raw('body'));
    const sig = readAttestation(f.raw('sig'));
    const bodyValue = inviteBodyValue(body, asRead);
    requireCanonical(bytes, { body: bodyValue, sig: attestationCbor(sig) });
    return { body, sig, digest: taggedDigest(INVITE_DIGEST_TAG, encodeCanonicalCbor(bodyValue)) };
  });
}

/** Structure of a signed ACCEPT (no signature, MAC or time check). */
export function decodeSignedAccept(bytes: Uint8Array): InviteResult<SignedAccept> {
  return attempt(() => {
    const item = decodeStrict(bytes, MAX_PLAINTEXT_BYTES.ACCEPT);
    const f = new Fields(item.value, ['body', 'sig'], ['mac'], 'accept');
    const body = readAcceptBody(f.raw('body'));
    const sig = readAttestation(f.raw('sig'));
    const bodyValue = acceptBodyValue(body, asRead);
    const out: { -readonly [K in keyof SignedAccept]: SignedAccept[K] } = { body, sig, digest: taggedDigest(ACCEPT_DIGEST_TAG, encodeCanonicalCbor(bodyValue)) };
    const value: Record<string, CborWritable> = { body: bodyValue, sig: attestationCbor(sig) };
    if (f.has('mac')) out.mac = value['mac'] = f.bytes('mac', 32);
    requireCanonical(bytes, value);
    return out;
  });
}

export function decodeDecline(bytes: Uint8Array): InviteResult<DeclineBody> {
  return attempt(() => {
    const f = new Fields(decodeStrict(bytes, MAX_PLAINTEXT_BYTES.DECLINE).value, ['v', 'kind', 'setupId', 'invite'], [], 'decline');
    expectHeader(f, PAYLOAD_KIND.DECLINE);
    const body = { setupId: f.bytes('setupId', SETUP_ID_BYTES), invite: f.bytes('invite', 32) };
    requireCanonical(bytes, { v: INVITE_VERSION, kind: PAYLOAD_KIND.DECLINE, ...body });
    return body;
  });
}

export function decodeRevoke(bytes: Uint8Array): InviteResult<RevokeBody> {
  return attempt(() => {
    const f = new Fields(decodeStrict(bytes, MAX_REVOKE_BYTES).value, ['v', 'kind', 'setupId', 'secret', 'revokedAt'], [], 'revoke');
    expectHeader(f, PAYLOAD_KIND.REVOKE);
    const body = { setupId: f.bytes('setupId', SETUP_ID_BYTES), secret: f.bytes('secret', KEY_BYTES), revokedAt: f.uint('revokedAt') };
    requireCanonical(bytes, { v: INVITE_VERSION, kind: PAYLOAD_KIND.REVOKE, ...body });
    return body;
  });
}

// ---------------------------------------------------------------------------------------------
// Full checks

/** Within its window at `now` (unix seconds): issued no later than `now + CLOCK_SKEW_S`, not expired. */
function checkWindow(issuedAt: number, expiresAt: number, now: number): void {
  if (!Number.isSafeInteger(now)) throw new TypeError('now is unix seconds');
  if (issuedAt > now + CLOCK_SKEW_S) refuse('NOT_YET_VALID');
  if (now >= expiresAt) refuse('EXPIRED');
}

/**
 * A signed INVITE a cosigner may show: canonical, every field valid, the attestation by the vault
 * payment key it names, and within its window at `now`. `expect` pins what the channel already
 * fixed (the setup the server filed it under, the network and reply key a scanned QR named).
 */
export async function openSignedInvite(
  bytes: Uint8Array,
  now: number,
  expect: { readonly setupId?: Uint8Array; readonly network?: InviteNetwork; readonly replyKey?: Uint8Array } = {},
): Promise<InviteResult<SignedInvite>> {
  const decoded = decodeSignedInvite(bytes);
  if (decoded.ok === false) return decoded;
  return attemptAsync(async () => {
    const { body, sig, digest } = decoded.value;
    if (expect.setupId && !sameBytes(expect.setupId, body.setupId)) refuse('WRONG_SETUP');
    if (expect.network && expect.network !== body.network) refuse('WRONG_NETWORK');
    if (expect.replyKey && !sameBytes(expect.replyKey, body.replyKey)) refuse('BAD_KEY', 'body.replyKey');
    checkWindow(body.issuedAt, body.expiresAt, now);
    const check = await verifyAttestation(sig, vaultPaymentCredential(body.vaultKeys), { kind: 'invite', digest, network: vaultNetworkOf(body.network) });
    if (check.ok === false) refuse('BAD_SIGNATURE', check.code);
    return decoded.value;
  });
}

/**
 * A signed ACCEPT the initiator may use: canonical, for this setup, network and invitation, signed
 * by the vault payment key it carries, accepted before the invitation expired and not dated ahead
 * of `now`. With `macKey` (the response came through a QR or link) the MAC must verify; without
 * it, no MAC may be present.
 */
export async function openSignedAccept(
  bytes: Uint8Array,
  now: number,
  expect: { readonly setupId: Uint8Array; readonly network: InviteNetwork; readonly inviteDigest: string; readonly inviteExpiresAt: number; readonly macKey?: Uint8Array },
): Promise<InviteResult<SignedAccept>> {
  const decoded = decodeSignedAccept(bytes);
  if (decoded.ok === false) return decoded;
  return attemptAsync(async () => {
    const { body, sig, mac, digest } = decoded.value;
    if (!sameBytes(body.setupId, expect.setupId)) refuse('WRONG_SETUP');
    if (body.network !== expect.network) refuse('WRONG_NETWORK');
    if (bytesToHex(body.invite) !== expect.inviteDigest) refuse('WRONG_INVITE');
    if (body.acceptedAt > now + CLOCK_SKEW_S) refuse('NOT_YET_VALID');
    if (body.acceptedAt >= expect.inviteExpiresAt) refuse('EXPIRED');
    if (expect.macKey) {
      if (!mac || !sameBytes(mac, acceptMac(expect.macKey, digest))) refuse('BAD_MAC');
    } else if (mac) {
      refuse('BAD_MAC');
    }
    const check = await verifyAttestation(sig, vaultPaymentCredential(body.vaultKeys), { kind: 'inviteAccept', digest, network: vaultNetworkOf(body.network) });
    if (check.ok === false) refuse('BAD_SIGNATURE', check.code);
    return decoded.value;
  });
}

/** A DECLINE for this setup and invitation (only someone who read the invitation knows its digest). */
export function openDecline(bytes: Uint8Array, expect: { readonly setupId: Uint8Array; readonly inviteDigest: string }): InviteResult<DeclineBody> {
  const decoded = decodeDecline(bytes);
  if (decoded.ok === false) return decoded;
  return attempt(() => {
    if (!sameBytes(decoded.value.setupId, expect.setupId)) refuse('WRONG_SETUP');
    if (bytesToHex(decoded.value.invite) !== expect.inviteDigest) refuse('WRONG_INVITE');
    return decoded.value;
  });
}

/** A REVOKE of `invite`: the same setup, and a secret whose SHA-256 is the invitation's `revokeHash`. */
export function openRevoke(bytes: Uint8Array, invite: InviteBody): InviteResult<RevokeBody> {
  const decoded = decodeRevoke(bytes);
  if (decoded.ok === false) return decoded;
  return attempt(() => {
    if (!sameBytes(decoded.value.setupId, invite.setupId)) refuse('WRONG_SETUP');
    if (!sameBytes(sha256(decoded.value.secret), invite.revokeHash)) refuse('BAD_REVOKE');
    return decoded.value;
  });
}

/** The vault payment key's credential (blake2b-224), lowercase hex: whose attestation `sig` must be. */
export function vaultPaymentCredential(keys: InviteVaultKeys): string {
  return bytesToHex(credentialOf(keys.payment));
}
