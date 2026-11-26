import { describe, expect, it } from 'vitest';
import { fromHex } from './cbor';
import type { DecodeContext } from './context';
import { Refusals } from './refusals';
import { decodeWithdrawals } from './withdrawals';
import { bytes, EXECUTOR_ENTERPRISE_ADDRESS, map, uint, VAULT_REWARD_ACCOUNT, VAULT_SCRIPT_HASH } from './__fixtures__/vaultTxs';

const ctx = (): DecodeContext => ({ networkId: 0, refusals: new Refusals() });
const OTHER_REWARD = `e0${'ab'.repeat(28)}`;

describe('decodeWithdrawals', () => {
  it('renders each withdrawal: full reward address, credential, amount', () => {
    const c = ctx();
    const views = decodeWithdrawals(fromHex(map([bytes(VAULT_REWARD_ACCOUNT), uint(1_500_000)], [bytes(OTHER_REWARD), uint(0)])), 'body.5', c);
    expect(c.refusals.list).toEqual([]);
    expect(views.map((w) => [w.rewardAccount.hex, w.rewardAccount.credential, w.lovelace])).toEqual([
      [VAULT_REWARD_ACCOUNT, { kind: 'script', hash: VAULT_SCRIPT_HASH }, 1_500_000n],
      [OTHER_REWARD, { kind: 'key', hash: 'ab'.repeat(28) }, 0n],
    ]);
    expect(views.every((w) => w.rewardAccount.bech32.startsWith('stake_test1'))).toBe(true);
  });

  it('refuses another network and a payment address, per withdrawal', () => {
    const c = ctx();
    decodeWithdrawals(fromHex(map([bytes(`f1${VAULT_SCRIPT_HASH}`), uint(1)], [bytes(EXECUTOR_ENTERPRISE_ADDRESS), uint(1)])), 'body.5', c);
    expect(c.refusals.list).toEqual([
      { code: 'network_mismatch', path: 'body.5[0]', detail: 'network_1' },
      { code: 'address_invalid', path: 'body.5[1]', detail: 'not_reward_account' },
    ]);
  });

  it('refuses a repeated account and an empty map', () => {
    expect(() => decodeWithdrawals(fromHex(map([bytes(VAULT_REWARD_ACCOUNT), uint(1)], [bytes(VAULT_REWARD_ACCOUNT), uint(2)])), 'body.5', ctx())).toThrow(/duplicate_key/);
    expect(() => decodeWithdrawals(fromHex(map()), 'body.5', ctx())).toThrow(/empty/);
  });
});
