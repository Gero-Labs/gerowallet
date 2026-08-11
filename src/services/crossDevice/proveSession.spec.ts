import { describe, it, expect } from 'vitest';
import { x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  chunkAad,
  deriveSessionKeys,
  generateEphemeralKeyPair,
  joinChunks,
  openChunk,
  sealChunk,
  sessionInfo,
  sessionPrk,
  splitPayload,
  wipe,
  DEFAULT_CHUNK_BYTES,
  type SealedChunk,
} from './proveSession';

// ── CONFORMANCE VECTORS ──────────────────────────────────────────────────────
// iOS must reproduce these byte-for-byte. Generated from FIXED ephemeral
// secrets (0x11 * 32 for the phone, 0x22 * 32 for the desktop) so both clients
// can derive them without exchanging anything. Never use fixed secrets outside
// a test — real jobs mint fresh ones per job.
const PHONE_EPH_PRIV = new Uint8Array(32).fill(0x11);
const DESK_EPH_PRIV = new Uint8Array(32).fill(0x22);
const PHONE_EPH_PUB = '7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13';
const DESK_EPH_PUB = '0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20';
const K_P2D = 'f12adaf1187195d83f8dc7c73ccde874f197008785977bc02c9788f3edd1b140';
const K_D2P = 'b3cd2461624748ad825186b64bf51a38aa72d9dcb4a155d0b3d3aab30214b3c9';
const VEC_NONCE = 'a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5';
const VEC_CT = '470f9789d9f6609e9b3311100850bb4d392da48923c18431405fd6794698035d49';
const VEC_PLAINTEXT = 'unproven-tx-bytes';

const REQ_ID = 'req-1';
const PHONE_ID = 'phone-dev';
const DESK_ID = 'desk-dev';

const deriveFor = (role: 'phone' | 'desktop') =>
  deriveSessionKeys({
    ourPrivKey: role === 'phone' ? PHONE_EPH_PRIV : DESK_EPH_PRIV,
    theirPubKeyHex: role === 'phone' ? DESK_EPH_PUB : PHONE_EPH_PUB,
    reqId: REQ_ID,
    phoneDeviceId: PHONE_ID,
    desktopDeviceId: DESK_ID,
    role,
  });

describe('sessionInfo (conformance)', () => {
  it('is the exact pipe-joined string', () => {
    expect(sessionInfo(REQ_ID, PHONE_ID, DESK_ID, 'p2d'))
      .toBe('gero-xprove/v1|req-1|phone-dev|desk-dev|p2d');
  });
});

describe('chunkAad (conformance)', () => {
  it('is the exact pipe-joined string', () => {
    expect(new TextDecoder().decode(chunkAad(REQ_ID, 'd2p', 2, 5)))
      .toBe('gero-xprove/v1|req-1|d2p|2|5');
  });
});

describe('ephemeral keys', () => {
  it('derives the vector public keys from the vector secrets', () => {
    expect(bytesToHex(x25519.getPublicKey(PHONE_EPH_PRIV))).toBe(PHONE_EPH_PUB);
    expect(bytesToHex(x25519.getPublicKey(DESK_EPH_PRIV))).toBe(DESK_EPH_PUB);
  });

  it('mints a fresh 32-byte pair each call', () => {
    const a = generateEphemeralKeyPair();
    const b = generateEphemeralKeyPair();
    expect(a.privKey).toHaveLength(32);
    expect(hexToBytes(a.pubKeyHex)).toHaveLength(32);
    expect(a.pubKeyHex).not.toBe(b.pubKeyHex);
  });
});

// The KDF is the reconciliation hot spot. These pin BOTH steps: a mismatch on
// PRK localizes the fault to extract, a mismatch on only the keys to expand.
const VEC_ECDH = '9e004098efc091d4ec2663b4e9f5cfd4d7064571690b4bea97ab146ab9f35056';
const VEC_PRK = 'd74b44c27980244dec7d11bda9a67caf7f2a6a33604348ccbb7fca1dd54ecad6'
  + '79f9e8ad7774142ed057e0481ac8a203d73bf742fefc78f06c6a7bfa30eb5713';

describe('KDF extract (RFC 5869 HKDF with HMAC-BLAKE2b-512)', () => {
  const shared = x25519.getSharedSecret(DESK_EPH_PRIV, hexToBytes(PHONE_EPH_PUB));

  it('agrees on the ECDH secret from the vector keys', () => {
    expect(bytesToHex(shared)).toBe(VEC_ECDH);
  });

  it('produces the pinned 64-byte PRK', () => {
    const prk = sessionPrk(shared);
    expect(prk).toHaveLength(64);
    expect(bytesToHex(prk)).toBe(VEC_PRK);
  });

  // The trap this protocol must not fall into: BLAKE2b's NATIVE keyed mode is
  // the intuitive reading of "HKDF-BLAKE2b" and is what a CryptoKit/libsodium
  // port reaches for first. It produces different bytes and would never
  // interoperate. If this test ever fails, the KDF silently changed meaning.
  it('is HMAC-BLAKE2b, NOT BLAKE2b native keyed mode', () => {
    const nativeKeyed = blake2b.create({ key: new Uint8Array(64) }).update(shared).digest();
    expect(bytesToHex(nativeKeyed)).not.toBe(VEC_PRK);
  });
});

describe('deriveSessionKeys', () => {
  it('matches the conformance vectors', () => {
    const desktop = deriveFor('desktop');
    expect(bytesToHex(desktop.send)).toBe(K_D2P);
    expect(bytesToHex(desktop.receive)).toBe(K_P2D);
  });

  it('gives both sides mirrored send/receive keys', () => {
    const phone = deriveFor('phone');
    const desktop = deriveFor('desktop');
    expect(bytesToHex(phone.send)).toBe(bytesToHex(desktop.receive));
    expect(bytesToHex(phone.receive)).toBe(bytesToHex(desktop.send));
  });

  it('never derives the same key for both directions', () => {
    const { send, receive } = deriveFor('desktop');
    expect(bytesToHex(send)).not.toBe(bytesToHex(receive));
  });

  it('binds the key to reqId and to both device ids', () => {
    const base = bytesToHex(deriveFor('desktop').send);
    const otherReq = deriveSessionKeys({
      ourPrivKey: DESK_EPH_PRIV,
      theirPubKeyHex: PHONE_EPH_PUB,
      reqId: 'req-2',
      phoneDeviceId: PHONE_ID,
      desktopDeviceId: DESK_ID,
      role: 'desktop',
    });
    const otherPeer = deriveSessionKeys({
      ourPrivKey: DESK_EPH_PRIV,
      theirPubKeyHex: PHONE_EPH_PUB,
      reqId: REQ_ID,
      phoneDeviceId: 'other-phone',
      desktopDeviceId: DESK_ID,
      role: 'desktop',
    });
    expect(bytesToHex(otherReq.send)).not.toBe(base);
    expect(bytesToHex(otherPeer.send)).not.toBe(base);
  });
});

describe('chunk sealing', () => {
  const key = hexToBytes(K_P2D);
  const aad = chunkAad(REQ_ID, 'p2d', 0, 1);

  it('opens the conformance-vector ciphertext', () => {
    const opened = openChunk(
      key,
      { nonceHex: VEC_NONCE, ciphertextB64: bytesToBase64(hexToBytes(VEC_CT)) },
      aad,
    );
    expect(new TextDecoder().decode(opened)).toBe(VEC_PLAINTEXT);
  });

  it('base64 round-trips a body larger than the fromCharCode stride', () => {
    const big = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256);
    expect(bytesToHex(base64ToBytes(bytesToBase64(big)))).toBe(bytesToHex(big));
  });

  it('round-trips through a random nonce', () => {
    const pt = new TextEncoder().encode(VEC_PLAINTEXT);
    const sealed = sealChunk(key, pt, aad);
    expect(new TextDecoder().decode(openChunk(key, sealed, aad))).toBe(VEC_PLAINTEXT);
  });

  it('uses a fresh nonce per chunk', () => {
    const pt = new TextEncoder().encode(VEC_PLAINTEXT);
    expect(sealChunk(key, pt, aad).nonceHex).not.toBe(sealChunk(key, pt, aad).nonceHex);
  });

  // The security claim behind "no per-chunk signatures needed" (R4): the AAD
  // binds job, direction and position, so a relay cannot reorder, renumber,
  // re-scope or cross-splice chunks without the tag failing.
  it.each([
    ['a different seq', chunkAad(REQ_ID, 'p2d', 1, 1)],
    ['a different count', chunkAad(REQ_ID, 'p2d', 0, 2)],
    ['a reflected direction', chunkAad(REQ_ID, 'd2p', 0, 1)],
    ['a different job', chunkAad('req-2', 'p2d', 0, 1)],
  ])('rejects a chunk replayed with %s', (_label, wrongAad) => {
    const sealed = sealChunk(key, new TextEncoder().encode(VEC_PLAINTEXT), aad);
    expect(() => openChunk(key, sealed, wrongAad)).toThrow();
  });

  it('rejects the wrong direction key', () => {
    const sealed = sealChunk(key, new TextEncoder().encode(VEC_PLAINTEXT), aad);
    expect(() => openChunk(hexToBytes(K_D2P), sealed, aad)).toThrow();
  });

  it('rejects a tampered body', () => {
    const sealed = sealChunk(key, new TextEncoder().encode(VEC_PLAINTEXT), aad);
    const flipped = base64ToBytes(sealed.ciphertextB64);
    flipped[0] ^= 0xff;
    const tampered: SealedChunk = { ...sealed, ciphertextB64: bytesToBase64(flipped) };
    expect(() => openChunk(key, tampered, aad)).toThrow();
  });
});

describe('splitPayload / joinChunks', () => {
  it('round-trips a multi-chunk payload', () => {
    const payload = new Uint8Array(DEFAULT_CHUNK_BYTES * 2 + 17).map((_, i) => i % 251);
    const chunks = splitPayload(payload);
    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toHaveLength(17);
    expect(bytesToHex(joinChunks(chunks))).toBe(bytesToHex(payload));
  });

  it('emits one chunk when the payload fits exactly', () => {
    expect(splitPayload(new Uint8Array(10), 10)).toHaveLength(1);
  });

  it('emits one empty chunk for an empty payload, never zero', () => {
    const chunks = splitPayload(new Uint8Array(0));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(0);
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => splitPayload(new Uint8Array(4), 0)).toThrow();
  });

  it('survives a full seal/split/open/join cycle', () => {
    const keys = deriveFor('phone');
    const payload = new Uint8Array(DEFAULT_CHUNK_BYTES + 5).map((_, i) => i % 256);
    const parts = splitPayload(payload);
    const sealed = parts.map((p, i) => sealChunk(keys.send, p, chunkAad(REQ_ID, 'p2d', i, parts.length)));

    const desktop = deriveFor('desktop');
    const opened = sealed.map((c, i) =>
      openChunk(desktop.receive, c, chunkAad(REQ_ID, 'p2d', i, sealed.length)));
    expect(bytesToHex(joinChunks(opened))).toBe(bytesToHex(payload));
  });
});

describe('wipe', () => {
  it('zeroes every buffer and tolerates undefined', () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(() => wipe(a, undefined)).not.toThrow();
    expect([...a]).toEqual([0, 0, 0]);
  });
});
