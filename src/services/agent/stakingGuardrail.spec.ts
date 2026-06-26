// src/services/agent/stakingGuardrail.spec.ts
import { describe, it, expect } from 'vitest';
import { verifyDelegateTx, verifyWithdrawTx, type DecodedStakeTx } from './stakingGuardrail';

const OWN = 'addr_own';
const FOREIGN = 'addr_foreign';
const STAKE = 'stake_own';

const delegTx = (poolId: string, extra: Partial<DecodedStakeTx> = {}): DecodedStakeTx => ({
  certificates: [{ kind: 'StakeDelegation', poolId }],
  withdrawals: [],
  outputs: [{ address: OWN, lovelace: 9_000000n, hasAssets: false }],
  fee: 200000n,
  ...extra,
});

describe('verifyDelegateTx', () => {
  const exp = { ownAddresses: [OWN], targetPoolId: 'pool1good', maxFeeLovelace: 2_000000n };
  it('passes when the delegation cert targets the intended pool', () => {
    expect(verifyDelegateTx(delegTx('pool1good'), exp).ok).toBe(true);
  });
  it('FAILS when the cert targets a different pool', () => {
    const v = verifyDelegateTx(delegTx('pool1EVIL'), exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/different pool/i);
  });
  it('FAILS when no delegation cert is present', () => {
    expect(verifyDelegateTx(delegTx('pool1good', { certificates: [] }), exp).ok).toBe(false);
  });
  it('FAILS when a reward withdrawal is sneaked in', () => {
    const v = verifyDelegateTx(delegTx('pool1good', { withdrawals: [{ stakeAddress: STAKE, quantity: 5_000000n }] }), exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/should not.*withdraw/i);
  });
  it('FAILS on foreign ADA outflow', () => {
    const v = verifyDelegateTx(delegTx('pool1good', { outputs: [{ address: FOREIGN, lovelace: 50_000000n, hasAssets: false }] }), exp);
    expect(v.ok).toBe(false);
  });
});

describe('verifyWithdrawTx', () => {
  const exp = { ownAddresses: [OWN], stakeAddress: STAKE, withdrawableAmount: 5_000000n, maxFeeLovelace: 1_000000n };
  const wTx = (extra: Partial<DecodedStakeTx> = {}): DecodedStakeTx => ({
    certificates: [], withdrawals: [{ stakeAddress: STAKE, quantity: 5_000000n }],
    outputs: [{ address: OWN, lovelace: 12_000000n, hasAssets: false }], fee: 200000n, ...extra,
  });
  it('passes a clean rewards withdrawal to an own address', () => {
    expect(verifyWithdrawTx(wTx(), exp).ok).toBe(true);
  });
  it('FAILS when the withdrawal exceeds the available rewards', () => {
    const v = verifyWithdrawTx(wTx({ withdrawals: [{ stakeAddress: STAKE, quantity: 9_000000n }] }), exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/exceeds/i);
  });
  it('FAILS when ADA leaves to a foreign address', () => {
    const v = verifyWithdrawTx(wTx({ outputs: [{ address: FOREIGN, lovelace: 12_000000n, hasAssets: false }] }), exp);
    expect(v.ok).toBe(false);
  });
  it('FAILS when a delegation cert is sneaked into a withdraw', () => {
    const v = verifyWithdrawTx(wTx({ certificates: [{ kind: 'StakeDelegation', poolId: 'pool1x' }] }), exp);
    expect(v.ok).toBe(false);
  });
});
