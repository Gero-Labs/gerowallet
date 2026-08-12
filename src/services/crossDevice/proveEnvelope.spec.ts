import { describe, it, expect } from 'vitest';
import {
  buildProveSubject,
  provePayloadDigest,
  signProveMessage,
  verifyProveMessage,
  type UnsignedProveMessage,
} from './proveEnvelope';
import { generateDeviceKeypair } from './deviceIdentity';
import {
  parseProveMessage,
  isProveChunk,
  isProveInit,
  MAX_PROVE_PAYLOAD_BYTES,
  PROVE_MESSAGE_TYPES,
  type ProveAccept,
  type ProveInit,
  type ProveReject,
} from './proveProtocol';

const kp = generateDeviceKeypair((n) => new Uint8Array(n).fill(3));
const otherKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(4));

const PHONE = 'phone-dev';
const DESK = 'desk-dev';
const EPH = '7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13';

// CONFORMANCE VECTOR — blake2b-256 of the ASCII bytes "unproven-tx-bytes".
const PAYLOAD = new TextEncoder().encode('unproven-tx-bytes');
const PAYLOAD_DIGEST = provePayloadDigest(PAYLOAD);

const init: Omit<ProveInit, 'sig'> = {
  type: 'PROVE_INIT',
  reqId: 'req-1',
  nonce: 'n1',
  from: PHONE,
  to: DESK,
  stakeAddress: 'stake1xyz',
  ephPub: EPH,
  ledgerVersion: '8.1.0',
  byteLen: 17,
  chunkCount: 1,
  expiresAt: 1000,
  payloadDigest: PAYLOAD_DIGEST,
};

const accept: Omit<ProveAccept, 'sig'> = {
  type: 'PROVE_ACCEPT',
  reqId: 'req-1',
  nonce: 'n2',
  from: DESK,
  to: PHONE,
  ephPub: '0faa684ed28867b97f4a6a2dee5df8ce974e76b7018e3f22a1c4cf2678570f20',
  ledgerVersion: '8.1.0',
};

// blake2b-256 of the ASCII bytes "unproven-tx-bytes".
const VEC_PAYLOAD_DIGEST = 'cf0993512d6d06ec100df25e954a9b5476debbd768274330b4bc4b28b9752ef5';

describe('provePayloadDigest', () => {
  it('matches the blake2b-256 vector for the plaintext payload', () => {
    expect(PAYLOAD_DIGEST).toBe(VEC_PAYLOAD_DIGEST);
  });

  it('digests the PLAINTEXT, so a ciphertext of the same length differs', () => {
    const ciphertextish = new Uint8Array(PAYLOAD.length).fill(0x5a);
    expect(provePayloadDigest(ciphertextish)).not.toBe(VEC_PAYLOAD_DIGEST);
  });
});

describe('buildProveSubject (cross-client conformance vectors)', () => {
  it('PROVE_INIT is the exact pipe-joined string', () => {
    expect(buildProveSubject(init)).toBe(
      `gero-xprove/v1|PROVE_INIT|req-1|n1|${PHONE}|${DESK}|stake1xyz|${EPH}|8.1.0|17|1|1000|${PAYLOAD_DIGEST}`,
    );
  });

  it('PROVE_INIT leaves an EMPTY SLOT for an absent stakeAddress', () => {
    const { stakeAddress: _omitted, ...rest } = init;
    expect(buildProveSubject(rest)).toContain(`|${DESK}||${EPH}|`);
  });

  it('PROVE_ACCEPT is the exact pipe-joined string', () => {
    expect(buildProveSubject(accept)).toBe(
      `gero-xprove/v1|PROVE_ACCEPT|req-1|n2|${DESK}|${PHONE}|${accept.ephPub}|8.1.0`,
    );
  });

  it('PROVE_REJECT signs the reason', () => {
    const reject: Omit<ProveReject, 'sig'> = {
      type: 'PROVE_REJECT', reqId: 'req-1', nonce: 'n3', from: DESK, to: PHONE, reason: 'busy',
    };
    expect(buildProveSubject(reject)).toBe(
      `gero-xprove/v1|PROVE_REJECT|req-1|n3|${DESK}|${PHONE}|busy`,
    );
  });

  it('PROVE_RESULT is the exact pipe-joined string', () => {
    expect(buildProveSubject({
      type: 'PROVE_RESULT', reqId: 'req-1', nonce: 'n4', from: DESK, to: PHONE,
      byteLen: 42, chunkCount: 2, provenDigest: PAYLOAD_DIGEST,
    })).toBe(`gero-xprove/v1|PROVE_RESULT|req-1|n4|${DESK}|${PHONE}|42|2|${PAYLOAD_DIGEST}`);
  });

  it('PROVE_STATUS and PROVE_CANCEL are the exact pipe-joined strings', () => {
    expect(buildProveSubject({
      type: 'PROVE_STATUS', reqId: 'req-1', nonce: 'n5', from: DESK, to: PHONE, state: 'proving',
    })).toBe(`gero-xprove/v1|PROVE_STATUS|req-1|n5|${DESK}|${PHONE}|proving`);
    expect(buildProveSubject({
      type: 'PROVE_CANCEL', reqId: 'req-1', nonce: 'n6', from: PHONE, to: DESK,
    })).toBe(`gero-xprove/v1|PROVE_CANCEL|req-1|n6|${PHONE}|${DESK}`);
  });

  // The departure from gero-xdev/v1 that most needs a regression test: if `to`
  // ever drops out of the subject, a relay can silently redirect jobs (and the
  // ephemeral key exchange with them) to a different pinned desktop.
  it('binds `to` in every subject', () => {
    const subjects: UnsignedProveMessage[] = [
      init,
      accept,
      { type: 'PROVE_REJECT', reqId: 'r', nonce: 'n', from: DESK, to: PHONE, reason: 'busy' },
      { type: 'PROVE_STATUS', reqId: 'r', nonce: 'n', from: DESK, to: PHONE, state: 'queued' },
      { type: 'PROVE_RESULT', reqId: 'r', nonce: 'n', from: DESK, to: PHONE, byteLen: 1, chunkCount: 1, provenDigest: PAYLOAD_DIGEST },
      { type: 'PROVE_CANCEL', reqId: 'r', nonce: 'n', from: PHONE, to: DESK },
    ];
    for (const msg of subjects) {
      expect(buildProveSubject(msg).split('|')).toContain(msg.to);
    }
  });
});

describe('signProveMessage / verifyProveMessage', () => {
  it('round-trips a PROVE_INIT', async () => {
    const signed = await signProveMessage<ProveInit>(init, kp.privKeyHex);
    expect(await verifyProveMessage(signed, kp.pubKeyHex)).toBe(true);
  });

  it('rejects a signature from a different key', async () => {
    const signed = await signProveMessage<ProveInit>(init, kp.privKeyHex);
    expect(await verifyProveMessage(signed, otherKp.pubKeyHex)).toBe(false);
  });

  it('rejects a malformed signature without throwing', async () => {
    expect(await verifyProveMessage({ ...init, sig: 'not-hex' }, kp.pubKeyHex)).toBe(false);
  });

  // Each of these is a distinct attack the signature must stop.
  it.each([
    ['redirection to another desktop', { to: 'other-desk' }],
    ['a swapped ephemeral key', { ephPub: '00'.repeat(32) }],
    ['a downgraded ledger version', { ledgerVersion: '7.0.0' }],
    ['a swapped payload digest', { payloadDigest: 'ff'.repeat(32) }],
    ['an inflated chunk count', { chunkCount: 99 }],
    ['an extended expiry', { expiresAt: 999999 }],
  ])('rejects %s', async (_label, tamper) => {
    const signed = await signProveMessage<ProveInit>(init, kp.privKeyHex);
    expect(await verifyProveMessage({ ...signed, ...tamper }, kp.pubKeyHex)).toBe(false);
  });

  it('rejects a tampered reject reason (the downgrade vector)', async () => {
    const reject = await signProveMessage<ProveReject>({
      type: 'PROVE_REJECT', reqId: 'req-1', nonce: 'n3', from: DESK, to: PHONE,
      reason: 'prover_unhealthy',
    }, kp.privKeyHex);
    expect(await verifyProveMessage(reject, kp.pubKeyHex)).toBe(true);
    expect(await verifyProveMessage({ ...reject, reason: 'busy' }, kp.pubKeyHex)).toBe(false);
  });
});

describe('parseProveMessage', () => {
  it('accepts each well-formed frame', async () => {
    const signed = await signProveMessage<ProveInit>(init, kp.privKeyHex);
    expect(parseProveMessage(signed)?.type).toBe('PROVE_INIT');
    expect(parseProveMessage({
      type: 'PROVE_CHUNK', reqId: 'r', to: DESK, seq: 0, count: 1,
      nonceHex: 'aa'.repeat(24), ciphertextB64: 'AAAA',
    })?.type).toBe('PROVE_CHUNK');
  });

  it.each([
    ['a non-object', 'nope'],
    ['an unknown type', { type: 'PROVE_WHAT', reqId: 'r', nonce: 'n', from: 'a', to: 'b', sig: 's' }],
    ['a missing sig', { ...init }],
    ['a missing `to`', { ...init, to: undefined, sig: 'ab' }],
    ['an unknown reject reason', { type: 'PROVE_REJECT', reqId: 'r', nonce: 'n', from: 'a', to: 'b', reason: 'vibes', sig: 's' }],
    ['an unknown status state', { type: 'PROVE_STATUS', reqId: 'r', nonce: 'n', from: 'a', to: 'b', state: 'thinking', sig: 's' }],
    ['a fractional chunk seq', { type: 'PROVE_CHUNK', reqId: 'r', to: 'b', seq: 1.5, count: 2, nonceHex: 'aa', ciphertextB64: 'AA' }],
    ['a negative chunk count', { type: 'PROVE_CHUNK', reqId: 'r', to: 'b', seq: 0, count: -1, nonceHex: 'aa', ciphertextB64: 'AA' }],
    ['a stringified byteLen', { ...init, byteLen: '17', sig: 'ab' }],
    // Hex-typed fields feed straight into crypto that throws on bad input, so
    // they are validated at the parse boundary rather than at the call site.
    ['a non-hex ephPub', { ...init, ephPub: 'z'.repeat(64), sig: 'ab' }],
    ['an odd-length ephPub', { ...init, ephPub: 'ab'.repeat(31) + 'a', sig: 'ab' }],
    ['a short ephPub', { ...init, ephPub: 'ab'.repeat(16), sig: 'ab' }],
    ['an over-long ephPub', { ...init, ephPub: 'ab'.repeat(33), sig: 'ab' }],
    ['a non-hex payloadDigest', { ...init, payloadDigest: 'x'.repeat(64), sig: 'ab' }],
    ['a short payloadDigest', { ...init, payloadDigest: 'ab', sig: 'ab' }],
    ['a chunk nonce of the wrong length', {
      type: 'PROVE_CHUNK', reqId: 'r', to: 'b', seq: 0, count: 1,
      nonceHex: 'aa'.repeat(12), ciphertextB64: 'AA',
    }],
  ])('rejects %s', (_label, raw) => {
    expect(parseProveMessage(raw)).toBeNull();
  });

  it('accepts uppercase hex (contract says lowercase; refusing it would be an interop trap)', () => {
    const upper = { ...init, ephPub: EPH.toUpperCase(), sig: 'ab' };
    expect(isProveInit(upper)).toBe(true);
  });

  it('does not confuse a chunk with a signed frame', () => {
    const chunk = {
      type: 'PROVE_CHUNK', reqId: 'r', to: DESK, seq: 0, count: 1,
      nonceHex: 'aa'.repeat(24), ciphertextB64: 'AAAA',
    };
    expect(isProveChunk(chunk)).toBe(true);
    expect(isProveInit(chunk)).toBe(false);
  });
});

describe('contract constants', () => {
  it('lists every frame type for the relay allow-list', () => {
    expect([...PROVE_MESSAGE_TYPES].sort()).toEqual([
      'PROVE_ACCEPT', 'PROVE_CANCEL', 'PROVE_CHUNK', 'PROVE_INIT',
      'PROVE_REJECT', 'PROVE_RESULT', 'PROVE_STATUS',
    ]);
  });

  // The payload cap's exact value is asserted in xproveVectors.spec.ts against
  // the frozen contract file, so it lives in one place. Here we only assert the
  // property this module depends on: it is a positive byte bound.
  it('exposes a positive payload cap', () => {
    expect(MAX_PROVE_PAYLOAD_BYTES).toBeGreaterThan(0);
  });
});
