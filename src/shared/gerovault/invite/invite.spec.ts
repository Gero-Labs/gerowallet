// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { attestationBy, testParticipants, type TestParticipant } from '../__fixtures__/manifest';
import { encodeCanonicalCbor } from '../canonicalCbor';
import { COSIGNER_STAKE_CREDENTIAL, INVITER_STAKE_CREDENTIAL, NETWORK, NOW, SERVER_DECOY_SECRET, SETUP_ID, fixed } from './__fixtures__/inviteVectors';
import { bytesToHex, hexToBytes } from './codec';
import { CLOCK_SKEW_S, MAX_INVITE_LIFETIME_S, MAX_PLAINTEXT_BYTES } from './constants';
import { openLinkInvite, openMailboxInvite } from './flows';
import { InviteLink, deriveLinkSecrets, encodeInviteLinkPayload, encodeInviteLinkUrl, joinTokenHashHex, parseInviteLink } from './link';
import {
  AcceptBody,
  InviteBody,
  acceptSubject,
  decodeSignedInvite,
  encodeDecline,
  encodeInviteBody,
  encodeSignedAccept,
  encodeSignedInvite,
  inviteDigest,
  inviteSubject,
  openDecline,
  openSignedAccept,
  openSignedInvite,
  revokeHashOf,
} from './payloads';
import { SealRandomness, decoyInviteKey, openForRecipient, sealForRecipients, sealWithLinkKey, x25519PublicKey } from './seal';

const bytes = (h: string) => hexToBytes(h) as Uint8Array;
const rnd = (prefix: string, n: number): SealRandomness => ({
  contentKey: fixed(`${prefix} ck`),
  nonce: fixed(`${prefix} n`, 24),
  wraps: Array.from({ length: n }, (_, i) => ({ ephemeralSecret: fixed(`${prefix} e${i}`), nonce: fixed(`${prefix} wn${i}`, 24) })),
});

let initiator: TestParticipant;
let cosigner: TestParticipant;
const replySecret = fixed('unit reply secret');
const deviceSecrets = [0, 1, 2, 3, 4].map(i => fixed(`unit device ${i}`));
const directory = deviceSecrets.map((s, slot) => ({ slot, key: x25519PublicKey(s) }));

function body(overrides: Partial<InviteBody> = {}): InviteBody {
  return {
    network: NETWORK,
    setupId: SETUP_ID,
    vault: { name: 'Ops petty cash', template: 'standard', threshold: 2, owners: 3 },
    inviter: { label: 'Adam', stakeCredential: INVITER_STAKE_CREDENTIAL },
    invitee: COSIGNER_STAKE_CREDENTIAL,
    participants: [],
    replyKey: x25519PublicKey(replySecret),
    vaultKeys: { payment: bytes(initiator.vaultKeys.payment), stake: bytes(initiator.vaultKeys.stake) },
    revokeHash: revokeHashOf(fixed('unit revoke')),
    issuedAt: NOW,
    expiresAt: NOW + 86400,
    ...overrides,
  };
}

const signed = (b: InviteBody, by: TestParticipant = initiator) => encodeSignedInvite(b, attestationBy(by, inviteSubject(b)));

beforeAll(async () => {
  [initiator, cosigner] = await testParticipants([1, 1, 1, 1]);
});

describe('seal', () => {
  it('opens at every slot with that slot key only', () => {
    const plaintext = signed(body());
    const sealed = sealForRecipients('INVITE', SETUP_ID, plaintext, directory, rnd('a', 5));
    for (let i = 0; i < 5; i++) {
      const delivery = { wrap: sealed.wraps[i], nonce: sealed.nonce, ciphertext: sealed.ciphertext };
      const opened = openForRecipient('INVITE', SETUP_ID, delivery, deviceSecrets[i]);
      expect(opened.ok && bytesToHex(opened.value)).toBe(bytesToHex(plaintext));
      expect(openForRecipient('INVITE', SETUP_ID, delivery, deviceSecrets[(i + 1) % 5])).toEqual({ ok: false, code: 'WRONG_RECIPIENT' });
    }
  });

  it('binds kind and setup: the same bytes do not open in another context', () => {
    const sealed = sealForRecipients('DECLINE', SETUP_ID, encodeDecline({ setupId: SETUP_ID, invite: new Uint8Array(32) }), [{ slot: 0, key: directory[0].key }], rnd('b', 1));
    const delivery = { wrap: sealed.wraps[0], nonce: sealed.nonce, ciphertext: sealed.ciphertext };
    expect(openForRecipient('DECLINE', SETUP_ID, delivery, deviceSecrets[0]).ok).toBe(true);
    expect(openForRecipient('ACCEPT', SETUP_ID, delivery, deviceSecrets[0])).toEqual({ ok: false, code: 'DECRYPT_FAILED' });
    expect(openForRecipient('DECLINE', new Uint8Array(16), delivery, deviceSecrets[0])).toEqual({ ok: false, code: 'DECRYPT_FAILED' });
  });

  it('refuses caller errors: slot count, a small-order key, an oversized plaintext', () => {
    const p = new Uint8Array(10);
    expect(() => sealForRecipients('INVITE', SETUP_ID, p, directory.slice(0, 4), rnd('c', 4))).toThrow(/exactly 5/);
    expect(() => sealForRecipients('INVITE', SETUP_ID, p, directory.map(d => ({ ...d, slot: 0 })), rnd('c', 5))).toThrow(/each once/);
    expect(() => sealForRecipients('ACCEPT', SETUP_ID, p, [{ slot: 0, key: new Uint8Array(32) }], rnd('c', 1))).toThrow(/usable X25519/);
    expect(() => sealForRecipients('ACCEPT', SETUP_ID, new Uint8Array(MAX_PLAINTEXT_BYTES.ACCEPT + 1), [directory[0]], rnd('c', 1))).toThrow(/at most/);
  });

  it('decoys are stable per network, credential and slot, and differ otherwise', () => {
    const k = (secret: Uint8Array, network: typeof NETWORK | 'cardano-mainnet', cred: Uint8Array, slot: number) => bytesToHex(decoyInviteKey(secret, network, cred, slot));
    const base = k(SERVER_DECOY_SECRET, NETWORK, COSIGNER_STAKE_CREDENTIAL, 2);
    expect(k(SERVER_DECOY_SECRET, NETWORK, COSIGNER_STAKE_CREDENTIAL, 2)).toBe(base);
    expect(new Set([
      base,
      k(SERVER_DECOY_SECRET, NETWORK, COSIGNER_STAKE_CREDENTIAL, 3),
      k(SERVER_DECOY_SECRET, 'cardano-mainnet', COSIGNER_STAKE_CREDENTIAL, 2),
      k(SERVER_DECOY_SECRET, NETWORK, INVITER_STAKE_CREDENTIAL, 2),
      k(fixed('other server'), NETWORK, COSIGNER_STAKE_CREDENTIAL, 2),
    ]).size).toBe(5);
  });
});

describe('payloads', () => {
  it('builders normalise labels; readers keep what they read', () => {
    const b = body({ inviter: { label: '  Adám ', stakeCredential: INVITER_STAKE_CREDENTIAL } });
    const decoded = decodeSignedInvite(signed(b));
    expect(decoded.ok && decoded.value.body.inviter.label).toBe('Adám');
    expect(decoded.ok && decoded.value.digest).toBe(inviteDigest(b));
  });

  it('a label the write rule refuses but the read rule accepts still decodes, hashed as read', () => {
    const value = {
      v: 1, kind: 'invite', network: NETWORK, setupId: SETUP_ID,
      vault: { name: 'Ops​cash', template: 'standard', threshold: 2, owners: 2 },
      inviter: { label: 'Adam', stakeCredential: INVITER_STAKE_CREDENTIAL },
      participants: [], replyKey: x25519PublicKey(replySecret),
      vaultKeys: { payment: bytes(initiator.vaultKeys.payment), stake: bytes(initiator.vaultKeys.stake) },
      revokeHash: new Uint8Array(32), issuedAt: NOW, expiresAt: NOW + 60,
    };
    const raw = encodeCanonicalCbor({ body: value, sig: { method: 0, proof: Uint8Array.of(1) } });
    const decoded = decodeSignedInvite(raw);
    expect(decoded.ok && decoded.value.body.vault.name).toBe('Ops​cash');
    expect(() => encodeInviteBody(decoded.ok ? decoded.value.body : body())).toThrow();
  });

  it('builders refuse what readers refuse', () => {
    expect(() => encodeInviteBody(body({ vault: { name: 'V', template: 'standard', threshold: 2, owners: 21 } }))).toThrow(/body.vault.owners/);
    expect(() => encodeInviteBody(body({ expiresAt: NOW + MAX_INVITE_LIFETIME_S + 1 }))).toThrow(/LIFETIME_TOO_LONG/);
    expect(() => encodeInviteBody(body({ inviter: { label: 'A', stakeCredential: INVITER_STAKE_CREDENTIAL, handle: '$UPPER' } }))).toThrow(/handle/);
  });

  it('an INVITE signed by anyone but the vault key it names is refused', async () => {
    const b = body();
    const bySomeoneElse = encodeSignedInvite(b, attestationBy(cosigner, inviteSubject(b)));
    expect(await openSignedInvite(bySomeoneElse, NOW)).toEqual({ ok: false, code: 'BAD_SIGNATURE', field: 'WRONG_KEY' });
    const swapped = body({ vaultKeys: { payment: bytes(cosigner.vaultKeys.payment), stake: bytes(cosigner.vaultKeys.stake) } });
    const keySwapped = encodeSignedInvite(swapped, attestationBy(initiator, inviteSubject(b)));
    expect((await openSignedInvite(keySwapped, NOW)).ok).toBe(false);
  });

  it('checks the channel expectations', async () => {
    const s = signed(body());
    expect((await openSignedInvite(s, NOW, { setupId: SETUP_ID, network: NETWORK, replyKey: x25519PublicKey(replySecret) })).ok).toBe(true);
    expect(await openSignedInvite(s, NOW, { setupId: new Uint8Array(16) })).toEqual({ ok: false, code: 'WRONG_SETUP' });
    expect(await openSignedInvite(s, NOW, { network: 'cardano-mainnet' })).toEqual({ ok: false, code: 'WRONG_NETWORK' });
    expect(await openSignedInvite(s, NOW, { replyKey: directory[0].key })).toEqual({ ok: false, code: 'BAD_KEY', field: 'body.replyKey' });
    expect((await openSignedInvite(s, NOW + 86400 - 1)).ok).toBe(true);
    expect((await openSignedInvite(s, NOW - CLOCK_SKEW_S)).ok).toBe(true);
  });

  it('an ACCEPT carries a MAC exactly when a MAC key is expected', async () => {
    const invite = body();
    const accept: AcceptBody = {
      network: NETWORK, setupId: SETUP_ID, invite: bytes(inviteDigest(invite)), label: 'Carla', stakeCredential: COSIGNER_STAKE_CREDENTIAL,
      vaultKeys: { payment: bytes(cosigner.vaultKeys.payment), stake: bytes(cosigner.vaultKeys.stake) }, acceptedAt: NOW + 10,
    };
    const sig = attestationBy(cosigner, acceptSubject(accept));
    const ctx = { setupId: SETUP_ID, network: NETWORK, inviteDigest: inviteDigest(invite), inviteExpiresAt: invite.expiresAt } as const;
    const plain = encodeSignedAccept(accept, sig);
    expect((await openSignedAccept(plain, NOW + 10, ctx)).ok).toBe(true);
    expect(await openSignedAccept(plain, NOW + 10, { ...ctx, macKey: fixed('k') })).toEqual({ ok: false, code: 'BAD_MAC' });
    // Same vault keys accepted by a different (self-declared) person: still the key holder who signed.
    const relabelled = encodeSignedAccept({ ...accept, label: 'Mallory' }, sig);
    expect((await openSignedAccept(relabelled, NOW + 10, ctx)).ok).toBe(false);
  });

  it('a DECLINE names the invitation it declines', () => {
    const d = encodeDecline({ setupId: SETUP_ID, invite: bytes(inviteDigest(body())) });
    expect(openDecline(d, { setupId: SETUP_ID, inviteDigest: inviteDigest(body()) }).ok).toBe(true);
    expect(openDecline(d, { setupId: SETUP_ID, inviteDigest: '11'.repeat(32) })).toEqual({ ok: false, code: 'WRONG_INVITE' });
  });
});

describe('link', () => {
  const link: InviteLink = { network: NETWORK, setupId: SETUP_ID, replyKey: x25519PublicKey(replySecret), cap: fixed('unit cap'), exp: NOW + 600 };

  it('round-trips both forms and refuses anything around them', () => {
    expect(parseInviteLink(encodeInviteLinkPayload(link), NOW)).toEqual({ ok: true, value: link });
    expect(parseInviteLink(encodeInviteLinkUrl(link), NOW)).toEqual({ ok: true, value: link });
    expect(parseInviteLink(` ${encodeInviteLinkPayload(link)}`, NOW).ok).toBe(false);
    expect(parseInviteLink(`${encodeInviteLinkUrl(link)}\n`, NOW).ok).toBe(false);
    expect(parseInviteLink(encodeInviteLinkUrl(link).replace('https:', 'http:'), NOW).ok).toBe(false);
    expect(parseInviteLink(encodeInviteLinkUrl(link).replace('#', '?p='), NOW).ok).toBe(false);
    expect(parseInviteLink(42, NOW)).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('derives three distinct secrets; only the token hash is for the server', () => {
    const s = deriveLinkSecrets(link.cap, SETUP_ID);
    expect(new Set([s.joinToken, s.contentKey, s.macKey].map(bytesToHex)).size).toBe(3);
    expect(joinTokenHashHex(s.joinToken)).toBe(bytesToHex(s.joinTokenHash));
    expect(bytesToHex(deriveLinkSecrets(link.cap, new Uint8Array(16)).joinToken)).not.toBe(bytesToHex(s.joinToken));
  });

  it('refuses a link copy whose QR was altered on the way (reply key or capability)', async () => {
    const copyBody = body({ invitee: undefined, replyKey: link.replyKey, expiresAt: NOW + 3600 });
    delete (copyBody as { invitee?: unknown }).invitee;
    const s = deriveLinkSecrets(link.cap, SETUP_ID);
    const sealed = sealWithLinkKey(SETUP_ID, signed(copyBody), s.contentKey, fixed('unit link nonce', 24));
    expect((await openLinkInvite(link, sealed, NOW)).ok).toBe(true);
    expect(await openLinkInvite({ ...link, replyKey: directory[0].key }, sealed, NOW)).toEqual({ ok: false, code: 'BAD_KEY', field: 'body.replyKey' });
    expect(await openLinkInvite({ ...link, cap: fixed('other cap') }, sealed, NOW)).toEqual({ ok: false, code: 'DECRYPT_FAILED' });
    expect(await openLinkInvite({ ...link, exp: NOW + 7200 }, sealed, NOW)).toEqual({ ok: false, code: 'BAD_FIELD', field: 'exp' });
    const addressed = sealWithLinkKey(SETUP_ID, signed(body({ replyKey: link.replyKey })), s.contentKey, fixed('unit link nonce 2', 24));
    expect(await openLinkInvite(link, addressed, NOW)).toEqual({ ok: false, code: 'BAD_FIELD', field: 'body.invitee' });
  });

  it('the mailbox path refuses an invitation filed under another setup', async () => {
    const otherSetup = Uint8Array.from(SETUP_ID, b => b ^ 1);
    const plaintext = signed(body({ setupId: otherSetup }));
    const sealed = sealForRecipients('INVITE', SETUP_ID, plaintext, directory, rnd('d', 5));
    expect(await openMailboxInvite(SETUP_ID, { wrap: sealed.wraps[0], nonce: sealed.nonce, ciphertext: sealed.ciphertext }, deviceSecrets[0], NOW))
      .toEqual({ ok: false, code: 'WRONG_SETUP' });
  });
});
