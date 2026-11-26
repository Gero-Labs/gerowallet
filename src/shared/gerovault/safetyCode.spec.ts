import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { entropyToMnemonic, wordlists } from 'bip39';
import { VaultManifest, encodeManifest, manifestHash, newManifest, nextManifestRevision } from './manifest';
import {
  CosignerVerification,
  SAFETY_CODE_TAG,
  codeVerification,
  compareSafetyQr,
  cosignerVerificationStatus,
  fundingVerified,
  parseSafetyQr,
  providerResolution,
  qrVerification,
  safetyCodeDigest,
  safetyCodeWords,
  safetyCodeWordsFromDigest,
  safetyQrPayload,
} from './safetyCode';
import { VaultPublicKeys, VaultScripts } from './types';
import { boundDevice, vectorFixture } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07). The
 * manifest is `vectorFixture()`, the one the manifest spec pins.
 */
const VECTOR = {
  digest: 'b68f77a51cf776aca8769704fa08473d26ceee889ecf9d4b0f6cee54e52beafb',
  words: ['repair', 'knife', 'true', 'delay', 'jazz', 'film', 'peace', 'spray', 'agent', 'space', 'balcony', 'kid'],
};

const T = 1795651300;

let keys: VaultPublicKeys[];
let cred: Ed25519KeyHashHex[];
let vault: VaultScripts;
let id: string;
let manifest: VaultManifest;

beforeAll(async () => {
  ({ keys, credentials: cred, vault, id, manifest } = await vectorFixture());
});

describe('the 12-word safety code', () => {
  it('matches the provisional vector', () => {
    expect(safetyCodeDigest(manifest)).toBe(VECTOR.digest);
    expect(safetyCodeWords(manifest)).toEqual(VECTOR.words);
  });

  it('is blake2b-256 of tag || manifest CBOR, read as 132 bits of BIP-39 English (checked independently)', () => {
    const preimage = Buffer.from(SAFETY_CODE_TAG, 'utf8').toString('hex') + encodeManifest(manifest);
    const digest = sdkBlake2b.hash(HexBlob(preimage), 32);
    expect(safetyCodeDigest(manifest)).toBe(digest);
    // BIP-39 turns 160 bits of entropy into 15 words; its first 12 words are bits 0 to 131.
    const fromBip39 = entropyToMnemonic(digest.slice(0, 40)).split(' ').slice(0, 12);
    expect(safetyCodeWords(manifest)).toEqual(fromBip39);
    expect(safetyCodeDigest(manifest)).not.toBe(manifestHash(manifest));
  });

  it('uses the BIP-39 English wordlist', () => {
    const english = wordlists['english'];
    expect(createHash('sha256').update(`${english.join('\n')}\n`).digest('hex')).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });

  it('takes exactly bits 0 to 131 of the digest, most significant first, with no checksum', () => {
    expect(safetyCodeWordsFromDigest('00'.repeat(32))).toEqual(Array(12).fill('abandon'));
    expect(safetyCodeWordsFromDigest('ff'.repeat(32))).toEqual(Array(12).fill('zoo'));
    const withBit = (bit: number) => {
      const bytes = new Uint8Array(32);
      bytes[bit >> 3] |= 0x80 >> (bit & 7);
      return Buffer.from(bytes).toString('hex');
    };
    expect(safetyCodeWordsFromDigest(withBit(0))[0]).toBe(wordlists['english'][1024]);
    expect(safetyCodeWordsFromDigest(withBit(131))).toEqual([...Array(11).fill('abandon'), 'ability']);
    expect(safetyCodeWordsFromDigest(withBit(132))).toEqual(Array(12).fill('abandon'));
    expect(() => safetyCodeWordsFromDigest('00')).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
    expect(() => safetyCodeWordsFromDigest('FF'.repeat(32))).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
  });

  it('changes with any change to the manifest', async () => {
    const relabelled = newManifest({
      vault,
      network: 'preprod',
      owners: [
        { vaultKeys: keys[0], devices: [await boundDevice(id, 'owner', cred[0], 1, 'Laptop.')] },
        { vaultKeys: keys[1], devices: [await boundDevice(id, 'owner', cred[1], 2, 'Phone')] },
        { vaultKeys: keys[2] },
      ],
      viewers: [{ devices: [await boundDevice(id, 'viewer', undefined, 9, 'Accountant')] }],
      createdAt: manifest.createdAt,
    });
    expect(safetyCodeWords(relabelled)).not.toEqual(safetyCodeWords(manifest));
    expect(safetyCodeWords({ ...manifest, createdAt: manifest.createdAt + 1 })).not.toEqual(safetyCodeWords(manifest));
    expect(() => safetyCodeWords({ ...manifest, threshold: 9 })).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});

describe('the in-person QR', () => {
  it('carries the full manifest hash', () => {
    const payload = safetyQrPayload(manifest);
    expect(payload).toBe(`gero-vault/v1|VERIFY|cardano-preprod|${id}|1|${manifestHash(manifest)}`);
    expect(parseSafetyQr(payload)).toEqual({ ok: true, qr: { network: 'preprod', vaultId: id, version: 1, manifestHash: manifestHash(manifest) } });
    expect(compareSafetyQr(payload, manifest)).toBe('MATCH');
  });

  it('tells another vault, another revision and other contents apart, none of which verifies', () => {
    const v2 = nextManifestRevision(manifest, { roles: { viewers: [] }, createdAt: T });
    expect(compareSafetyQr(safetyQrPayload(v2), manifest)).toBe('OTHER_REVISION');
    const other = newManifest({ vault, network: 'preprod', owners: keys.map(vaultKeys => ({ vaultKeys })), createdAt: T });
    expect(compareSafetyQr(safetyQrPayload(other), manifest)).toBe('DIFFERENT_MANIFEST');
    const preview = newManifest({ vault, network: 'preview', owners: keys.map(vaultKeys => ({ vaultKeys })), createdAt: T });
    expect(compareSafetyQr(safetyQrPayload(preview), manifest)).toBe('OTHER_VAULT');
  });

  it('refuses a malformed payload', () => {
    const good = safetyQrPayload(manifest);
    const parts = good.split('|');
    const variants = [
      good.toUpperCase(),
      `${good}|`,
      parts.slice(0, 5).join('|'),
      [...parts.slice(0, 4), '01', parts[5]].join('|'),
      [...parts.slice(0, 4), '0', parts[5]].join('|'),
      [...parts.slice(0, 4), '99999999999', parts[5]].join('|'),
      [parts[0], 'VAULT_ACK', ...parts.slice(2)].join('|'),
      [parts[0], parts[1], 'preprod', ...parts.slice(3)].join('|'),
      [...parts.slice(0, 5), parts[5].slice(2)].join('|'),
      'x'.repeat(300),
      '',
      42,
      undefined,
    ];
    for (const v of variants) {
      expect(parseSafetyQr(v)).toEqual({ ok: false, code: 'MALFORMED_QR' });
      expect(compareSafetyQr(v, manifest)).toBe('MALFORMED_QR');
    }
  });
});

describe('cosigner verification and the funding gate', () => {
  it('opens funding only when every other cosigner is verified by the words or the QR', () => {
    const self = cred[0];
    expect(fundingVerified(manifest, [], self)).toBe(false);
    const one = codeVerification(manifest, cred[1], T);
    expect(fundingVerified(manifest, [one], self)).toBe(false);
    const qr = qrVerification(manifest, cred[2], safetyQrPayload(manifest), T);
    expect(qr).toMatchObject({ method: 'qr', credential: cred[2], manifestHash: manifestHash(manifest) });
    expect(fundingVerified(manifest, [one, qr], self)).toBe(true);
    expect(cosignerVerificationStatus(manifest, [one, qr], self)).toEqual([
      { credential: cred[1], role: 'owner', state: 'verified', method: 'code', providers: [] },
      { credential: cred[2], role: 'owner', state: 'verified', method: 'qr', providers: [] },
    ].sort((a, b) => (a.credential < b.credential ? -1 : 1)));
    // A viewer's device, with no key of its own, needs every cosigner.
    expect(fundingVerified(manifest, [one, qr])).toBe(false);
    expect(fundingVerified(manifest, [codeVerification(manifest, cred[0], T), one, qr])).toBe(true);
  });

  it('never counts a check resolved by a provider', () => {
    const records: CosignerVerification[] = [
      providerResolution(cred[1], 'adaHandle', T),
      providerResolution(cred[1], 'knownAddress', T),
      providerResolution(cred[2], 'sharedVault', T),
    ];
    expect(fundingVerified(manifest, records, cred[0])).toBe(false);
    const status = cosignerVerificationStatus(manifest, records, cred[0]);
    expect(status.map(s => s.state)).toEqual(['providerOnly', 'providerOnly']);
    expect(status.find(s => s.credential === cred[1]).providers).toEqual(['adaHandle', 'knownAddress']);
    const verified = [...records, codeVerification(manifest, cred[1], T), codeVerification(manifest, cred[2], T)];
    expect(fundingVerified(manifest, verified, cred[0])).toBe(true);
    expect(cosignerVerificationStatus(manifest, verified, cred[0]).find(s => s.credential === cred[1]))
      .toEqual({ credential: cred[1], role: 'owner', state: 'verified', method: 'code', providers: ['adaHandle', 'knownAddress'] });
  });

  it('records a QR only from a scan that matches', () => {
    const v2 = nextManifestRevision(manifest, { roles: { viewers: [] }, createdAt: T });
    expect(qrVerification(manifest, cred[1], safetyQrPayload(v2), T)).toBeUndefined();
    expect(qrVerification(manifest, cred[1], 'not a payload', T)).toBeUndefined();
  });

  it('asks again after a new revision: a ceremony is bound to the manifest it compared', () => {
    const records = [codeVerification(manifest, cred[1], T), codeVerification(manifest, cred[2], T)];
    expect(fundingVerified(manifest, records, cred[0])).toBe(true);
    const v2 = nextManifestRevision(manifest, { roles: { viewers: [] }, createdAt: T });
    expect(fundingVerified(v2, records, cred[0])).toBe(false);
    expect(cosignerVerificationStatus(v2, records, cred[0]).map(s => s.state)).toEqual(['stale', 'stale']);
  });

  it('needs an external cosigner verified too', () => {
    const withExternal = newManifest({
      vault,
      network: 'preprod',
      owners: keys.slice(0, 2).map(vaultKeys => ({ vaultKeys })),
      external: [{ credential: cred[2], label: 'Other wallet' }],
      createdAt: T,
    });
    const status = cosignerVerificationStatus(withExternal, [codeVerification(withExternal, cred[1], T)], cred[0]);
    expect(status).toEqual(expect.arrayContaining([expect.objectContaining({ credential: cred[2], role: 'external', state: 'unverified' })]));
    expect(fundingVerified(withExternal, [codeVerification(withExternal, cred[1], T)], cred[0])).toBe(false);
  });

  it('has no value threshold and never throws', () => {
    // The gate takes the manifest, the records and the device's own credential: no amount.
    expect(fundingVerified.length).toBe(3);
    const records = [codeVerification(manifest, cred[1], T), codeVerification(manifest, cred[2], T)];
    expect(fundingVerified({ ...manifest, threshold: 0 }, records, cred[0])).toBe(false);
    expect(fundingVerified(undefined, records, cred[0])).toBe(false);
    expect(fundingVerified(manifest, undefined, cred[0])).toBe(false);
    const malformed = [
      { ...records[0], credential: records[0].credential.toUpperCase() },
      { ...records[1], manifestHash: undefined },
      { ...records[1], method: 'handshake' },
      null,
    ] as unknown as CosignerVerification[];
    expect(fundingVerified(manifest, malformed, cred[0])).toBe(false);
  });

  it('builds only well-formed records', () => {
    expect(() => codeVerification(manifest, 'ab' as Ed25519KeyHashHex, T)).toThrow(expect.objectContaining({ code: 'INVALID_KEY_HASH' }));
    expect(() => codeVerification(manifest, cred[1], -1)).toThrow(expect.objectContaining({ code: 'INVALID_TIME' }));
    expect(() => providerResolution(cred[1], 'email' as 'adaHandle', T)).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
    expect(() => codeVerification({ ...manifest, version: 0 }, cred[1], T)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});
