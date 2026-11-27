/**
 * Constants of `gero-vault-invite/v1` (`PROTOCOL.md`). Every tag, limit and wire name another
 * client has to reproduce lives here, so a port can be checked against one file.
 *
 * PROVISIONAL: frozen only once gero-sync, iOS and Android reproduce `__fixtures__/invite-vectors.json`.
 */
import type { VaultNetwork } from '../types';

export const INVITE_PROTOCOL = 'gero-vault-invite/v1';
export const INVITE_VERSION = 1;

/** The kinds a sealed object can be, as written in tags, AAD and HKDF info. */
export const SEAL_KIND = Object.freeze({ INVITE: 'INVITE', LINK: 'LINK', ACCEPT: 'ACCEPT', DECLINE: 'DECLINE' } as const);
export type SealKind = (typeof SEAL_KIND)[keyof typeof SEAL_KIND];

/** Payload `kind` values (lowercase, inside the canonical CBOR). */
export const PAYLOAD_KIND = Object.freeze({ INVITE: 'invite', ACCEPT: 'accept', DECLINE: 'decline', REVOKE: 'revoke', LINK: 'link' } as const);

/** `blake2b-256(tag || canonical CBOR of the body)`: what the vault payment key attests. */
export const INVITE_DIGEST_TAG = `${INVITE_PROTOCOL}|INVITE|`;
export const ACCEPT_DIGEST_TAG = `${INVITE_PROTOCOL}|ACCEPT|`;
/** HMAC-SHA256 input prefix of an ACCEPT that came through a QR or link. */
export const ACCEPT_MAC_TAG = `${INVITE_PROTOCOL}|ACCEPT-MAC|`;
/** HKDF info prefix of a per-recipient wrap key. */
export const WRAP_INFO_TAG = `${INVITE_PROTOCOL}|WRAP|`;
/** HKDF info of the three capability derivations. */
export const LINK_JOIN_TOKEN_INFO = `${INVITE_PROTOCOL}|LINK|join-token`;
export const LINK_CONTENT_KEY_INFO = `${INVITE_PROTOCOL}|LINK|content-key`;
export const LINK_MAC_KEY_INFO = `${INVITE_PROTOCOL}|LINK|mac-key`;
/** HMAC input prefix of a server decoy (`decoyInviteKey`). */
export const DECOY_TAG = `${INVITE_PROTOCOL}|DECOY|`;

/** The QR / link payload prefix, and the link form (the payload is the fragment). */
export const LINK_PREFIX = 'gvi1';
export const LINK_URL_PREFIX = 'https://gerowallet.io/vault-invite#';
export const MAX_LINK_CHARS = 512;

/** Exactly this many directory entries, real or decoy, for any credential. */
export const DIRECTORY_SLOTS = 5;

export const SETUP_ID_BYTES = 16;
export const KEY_BYTES = 32;
export const NONCE_BYTES = 24;
export const TAG_BYTES = 16;
export const CREDENTIAL_BYTES = 28;

/** Seven days, in seconds: the longest an invitation, a setup or a link lives. */
export const MAX_INVITE_LIFETIME_S = 7 * 24 * 60 * 60;
/** A timestamp may be this far ahead of the reader's clock (seconds). */
export const CLOCK_SKEW_S = 300;

/** Plaintext caps (bytes of canonical CBOR). Ciphertexts are these plus `TAG_BYTES`. */
export const MAX_PLAINTEXT_BYTES: Readonly<Record<SealKind, number>> = Object.freeze({
  INVITE: 6144,
  LINK: 6144,
  ACCEPT: 3072,
  DECLINE: 128,
});

/** How many wraps each sealed kind carries. LINK has none: its key comes from the capability. */
export const WRAP_COUNT: Readonly<Record<SealKind, number>> = Object.freeze({
  INVITE: DIRECTORY_SLOTS,
  LINK: 0,
  ACCEPT: 1,
  DECLINE: 1,
});

/** Vault terms an invitation may carry this round: the standard template only. */
export const INVITE_TEMPLATES = ['standard'] as const;
export const MIN_INVITE_OWNERS = 2;
export const MAX_INVITE_OWNERS = 20;
export const MIN_INVITE_THRESHOLD = 2;

export const PARTICIPANT_STATUSES = ['waiting', 'accepted', 'verified'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

/** An ADA Handle as the inviter typed it: `$` and 1 to 15 of a-z, 0-9, `-`, `_`, `.`. */
export const HANDLE_PATTERN = /^\$[a-z0-9_.-]{1,15}$/;

/** Wire names of the networks, as the manifest and the notify API write them. */
export const WIRE_NETWORK: Readonly<Record<VaultNetwork, string>> = Object.freeze({
  mainnet: 'cardano-mainnet',
  preprod: 'cardano-preprod',
  preview: 'cardano-preview',
});
export type InviteNetwork = 'cardano-mainnet' | 'cardano-preprod' | 'cardano-preview';
export const INVITE_NETWORKS: readonly InviteNetwork[] = ['cardano-mainnet', 'cardano-preprod', 'cardano-preview'];

export function vaultNetworkOf(network: InviteNetwork): VaultNetwork {
  return network === 'cardano-mainnet' ? 'mainnet' : network === 'cardano-preprod' ? 'preprod' : 'preview';
}
