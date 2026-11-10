// Public keys a broadcast announcement may be signed with.
//
// REVIEWED PROTOCOL CONSTANTS, not env config, at the same bar as the CIP-113 hashes in
// cip113Deployments.ts: a wrong key here lets someone else speak as Gero inside every wallet.
//
// - The tier comes from the list a key is in, never from the announcement itself.
// - EDITORIAL keys may sign anything within the content rules (announcementRules.ts). Their private
//   halves are never on a server: an announcement is signed on the operator's machine.
// - FEED keys are held by gero-sync to post blog headlines by themselves. The rules hold them to
//   that: news only, a title, a summary and a link to gerowallet.io, nothing else.
// - Empty = nothing verifies, so nothing is ever stored or shown. Fails closed.
// - Rotation or revocation is a release. A key id listed in both tiers is usable in neither.
// - Never add a key that appears in a test or in __fixtures__/vectors.json: those are the RFC 8032
//   test keys, whose private halves are public knowledge.

export interface AnnouncementKey {
  readonly keyId: string;
  /** The raw 32-byte Ed25519 public key, lower-case hex. */
  readonly publicKeyHex: string;
}

export const ANNOUNCEMENT_EDITORIAL_KEYS: readonly AnnouncementKey[] = Object.freeze([]);

export const ANNOUNCEMENT_FEED_KEYS: readonly AnnouncementKey[] = Object.freeze([]);
