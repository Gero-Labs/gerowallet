// Cross-Device Proving (XDP) — relay protocol types + validators (pure). R1.
//
// The phone cannot run a Midnight proof server, but EVERY Midnight send is
// proven somewhere: even a plain unshielded transfer is signed-but-unproven
// because the DUST fee mechanism is zero-knowledge. Today Gero Cloud's sidecar
// proves those (`/tx/finalize`), which means the cloud sees the witness of every
// mobile send. XDP makes the user's own paired desktop the phone's prover: the
// unproven tx travels phone -> desktop E2E-encrypted over the existing gero-sync
// relay, the desktop proves it against localhost:6300, and the phone submits.
// The relay carries ciphertext only.
//
// Trust fabric is the one the signing bridge already ships (protocol.ts): device
// Ed25519 identities, QR pairing with the stake-key wallet-control proof, pinned
// peers. XDP adds NO new pairing and NO approval UI — proving authorizes
// nothing, so the desktop serves silently, gated on pinning + an opt-in toggle.
//
// Version lives in the SIGNING SUBJECT prefix (`gero-xprove/v1`, see
// proveEnvelope.ts), so signed frames carry no numeric `v` — same rule as
// gero-xdev/v1.
//
// Pure module: no chrome, no WebSocket, no Date.now.

/** Every XDP frame type. Also the gero-sync relay routing allow-list. */
export type ProveMessageType =
  | 'PROVE_INIT' // phone -> desktop: please prove this tx (opens the session)
  | 'PROVE_ACCEPT' // desktop -> phone: gates passed, send the chunks
  | 'PROVE_REJECT' // desktop -> phone: refused, with a signed reason
  | 'PROVE_CHUNK' // both: one AEAD-sealed slice of a payload
  | 'PROVE_STATUS' // desktop -> phone: advisory progress
  | 'PROVE_RESULT' // desktop -> phone: finalized tx follows / is complete
  | 'PROVE_CANCEL'; // both: abandon the job

/**
 * Exported so `websocket.service.ts` can extend its cross-device routing
 * allow-list from ONE source instead of a second hand-maintained literal. The
 * relay drops any type absent from that list before the bridge ever sees it —
 * the failure mode the WAKE_PENDING comment there records.
 */
export const PROVE_MESSAGE_TYPES: readonly ProveMessageType[] = [
  'PROVE_INIT',
  'PROVE_ACCEPT',
  'PROVE_REJECT',
  'PROVE_CHUNK',
  'PROVE_STATUS',
  'PROVE_RESULT',
  'PROVE_CANCEL',
];

/**
 * Closed set of refusal reasons.
 *
 * UNLIKE `SignResponse.reason` (protocol.ts:90), which is explicitly
 * unauthenticated advisory text, this IS signed and IS in the subject. The
 * reason drives a downgrade decision on the phone: a spoofed
 * `PROVE_REJECT(busy)` from a hostile relay would push the user onto Gero Cloud
 * proving — the exact outcome XDP exists to prevent. The phone must ignore any
 * reject it cannot verify rather than fall back on it.
 *
 * Note there is no `not_pinned`: an unpinned sender is dropped SILENTLY (see
 * the R3 gate order), so a prober learns nothing about who this wallet pairs
 * with. It exists in the type only to name what is deliberately never sent.
 */
export type ProveRejectReason =
  | 'serving_off' // the user has not enabled serving for this peer
  | 'ledger_mismatch' // prover ledger/proof-server version differs from the requester's
  | 'too_large' // payload exceeds MAX_PROVE_PAYLOAD_BYTES
  | 'rate_limited' // too many jobs from this peer too quickly
  | 'prover_unhealthy' // local proof server failed /health
  | 'busy' // a job is already running (single-job queue)
  | 'timeout' // the job exceeded its budget
  | 'decrypt_failed' // session key establishment failed, a chunk failed its AEAD tag, or chunks never completed
  | 'digest_mismatch' // reassembled payload != the digest signed in PROVE_INIT
  | 'prove_failed'; // the proof server itself failed

/** Advisory progress states (closed set so the phone can localize them). */
export type ProveStatusState = 'queued' | 'proving';

/**
 * Hard ceiling on a job payload, enforced BEFORE any decryption work (R3 size
 * gate) so a hostile pinned peer cannot park unbounded memory in a long-lived
 * service worker.
 *
 * Set from iOS's measurements against ledger-v8 8.1.0 (their 2026-08-11 reply
 * §4), which replaced the retracted 10²–10³ KB figure this was originally sized
 * against:
 *
 *   unshielded 1-in/1-out + 1 DUST spend:  1,685 B unproven -> 3,627 B proven
 *   range across shapes:                   1.5–9 KB unproven -> 3.6–60 KB proven
 *
 * 256 KiB is ~4x the largest measured proven payload — enough headroom for the
 * variable-size contract/shield-swap proofs iOS flags, while being an actual
 * memory bound. The previous 4 MiB was ~70x the real worst case, which bounded
 * nothing in practice.
 *
 * Failure mode is loud, not silent: an undersized cap rejects with
 * PROVE_REJECT(too_large) rather than corrupting anything.
 */
export const MAX_PROVE_PAYLOAD_BYTES = 256 * 1024;

/**
 * Phone -> desktop. Opens a job.
 *
 * `to` is INSIDE the signed subject, unlike SIGN_REQUEST where it is an unsigned
 * routing hint. SIGN_* can afford that because a relay rewriting `to` can only
 * misdeliver, never forge. Here the frame also carries an ephemeral X25519
 * public key, so an unsigned `to` would let the relay steer a job at whichever
 * of the user's pinned desktops it prefers. Same reasoning as PAIR_CONFIRM
 * (envelope.ts:16-18).
 */
export interface ProveInit {
  type: 'PROVE_INIT';
  reqId: string; // unique per job
  nonce: string; // anti-replay; single-use per (reqId, nonce)
  from: string; // requesting deviceId (the phone)
  to: string; // target deviceId (this desktop) — SIGNED, see above
  stakeAddress?: string; // routing scope; empty slot in the subject when absent
  ephPub: string; // hex X25519 ephemeral public key for this job only
  ledgerVersion: string; // proof-server docker tag, e.g. "8.1.0"
  byteLen: number; // plaintext payload length, for the pre-flight size gate
  chunkCount: number; // how many PROVE_CHUNKs to expect
  expiresAt: number; // unix SECONDS
  payloadDigest: string; // blake2b-256 hex of the PLAINTEXT payload
  sig: string; // hex Ed25519 over the canonical PROVE_INIT subject
}

/** Desktop -> phone. Gates passed; carries this side's ephemeral key. */
export interface ProveAccept {
  type: 'PROVE_ACCEPT';
  reqId: string;
  nonce: string;
  from: string; // the desktop
  to: string; // the phone
  ephPub: string; // hex X25519 ephemeral public key for this job only
  ledgerVersion: string;
  sig: string;
}

/** Desktop -> phone. Refusal, with an AUTHENTICATED reason (see the type note). */
export interface ProveReject {
  type: 'PROVE_REJECT';
  reqId: string;
  nonce: string;
  from: string;
  to: string;
  reason: ProveRejectReason;
  sig: string;
}

/**
 * One sealed slice. UNSIGNED by design (R4): the AEAD tag's AAD binds version,
 * reqId, direction, seq and count, so a relay cannot reorder, renumber,
 * cross-splice or reflect chunks — and the INIT/ACCEPT signatures already
 * authenticated the handshake that produced the key.
 *
 * There is deliberately no `dir` field: the receiver knows which direction it is
 * receiving and MUST rebuild the AAD from its OWN expectation, never from a
 * relay-supplied value. Same discipline as PAIR_ACK, where the phone
 * reconstructs the subject from what it pinned rather than from the frame.
 */
export interface ProveChunk {
  type: 'PROVE_CHUNK';
  reqId: string;
  to: string; // routing hint only (unsigned frame; AEAD is the real binding)
  seq: number; // 0-based
  count: number; // total chunks in this direction
  nonceHex: string; // 24-byte XChaCha20 nonce, hex
  ciphertextB64: string; // sealed body, base64 (see SealedChunk)
}

/** Desktop -> phone. Advisory; never gates anything on the phone. */
export interface ProveStatus {
  type: 'PROVE_STATUS';
  reqId: string;
  nonce: string;
  from: string;
  to: string;
  state: ProveStatusState;
  sig: string;
}

/** Desktop -> phone. The finalized tx has been sent as `chunkCount` chunks. */
export interface ProveResult {
  type: 'PROVE_RESULT';
  reqId: string;
  nonce: string;
  from: string;
  to: string;
  byteLen: number;
  chunkCount: number;
  provenDigest: string; // blake2b-256 hex of the PLAINTEXT finalized tx
  sig: string;
}

/** Either side. Always safe to honor — proving authorizes nothing. */
export interface ProveCancel {
  type: 'PROVE_CANCEL';
  reqId: string;
  nonce: string;
  from: string;
  to: string;
  sig: string;
}

export type ProveMessage =
  | ProveInit
  | ProveAccept
  | ProveReject
  | ProveChunk
  | ProveStatus
  | ProveResult
  | ProveCancel;

// ---------------------------------------------------------------------------
// Primitive field checks (mirrors protocol.ts — deliberately not shared, so a
// change to the signing guards can never silently loosen the proving guards)
// ---------------------------------------------------------------------------

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

/** Non-negative integer. Chunk indices and byte lengths are never fractional. */
function isCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0;
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Hex string of an exact byte length.
 *
 * Applied to the fields that feed DIRECTLY into crypto that throws on bad
 * input — the ephemeral public key, the digests, the AEAD nonce. Without this,
 * a `typeof === 'string'` check lets a malformed value through the guard and
 * the failure surfaces as an exception deep inside key derivation rather than
 * as a clean frame rejection. Validating shape at the parse boundary is where
 * every other structural check in this file already lives.
 *
 * Case-insensitive: the contract specifies lowercase, but accepting uppercase
 * costs nothing and refusing it would be a gratuitous interop trap.
 */
function isHexOfBytes(x: unknown, byteLen: number): x is string {
  return isString(x) && x.length === byteLen * 2 && /^[0-9a-fA-F]+$/.test(x);
}

/** X25519 public keys and blake2b-256 digests are both 32 bytes. */
const KEY_HEX_BYTES = 32;
const DIGEST_HEX_BYTES = 32;
/** XChaCha20-Poly1305 nonce. */
const NONCE_HEX_BYTES = 24;

const REJECT_REASONS: readonly ProveRejectReason[] = [
  'serving_off', 'ledger_mismatch', 'too_large', 'rate_limited', 'prover_unhealthy',
  'busy', 'timeout', 'decrypt_failed', 'digest_mismatch', 'prove_failed',
];

const STATUS_STATES: readonly ProveStatusState[] = ['queued', 'proving'];

/** Fields every signed XDP frame carries. */
function hasSignedEnvelope(x: Record<string, unknown>): boolean {
  return isString(x['reqId']) && isString(x['nonce'])
    && isString(x['from']) && isString(x['to']) && isString(x['sig']);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isProveInit(x: unknown): x is ProveInit {
  if (!isObject(x) || x['type'] !== 'PROVE_INIT') return false;
  return (
    hasSignedEnvelope(x)
    && (x['stakeAddress'] === undefined || isString(x['stakeAddress']))
    && isHexOfBytes(x['ephPub'], KEY_HEX_BYTES)
    && isString(x['ledgerVersion'])
    && isCount(x['byteLen'])
    && isCount(x['chunkCount'])
    && isNumber(x['expiresAt'])
    && isHexOfBytes(x['payloadDigest'], DIGEST_HEX_BYTES)
  );
}

export function isProveAccept(x: unknown): x is ProveAccept {
  if (!isObject(x) || x['type'] !== 'PROVE_ACCEPT') return false;
  return hasSignedEnvelope(x)
    && isHexOfBytes(x['ephPub'], KEY_HEX_BYTES)
    && isString(x['ledgerVersion']);
}

export function isProveReject(x: unknown): x is ProveReject {
  if (!isObject(x) || x['type'] !== 'PROVE_REJECT') return false;
  return hasSignedEnvelope(x)
    && REJECT_REASONS.includes(x['reason'] as ProveRejectReason);
}

export function isProveChunk(x: unknown): x is ProveChunk {
  if (!isObject(x) || x['type'] !== 'PROVE_CHUNK') return false;
  return (
    isString(x['reqId'])
    && isString(x['to'])
    && isCount(x['seq'])
    && isCount(x['count'])
    && isHexOfBytes(x['nonceHex'], NONCE_HEX_BYTES)
    && isString(x['ciphertextB64'])
  );
}

export function isProveStatus(x: unknown): x is ProveStatus {
  if (!isObject(x) || x['type'] !== 'PROVE_STATUS') return false;
  return hasSignedEnvelope(x) && STATUS_STATES.includes(x['state'] as ProveStatusState);
}

export function isProveResult(x: unknown): x is ProveResult {
  if (!isObject(x) || x['type'] !== 'PROVE_RESULT') return false;
  return hasSignedEnvelope(x)
    && isCount(x['byteLen'])
    && isCount(x['chunkCount'])
    && isHexOfBytes(x['provenDigest'], DIGEST_HEX_BYTES);
}

export function isProveCancel(x: unknown): x is ProveCancel {
  return isObject(x) && x['type'] === 'PROVE_CANCEL' && hasSignedEnvelope(x);
}

/**
 * Parse an untrusted raw value into a typed XDP message. Returns null on a
 * missing/mistyped field, unknown type, or non-object. Authentication (`sig`
 * verification) and every trust gate are separate, later steps — see
 * proveService.ts.
 */
export function parseProveMessage(raw: unknown): ProveMessage | null {
  if (isProveInit(raw)) return raw;
  if (isProveAccept(raw)) return raw;
  if (isProveReject(raw)) return raw;
  if (isProveChunk(raw)) return raw;
  if (isProveStatus(raw)) return raw;
  if (isProveResult(raw)) return raw;
  if (isProveCancel(raw)) return raw;
  return null;
}
