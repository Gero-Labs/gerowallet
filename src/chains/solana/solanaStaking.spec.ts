// Nexus's staking answers read strictly, and what each stake account offers the wallet.
import { describe, expect, it } from 'vitest';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';
import {
  parseSolanaStakeInfo,
  parseSolanaStakes,
  parseSolanaValidators,
  stakeActions,
  totalActiveLamports,
  totalStakedLamports,
} from './solanaStaking';

// Fixed test vectors — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const OTHER = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const STAKE = deriveSolanaKeypairFromMnemonic(MNEMONIC, 2).address;
const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const NODE = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

const row = (fields: Record<string, unknown> = {}) => ({
  address: STAKE, state: 'active', role: 'both', lamports: '2002282880', rentExemptReserve: '2282880',
  staker: OWNER, withdrawer: OWNER, voter: VOTE, delegatedStake: '2000000000', activeStake: '2000000000',
  activatingStake: '0', deactivatingStake: '0', activationEpoch: 600, deactivationEpoch: null,
  withdrawableLamports: '0', lockedUp: false, lockupUnixTimestamp: 0, lockupEpoch: 0, lockupCustodian: OWNER, ...fields,
});

describe('stake accounts', () => {
  it('reads amounts exactly, beyond 2^53', () => {
    const stakes = parseSolanaStakes({ epoch: 700, accounts: [row({ lamports: '18000000000000000000', withdrawableLamports: '1' })], truncated: true }, OWNER);
    expect(stakes.accounts[0].lamports).toBe(18_000_000_000_000_000_000n);
    expect(stakes).toMatchObject({ epoch: 700, truncated: true, dropped: 0 });
  });

  it.each([
    ['an unknown state', { state: 'uninitialized' }],
    ['a role the authorities do not give the wallet', { role: 'staker', staker: OTHER }],
    ['both roles when the wallet holds one', { withdrawer: OTHER }],
    ['a number where a decimal string belongs', { lamports: 2002282880 }],
    ['more withdrawable than the balance', { withdrawableLamports: '9002282880' }],
    ['a delegated state without a validator', { voter: null }],
    ['a bad address', { address: 'nope' }],
  ])('drops a row with %s', (_, fields) => {
    const stakes = parseSolanaStakes({ epoch: 700, accounts: [row(fields)], truncated: false }, OWNER);
    expect(stakes.accounts).toEqual([]);
    expect(stakes.dropped).toBe(1);
  });

  it('drops a repeated account and throws on an answer that is not a list', () => {
    expect(parseSolanaStakes({ epoch: 1, accounts: [row(), row()] }, OWNER).accounts).toHaveLength(1);
    expect(() => parseSolanaStakes({ epoch: 1, accounts: {} }, OWNER)).toThrow();
    expect(() => parseSolanaStakes(null, OWNER)).toThrow();
  });

  it('offers Unstake to the staker of an active stake and Withdraw to the withdrawer of what can be taken', () => {
    const [active] = parseSolanaStakes({ epoch: 1, accounts: [row()] }, OWNER).accounts;
    expect(stakeActions(active, OWNER)).toEqual({ unstake: true, withdraw: false });
    const [inactive] = parseSolanaStakes({ epoch: 1, accounts: [row({ state: 'inactive', activeStake: '0', withdrawableLamports: '2002282880' })] }, OWNER).accounts;
    expect(stakeActions(inactive, OWNER)).toEqual({ unstake: false, withdraw: true });
    expect(stakeActions({ ...inactive, lockedUp: true }, OWNER).withdraw).toBe(false);
    expect(stakeActions(inactive, OTHER)).toEqual({ unstake: false, withdraw: false });
    expect(totalStakedLamports([active, inactive])).toBe(4_004_565_760n);
    expect(totalActiveLamports([active, inactive])).toBe(2_000_000_000n);
  });
});

describe('validators', () => {
  const v = (fields: Record<string, unknown> = {}) => ({
    votePubkey: VOTE, nodePubkey: NODE, name: 'Certus', website: 'https://certus.one', iconUrl: 'https://certus.one/i.png',
    details: 'x', commission: 7, activatedStake: '1000', delinquent: false, lastVote: 1, lastEpochCredits: 400_000, ...fields,
  });

  it('keeps https links only and bounds published text', () => {
    const [kept] = parseSolanaValidators({ epoch: 1, validators: [v({ website: 'javascript:alert(1)', iconUrl: 'http://x', name: 'n'.repeat(400) })] }).validators;
    expect(kept.website).toBeNull();
    expect(kept.iconUrl).toBeNull();
    expect(kept.name).toHaveLength(300);
  });

  it('drops a validator with a commission above 100, a bad vote account, or one seen before', () => {
    const { validators } = parseSolanaValidators({ epoch: 1, validators: [v({ commission: 101 }), v({ votePubkey: 'x' }), v(), v({ name: 'Copy' })] });
    expect(validators).toHaveLength(1);
    expect(validators[0].name).toBe('Certus');
  });
});

describe('stake info', () => {
  it('reads the epoch, minimum and reserve, and refuses impossible progress', () => {
    const info = parseSolanaStakeInfo({ epoch: 700, slotIndex: 10, slotsInEpoch: 432000, minimumDelegation: '1000000000', rentExemptReserve: '2282880' });
    expect(info).toMatchObject({ epoch: 700, minimumDelegation: 1_000_000_000n, rentExemptReserve: 2_282_880n });
    expect(() => parseSolanaStakeInfo({ epoch: 1, slotIndex: 2, slotsInEpoch: 1, minimumDelegation: '1', rentExemptReserve: '1' })).toThrow();
    expect(() => parseSolanaStakeInfo({ epoch: 1, slotIndex: 0, slotsInEpoch: 1, minimumDelegation: 1, rentExemptReserve: '1' })).toThrow();
  });
});
