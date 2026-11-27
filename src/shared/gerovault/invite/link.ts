/**
 * The in-person QR and the invite link of `gero-vault-invite/v1` (`PROTOCOL.md` section 5).
 *
 *   payload = "gvi1" || base64url( canonical CBOR { v: 1, kind: "link", network, setupId, replyKey, cap, exp } )
 *   link    = "https://gerowallet.io/vault-invite#" || payload     (a fragment: never sent to a server)
 *
 * From `cap` (32 random bytes, new for every QR shown and every link copied):
 *
 *   joinToken  = HKDF-SHA256(ikm = cap, salt = setupId, info = "gero-vault-invite/v1|LINK|join-token", 32)
 *   contentKey = HKDF-SHA256(ikm = cap, salt = setupId, info = "gero-vault-invite/v1|LINK|content-key", 32)
 *   macKey     = HKDF-SHA256(ikm = cap, salt = setupId, info = "gero-vault-invite/v1|LINK|mac-key", 32)
 *   joinTokenHash = SHA-256(joinToken)          the only form gero-sync stores
 *
 * The joiner presents `joinToken` to fetch the link copy (sealed under `contentKey`) and to file
 * its answer; `macKey` never leaves the two devices and authenticates the ACCEPT.
 *
 * A scan or a link authenticates who joined. This round it does NOT verify the vault (GV-61):
 * the 40-digit number still does.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encodeCanonicalCbor } from '../canonicalCbor';
import {
  CLOCK_SKEW_S,
  INVITE_VERSION,
  InviteNetwork,
  KEY_BYTES,
  LINK_CONTENT_KEY_INFO,
  LINK_JOIN_TOKEN_INFO,
  LINK_MAC_KEY_INFO,
  LINK_PREFIX,
  LINK_URL_PREFIX,
  MAX_INVITE_LIFETIME_S,
  MAX_LINK_CHARS,
  PAYLOAD_KIND,
  SETUP_ID_BYTES,
} from './constants';
import { Fields, InviteResult, ascii, attempt, bytesToHex, decodeStrict, expectHeader, fromBase64Url, refuse, requireCanonical, toBase64Url } from './codec';

export interface InviteLink {
  readonly network: InviteNetwork;
  readonly setupId: Uint8Array;
  /** The initiator device's X25519 invite key: where the joiner's answer is sealed to. */
  readonly replyKey: Uint8Array;
  /** 32 random bytes; the capability. Never sent anywhere but in this QR or link. */
  readonly cap: Uint8Array;
  /** Unix seconds after which the QR or link is refused. */
  readonly exp: number;
}

export interface LinkSecrets {
  readonly joinToken: Uint8Array;
  readonly joinTokenHash: Uint8Array;
  readonly contentKey: Uint8Array;
  readonly macKey: Uint8Array;
}

const MAX_LINK_CBOR_BYTES = 256;

function linkValue(link: InviteLink) {
  return { v: INVITE_VERSION, kind: PAYLOAD_KIND.LINK, network: link.network, setupId: link.setupId, replyKey: link.replyKey, cap: link.cap, exp: link.exp };
}

function readLink(bytes: Uint8Array): InviteLink {
  const f = new Fields(decodeStrict(bytes, MAX_LINK_CBOR_BYTES).value, ['v', 'kind', 'network', 'setupId', 'replyKey', 'cap', 'exp'], [], 'link');
  expectHeader(f, PAYLOAD_KIND.LINK);
  const link = { network: f.network('network'), setupId: f.bytes('setupId', SETUP_ID_BYTES), replyKey: f.x25519('replyKey'), cap: f.bytes('cap', KEY_BYTES), exp: f.uint('exp') };
  requireCanonical(bytes, linkValue(link));
  return link;
}

/** The QR payload string. Throws for a link its own parser would refuse (time aside). */
export function encodeInviteLinkPayload(link: InviteLink): string {
  const bytes = encodeCanonicalCbor(linkValue(link));
  const back = attempt(() => readLink(bytes));
  if (back.ok === false) throw new TypeError(`Invite link refused by its own reader: ${back.code}`);
  return LINK_PREFIX + toBase64Url(bytes);
}

/** The shareable link: the payload as the URL fragment. */
export function encodeInviteLinkUrl(link: InviteLink): string {
  return LINK_URL_PREFIX + encodeInviteLinkPayload(link);
}

/**
 * Parses a scanned QR or a pasted link (either form, exactly as written: no whitespace, no other
 * host, path or query) and refuses one that is expired at `now`, or valid for longer than seven
 * days from `now`. Never throws.
 */
export function parseInviteLink(input: unknown, now: number): InviteResult<InviteLink> {
  if (!Number.isSafeInteger(now)) throw new TypeError('now is unix seconds');
  return attempt(() => {
    if (typeof input !== 'string' || input.length > MAX_LINK_CHARS) return refuse('MALFORMED');
    const payload = input.startsWith(LINK_URL_PREFIX) ? input.slice(LINK_URL_PREFIX.length) : input;
    if (!payload.startsWith(LINK_PREFIX)) {
      // A prefix of the same family with another version (`gvi2…`) is a version the reader does not know.
      return refuse(/^gvi[0-9]/.test(payload) ? 'UNKNOWN_VERSION' : 'MALFORMED');
    }
    const bytes = fromBase64Url(payload.slice(LINK_PREFIX.length));
    if (!bytes) return refuse('MALFORMED');
    const link = readLink(bytes);
    if (now >= link.exp) refuse('EXPIRED');
    if (link.exp > now + MAX_INVITE_LIFETIME_S + CLOCK_SKEW_S) refuse('LIFETIME_TOO_LONG');
    return link;
  });
}

/** The three keys a capability gives, and the join token's hash. */
export function deriveLinkSecrets(cap: Uint8Array, setupId: Uint8Array): LinkSecrets {
  if (!(cap instanceof Uint8Array) || cap.length !== KEY_BYTES) throw new TypeError('A capability is 32 bytes');
  if (!(setupId instanceof Uint8Array) || setupId.length !== SETUP_ID_BYTES) throw new TypeError('A setup id is 16 bytes');
  const derive = (info: string) => hkdf(sha256, cap, setupId, ascii(info), KEY_BYTES);
  const joinToken = derive(LINK_JOIN_TOKEN_INFO);
  return { joinToken, joinTokenHash: sha256(joinToken), contentKey: derive(LINK_CONTENT_KEY_INFO), macKey: derive(LINK_MAC_KEY_INFO) };
}

/** `joinTokenHash` as gero-sync stores and compares it: lowercase hex of SHA-256(joinToken). */
export function joinTokenHashHex(joinToken: Uint8Array): string {
  if (!(joinToken instanceof Uint8Array) || joinToken.length !== KEY_BYTES) throw new TypeError('A join token is 32 bytes');
  return bytesToHex(sha256(joinToken));
}
