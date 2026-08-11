// The frozen cross-client contract, asserted against the implementation.
//
// `xprove-vectors.json` is the artifact gero-ios mirrors byte-for-byte. This
// spec is what stops it from becoming a stale document: every value in the file
// is recomputed from the real code here, so changing either side without the
// other fails the suite.
//
// If something here fails, the wire contract moved. That is a coordinated change
// with iOS and a version bump — not a file to hand-edit green.

import { describe, it, expect } from 'vitest';
import { x25519 } from '@noble/curves/ed25519';
import { blake2b } from '@noble/hashes/blake2.js';
import vectors from './xprove-vectors.json';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  chunkAad,
  deriveSessionKeys,
  hexToBytes,
  openChunk,
  sessionInfo,
  sessionPrk,
  DEFAULT_CHUNK_BYTES,
} from './proveSession';
import { buildProveSubject, provePayloadDigest, verifyProveMessage } from './proveEnvelope';
import { generateDeviceKeypair } from './deviceIdentity';
import { MAX_PROVE_PAYLOAD_BYTES, type ProveAccept, type ProveInit } from './proveProtocol';

const s = vectors.session;
const phonePriv = hexToBytes(s.phoneEphemeralPrivHex);
const deskPriv = hexToBytes(s.desktopEphemeralPrivHex);

describe('frozen vectors: X25519', () => {
  it('derives the pinned public keys', () => {
    expect(bytesToHex(x25519.getPublicKey(phonePriv))).toBe(s.phoneEphemeralPubHex);
    expect(bytesToHex(x25519.getPublicKey(deskPriv))).toBe(s.desktopEphemeralPubHex);
  });

  it('agrees on the pinned shared secret from both sides', () => {
    expect(bytesToHex(x25519.getSharedSecret(deskPriv, hexToBytes(s.phoneEphemeralPubHex))))
      .toBe(s.ecdhSharedHex);
    expect(bytesToHex(x25519.getSharedSecret(phonePriv, hexToBytes(s.desktopEphemeralPubHex))))
      .toBe(s.ecdhSharedHex);
  });
});

describe('frozen vectors: KDF', () => {
  const shared = hexToBytes(s.ecdhSharedHex);

  it('declares the construction it actually implements', () => {
    expect(vectors.kdf.construction).toBe('RFC5869-HKDF-HMAC-BLAKE2b-512');
    expect(vectors.kdf.hashLen).toBe(blake2b.outputLen);
    expect(vectors.kdf.blockLen).toBe(blake2b.blockLen);
  });

  it('produces the pinned PRK', () => {
    expect(bytesToHex(sessionPrk(shared))).toBe(s.prkHex);
  });

  // The negative control is the whole point of shipping a PRK vector: it tells a
  // porting team not just what right looks like, but what THEIR most likely
  // wrong answer looks like.
  it('does NOT produce the native-keyed value (the iOS-first-attempt bug)', () => {
    const nativeKeyed = blake2b.create({ key: new Uint8Array(64) }).update(shared).digest();
    expect(bytesToHex(nativeKeyed)).toBe(s.negativeControl.nativeKeyedPrkHex);
    expect(bytesToHex(nativeKeyed)).not.toBe(s.prkHex);
  });

  it('builds the pinned info strings', () => {
    expect(sessionInfo(s.reqId, s.phoneDeviceId, s.desktopDeviceId, 'p2d')).toBe(s.infoP2d);
    expect(sessionInfo(s.reqId, s.phoneDeviceId, s.desktopDeviceId, 'd2p')).toBe(s.infoD2p);
  });

  it('expands to the pinned directional keys, mirrored across roles', () => {
    const desktop = deriveSessionKeys({
      ourPrivKey: deskPriv, theirPubKeyHex: s.phoneEphemeralPubHex, reqId: s.reqId,
      phoneDeviceId: s.phoneDeviceId, desktopDeviceId: s.desktopDeviceId, role: 'desktop',
    });
    const phone = deriveSessionKeys({
      ourPrivKey: phonePriv, theirPubKeyHex: s.desktopEphemeralPubHex, reqId: s.reqId,
      phoneDeviceId: s.phoneDeviceId, desktopDeviceId: s.desktopDeviceId, role: 'phone',
    });
    expect(bytesToHex(desktop.receive)).toBe(s.keyP2dHex);
    expect(bytesToHex(desktop.send)).toBe(s.keyD2pHex);
    expect(bytesToHex(phone.send)).toBe(s.keyP2dHex);
    expect(bytesToHex(phone.receive)).toBe(s.keyD2pHex);
  });
});

describe('frozen vectors: AEAD chunk', () => {
  const c = vectors.chunk;

  it('builds the pinned AAD', () => {
    expect(new TextDecoder().decode(chunkAad(s.reqId, 'p2d', 0, 1))).toBe(c.aad);
  });

  it('hex and base64 encodings of the ciphertext agree', () => {
    expect(bytesToBase64(hexToBytes(c.ciphertextHex))).toBe(c.ciphertextB64);
    expect(bytesToHex(base64ToBytes(c.ciphertextB64))).toBe(c.ciphertextHex);
  });

  it('decrypts the pinned ciphertext to the pinned plaintext', () => {
    const opened = openChunk(
      hexToBytes(s.keyP2dHex),
      { nonceHex: c.nonceHex, ciphertextB64: c.ciphertextB64 },
      chunkAad(s.reqId, 'p2d', 0, 1),
    );
    expect(new TextDecoder().decode(opened)).toBe(c.plaintextUtf8);
  });
});

describe('frozen vectors: payload digest', () => {
  it('digests the pinned plaintext to the pinned value', () => {
    const payload = new TextEncoder().encode(vectors.payloadDigest.plaintextUtf8);
    expect(provePayloadDigest(payload)).toBe(vectors.payloadDigest.digestHex);
  });
});

describe('frozen vectors: signed subjects', () => {
  const sub = vectors.subjects;
  const phoneKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(9));
  const deskKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(8));

  const init: Omit<ProveInit, 'sig'> = {
    type: 'PROVE_INIT', reqId: s.reqId, nonce: 'n1', from: s.phoneDeviceId, to: s.desktopDeviceId,
    stakeAddress: 'stake1xyz', ephPub: s.phoneEphemeralPubHex, ledgerVersion: '8.1.0',
    byteLen: 17, chunkCount: 1, expiresAt: 1000,
    payloadDigest: vectors.payloadDigest.digestHex,
  };
  const accept: Omit<ProveAccept, 'sig'> = {
    type: 'PROVE_ACCEPT', reqId: s.reqId, nonce: 'n2', from: s.desktopDeviceId, to: s.phoneDeviceId,
    ephPub: s.desktopEphemeralPubHex, ledgerVersion: '8.1.0',
  };

  it('derives the pinned signing public keys', () => {
    expect(phoneKp.pubKeyHex).toBe(sub.phoneSignPubHex);
    expect(deskKp.pubKeyHex).toBe(sub.desktopSignPubHex);
  });

  it('builds the pinned PROVE_INIT subject and verifies its pinned signature', async () => {
    expect(buildProveSubject(init)).toBe(sub.proveInit.subject);
    expect(await verifyProveMessage({ ...init, sig: sub.proveInit.sigHex }, phoneKp.pubKeyHex))
      .toBe(true);
  });

  it('builds the pinned PROVE_ACCEPT subject and verifies its pinned signature', async () => {
    expect(buildProveSubject(accept)).toBe(sub.proveAccept.subject);
    expect(await verifyProveMessage({ ...accept, sig: sub.proveAccept.sigHex }, deskKp.pubKeyHex))
      .toBe(true);
  });

  it('rejects the pinned signature against the other device key', async () => {
    expect(await verifyProveMessage({ ...init, sig: sub.proveInit.sigHex }, deskKp.pubKeyHex))
      .toBe(false);
  });
});

describe('frozen vectors: limits', () => {
  it('matches the constants the service enforces', () => {
    expect(vectors.limits.maxProvePayloadBytes).toBe(MAX_PROVE_PAYLOAD_BYTES);
    expect(vectors.limits.defaultChunkBytes).toBe(DEFAULT_CHUNK_BYTES);
  });

  it('leaves headroom over the largest measured proven payload (60 KB)', () => {
    expect(MAX_PROVE_PAYLOAD_BYTES).toBeGreaterThan(60 * 1024 * 4);
  });

  it('carries a measured unshielded payload in a single chunk', () => {
    expect(DEFAULT_CHUNK_BYTES).toBeGreaterThan(60 * 1024);
  });
});
