// src/services/agent/decodeStakeTx.spec.ts
import { describe, it, expect } from 'vitest';
import { toDecodedStakeTx } from './decodeStakeTx';

/**
 * Minimal structural shapes that mirror a deserialized Cardano.Tx from @cardano-sdk/core.
 * Certificates use `__typename` (the SDK's discriminant) and `poolId` (bech32 pool id).
 * Withdrawals use `{ stakeAddress, quantity }` -- confirmed from useWithdrawal.ts line 63.
 * Outputs use `{ address, value: { coins, assets? } }`.
 */

const POOL_ID = 'pool1abc123';
const STAKE_ADDR = 'stake1uxxx';
const OWN_ADDR = 'addr1vxxx';

function makeDelegTx() {
  return {
    body: {
      certificates: [
        {
          __typename: 'StakeDelegation',
          poolId: POOL_ID,
          stakeCredential: { type: 0, hash: 'deadbeef' },
        },
      ],
      withdrawals: [] as Array<{ stakeAddress: string; quantity: bigint }>,
      outputs: [
        {
          address: OWN_ADDR,
          value: { coins: 9_000000n, assets: undefined },
        },
      ],
      fee: 180000n,
    },
  };
}

function makeWithdrawTx() {
  const assets = new Map([['policyid.assetname' as any, 5n]]);
  return {
    body: {
      certificates: [] as Array<{ __typename: string; poolId?: string }>,
      withdrawals: [
        { stakeAddress: STAKE_ADDR, quantity: 5_000000n },
      ],
      outputs: [
        {
          address: OWN_ADDR,
          value: { coins: 14_800000n, assets },
        },
      ],
      fee: 200000n,
    },
  };
}

describe('toDecodedStakeTx', () => {
  it('maps a delegation tx: cert kind, poolId, output address/lovelace/hasAssets, fee', () => {
    const result = toDecodedStakeTx(makeDelegTx());
    expect(result.certificates).toHaveLength(1);
    expect(result.certificates[0].kind).toBe('StakeDelegation');
    expect(result.certificates[0].poolId).toBe(POOL_ID);
    expect(result.withdrawals).toHaveLength(0);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].address).toBe(OWN_ADDR);
    expect(result.outputs[0].lovelace).toBe(9_000000n);
    expect(result.outputs[0].hasAssets).toBe(false);
    expect(result.fee).toBe(180000n);
  });

  it('maps a withdrawal tx: stakeAddress, quantity, hasAssets=true when assets map is non-empty', () => {
    const result = toDecodedStakeTx(makeWithdrawTx());
    expect(result.certificates).toHaveLength(0);
    expect(result.withdrawals).toHaveLength(1);
    expect(result.withdrawals[0].stakeAddress).toBe(STAKE_ADDR);
    expect(result.withdrawals[0].quantity).toBe(5_000000n);
    expect(result.outputs[0].hasAssets).toBe(true);
    expect(result.fee).toBe(200000n);
  });
});
