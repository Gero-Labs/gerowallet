/**
 * The checks each side runs on what arrives, composed from `seal.ts`, `payloads.ts` and
 * `link.ts` (`PROTOCOL.md` section 6). Every function fails closed and never throws for untrusted
 * input. Nothing here decides anything about the vault: an opened invitation is shown, an opened
 * ACCEPT fills a cosigner card, and only the GV-61 ceremony verifies.
 */
import { CLOCK_SKEW_S, InviteNetwork } from './constants';
import { InviteResult, attempt, refuse } from './codec';
import { InviteLink, deriveLinkSecrets } from './link';
import { DeclineBody, SignedAccept, SignedInvite, openDecline, openSignedAccept, openSignedInvite } from './payloads';
import { WireDelivery, openForRecipient, openWithLinkKey } from './seal';

/** A cosigner device opens an invitation from `GET /vault-invites` with its invite secret. */
export async function openMailboxInvite(setupId: Uint8Array, delivery: WireDelivery, inviteSecret: Uint8Array, now: number): Promise<InviteResult<SignedInvite>> {
  const plaintext = openForRecipient('INVITE', setupId, delivery, inviteSecret);
  if (plaintext.ok === false) return plaintext;
  return openSignedInvite(plaintext.value, now, { setupId });
}

/**
 * A joiner opens the link copy (`POST /vault-invites/by-link`) with the scanned QR or link. The
 * copy must name the setup, network and reply key the QR named, address nobody, and outlive the QR.
 */
export async function openLinkInvite(
  link: InviteLink,
  sealed: { readonly nonce: unknown; readonly ciphertext: unknown },
  now: number,
): Promise<InviteResult<SignedInvite>> {
  const { contentKey } = deriveLinkSecrets(link.cap, link.setupId);
  const plaintext = openWithLinkKey(link.setupId, sealed, contentKey);
  if (plaintext.ok === false) return plaintext;
  const opened = await openSignedInvite(plaintext.value, now, { setupId: link.setupId, network: link.network, replyKey: link.replyKey });
  if (opened.ok === false) return opened;
  return attempt(() => {
    if (opened.value.body.invitee !== undefined) refuse('BAD_FIELD', 'body.invitee');
    if (link.exp > opened.value.body.expiresAt + CLOCK_SKEW_S) refuse('BAD_FIELD', 'exp');
    return opened.value;
  });
}

export interface ResponseContext {
  readonly setupId: Uint8Array;
  readonly network: InviteNetwork;
  /** The digest of the INVITE this response answers (the mailbox invitation or the link copy). */
  readonly inviteDigest: string;
  readonly inviteExpiresAt: number;
  /** The link's MAC key when the response came through a QR or link; absent for a mailbox answer. */
  readonly macKey?: Uint8Array;
}

/** The initiator opens an ACCEPT from `GET /vault-setups/{setupId}/responses` with its reply secret. */
export async function openAcceptResponse(delivery: WireDelivery, replySecret: Uint8Array, ctx: ResponseContext, now: number): Promise<InviteResult<SignedAccept>> {
  const plaintext = openForRecipient('ACCEPT', ctx.setupId, delivery, replySecret);
  if (plaintext.ok === false) return plaintext;
  return openSignedAccept(plaintext.value, now, ctx);
}

/** The initiator opens a DECLINE. */
export function openDeclineResponse(delivery: WireDelivery, replySecret: Uint8Array, ctx: Pick<ResponseContext, 'setupId' | 'inviteDigest'>): InviteResult<DeclineBody> {
  const plaintext = openForRecipient('DECLINE', ctx.setupId, delivery, replySecret);
  if (plaintext.ok === false) return plaintext;
  return openDecline(plaintext.value, ctx);
}
