import { describe, expect, it } from 'vitest';
import { BODY_KEY_RULES, bodyKeyRule } from './bodyKeys';
import { decodeVaultTransaction } from './decodeVaultTx';
import {
  array, baseEntries, bytes, entry, EXECUTOR_ADDRESS, fundSource, inputSet, K1, legacyOutput, map, POOL_KEY_HASH, transaction,
  uint, VAULT_REWARD_ACCOUNT, VAULT_SCRIPT_HASH,
} from './__fixtures__/vaultTxs';

/** Every key the Conway transaction body CDDL defines. */
const CONWAY_BODY_KEYS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/**
 * A well-formed, balanced value for each decoded key, added to the base body (which already has
 * keys 0, 1 and 2). Collateral return and total need collateral inputs beside them.
 */
const SAMPLES: Record<string, Array<[string, string]>> = {
  3: [entry(3, uint(1_000))],
  4: [entry(4, array(array(uint(2), array(uint(1), bytes(VAULT_SCRIPT_HASH)), bytes(POOL_KEY_HASH))))],
  5: [entry(5, map([bytes(VAULT_REWARD_ACCOUNT), uint(0)]))],
  8: [entry(8, uint(10))],
  13: [entry(13, inputSet(2))],
  14: [entry(14, array(bytes(K1)))],
  15: [entry(15, uint(0))],
  16: [entry(13, inputSet(2)), entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(4_500_000)))],
  17: [entry(13, inputSet(2)), entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(4_500_000))), entry(17, uint(500_000))],
  18: [entry(18, inputSet(3))],
};

const decode = (tx: string) => decodeVaultTransaction(tx, { networkId: 0, inputSources: [fundSource()] });

describe('body key rules', () => {
  it('name every Conway body key, and only those', () => {
    expect(BODY_KEY_RULES.map((rule) => rule.key)).toEqual(CONWAY_BODY_KEYS);
    expect(new Set(BODY_KEY_RULES.map((rule) => rule.key)).size).toBe(BODY_KEY_RULES.length);
  });

  it('are each either a decoder or a refusal', () => {
    for (const rule of BODY_KEY_RULES) expect('decode' in rule !== 'refuse' in rule).toBe(true);
  });

  it('every key from 0 to 63 and some large ones is decoded or refused, none ignored', async () => {
    const keys = [...Array.from({ length: 64 }, (_, i) => i), 255, 256, 1_000, 65_535, 4_294_967_296];
    for (const key of keys) {
      const rule = bodyKeyRule(BigInt(key));
      if (rule && 'decode' in rule) {
        // Keys 0, 1 and 2 are in every base body; the others get a sample value.
        const extra = key <= 2 ? [] : SAMPLES[key];
        expect(extra, `sample for body key ${key}`).toBeDefined();
        const result = await decode(transaction(...baseEntries(), ...extra));
        expect(result.status, `body key ${key} decodes: ${JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`).toBe('decoded');
      } else {
        const result = await decode(transaction(...baseEntries(), entry(key, uint(0))));
        expect(result.status, `body key ${key} refuses`).toBe('refused');
        if (result.status !== 'decoded') {
          expect(result.refusals).toEqual([expect.objectContaining({
            path: `body.${key}`,
            code: rule && 'refuse' in rule ? rule.refuse : 'body_key_unknown',
          })]);
        }
      }
    }
  });

  it('every key of a decoded body is reflected in the summary', async () => {
    const tx = transaction(...baseEntries(), ...Object.values(SAMPLES).flat().filter(([k], i, all) => all.findIndex(([j]) => j === k) === i));
    const result = await decode(tx);
    expect(result.status).toBe('decoded');
    if (result.status !== 'decoded') return;
    const s = result.summary;
    expect(s.inputs).toHaveLength(1); // 0
    expect(s.outputs).toHaveLength(1); // 1
    expect(s.fee).toBe(200_000n); // 2
    expect(s.validity).toEqual({ invalidHereafter: 1_000n, invalidBefore: 10n }); // 3, 8
    expect(s.certificates).toHaveLength(1); // 4
    expect(s.withdrawals).toHaveLength(1); // 5
    expect(s.collateral?.inputs).toHaveLength(1); // 13
    expect(s.requiredSigners).toEqual([K1]); // 14
    expect(s.bodyNetworkId).toBe(0); // 15
    expect(s.collateral?.collateralReturn?.value.lovelace).toBe(4_500_000n); // 16
    expect(s.collateral?.totalCollateral).toBe(500_000n); // 17
    expect(s.referenceInputs).toHaveLength(1); // 18
  });
});
