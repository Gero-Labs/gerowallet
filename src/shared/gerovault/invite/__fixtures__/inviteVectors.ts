/**
 * Builds `invite-vectors.json` from fixed inputs. Nothing here is a real wallet, device or server
 * secret: vault keys are the test participants of the manifest specs (`../../__fixtures__/manifest.ts`,
 * vault index 1), and every other secret, nonce and ephemeral key is BLAKE2b-256 of a fixed label.
 *
 * Regenerate after a deliberate contract change only:
 *   WRITE_INVITE_VECTORS=1 npx vitest run src/shared/gerovault/invite/inviteVectors.spec.ts
 */
import { x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import { readCbor } from '../../cbor';
import { CborWritable, encodeCanonicalCbor } from '../../canonicalCbor';
import { attestationBy, testParticipants } from '../../__fixtures__/manifest';
import { CLOCK_SKEW_S, DIRECTORY_SLOTS, MAX_INVITE_LIFETIME_S } from '../constants';
import { bytesToHex, hexToBytes, toBase64Url } from '../codec';
import { InviteLink, deriveLinkSecrets, encodeInviteLinkPayload, encodeInviteLinkUrl } from '../link';
import {
  AcceptBody,
  InviteBody,
  acceptDigest,
  acceptMac,
  acceptSubject,
  encodeAcceptBody,
  encodeDecline,
  encodeInviteBody,
  encodeRevoke,
  encodeSignedAccept,
  encodeSignedInvite,
  inviteDigest,
  inviteSubject,
  revokeHashOf,
} from '../payloads';
import { SealRandomness, bodyAad, decoyInviteKey, sealForRecipients, sealWithLinkKey, wrapAad, wrapKey, x25519PublicKey } from '../seal';

const utf8 = (text: string) => new TextEncoder().encode(text);
/** 32 (or `n`) bytes from a label: the only source of "randomness" in the vectors. */
export const fixed = (label: string, n = 32) => blake2b(utf8(`gero-vault-invite vectors|${label}`), { dkLen: n });
const hex = bytesToHex;

export const NOW = 1795651200;
export const SETUP_ID = hexToBytes('a0a1a2a3a4a5a6a7a8a9aaabacadaeaf') as Uint8Array;
export const NETWORK = 'cardano-preprod' as const;
export const SERVER_DECOY_SECRET = fixed('server decoy secret');
export const INVITER_STAKE_CREDENTIAL = fixed('inviter stake credential', 28);
export const COSIGNER_STAKE_CREDENTIAL = fixed('cosigner stake credential', 28);

/** A map written in the given key order: valid strict CBOR, but not canonical when unsorted. */
function unsortedMap(entries: readonly [string, CborWritable][]): Uint8Array {
  const parts = entries.flatMap(([k, v]) => [encodeCanonicalCbor(k), encodeCanonicalCbor(v)]);
  const out = new Uint8Array(1 + parts.reduce((n, p) => n + p.length, 0));
  out[0] = 0xa0 + entries.length;
  let at = 1;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** JSON form: bytes as lowercase hex, everything else as is. */
function json(value: unknown): unknown {
  if (value instanceof Uint8Array) return hex(value);
  if (Array.isArray(value)) return value.map(json);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, json(v)]));
  return value;
}

function sealRandomness(prefix: string, count: number): SealRandomness {
  return {
    contentKey: fixed(`${prefix} content key`),
    nonce: fixed(`${prefix} nonce`, 24),
    wraps: Array.from({ length: count }, (_, i) => ({ ephemeralSecret: fixed(`${prefix} ephemeral ${i}`), nonce: fixed(`${prefix} wrap nonce ${i}`, 24) })),
  };
}

/** Intermediate values of each wrap, so a port can tell an ECDH fault from an HKDF one. */
function wrapIntermediates(kind: 'INVITE' | 'ACCEPT' | 'DECLINE', rnd: SealRandomness, recipients: readonly { slot: number; key: Uint8Array }[]) {
  return recipients.map((r, i) => {
    const e = rnd.wraps[i].ephemeralSecret;
    const E = x25519PublicKey(e);
    const ss = x25519.getSharedSecret(e, r.key);
    return { slot: r.slot, ephemeralSecret: hex(e), ephemeralKey: hex(E), sharedSecret: hex(ss), wrapKey: hex(wrapKey(kind, SETUP_ID, r.slot, ss, E, r.key)), wrapAad: hex(wrapAad(kind, SETUP_ID, r.slot)) };
  });
}

export async function buildInviteVectors(): Promise<Record<string, unknown>> {
  const [initiator, cosigner] = await testParticipants([1, 1, 1, 1]);
  const vaultKeysOf = (p: typeof initiator) => ({ payment: hexToBytes(p.vaultKeys.payment) as Uint8Array, stake: hexToBytes(p.vaultKeys.stake) as Uint8Array });

  // Device invite keys: the initiator's, and two devices of the cosigner. Slots 2 to 4 are decoys.
  const initiatorSecret = fixed('initiator device invite secret');
  const cosignerSecrets = [fixed('cosigner device A invite secret'), fixed('cosigner device B invite secret')];
  const decoys = [2, 3, 4].map(slot => ({ slot, key: decoyInviteKey(SERVER_DECOY_SECRET, NETWORK, COSIGNER_STAKE_CREDENTIAL, slot) }));
  const directory = [
    { slot: 0, key: x25519PublicKey(cosignerSecrets[0]) },
    { slot: 1, key: x25519PublicKey(cosignerSecrets[1]) },
    ...decoys,
  ];
  const replyKey = x25519PublicKey(initiatorSecret);

  // INVITE (mailbox, addressed to the cosigner's credential)
  const revokeSecret = fixed('invite revoke secret');
  const inviteBody: InviteBody = {
    network: NETWORK,
    setupId: SETUP_ID,
    vault: { name: 'Ops petty cash', template: 'standard', threshold: 2, owners: 3 },
    inviter: { label: 'Adam', stakeCredential: INVITER_STAKE_CREDENTIAL, handle: '$adam' },
    invitee: COSIGNER_STAKE_CREDENTIAL,
    participants: [{ label: 'Bea', status: 'accepted' }],
    replyKey,
    vaultKeys: vaultKeysOf(initiator),
    revokeHash: revokeHashOf(revokeSecret),
    issuedAt: NOW,
    expiresAt: NOW + MAX_INVITE_LIFETIME_S,
  };
  const inviteSig = attestationBy(initiator, inviteSubject(inviteBody), 'cip8');
  const inviteSigTx = attestationBy(initiator, inviteSubject(inviteBody), 'expiredTx');
  const signedInvite = encodeSignedInvite(inviteBody, inviteSig);
  const signedInviteTx = encodeSignedInvite(inviteBody, inviteSigTx);
  const inviteRnd = sealRandomness('invite', DIRECTORY_SLOTS);
  const inviteSealed = sealForRecipients('INVITE', SETUP_ID, signedInvite, directory, inviteRnd);

  // Link: the QR's capability, and the link copy of the invitation (no invitee, its own revoke secret)
  const link: InviteLink = { network: NETWORK, setupId: SETUP_ID, replyKey, cap: fixed('link capability'), exp: NOW + 600 };
  const secrets = deriveLinkSecrets(link.cap, SETUP_ID);
  const linkRevokeSecret = fixed('link copy revoke secret');
  const linkBody: InviteBody = { ...inviteBody, invitee: undefined, participants: [], revokeHash: revokeHashOf(linkRevokeSecret) };
  delete (linkBody as { invitee?: unknown }).invitee;
  const linkSig = attestationBy(initiator, inviteSubject(linkBody), 'cip8');
  const signedLinkCopy = encodeSignedInvite(linkBody, linkSig);
  const linkSealed = sealWithLinkKey(SETUP_ID, signedLinkCopy, secrets.contentKey, fixed('link copy nonce', 24));

  // ACCEPT of the mailbox invitation (CIP-8 and expired transaction), sealed to the reply key
  const acceptBody: AcceptBody = {
    network: NETWORK,
    setupId: SETUP_ID,
    invite: hexToBytes(inviteDigest(inviteBody)) as Uint8Array,
    label: 'Carla',
    stakeCredential: COSIGNER_STAKE_CREDENTIAL,
    vaultKeys: vaultKeysOf(cosigner),
    acceptedAt: NOW + 3600,
  };
  const acceptSig = attestationBy(cosigner, acceptSubject(acceptBody), 'cip8');
  const acceptSigTx = attestationBy(cosigner, acceptSubject(acceptBody), 'expiredTx');
  const signedAccept = encodeSignedAccept(acceptBody, acceptSig);
  const signedAcceptTx = encodeSignedAccept(acceptBody, acceptSigTx);
  const replyRecipient = [{ slot: 0, key: replyKey }];
  const acceptRnd = sealRandomness('accept', 1);
  const acceptSealed = sealForRecipients('ACCEPT', SETUP_ID, signedAccept, replyRecipient, acceptRnd);

  // ACCEPT of the link copy, with the MAC
  const linkAcceptBody: AcceptBody = { ...acceptBody, invite: hexToBytes(inviteDigest(linkBody)) as Uint8Array, acceptedAt: NOW + 60 };
  const linkAcceptSig = attestationBy(cosigner, acceptSubject(linkAcceptBody), 'cip8');
  const mac = acceptMac(secrets.macKey, acceptDigest(linkAcceptBody));
  const signedLinkAccept = encodeSignedAccept(linkAcceptBody, linkAcceptSig, mac);
  const linkAcceptRnd = sealRandomness('link accept', 1);
  const linkAcceptSealed = sealForRecipients('ACCEPT', SETUP_ID, signedLinkAccept, replyRecipient, linkAcceptRnd);

  // DECLINE and REVOKE
  const decline = encodeDecline({ setupId: SETUP_ID, invite: hexToBytes(inviteDigest(inviteBody)) as Uint8Array });
  const declineRnd = sealRandomness('decline', 1);
  const declineSealed = sealForRecipients('DECLINE', SETUP_ID, decline, replyRecipient, declineRnd);
  const revoke = encodeRevoke({ setupId: SETUP_ID, secret: revokeSecret, revokedAt: NOW + 7200 });

  return {
    protocol: 'gero-vault-invite/v1',
    note: 'PROVISIONAL test vectors. Every secret is BLAKE2b-256("gero-vault-invite vectors|<label>"); vault keys are the manifest test participants 0 (inviter) and 1 (cosigner) at vault index 1. Bytes are lowercase hex, ciphertexts base64url without padding, times unix seconds.',
    now: NOW,
    clockSkewSeconds: CLOCK_SKEW_S,
    setupId: hex(SETUP_ID),
    network: NETWORK,
    deviceKeys: {
      initiator: { secret: hex(initiatorSecret), inviteKey: hex(replyKey) },
      cosignerA: { secret: hex(cosignerSecrets[0]), inviteKey: hex(directory[0].key) },
      cosignerB: { secret: hex(cosignerSecrets[1]), inviteKey: hex(directory[1].key) },
    },
    decoys: {
      serverSecret: hex(SERVER_DECOY_SECRET),
      network: NETWORK,
      stakeCredential: hex(COSIGNER_STAKE_CREDENTIAL),
      entries: decoys.map(d => ({ slot: d.slot, inviteKey: hex(d.key) })),
    },
    directory: directory.map(d => ({ slot: d.slot, inviteKey: hex(d.key) })),
    invite: {
      body: json(inviteBody),
      bodyCbor: hex(encodeInviteBody(inviteBody)),
      digest: inviteDigest(inviteBody),
      revokeSecret: hex(revokeSecret),
      cip8: { sig: inviteSig, signedCbor: hex(signedInvite) },
      expiredTx: { sig: inviteSigTx, signedCbor: hex(signedInviteTx) },
      seal: {
        kind: 'INVITE',
        contentKey: hex(inviteRnd.contentKey),
        nonce: hex(inviteRnd.nonce),
        bodyAad: hex(bodyAad('INVITE', SETUP_ID)),
        wraps: wrapIntermediates('INVITE', inviteRnd, directory).map((w, i) => ({ ...w, wrapNonce: hex(inviteRnd.wraps[i].nonce) })),
        plaintext: 'invite.cip8.signedCbor',
        sealed: inviteSealed,
      },
    },
    link: {
      fields: json(link),
      payload: encodeInviteLinkPayload(link),
      url: encodeInviteLinkUrl(link),
      cbor: hex(encodeCanonicalCbor({ v: 1, kind: 'link', network: link.network, setupId: link.setupId, replyKey: link.replyKey, cap: link.cap, exp: link.exp })),
      joinToken: hex(secrets.joinToken),
      joinTokenHash: hex(secrets.joinTokenHash),
      contentKey: hex(secrets.contentKey),
      macKey: hex(secrets.macKey),
      copy: {
        body: json(linkBody),
        digest: inviteDigest(linkBody),
        revokeSecret: hex(linkRevokeSecret),
        sig: linkSig,
        signedCbor: hex(signedLinkCopy),
        bodyAad: hex(bodyAad('LINK', SETUP_ID)),
        sealed: linkSealed,
      },
    },
    accept: {
      body: json(acceptBody),
      bodyCbor: hex(encodeAcceptBody(acceptBody)),
      digest: acceptDigest(acceptBody),
      cip8: { sig: acceptSig, signedCbor: hex(signedAccept) },
      expiredTx: { sig: acceptSigTx, signedCbor: hex(signedAcceptTx) },
      seal: {
        kind: 'ACCEPT',
        contentKey: hex(acceptRnd.contentKey),
        nonce: hex(acceptRnd.nonce),
        bodyAad: hex(bodyAad('ACCEPT', SETUP_ID)),
        wraps: wrapIntermediates('ACCEPT', acceptRnd, replyRecipient).map((w, i) => ({ ...w, wrapNonce: hex(acceptRnd.wraps[i].nonce) })),
        plaintext: 'accept.cip8.signedCbor',
        sealed: acceptSealed,
      },
    },
    linkAccept: {
      body: json(linkAcceptBody),
      digest: acceptDigest(linkAcceptBody),
      mac: hex(mac),
      sig: linkAcceptSig,
      signedCbor: hex(signedLinkAccept),
      seal: {
        kind: 'ACCEPT',
        contentKey: hex(linkAcceptRnd.contentKey),
        nonce: hex(linkAcceptRnd.nonce),
        wraps: wrapIntermediates('ACCEPT', linkAcceptRnd, replyRecipient).map((w, i) => ({ ...w, wrapNonce: hex(linkAcceptRnd.wraps[i].nonce) })),
        sealed: linkAcceptSealed,
      },
    },
    decline: {
      cbor: hex(decline),
      seal: {
        kind: 'DECLINE',
        contentKey: hex(declineRnd.contentKey),
        nonce: hex(declineRnd.nonce),
        wraps: wrapIntermediates('DECLINE', declineRnd, replyRecipient).map((w, i) => ({ ...w, wrapNonce: hex(declineRnd.wraps[i].nonce) })),
        sealed: declineSealed,
      },
    },
    revoke: { cbor: hex(revoke), base64url: toBase64Url(revoke), revokeHash: hex(revokeHashOf(revokeSecret)) },
    negative: negativeVectors({ inviteBody, signedInvite, signedAccept, link, initiatorSecret, cosignerSecrets, inviteSealed, acceptBody }),
  };
}

interface NegativeInputs {
  inviteBody: InviteBody;
  signedInvite: Uint8Array;
  signedAccept: Uint8Array;
  link: InviteLink;
  initiatorSecret: Uint8Array;
  cosignerSecrets: readonly Uint8Array[];
  inviteSealed: ReturnType<typeof sealForRecipients>;
  acceptBody: AcceptBody;
}

/**
 * Inputs every reader must refuse, with the refusal code. `target` names the check:
 *   link            parseInviteLink(input, now)
 *   signedInvite    openSignedInvite(hex, now)  (no channel expectations)
 *   signedAccept    openSignedAccept(hex, now, the mailbox accept's context, no MAC key)
 *   delivery        openMailboxInvite(setupId, delivery, secret of `device`, now)
 *   revoke          openRevoke(hex, invite.body)
 *   x25519          isUsableX25519Key(hex) is false (no code)
 *   base64url       fromBase64Url(text) is undefined (no code)
 */
function negativeVectors(n: NegativeInputs): unknown[] {
  const out: unknown[] = [];
  const linkCbor = (overrides: Record<string, CborWritable>) =>
    'gvi1' + toBase64Url(encodeCanonicalCbor({ v: 1, kind: 'link', network: n.link.network, setupId: n.link.setupId, replyKey: n.link.replyKey, cap: n.link.cap, exp: n.link.exp, ...overrides }));
  const linkOk = encodeInviteLinkPayload(n.link);

  out.push({ target: 'link', name: 'expired', input: linkOk, now: n.link.exp, code: 'EXPIRED' });
  out.push({ target: 'link', name: 'unknown prefix version', input: 'gvi2' + linkOk.slice(4), now: NOW, code: 'UNKNOWN_VERSION' });
  out.push({ target: 'link', name: 'v 2 inside', input: linkCbor({ v: 2 }), now: NOW, code: 'UNKNOWN_VERSION' });
  out.push({ target: 'link', name: 'other host', input: 'https://example.com/vault-invite#' + linkOk, now: NOW, code: 'MALFORMED' });
  out.push({ target: 'link', name: 'padding', input: linkOk + '=', now: NOW, code: 'MALFORMED' });
  out.push({ target: 'link', name: 'short cap', input: linkCbor({ cap: n.link.cap.subarray(0, 31) }), now: NOW, code: 'BAD_FIELD' });
  out.push({ target: 'link', name: 'short setup id', input: linkCbor({ setupId: n.link.setupId.subarray(0, 15) }), now: NOW, code: 'BAD_FIELD' });
  out.push({ target: 'link', name: 'unknown field', input: linkCbor({ extra: 1 }), now: NOW, code: 'BAD_FIELD' });
  out.push({ target: 'link', name: 'unknown network', input: linkCbor({ network: 'cardano-sanchonet' }), now: NOW, code: 'WRONG_NETWORK' });
  out.push({ target: 'link', name: 'small-order reply key', input: linkCbor({ replyKey: new Uint8Array(32) }), now: NOW, code: 'BAD_KEY' });
  out.push({ target: 'link', name: 'lifetime over 7 days', input: linkCbor({ exp: NOW + MAX_INVITE_LIFETIME_S + CLOCK_SKEW_S + 1 }), now: NOW, code: 'LIFETIME_TOO_LONG' });
  const unsorted = unsortedMap([['v', 1], ['kind', 'link'], ['network', n.link.network], ['setupId', n.link.setupId], ['replyKey', n.link.replyKey], ['cap', n.link.cap], ['exp', n.link.exp]]);
  out.push({ target: 'link', name: 'keys not in canonical order', input: 'gvi1' + toBase64Url(unsorted), now: NOW, code: 'NOT_CANONICAL' });

  const bodyValue = (overrides: Record<string, CborWritable>, drop: readonly string[] = []): Record<string, CborWritable> => {
    const b = n.inviteBody;
    const base: Record<string, CborWritable> = {
      v: 1, kind: 'invite', network: b.network, setupId: b.setupId,
      vault: { name: b.vault.name, template: b.vault.template, threshold: b.vault.threshold, owners: b.vault.owners },
      inviter: { label: b.inviter.label, stakeCredential: b.inviter.stakeCredential, handle: b.inviter.handle as string },
      invitee: b.invitee as Uint8Array,
      participants: b.participants.map(p => ({ label: p.label, status: p.status })),
      replyKey: b.replyKey, vaultKeys: { payment: b.vaultKeys.payment, stake: b.vaultKeys.stake }, revokeHash: b.revokeHash,
      issuedAt: b.issuedAt, expiresAt: b.expiresAt, ...overrides,
    };
    for (const k of drop) delete base[k];
    return base;
  };
  // The original signature over the original body: structure errors fire first, a changed body fails the signature.
  const withSig = (body: Record<string, CborWritable>, sig: Record<string, CborWritable>) => hex(encodeCanonicalCbor({ body, sig }));
  const originalSig = sigOf(n.signedInvite);
  const inviteCase = (name: string, body: Record<string, CborWritable>, code: string, now = NOW) =>
    out.push({ target: 'signedInvite', name, input: withSig(body, originalSig), now, code });

  inviteCase('version 2', bodyValue({ v: 2 }), 'UNKNOWN_VERSION');
  inviteCase('kind accept', bodyValue({ kind: 'accept' }), 'WRONG_KIND');
  inviteCase('unknown field', bodyValue({ colour: 'red' }), 'BAD_FIELD');
  inviteCase('missing replyKey', bodyValue({}, ['replyKey']), 'BAD_FIELD');
  inviteCase('backup template', bodyValue({ vault: { name: 'Ops petty cash', template: 'backup', threshold: 2, owners: 3 } }), 'BAD_FIELD');
  inviteCase('threshold above owners', bodyValue({ vault: { name: 'Ops petty cash', template: 'standard', threshold: 4, owners: 3 } }), 'BAD_FIELD');
  inviteCase('threshold 1', bodyValue({ vault: { name: 'Ops petty cash', template: 'standard', threshold: 1, owners: 3 } }), 'BAD_FIELD');
  inviteCase('21 owners', bodyValue({ vault: { name: 'Ops petty cash', template: 'standard', threshold: 2, owners: 21 } }), 'BAD_FIELD');
  inviteCase('too many participants', bodyValue({ participants: [1, 2, 3].map(i => ({ label: `P${i}`, status: 'waiting' })) }), 'BAD_FIELD');
  inviteCase('unknown participant status', bodyValue({ participants: [{ label: 'Bea', status: 'declined' }] }), 'BAD_FIELD');
  inviteCase('handle without $', bodyValue({ inviter: { label: 'Adam', stakeCredential: n.inviteBody.inviter.stakeCredential, handle: 'adam' } }), 'BAD_FIELD');
  inviteCase('label with a control character', bodyValue({ inviter: { label: 'Ad\u0007am', stakeCredential: n.inviteBody.inviter.stakeCredential } }), 'BAD_FIELD');
  inviteCase('small-order reply key', bodyValue({ replyKey: hexToBytes('e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800') as Uint8Array }), 'BAD_KEY');
  inviteCase('payment key equals stake key', bodyValue({ vaultKeys: { payment: n.inviteBody.vaultKeys.payment, stake: n.inviteBody.vaultKeys.payment } }), 'BAD_KEY');
  inviteCase('lifetime over 7 days', bodyValue({ expiresAt: NOW + MAX_INVITE_LIFETIME_S + 1 }), 'LIFETIME_TOO_LONG');
  inviteCase('expires before issued', bodyValue({ expiresAt: NOW }), 'BAD_FIELD');
  inviteCase('vault name changed after signing', bodyValue({ vault: { name: 'Ops treasury', template: 'standard', threshold: 2, owners: 3 } }), 'BAD_SIGNATURE');
  inviteCase('revoke hash changed after signing', bodyValue({ revokeHash: new Uint8Array(32) }), 'BAD_SIGNATURE');
  out.push({ target: 'signedInvite', name: 'expired', input: hex(n.signedInvite), now: n.inviteBody.expiresAt, code: 'EXPIRED' });
  out.push({ target: 'signedInvite', name: 'issued in the future', input: hex(n.signedInvite), now: NOW - CLOCK_SKEW_S - 1, code: 'NOT_YET_VALID' });
  out.push({ target: 'signedInvite', name: 'trailing byte', input: hex(n.signedInvite) + '00', now: NOW, code: 'MALFORMED' });
  out.push({ target: 'signedInvite', name: 'unsorted outer map', input: hex(unsortedMap([['body', bodyValue({})], ['sig', originalSig]])), now: NOW, code: 'NOT_CANONICAL' });

  const acceptOk = hex(n.signedAccept);
  out.push({ target: 'signedAccept', name: 'MAC on a mailbox accept', input: hex(appendMac(n.signedAccept)), now: NOW + 3600, code: 'BAD_MAC' });
  out.push({ target: 'signedAccept', name: 'accepted after the invitation expired', input: acceptOk, now: NOW + 3600, inviteExpiresAt: NOW + 3600, code: 'EXPIRED' });
  out.push({ target: 'signedAccept', name: 'dated in the future', input: acceptOk, now: NOW, code: 'NOT_YET_VALID' });
  out.push({ target: 'signedAccept', name: 'other invitation', input: acceptOk, now: NOW + 3600, inviteDigest: '00'.repeat(32), code: 'WRONG_INVITE' });
  out.push({ target: 'signedAccept', name: 'label changed after signing', input: hex(resignless(n.signedAccept, n.acceptBody, { label: 'Carl' })), now: NOW + 3600, code: 'BAD_SIGNATURE' });

  const delivery = (wrapIndex: number, patch: Record<string, unknown> = {}) => ({ wrap: { ...n.inviteSealed.wraps[wrapIndex], ...patch }, nonce: n.inviteSealed.nonce, ciphertext: n.inviteSealed.ciphertext });
  out.push({ target: 'delivery', name: 'wrap of another device', delivery: delivery(1), device: 'cosignerA', now: NOW, code: 'WRONG_RECIPIENT' });
  out.push({ target: 'delivery', name: 'wrapped key tampered', delivery: delivery(0, { wrappedKey: flipLastHex(n.inviteSealed.wraps[0].wrappedKey) }), device: 'cosignerA', now: NOW, code: 'DECRYPT_FAILED' });
  out.push({ target: 'delivery', name: 'slot changed', delivery: delivery(0, { slot: 1 }), device: 'cosignerA', now: NOW, code: 'DECRYPT_FAILED' });
  out.push({ target: 'delivery', name: 'ciphertext tampered', delivery: { ...delivery(0), ciphertext: flipFirstB64(n.inviteSealed.ciphertext) }, device: 'cosignerA', now: NOW, code: 'DECRYPT_FAILED' });
  out.push({ target: 'delivery', name: 'uppercase hex', delivery: delivery(0, { nonce: n.inviteSealed.wraps[0].nonce.toUpperCase() }), device: 'cosignerA', now: NOW, code: 'MALFORMED' });

  out.push({ target: 'revoke', name: 'wrong secret', input: hex(encodeRevoke({ setupId: SETUP_ID, secret: fixed('not the revoke secret'), revokedAt: NOW })), code: 'BAD_REVOKE' });
  out.push({ target: 'revoke', name: 'other setup', input: hex(encodeRevoke({ setupId: new Uint8Array(16), secret: fixed('invite revoke secret'), revokedAt: NOW })), code: 'WRONG_SETUP' });

  for (const key of [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0100000000000000000000000000000000000000000000000000000000000000',
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
    '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    hex(x25519PublicKey(fixed('high bit'))).slice(0, 62) + '80',
  ]) out.push({ target: 'x25519', name: `refused key ${key.slice(0, 8)}…`, input: key });

  for (const text of ['AA==', 'A', 'AB', 'a+b/', 'ab cd', 'AAF', 'AAAB=']) out.push({ target: 'base64url', name: `refused ${JSON.stringify(text)}`, input: text });
  return out;
}

function sigOf(signed: Uint8Array): Record<string, CborWritable> {
  const item = readCbor(signed, { maxDepth: 8, maxItems: 1024 });
  if (item.value.type !== 'map') throw new Error('fixture: not a map');
  const entry = item.value.value.find(([k]) => k.value.type === 'text' && k.value.value === 'sig');
  if (!entry || entry[1].value.type !== 'map') throw new Error('fixture: no sig');
  const out: Record<string, CborWritable> = {};
  for (const [k, v] of entry[1].value.value) {
    if (k.value.type !== 'text') throw new Error('fixture: sig key');
    out[k.value.value] = v.value.type === 'int' ? Number(v.value.value) : (v.value.value as Uint8Array);
  }
  return out;
}

/** The signed ACCEPT with a 32-byte MAC added. */
function appendMac(signed: Uint8Array): Uint8Array {
  const item = readCbor(signed, { maxDepth: 8, maxItems: 1024 });
  if (item.value.type !== 'map') throw new Error('fixture: not a map');
  const parts = item.value.value.map(([k, v]) => [signed.subarray(k.start, k.end), signed.subarray(v.start, v.end)] as const);
  const entries: [string, Uint8Array][] = parts.map(([k, v]) => [new TextDecoder().decode(k.subarray(1)), v]);
  const mac = encodeCanonicalCbor(fixed('stray mac'));
  const all = [...entries, ['mac', mac] as [string, Uint8Array]].sort((a, b) => a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1));
  const chunks = [Uint8Array.of(0xa0 + all.length), ...all.flatMap(([k, v]) => [encodeCanonicalCbor(k), v])];
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The signed ACCEPT with its body changed and the original signature kept. */
function resignless(signed: Uint8Array, body: AcceptBody, patch: Partial<AcceptBody>): Uint8Array {
  const sig = sigOf(signed);
  const b = { ...body, ...patch };
  return encodeCanonicalCbor({
    body: { v: 1, kind: 'accept', network: b.network, setupId: b.setupId, invite: b.invite, label: b.label, stakeCredential: b.stakeCredential, vaultKeys: { payment: b.vaultKeys.payment, stake: b.vaultKeys.stake }, acceptedAt: b.acceptedAt },
    sig,
  });
}

function flipLastHex(text: string): string {
  const last = text[text.length - 1];
  return text.slice(0, -1) + (last === '0' ? '1' : '0');
}

function flipFirstB64(text: string): string {
  return (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
}
