// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bech32m } from 'bech32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { encodeCanonicalCbor } from '../../canonicalCbor';
import {
  KEY_CARD_FILE_EXTENSION,
  KEY_CARD_FILE_TYPE,
  KEY_CARD_MAX_JSON_BYTES,
  MidnightKeyCard,
  OwnerKeyCard,
  delegateKeyCard,
  guardianCardCommitment,
  guardianKeyCard,
  keyCardDigest,
  keyCardHrp,
  keyCardToBech32,
  keyCardToJson,
  ownerKeyCard,
  readKeyCard,
} from './keyCard';
import { deriveDelegateKeys, deriveGuardianKeys, deriveOwnerKeys } from './derive';
import { jubjubSign } from './schnorr';
import { jubjubMulGenerator, jubjubPointHex } from './jubjub';
import { concatBytes, fromHex, le2ip, le32, toHex } from './bytes';
import { FIELD_MODULUS, FieldElement, JUBJUB_SCALAR_MODULUS, JubjubPoint } from './types';

// Two public BIP-39 test phrases: Alice and Bob.
const ALICE = mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
const BOB = mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow');
const R = (b: number) => new Uint8Array(32).fill(b);
const OPTS = { rand32: R(1), aux32: R(2) };

const aliceOwner = deriveOwnerKeys(ALICE, 'preprod', 1);
const bobOwner = deriveOwnerKeys(BOB, 'preprod', 1);
const aliceGuardian = deriveGuardianKeys(ALICE, 'preprod', 2);
const bobGuardian = deriveGuardianKeys(BOB, 'preprod', 2);
const aliceDelegate = deriveDelegateKeys(ALICE, 'preprod', 3);

const ownerCard = ownerKeyCard(aliceOwner, { ...OPTS, label: 'Alice' });
const guardianCard = guardianKeyCard(aliceGuardian, OPTS);
const delegateCard = delegateKeyCard(aliceDelegate, OPTS);
const PREPROD = { network: 'preprod' } as const;

const json = (card: MidnightKeyCard) => JSON.parse(keyCardToJson(card)) as Record<string, unknown> & { signatures: Record<string, unknown> };
const text = (o: unknown) => JSON.stringify(o);
const refusal = (input: unknown, expect = PREPROD as { network: 'preprod' | 'mainnet' | 'preview'; role?: 'owner' | 'guardian' | 'delegate' }) => {
  const r = readKeyCard(input, expect);
  return r.ok ? 'ACCEPTED' : r;
};
const digestField = (card: MidnightKeyCard) => (le2ip(fromHex(keyCardDigest(card)) as Uint8Array) % FIELD_MODULUS) as FieldElement;

/** Torsion points of order 2 and 4: on the curve, never a valid key. */
const ORDER_2: JubjubPoint = { x: 0n, y: FIELD_MODULUS - 1n };
const ORDER_4: JubjubPoint = (() => {
  // With y = 0 the curve equation reads a x^2 = 1, so x^2 = 1/a = -1: the order-4 points are (+-sqrt(-1), 0).
  const p = FIELD_MODULUS;
  const pow = (b: bigint, e: bigint): bigint => {
    let r = 1n;
    let x = b % p;
    let k = e;
    while (k > 0n) {
      if (k & 1n) r = (r * x) % p;
      x = (x * x) % p;
      k >>= 1n;
    }
    return r;
  };
  // p = 1 mod 4: a square root of -1 is g^((p-1)/4) for a non-residue g (5 is one for this field).
  return { x: pow(5n, (p - 1n) / 4n), y: 0n };
})();

describe('key cards: making and reading back', () => {
  for (const [name, card] of [['owner', ownerCard], ['guardian', guardianCard], ['delegate', delegateCard]] as const) {
    it(`a ${name} card round-trips through bech32m, uppercase bech32m and JSON`, () => {
      const b = keyCardToBech32(card);
      expect(b.startsWith(`gvmn_${name}_preprod1`)).toBe(true);
      expect(readKeyCard(b, PREPROD)).toEqual({ ok: true, card, encoding: 'bech32m' });
      expect(readKeyCard(b.toUpperCase(), { network: 'preprod', role: name })).toEqual({ ok: true, card, encoding: 'bech32m' });
      expect(readKeyCard(keyCardToJson(card), PREPROD)).toEqual({ ok: true, card, encoding: 'json' });
    });
  }

  it('names the file type, version and extension, and writes keys as hex', () => {
    const o = json(ownerCard);
    expect(o['type']).toBe(KEY_CARD_FILE_TYPE);
    expect(o['version']).toBe(1);
    expect(o['approvalKey']).toBe(jubjubPointHex(aliceOwner.approval.publicKey));
    expect(o['upgradeKey']).toBe(aliceOwner.upgrade.publicKey);
    expect(o['label']).toBe('Alice');
    expect(Object.keys(o)).toEqual(['type', 'version', 'network', 'role', 'approvalKey', 'upgradeKey', 'signatures', 'label']);
    expect(json(guardianCard)['salt']).toBe(toHex(aliceGuardian.salt));
    expect(KEY_CARD_FILE_EXTENSION).toBe('.gvmkey.json');
  });

  it('uses one HRP per role, with the network appended off mainnet', () => {
    expect(keyCardHrp('owner', 'mainnet')).toBe('gvmn_owner');
    expect(keyCardHrp('guardian', 'preprod')).toBe('gvmn_guardian_preprod');
    expect(keyCardHrp('delegate', 'preview')).toBe('gvmn_delegate_preview');
    const mainnet = ownerKeyCard(deriveOwnerKeys(ALICE, 'mainnet', 1), OPTS);
    expect(keyCardToBech32(mainnet).startsWith('gvmn_owner1')).toBe(true);
    expect(readKeyCard(keyCardToBech32(mainnet), { network: 'mainnet' }).ok).toBe(true);
  });

  it('gives owners the guardian commitment the guardian derives', () => {
    const read = readKeyCard(keyCardToBech32(guardianCard), { network: 'preprod', role: 'guardian' });
    expect(read.ok && read.card.role === 'guardian' && guardianCardCommitment(read.card)).toBe(aliceGuardian.commitment);
  });

  it('treats the label as a claim: it is not signed', () => {
    const o = json(ownerCard);
    o['label'] = 'Mallory';
    const read = readKeyCard(text(o), PREPROD);
    expect(read.ok && read.card.label).toBe('Mallory');
    delete o['label'];
    expect(readKeyCard(text(o), PREPROD).ok).toBe(true);
  });

  it('writes labels by the write rule', () => {
    expect(ownerKeyCard(aliceOwner, { ...OPTS, label: '  Alice\u0301  ' }).label).toBe('Alic\u00e9');
    expect(() => ownerKeyCard(aliceOwner, { ...OPTS, label: '\u202Eevil' })).toThrow(expect.objectContaining({ code: 'INVALID_LABEL' }));
  });
});

describe('key cards: a card carrying another person\'s key is refused', () => {
  it('an owner card with someone else\'s approval key in place of the signer\'s', () => {
    const o = json(ownerCard);
    o['approvalKey'] = jubjubPointHex(bobOwner.approval.publicKey);
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'approval', signature: 'MISMATCH' });
  });

  it('an owner card with someone else\'s upgrade key, approval signed afresh, upgrade signature copied from their card', () => {
    const forged: OwnerKeyCard = { ...ownerCard, upgradeKey: bobOwner.upgrade.publicKey, signatures: ownerCard.signatures };
    const bobCard = ownerKeyCard(bobOwner, OPTS);
    const signed: OwnerKeyCard = {
      ...forged,
      signatures: { approval: jubjubSign(aliceOwner.approval.secretKey, digestField(forged), R(5)), upgrade: bobCard.signatures.upgrade },
    };
    expect(refusal(keyCardToJson(signed))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'upgrade' });
    expect(refusal(keyCardToBech32(signed))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'upgrade' });
  });

  it('a guardian card with someone else\'s key, or with another salt', () => {
    const o = json(guardianCard);
    o['key'] = jubjubPointHex(bobGuardian.key.publicKey);
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'key', signature: 'MISMATCH' });
    const s = json(guardianCard);
    s['salt'] = toHex(bobGuardian.salt);
    expect(refusal(text(s))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'key', signature: 'MISMATCH' });
  });

  it('a delegate card with someone else\'s key', () => {
    const o = json(delegateCard);
    o['key'] = jubjubPointHex(deriveDelegateKeys(BOB, 'preprod', 3).key.publicKey);
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'key', signature: 'MISMATCH' });
  });
});

describe('key cards: point validation and the small-order check', () => {
  const withKey = (card: MidnightKeyCard, field: 'approvalKey' | 'key', p: JubjubPoint) => {
    const o = json(card);
    o[field] = jubjubPointHex(p);
    return text(o);
  };

  it('refuses a small-order point as an approval, guardian or delegate key', () => {
    for (const p of [ORDER_2, ORDER_4]) {
      expect(refusal(withKey(ownerCard, 'approvalKey', p))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'SMALL_ORDER', field: 'approvalKey' });
      expect(refusal(withKey(guardianCard, 'key', p))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'SMALL_ORDER', field: 'key' });
      expect(refusal(withKey(delegateCard, 'key', p))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'SMALL_ORDER', field: 'key' });
    }
  });

  it('refuses the identity point', () => {
    const identity = { x: 0n, y: 1n };
    expect(refusal(withKey(ownerCard, 'approvalKey', identity))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'IDENTITY', field: 'approvalKey' });
    expect(refusal(withKey(guardianCard, 'key', identity))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'IDENTITY', field: 'key' });
  });

  it('refuses a key with a torsion component, a point off the curve, and coordinates out of range', () => {
    const g = jubjubMulGenerator(3n);
    // (x, 0) of order 4 added to a subgroup point: on the curve, outside the subgroup.
    const mixed = (() => {
      const p = FIELD_MODULUS;
      const inv = (a: bigint) => {
        let [r0, r1, s0, s1] = [p, ((a % p) + p) % p, 0n, 1n];
        while (r1 !== 0n) {
          const q = r0 / r1;
          [r0, r1] = [r1, r0 - q * r1];
          [s0, s1] = [s1, s0 - q * s1];
        }
        return ((s0 % p) + p) % p;
      };
      const d = 0x2a9318e74bfa2b48f5fd9207e6bd7fd4292d7f6d37579d2601065fd6d6343eb1n;
      const t = ORDER_4;
      const k = (d * g.x * t.x * g.y * t.y) % p;
      return { x: (((g.x * t.y + g.y * t.x) % p) * inv(1n + k)) % p, y: ((((g.y * t.y + g.x * t.x) % p) * inv(1n - k + p)) % p) };
    })();
    expect(refusal(withKey(ownerCard, 'approvalKey', mixed))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'NOT_IN_SUBGROUP', field: 'approvalKey' });
    expect(refusal(withKey(delegateCard, 'key', { x: g.x, y: g.y + 1n }))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'NOT_ON_CURVE', field: 'key' });
    const o = json(delegateCard);
    o['key'] = 'ff'.repeat(64);
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_KEY', point: 'OUT_OF_RANGE', field: 'key' });
  });

  it('refuses an upgrade key that does not lift to a secp256k1 point', () => {
    const o = json(ownerCard);
    o['upgradeKey'] = '05'.padStart(64, '0');
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_UPGRADE_KEY' });
  });
});

describe('key cards: network and role', () => {
  it('refuses a card for another network, in either encoding', () => {
    const mainnet = ownerKeyCard(deriveOwnerKeys(ALICE, 'mainnet', 1), OPTS);
    expect(refusal(keyCardToBech32(mainnet))).toEqual({ ok: false, code: 'WRONG_NETWORK' });
    expect(refusal(keyCardToJson(mainnet))).toEqual({ ok: false, code: 'WRONG_NETWORK' });
    expect(refusal(keyCardToBech32(ownerCard), { network: 'preview' })).toEqual({ ok: false, code: 'WRONG_NETWORK' });
  });

  it('refuses a preprod card relabelled as another network: the network is signed', () => {
    const o = json(ownerCard);
    o['network'] = 'mainnet';
    expect(refusal(text(o), { network: 'mainnet' })).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'approval', signature: 'MISMATCH' });
  });

  it('refuses a card for another role than the one asked for', () => {
    expect(refusal(keyCardToBech32(guardianCard), { network: 'preprod', role: 'owner' })).toEqual({ ok: false, code: 'WRONG_ROLE' });
    expect(refusal(keyCardToJson(ownerCard), { network: 'preprod', role: 'delegate' })).toEqual({ ok: false, code: 'WRONG_ROLE' });
  });

  it('refuses a card whose role is relabelled: the role is signed', () => {
    const o = json(delegateCard);
    o['role'] = 'guardian';
    o['salt'] = '00'.repeat(32);
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'key', signature: 'MISMATCH' });
  });
});

describe('key cards: strict decoding', () => {
  it('refuses unknown or missing fields, another type, another version, and a bad label', () => {
    const extra = json(delegateCard);
    extra['index'] = 3;
    expect(refusal(text(extra))).toEqual({ ok: false, code: 'MALFORMED' });
    const missing = json(ownerCard);
    delete missing['upgradeKey'];
    expect(refusal(text(missing))).toEqual({ ok: false, code: 'MALFORMED' });
    const sigExtra = json(delegateCard);
    sigExtra.signatures['upgrade'] = '00'.repeat(64);
    expect(refusal(text(sigExtra))).toEqual({ ok: false, code: 'MALFORMED' });
    const type = json(delegateCard);
    type['type'] = 'gero-vault/v1|midnight-request';
    expect(refusal(text(type))).toEqual({ ok: false, code: 'MALFORMED' });
    const version = json(delegateCard);
    version['version'] = 2;
    expect(refusal(text(version))).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION' });
    const label = json(delegateCard);
    label['label'] = 'line\nbreak';
    expect(refusal(text(label))).toEqual({ ok: false, code: 'INVALID_LABEL' });
    const upper = json(delegateCard);
    upper['key'] = String(upper['key']).toUpperCase();
    expect(refusal(text(upper))).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('refuses a signature response from r_J up', () => {
    const o = json(delegateCard);
    const sig = o.signatures['key'] as { announcement: string; response: string };
    sig.response = toHex(le32(le2ip(fromHex(sig.response) as Uint8Array) + JUBJUB_SCALAR_MODULUS));
    expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'key', signature: 'RESPONSE_OUT_OF_RANGE' });
  });

  it('refuses a signature announcement off the curve or with a coordinate from the modulus up', () => {
    const R = delegateCard.signatures.key.announcement;
    for (const announcement of [{ x: R.x, y: R.y + 1n }, { x: R.x + FIELD_MODULUS, y: R.y }]) {
      const o = json(delegateCard);
      (o.signatures['key'] as { announcement: string }).announcement = toHex(concatBytes(le32(announcement.x), le32(announcement.y)));
      expect(refusal(text(o))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'key', signature: 'ANNOUNCEMENT_NOT_ON_CURVE' });
    }
    const owner = json(ownerCard);
    (owner.signatures['approval'] as { announcement: string }).announcement = 'ff'.repeat(64);
    expect(refusal(text(owner))).toEqual({ ok: false, code: 'INVALID_SIGNATURE', field: 'approval', signature: 'ANNOUNCEMENT_NOT_ON_CURVE' });
  });

  it('refuses a JSON card above the size limit', () => {
    const o = json(delegateCard);
    expect(refusal(`${text(o)}${' '.repeat(KEY_CARD_MAX_JSON_BYTES)}`)).toEqual({ ok: false, code: 'TOO_LARGE' });
  });

  it('refuses a bech32m card under another HRP, with a bad checksum, or in plain bech32', () => {
    const b = keyCardToBech32(delegateCard);
    const words = bech32m.decode(b, 2048).words;
    expect(refusal(bech32m.encode('gvmn_guardian_preprod', words, 2048))).toEqual({ ok: false, code: 'MALFORMED' });
    expect(refusal(bech32m.encode('gvmn_delegate', words, 2048), { network: 'mainnet' })).toEqual({ ok: false, code: 'MALFORMED' });
    expect(refusal(`${b.slice(0, -1)}${b.endsWith('q') ? 'p' : 'q'}`)).toEqual({ ok: false, code: 'MALFORMED' });
    expect(refusal(`${b.slice(0, 10)}${b.slice(10).toUpperCase()}`)).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('refuses a bech32m card whose CBOR is not canonical', () => {
    const entries: [string, unknown][] = [
      ['key', fromHex(jubjubPointHex(delegateCard.key))],
      ['role', 'delegate'],
      ['network', 'preprod'],
      ['version', 1],
      ['signatures', { key: { announcement: fromHex(jubjubPointHex(delegateCard.signatures.key.announcement)), response: le32(delegateCard.signatures.key.response) } }],
    ];
    const encode = (pairs: [string, unknown][]) =>
      bech32m.encode('gvmn_delegate_preprod', bech32m.toWords(concatBytes(new Uint8Array([0xa5]), ...pairs.flatMap(([k, v]) => [encodeCanonicalCbor(k), encodeCanonicalCbor(v as never)]))), 2048);
    // In canonical key order (shorter keys first, then bytewise) the card reads back.
    expect(readKeyCard(encode(entries), PREPROD)).toEqual({ ok: true, card: delegateCard, encoding: 'bech32m' });
    // The same five pairs with the longest key first are not canonical.
    expect(refusal(encode([entries[4], ...entries.slice(0, 4)]))).toEqual({ ok: false, code: 'NOT_CANONICAL' });
  });

  it('never throws on garbage', () => {
    for (const bad of [undefined, null, 42, {}, [], '', 'gvmn_', 'gvmn_owner1', '{', '[]', 'null', '{"__proto__":{"type":1}}', 'x'.repeat(5000)]) {
      const r = readKeyCard(bad, PREPROD);
      expect(r.ok).toBe(false);
    }
    expect(readKeyCard(keyCardToJson(ownerCard), undefined as never)).toEqual({ ok: false, code: 'MALFORMED' });
    expect(readKeyCard(keyCardToJson(ownerCard), { network: 'devnet' as never })).toEqual({ ok: false, code: 'MALFORMED' });
  });
});
