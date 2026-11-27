// @vitest-environment node
import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from 'node:process';
import sodium from 'libsodium-wrappers-sumo';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildInviteVectors } from './__fixtures__/inviteVectors';
import { fromBase64Url, isUsableX25519Key } from './codec';
import { openAcceptResponse, openDeclineResponse, openLinkInvite, openMailboxInvite } from './flows';
import { parseInviteLink } from './link';
import { InviteBody, decodeSignedInvite, openRevoke, openSignedAccept, openSignedInvite } from './payloads';
import { WireDelivery, WireSealed } from './seal';

/**
 * PROVISIONAL vectors of `gero-vault-invite/v1` (`PROTOCOL.md` section 9), for gero-sync, iOS and
 * Android to reproduce. The file is checked three ways: this module rebuilds it byte for byte; an
 * independent re-derivation (libsodium for X25519, XChaCha20-Poly1305 and BLAKE2b; node:crypto for
 * HKDF, HMAC and SHA-256) opens every sealed object from the file's own inputs; and every negative
 * case is refused with its code.
 */
const FILE = resolve(__dirname, '__fixtures__/invite-vectors.json');
/* eslint-disable @typescript-eslint/no-explicit-any */
const V: any = JSON.parse(readFileSync(FILE, 'utf8'));

const hex = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const ascii = (s: string) => Uint8Array.from(Buffer.from(s, 'ascii'));
const cat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts.map(p => Buffer.from(p))));
// base64url through plain base64 (the Buffer polyfill knows no 'base64url').
const b64url = (s: string) => Uint8Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='), 'base64'));
const toB64url = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** RFC 5869 HKDF-SHA256 for 32 bytes (one block): PRK = HMAC(salt, ikm); OKM = HMAC(PRK, info || 0x01). */
const hmac = (key: Uint8Array, msg: Uint8Array) => Uint8Array.from(createHmac('sha256', Buffer.from(key)).update(Buffer.from(msg)).digest());
const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array) => hmac(hmac(salt, ikm), cat(info, Uint8Array.of(1)));

beforeAll(async () => {
  await sodium.ready;
});

describe('invite vectors: the file is what this module builds', () => {
  it('matches byte for byte', async () => {
    const built = JSON.parse(JSON.stringify(await buildInviteVectors()));
    if (env['WRITE_INVITE_VECTORS']) writeFileSync(FILE, `${JSON.stringify(built, null, 2)}\n`);
    expect(built).toEqual(V);
  });
});

describe('invite vectors: independent re-derivation', () => {
  const setupId = V.setupId ? hex(V.setupId) : new Uint8Array(16);

  /** Opens one wrap and the body with libsodium and node:crypto only, from the file's values. */
  function independentOpen(kind: string, sealed: WireSealed, slotIndex: number, secret: Uint8Array): Uint8Array {
    const wrap = sealed.wraps[slotIndex];
    const E = hex(wrap.ephemeralKey);
    const R = sodium.crypto_scalarmult_base(secret);
    expect(toHex(R)).toBe(wrap.recipientKey);
    const ss = sodium.crypto_scalarmult(secret, E);
    const info = cat(ascii(`gero-vault-invite/v1|WRAP|${kind}|`), Uint8Array.of(wrap.slot), E, R);
    const key = hkdf(ss, setupId, info);
    const wrapAad = cat(ascii(`gero-vault-invite/v1|WRAP|${kind}|`), setupId, Uint8Array.of(wrap.slot));
    const contentKey = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, hex(wrap.wrappedKey), wrapAad, hex(wrap.nonce), key);
    const aad = cat(ascii(`gero-vault-invite/v1|${kind}|`), setupId);
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, b64url(sealed.ciphertext), aad, hex(sealed.nonce), contentKey);
  }

  it('derives every device and decoy key', () => {
    for (const d of Object.values<any>(V.deviceKeys)) expect(toHex(sodium.crypto_scalarmult_base(hex(d.secret)))).toBe(d.inviteKey);
    for (const e of V.decoys.entries) {
      const scalar = createHmac('sha256', hex(V.decoys.serverSecret))
        .update(cat(ascii(`gero-vault-invite/v1|DECOY|${V.decoys.network}|`), hex(V.decoys.stakeCredential), Uint8Array.of(e.slot)))
        .digest();
      expect(toHex(sodium.crypto_scalarmult_base(Uint8Array.from(scalar)))).toBe(e.inviteKey);
      expect(isUsableX25519Key(hex(e.inviteKey))).toBe(true);
    }
    expect(V.directory).toHaveLength(5);
    expect(V.directory.map((d: any) => d.slot)).toEqual([0, 1, 2, 3, 4]);
  });

  it('pins the wrap intermediates', () => {
    for (const w of V.invite.seal.wraps) {
      const recipient = V.directory[w.slot].inviteKey;
      const ss = sodium.crypto_scalarmult(hex(w.ephemeralSecret), hex(recipient));
      expect(toHex(ss)).toBe(w.sharedSecret);
      const info = cat(ascii('gero-vault-invite/v1|WRAP|INVITE|'), Uint8Array.of(w.slot), hex(w.ephemeralKey), hex(recipient));
      expect(toHex(hkdf(ss, setupId, info))).toBe(w.wrapKey);
    }
  });

  it('opens the INVITE at both real slots, and the digests are tagged BLAKE2b-256', () => {
    const plain = toHex(independentOpen('INVITE', V.invite.seal.sealed, 0, hex(V.deviceKeys.cosignerA.secret)));
    expect(plain).toBe(V.invite.cip8.signedCbor);
    expect(toHex(independentOpen('INVITE', V.invite.seal.sealed, 1, hex(V.deviceKeys.cosignerB.secret)))).toBe(V.invite.cip8.signedCbor);
    const digest = sodium.crypto_generichash(32, cat(ascii('gero-vault-invite/v1|INVITE|'), hex(V.invite.bodyCbor)), null);
    expect(toHex(digest)).toBe(V.invite.digest);
    const acceptDigest = sodium.crypto_generichash(32, cat(ascii('gero-vault-invite/v1|ACCEPT|'), hex(V.accept.bodyCbor)), null);
    expect(toHex(acceptDigest)).toBe(V.accept.digest);
  });

  it('opens the ACCEPT and the DECLINE with the initiator key', () => {
    const initiator = hex(V.deviceKeys.initiator.secret);
    expect(toHex(independentOpen('ACCEPT', V.accept.seal.sealed, 0, initiator))).toBe(V.accept.cip8.signedCbor);
    expect(toHex(independentOpen('ACCEPT', V.linkAccept.seal.sealed, 0, initiator))).toBe(V.linkAccept.signedCbor);
    expect(toHex(independentOpen('DECLINE', V.decline.seal.sealed, 0, initiator))).toBe(V.decline.cbor);
  });

  it('derives the link secrets, opens the link copy and checks the MAC', () => {
    const cap = hex(V.link.fields.cap);
    const derive = (what: string) => toHex(hkdf(cap, setupId, ascii(`gero-vault-invite/v1|LINK|${what}`)));
    expect(derive('join-token')).toBe(V.link.joinToken);
    expect(derive('content-key')).toBe(V.link.contentKey);
    expect(derive('mac-key')).toBe(V.link.macKey);
    expect(createHash('sha256').update(hex(V.link.joinToken)).digest('hex')).toBe(V.link.joinTokenHash);
    expect(V.link.payload).toBe(`gvi1${toB64url(hex(V.link.cbor))}`);
    expect(V.link.url).toBe(`https://gerowallet.io/vault-invite#${V.link.payload}`);
    const aad = cat(ascii('gero-vault-invite/v1|LINK|'), setupId);
    const copy = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, b64url(V.link.copy.sealed.ciphertext), aad, hex(V.link.copy.sealed.nonce), hex(V.link.contentKey));
    expect(toHex(copy)).toBe(V.link.copy.signedCbor);
    const mac = createHmac('sha256', hex(V.link.macKey)).update(cat(ascii('gero-vault-invite/v1|ACCEPT-MAC|'), hex(V.linkAccept.digest))).digest('hex');
    expect(mac).toBe(V.linkAccept.mac);
    expect(createHash('sha256').update(hex(V.invite.revokeSecret)).digest('hex')).toBe(V.revoke.revokeHash);
  });
});

describe('invite vectors: this module opens what the file holds', () => {
  const setupId = V.setupId ? hex(V.setupId) : new Uint8Array(16);
  const delivery = (sealed: WireSealed, i: number): WireDelivery => ({ wrap: sealed.wraps[i], nonce: sealed.nonce, ciphertext: sealed.ciphertext });
  const inviteContext = (overrides: Record<string, unknown> = {}) => ({
    setupId,
    network: V.network,
    inviteDigest: V.invite.digest,
    inviteExpiresAt: V.invite.body.expiresAt,
    ...overrides,
  });

  it('opens the mailbox invitation on both devices; both signature methods verify', async () => {
    for (const [i, device] of [[0, 'cosignerA'], [1, 'cosignerB']] as const) {
      const opened = await openMailboxInvite(setupId, delivery(V.invite.seal.sealed, i), hex(V.deviceKeys[device].secret), V.now);
      expect(opened.ok).toBe(true);
      if (opened.ok) expect(opened.value.digest).toBe(V.invite.digest);
    }
    expect((await openSignedInvite(hex(V.invite.expiredTx.signedCbor), V.now)).ok).toBe(true);
  });

  it('opens the link copy from the parsed link', async () => {
    const link = parseInviteLink(V.link.url, V.now);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const opened = await openLinkInvite(link.value, V.link.copy.sealed, V.now);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.digest).toBe(V.link.copy.digest);
  });

  it('opens both ACCEPTs, the DECLINE and the REVOKE', async () => {
    const initiator = hex(V.deviceKeys.initiator.secret);
    const accepted = await openAcceptResponse(delivery(V.accept.seal.sealed, 0), initiator, inviteContext(), V.now + 3600);
    expect(accepted.ok).toBe(true);
    expect((await openSignedAccept(hex(V.accept.expiredTx.signedCbor), V.now + 3600, inviteContext())).ok).toBe(true);
    const viaLink = await openAcceptResponse(delivery(V.linkAccept.seal.sealed, 0), initiator,
      inviteContext({ inviteDigest: V.link.copy.digest, macKey: hex(V.link.macKey) }), V.now + 60);
    expect(viaLink.ok).toBe(true);
    expect(openDeclineResponse(delivery(V.decline.seal.sealed, 0), initiator, { setupId, inviteDigest: V.invite.digest }).ok).toBe(true);
    const body = decodeSignedInvite(hex(V.invite.cip8.signedCbor));
    expect(body.ok).toBe(true);
    if (body.ok) expect(openRevoke(hex(V.revoke.cbor), body.value.body).ok).toBe(true);
    expect(toHex(fromBase64Url(V.revoke.base64url) as Uint8Array)).toBe(V.revoke.cbor);
  });

  it('a link ACCEPT without its MAC key, or a wrong one, is refused', async () => {
    const initiator = hex(V.deviceKeys.initiator.secret);
    const noKey = await openAcceptResponse(delivery(V.linkAccept.seal.sealed, 0), initiator, inviteContext({ inviteDigest: V.link.copy.digest }), V.now + 60);
    expect(noKey).toEqual({ ok: false, code: 'BAD_MAC' });
    const wrongKey = await openAcceptResponse(delivery(V.linkAccept.seal.sealed, 0), initiator,
      inviteContext({ inviteDigest: V.link.copy.digest, macKey: hex(V.link.contentKey) }), V.now + 60);
    expect(wrongKey).toEqual({ ok: false, code: 'BAD_MAC' });
  });
});

describe('invite vectors: negative cases', () => {
  const setupId = V.setupId ? hex(V.setupId) : new Uint8Array(16);
  let inviteBody: InviteBody;

  beforeAll(() => {
    const decoded = decodeSignedInvite(hex(V.invite.cip8.signedCbor));
    if (!decoded.ok) throw new Error('vector invite does not decode');
    inviteBody = decoded.value.body;
  });

  it('has a case for every target', () => {
    const targets = new Set(V.negative.map((c: any) => c.target));
    expect([...targets].sort()).toEqual(['base64url', 'delivery', 'link', 'revoke', 'signedAccept', 'signedInvite', 'x25519']);
  });

  for (const c of V.negative as any[]) {
    it(`${c.target}: ${c.name}`, async () => {
      switch (c.target) {
        case 'link': {
          const r = parseInviteLink(c.input, c.now);
          expect(r.ok === false && r.code).toBe(c.code);
          break;
        }
        case 'signedInvite': {
          const r = await openSignedInvite(hex(c.input), c.now);
          expect(r.ok === false && r.code).toBe(c.code);
          break;
        }
        case 'signedAccept': {
          const r = await openSignedAccept(hex(c.input), c.now, {
            setupId,
            network: V.network,
            inviteDigest: c.inviteDigest ?? V.invite.digest,
            inviteExpiresAt: c.inviteExpiresAt ?? V.invite.body.expiresAt,
          });
          expect(r.ok === false && r.code).toBe(c.code);
          break;
        }
        case 'delivery': {
          const r = await openMailboxInvite(setupId, c.delivery, hex(V.deviceKeys[c.device].secret), c.now);
          expect(r.ok === false && r.code).toBe(c.code);
          break;
        }
        case 'revoke': {
          const r = openRevoke(hex(c.input), inviteBody);
          expect(r.ok === false && r.code).toBe(c.code);
          break;
        }
        case 'x25519':
          expect(isUsableX25519Key(hex(c.input))).toBe(false);
          break;
        case 'base64url':
          expect(fromBase64Url(c.input)).toBeUndefined();
          break;
        default:
          throw new Error(`unknown target ${c.target}`);
      }
    });
  }
});
