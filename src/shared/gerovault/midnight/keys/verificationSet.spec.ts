// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blake2b } from '@noble/hashes/blake2.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { readCbor } from '../../cbor';
import {
  MIDNIGHT_VERIFICATION_DIGEST_TAG,
  MIDNIGHT_VERIFICATION_NUMBER_TAG,
  MidnightVerificationSet,
  compareVerificationQr,
  parseVerificationQr,
  verificationDigest,
  verificationNumber,
  verificationQrPayload,
  verificationSetCbor,
} from './verificationSet';
import { deriveGuardianKeys, deriveOwnerKeys } from './derive';
import { ownerKeyCard, readKeyCard, keyCardToBech32 } from './keyCard';
import { digitGroups } from './digits';
import { concatBytes, fromHex, toHex, utf8Bytes } from './bytes';
import { FieldElement, JubjubPoint } from './types';

const ALICE = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const BOB = mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow');
const alice = deriveOwnerKeys(ALICE, 'preprod', 1);
const bob = deriveOwnerKeys(BOB, 'preprod', 1);
const guardian = deriveGuardianKeys(ALICE, 'preprod', 2);
const TEST_BUILD = 'gvmn-test-45d16eda70751d57';
const PRODUCTION_BUILD = 'gvmn-production-c4585eee75a8b850';

const SET: MidnightVerificationSet = {
  network: 'preprod',
  build: TEST_BUILD,
  buildHash: 'ab'.repeat(32),
  owners: [
    { approvalKey: alice.approval.publicKey, upgradeKey: alice.upgrade.publicKey },
    { approvalKey: bob.approval.publicKey, upgradeKey: bob.upgrade.publicKey },
  ],
  threshold: 2,
  changeDelay: 600,
  whitelistEnabled: true,
  whitelist: [{ recipient: '33'.repeat(32), scope: 'any' }],
  guardians: [guardian.commitment],
  guardianThreshold: 1,
  recoveryDelay: 604800,
  cooldown: 172800,
  expiryWindow: 2592000,
};

const err = expect.objectContaining({ code: 'INVALID_VERIFICATION_SET' });
const number = (s: MidnightVerificationSet) => verificationNumber(s).join(' ');

describe('verificationSet: the set', () => {
  it('is canonical CBOR of the design\'s fields, with no labels and no contract address', () => {
    const item = readCbor(fromHex(verificationSetCbor(SET)) as Uint8Array, { maxDepth: 6, maxItems: 200, booleans: true });
    expect(item.value.type).toBe('map');
    const keys = item.value.type === 'map' ? item.value.value.map(([k]) => (k.value.type === 'text' ? k.value.value : '?')) : [];
    expect([...keys].sort()).toEqual(
      ['build', 'buildHash', 'chain', 'changeDelay', 'cooldown', 'expiryWindow', 'guardianThreshold', 'guardians', 'network', 'owners', 'protocol', 'recoveryDelay', 'threshold', 'whitelist', 'whitelistEnabled'].sort(),
    );
  });

  it('does not depend on the labels of the cards it was built from', () => {
    const fromCard = (label: string) => {
      const read = readKeyCard(keyCardToBech32(ownerKeyCard(alice, { label })), { network: 'preprod', role: 'owner' });
      if (!read.ok || read.card.role !== 'owner') throw new Error('card');
      return { ...SET, owners: [{ approvalKey: read.card.approvalKey, upgradeKey: read.card.upgradeKey }, SET.owners[1]] };
    };
    expect(number(fromCard('Alice'))).toBe(number(SET));
    expect(number(fromCard('Someone else'))).toBe(number(SET));
  });
});

describe('verificationSet: the verification number', () => {
  it('is 8 groups of 5 digits from BLAKE2b-320 over the Midnight tag and the set', () => {
    const groups = verificationNumber(SET);
    expect(groups).toHaveLength(8);
    for (const g of groups) expect(g).toMatch(/^[0-9]{5}$/);
    const d = blake2b(concatBytes(utf8Bytes(MIDNIGHT_VERIFICATION_NUMBER_TAG), fromHex(verificationSetCbor(SET)) as Uint8Array), { dkLen: 40 });
    expect(groups).toEqual(digitGroups(d, 8));
    expect(MIDNIGHT_VERIFICATION_NUMBER_TAG).toBe('gero-vault/v1|midnight-verification-number|');
  });

  it('is pinned for the sample set', () => {
    expect(number(SET)).toBe('55125 28639 31136 02606 83590 47459 57286 51690');
  });

  it('changes when anything in the set changes', () => {
    const base = number(SET);
    const variants: MidnightVerificationSet[] = [
      { ...SET, owners: [SET.owners[1], SET.owners[0]] },
      { ...SET, owners: [SET.owners[0], { ...SET.owners[1], upgradeKey: deriveOwnerKeys(BOB, 'preprod', 2).upgrade.publicKey }] },
      { ...SET, threshold: 1 },
      { ...SET, changeDelay: 601 },
      { ...SET, whitelistEnabled: false },
      { ...SET, whitelist: [] },
      { ...SET, whitelist: [{ recipient: '34'.repeat(32), scope: 'any' }] },
      { ...SET, whitelist: [{ recipient: '33'.repeat(32), scope: 'quorumOnly' }] },
      { ...SET, guardians: [], guardianThreshold: 0 },
      { ...SET, guardians: [deriveGuardianKeys(ALICE, 'preprod', 3).commitment] },
      { ...SET, recoveryDelay: 604801 },
      { ...SET, cooldown: 172801 },
      { ...SET, expiryWindow: 2592001 },
      { ...SET, build: PRODUCTION_BUILD },
      { ...SET, build: 'gvmn-test-45d16eda70751d58' },
      { ...SET, buildHash: 'ac'.repeat(32) },
    ];
    const seen = new Set([base]);
    for (const v of variants) {
      const n = number(v);
      expect(seen.has(n)).toBe(false);
      seen.add(n);
    }
  });
});

describe('verificationSet: the QR', () => {
  it('reads gero-vault/v1|MN-VERIFY|<network>|<build>|<digest>', () => {
    const payload = verificationQrPayload(SET);
    const digest = toHex(blake2b(concatBytes(utf8Bytes(MIDNIGHT_VERIFICATION_DIGEST_TAG), fromHex(verificationSetCbor(SET)) as Uint8Array), { dkLen: 32 }));
    expect(payload).toBe(`gero-vault/v1|MN-VERIFY|preprod|${TEST_BUILD}|${digest}`);
    expect(verificationDigest(SET)).toBe(digest);
    expect(parseVerificationQr(payload)).toEqual({ ok: true, qr: { network: 'preprod', build: TEST_BUILD, verificationDigest: digest } });
  });

  it('matches only the same set', () => {
    expect(compareVerificationQr(verificationQrPayload(SET), SET)).toBe('MATCH');
    expect(compareVerificationQr(verificationQrPayload({ ...SET, threshold: 1 }), SET)).toBe('DIFFERENT_SET');
    expect(compareVerificationQr(verificationQrPayload({ ...SET, build: 'gvmn-test-0000000000000000' }), SET)).toBe('OTHER_BUILD');
  });

  it('refuses a malformed payload', () => {
    const good = verificationQrPayload(SET);
    for (const bad of [undefined, 7, '', good.replace('MN-VERIFY', 'VERIFY'), good.replace('preprod', 'devnet'), good.toUpperCase(), `${good}|x`, good.slice(0, -2), `${good}${'0'.repeat(300)}`]) {
      expect(parseVerificationQr(bad)).toEqual({ ok: false, code: 'MALFORMED_QR' });
      expect(compareVerificationQr(bad, SET)).toBe('MALFORMED_QR');
    }
  });
});

describe('verificationSet: refusals', () => {
  const smallOrder: JubjubPoint = { x: 0n, y: 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000000n };

  it('refuses a test build off preprod, and malformed build ids or hashes', () => {
    expect(() => verificationNumber({ ...SET, network: 'mainnet' })).toThrow(err);
    expect(verificationNumber({ ...SET, network: 'mainnet', build: PRODUCTION_BUILD })).toHaveLength(8);
    for (const build of ['gvmn-dev-45d16eda70751d57', 'gvmn-test-45D16EDA70751D57', 'gvmn-test-45d16eda70751d5', 'x|y']) expect(() => verificationNumber({ ...SET, build })).toThrow(err);
    expect(() => verificationNumber({ ...SET, buildHash: 'ab'.repeat(31) })).toThrow(err);
    expect(() => verificationNumber({ ...SET, network: 'devnet' as never })).toThrow(err);
  });

  it('refuses owner lists that break the rules', () => {
    const o = SET.owners;
    expect(() => verificationNumber({ ...SET, owners: [] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, owners: [o[0], o[1], o[0], o[1], o[0], o[1]] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, owners: [o[0], { ...o[1], approvalKey: o[0].approvalKey }] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, owners: [o[0], { ...o[1], upgradeKey: o[0].upgradeKey }] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, owners: [o[0], { ...o[1], approvalKey: smallOrder }] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, owners: [o[0], { ...o[1], approvalKey: { x: 0n, y: 1n } }] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, owners: [o[0], { ...o[1], upgradeKey: '05'.padStart(64, '0') }] })).toThrow(err);
    for (const threshold of [0, 3, 1.5]) expect(() => verificationNumber({ ...SET, threshold })).toThrow(err);
  });

  it('refuses guardian settings that break the rules', () => {
    const c = (i: number) => deriveGuardianKeys(ALICE, 'preprod', i).commitment;
    expect(() => verificationNumber({ ...SET, guardians: [], guardianThreshold: 1 })).toThrow(err);
    expect(() => verificationNumber({ ...SET, guardianThreshold: 0 })).toThrow(err);
    expect(() => verificationNumber({ ...SET, guardians: [c(2), c(3), c(4), c(5)], guardianThreshold: 2 })).toThrow(err);
    expect(verificationNumber({ ...SET, guardians: [c(2), c(3), c(4), c(5)], guardianThreshold: 3 })).toHaveLength(8);
    expect(() => verificationNumber({ ...SET, guardians: [c(2), c(2)], guardianThreshold: 2 })).toThrow(err);
    expect(() => verificationNumber({ ...SET, guardians: [0n as FieldElement], guardianThreshold: 1 })).toThrow(err);
    expect(() => verificationNumber({ ...SET, guardians: [c(2), c(3), c(4), c(5), c(6), c(7)], guardianThreshold: 4 })).toThrow(err);
  });

  it('refuses whitelists and times that break the rules', () => {
    const entry = (i: number) => ({ recipient: i.toString(16).padStart(2, '0').repeat(32), scope: 'any' as const });
    expect(() => verificationNumber({ ...SET, whitelist: Array.from({ length: 9 }, (_, i) => entry(i)) })).toThrow(err);
    expect(verificationNumber({ ...SET, whitelist: Array.from({ length: 8 }, (_, i) => entry(i)) })).toHaveLength(8);
    expect(() => verificationNumber({ ...SET, whitelist: [entry(1), entry(1)] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, whitelist: [{ recipient: '33'.repeat(32), scope: 'some' as never }] })).toThrow(err);
    expect(() => verificationNumber({ ...SET, whitelistEnabled: 1 as never })).toThrow(err);
    for (const k of ['changeDelay', 'recoveryDelay', 'cooldown', 'expiryWindow'] as const) {
      expect(() => verificationNumber({ ...SET, [k]: -1 })).toThrow(err);
      expect(() => verificationNumber({ ...SET, [k]: 1.5 })).toThrow(err);
    }
  });
});
