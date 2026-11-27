// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mnemonicToSeedSync } from '@scure/bip39';
import vectors from './__fixtures__/freeze-vectors.json';
import { formatMidnightKeyPath } from './paths';
import { deriveDelegateKeys, deriveGuardianKeys, deriveOwnerKeys, midnightChildKey } from './derive';
import { hedgedNonce, jubjubChallenge, jubjubSecretFromChildKey, jubjubSign, jubjubVerify } from './schnorr';
import { upgradeKeyPairFromChildKey } from './upgradeKey';
import { guardianCommitment, guardianSalt } from './guardian';
import { jubjubMulGenerator } from './jubjub';
import { bytes32Fields, transientHash, transientHashWords } from './poseidon';
import { fromHex, le32, pad32, toHex } from './bytes';
import { FieldElement, JubjubPoint, JubjubSecretKey, MidnightKeyRole, MidnightNetwork } from './types';

/**
 * Every vector of the vault contract freeze (tag `midnight-vault-freeze-1`, commit d9fd7387, file
 * `midnight/freeze/vectors.json`), copied byte for byte into `__fixtures__`. The freeze computed
 * them with compact-runtime 0.21.0 and the compiled contract's pure circuits; here they are
 * recomputed with this library alone.
 */
const FIXTURE_SHA256 = 'c026a0d1d07e64ac9250ac173925a10d62889680c3988f0cc03b55d9ef6020a4';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SEED = mnemonicToSeedSync(MNEMONIC);

const big = (s: string): bigint => BigInt(s);
const point = (p: { x: string; y: string }): JubjubPoint => ({ x: big(p.x), y: big(p.y) });
const bytes = (hex: string): Uint8Array => fromHex(hex) as Uint8Array;
const word = (x: bigint | number | string): Uint8Array => le32(BigInt(x));
const filled = (n: number, b: number) => new Uint8Array(n).fill(b);

describe('freeze vectors: the fixture', () => {
  it('is the frozen file, unchanged', () => {
    const raw = readFileSync(new URL('./__fixtures__/freeze-vectors.json', import.meta.url));
    expect(createHash('sha256').update(raw).digest('hex')).toBe(FIXTURE_SHA256);
  });

  it('uses the public BIP-39 test phrase', () => {
    expect(vectors.mnemonic.startsWith(MNEMONIC)).toBe(true);
  });
});

describe('freeze vectors: derivation (path, child key, Jubjub scalar, public keys, guardian salt)', () => {
  const ROLE: Record<string, MidnightKeyRole> = { approval: 'approval', upgrade: 'upgrade', guardian: 'guardian', delegate: 'delegate' };

  for (const v of vectors.derivation.keys) {
    it(`${v.path} (${v.network} ${v.role} ${v.index})`, () => {
      const network = v.network as MidnightNetwork;
      const role = ROLE[v.role];
      expect(formatMidnightKeyPath(network, role, v.index)).toBe(v.path);
      const k = midnightChildKey(SEED, network, role, v.index);
      expect(toHex(k)).toBe(v.childKey);
      if (role === 'upgrade') {
        expect(upgradeKeyPairFromChildKey(k).publicKey).toBe((v as { bip340XOnlyPublicKey: string }).bip340XOnlyPublicKey);
        expect(deriveOwnerKeys(SEED, network, v.index).upgrade.publicKey).toBe((v as { bip340XOnlyPublicKey: string }).bip340XOnlyPublicKey);
        return;
      }
      const jv = v as unknown as { jubjubSk: string; publicKey: { x: string; y: string }; guardianSalt?: string; guardianCommitment?: string };
      expect(jubjubSecretFromChildKey(k)).toBe(big(jv.jubjubSk));
      const derived = role === 'approval'
        ? deriveOwnerKeys(SEED, network, v.index).approval
        : role === 'guardian'
          ? deriveGuardianKeys(SEED, network, v.index).key
          : deriveDelegateKeys(SEED, network, v.index).key;
      expect(derived.secretKey).toBe(big(jv.jubjubSk));
      expect(derived.publicKey).toEqual(point(jv.publicKey));
      if (role === 'guardian') {
        // k_guardian is the 32-byte BIP-32 child key at role 2'.
        expect(toHex(guardianSalt(k))).toBe(jv.guardianSalt);
        const g = deriveGuardianKeys(SEED, network, v.index);
        expect(toHex(g.salt)).toBe(jv.guardianSalt);
        expect(g.commitment).toBe(big(jv.guardianCommitment));
      }
    });
  }
});

describe('freeze vectors: guardian commitments', () => {
  it('the derived preprod guardian key 2 with its salt', () => {
    const [derived] = vectors.commitments.guardianCommitments;
    const g = vectors.derivation.keys.find(k => k.role === 'guardian') as unknown as { publicKey: { x: string; y: string } };
    expect(guardianCommitment(point(g.publicKey), bytes(derived.salt))).toBe(big(derived.value));
  });

  it('a fixed scalar key with the salt 00..1f', () => {
    const fixed = vectors.commitments.guardianCommitments[1] as unknown as { key: { scalar: string; x: string; y: string }; salt: string; value: string };
    const key = jubjubMulGenerator(big(fixed.key.scalar));
    expect(key).toEqual(point(fixed.key));
    expect(guardianCommitment(key, bytes(fixed.salt))).toBe(big(fixed.value));
  });
});

describe('freeze vectors: the hedged Jubjub signature', () => {
  const s = vectors.signature;
  const approval = vectors.derivation.keys[0] as unknown as { jubjubSk: string; publicKey: { x: string; y: string } };
  const sk = big(approval.jubjubSk) as JubjubSecretKey;
  const digest = big(s.digest) as FieldElement;
  const rand32 = bytes(s.rand32);

  it('signs with the derived preprod approval key 1', () => {
    expect(point(s.publicKey)).toEqual(point(approval.publicKey));
  });

  it('derives the nonce from LE32(sk), LE32(digest) and rand32', () => {
    expect(hedgedNonce(sk, digest, rand32)).toBe(big(s.nonce));
  });

  it('computes the challenge as transientHash([R.x, R.y, pk.x, pk.y, digest]) mod r_J', () => {
    expect(jubjubChallenge(point(s.signature.announcement), point(s.publicKey), digest)).toBe(big(s.challenge));
  });

  it('produces the frozen signature exactly', () => {
    const sig = jubjubSign(sk, digest, rand32);
    expect(sig.announcement).toEqual(point(s.signature.announcement));
    expect(sig.response).toBe(big(s.signature.response));
  });

  it('verifies for the digest and not for digest + 1', () => {
    const sig = { announcement: point(s.signature.announcement), response: big(s.signature.response) };
    expect(jubjubVerify(point(s.publicKey), digest, sig)).toBe(s.verifies);
    expect(jubjubVerify(point(s.publicKey), digest + 1n, sig)).toBe(s.verifiesForDigestPlusOne);
  });
});

describe('freeze vectors: statement digests (transientHash over little-endian 32-byte words)', () => {
  for (const d of vectors.statementDigests) {
    it(d.kind, () => {
      const i = d.inputs as Record<string, string | number>;
      const head = [pad32(`midnight-vault:${d.kind}`), pad32(String(i['network'])), bytes(String(i['vault']))];
      let words: Uint8Array[];
      if (d.kind === 'payout:v4') {
        words = [...head, word(i['nonce']), word(i['expiry']), bytes(String(i['recipient'])), word(i['amount'])];
      } else if (d.kind === 'delegate-pay:v1') {
        words = [...head, word(i['slot']), word(i['delegateNonce']), word(i['expiry']), bytes(String(i['recipient'])), word(i['amount'])];
      } else {
        words = [...head, word(i['nonce']), word(i['expiry']), word(i['subject'])];
      }
      expect(transientHashWords(words)).toBe(big(d.value));
    });
  }
});

describe('freeze vectors: owner set, policy and recovery config commitments', () => {
  const keys = vectors.derivation.keys as unknown as { role: string; network: string; publicKey?: { x: string; y: string }; bip340XOnlyPublicKey?: string }[];
  const approval = point(keys[0].publicKey as { x: string; y: string });
  const upgrade = bytes(keys[1].bip340XOnlyPublicKey as string);
  const delegate = point(keys[3].publicKey as { x: string; y: string });
  const empty = { x: 0n, y: 1n };

  it('ownerSetCommitment', () => {
    const second = jubjubMulGenerator(0xfedcba0987654321n);
    const owners: [JubjubPoint, Uint8Array][] = [[approval, upgrade], [second, filled(32, 0x12)], [empty, filled(32, 0)], [empty, filled(32, 0)], [empty, filled(32, 0)]];
    const fields = [...bytes32Fields(pad32('midnight-vault:owner-set:v2')), ...owners.flatMap(([a, u]) => [a.x, a.y, ...bytes32Fields(u)]), 2n];
    expect(transientHash(fields)).toBe(big(vectors.commitments.ownerSetCommitment.value));
  });

  it('policyCommitment', () => {
    const whitelist: [bigint, Uint8Array, bigint][] = [[1n, filled(32, 0x33), 1n], ...Array.from({ length: 7 }, (): [bigint, Uint8Array, bigint] => [0n, filled(32, 0), 0n])];
    const delegates = [[1n, delegate.x, delegate.y, 100n, 3600n], [0n, 0n, 1n, 0n, 0n]];
    const fields = [...bytes32Fields(pad32('midnight-vault:policy:v1')), 1n, ...whitelist.flatMap(([a, r, s]) => [a, ...bytes32Fields(r), s]), ...delegates.flat()];
    expect(transientHash(fields)).toBe(big(vectors.commitments.policyCommitment.value));
  });

  it('recoveryConfigCommitment', () => {
    const guardian = big(vectors.commitments.guardianCommitments[0].value);
    const fields = [...bytes32Fields(pad32('midnight-vault:recovery-cfg:v1')), guardian, 0n, 0n, 0n, 0n, 1n, 604800n, 172800n, 2592000n];
    expect(transientHash(fields)).toBe(big(vectors.commitments.recoveryConfigCommitment.value));
  });
});
