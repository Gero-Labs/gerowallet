import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { WalletType } from '@/models/types';
import { delegationCertificates, signsSeparateStakeCertificates, stakeRegistrationDeposit } from './stakeCertificates';

const stakeCredential = { type: Cardano.CredentialType.KeyHash, hash: 'e8365057db076a441c20a6f9e7cbb1b982014c0b59900f165b4fb867' as Cardano.Credential['hash'] };
const poolId = Cardano.PoolId('pool1nmfr5j5rnqndprtazre802glpc3h865sy50mxdny65kfgf3e5eh');
const dRep = { __typename: 'AlwaysAbstain' } as Cardano.AlwaysAbstain;
const deposit = 2_000_000n;

const COMBINED = [
  Cardano.CertificateType.StakeVoteDelegation,
  Cardano.CertificateType.StakeRegistrationDelegation,
  Cardano.CertificateType.VoteRegistrationDelegation,
  Cardano.CertificateType.StakeVoteRegistrationDelegation,
];

describe('signsSeparateStakeCertificates', () => {
  it.each([WalletType.Ledger, WalletType.Trezor])('is true for %s', type => {
    expect(signsSeparateStakeCertificates(type)).toBe(true);
  });

  it.each([WalletType.Normal, WalletType.Keystone, undefined])('is false for %s', type => {
    expect(signsSeparateStakeCertificates(type)).toBe(false);
  });
});

describe('delegationCertificates', () => {
  it.each([
    ['registration + pool + DRep', { registrationDeposit: deposit, poolId, dRep }, [
      { __typename: Cardano.CertificateType.StakeVoteRegistrationDelegation, stakeCredential, poolId, dRep, deposit },
    ]],
    ['registration + DRep', { registrationDeposit: deposit, dRep }, [
      { __typename: Cardano.CertificateType.VoteRegistrationDelegation, stakeCredential, dRep, deposit },
    ]],
    ['pool + DRep', { poolId, dRep }, [
      { __typename: Cardano.CertificateType.StakeVoteDelegation, stakeCredential, poolId, dRep },
    ]],
    ['pool', { poolId }, [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential, poolId }]],
    ['DRep', { dRep }, [{ __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep }]],
  ])('combines %s for a wallet that signs combined certificates', (_, request, expected) => {
    expect(delegationCertificates({ stakeCredential, ...request, separate: false })).toEqual(expected);
  });

  it.each([
    ['registration + pool + DRep', { registrationDeposit: deposit, poolId, dRep }, [
      { __typename: Cardano.CertificateType.Registration, stakeCredential, deposit },
      { __typename: Cardano.CertificateType.StakeDelegation, stakeCredential, poolId },
      { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep },
    ]],
    ['registration + DRep', { registrationDeposit: deposit, dRep }, [
      { __typename: Cardano.CertificateType.Registration, stakeCredential, deposit },
      { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep },
    ]],
    ['pool + DRep', { poolId, dRep }, [
      { __typename: Cardano.CertificateType.StakeDelegation, stakeCredential, poolId },
      { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep },
    ]],
    ['pool', { poolId }, [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential, poolId }]],
    ['DRep', { dRep }, [{ __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep }]],
  ])('separates %s, registration first', (_, request, expected) => {
    const certificates = delegationCertificates({ stakeCredential, ...request, separate: true });
    expect(certificates).toEqual(expected);
    expect(certificates.some(c => COMBINED.includes(c.__typename))).toBe(false);
  });

  it.each([false, true])('locks the same deposit either way (separate: %s)', separate => {
    const certificates = delegationCertificates({ stakeCredential, registrationDeposit: deposit, poolId, dRep, separate });
    expect(stakeRegistrationDeposit(certificates)).toBe(deposit);
  });
});

describe('stakeRegistrationDeposit', () => {
  it('reads the deposit of a separate or combined registration', () => {
    expect(stakeRegistrationDeposit([
      { __typename: Cardano.CertificateType.Registration, stakeCredential, deposit },
      { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep },
    ])).toBe(deposit);
    expect(stakeRegistrationDeposit([
      { __typename: Cardano.CertificateType.VoteRegistrationDelegation, stakeCredential, dRep, deposit },
    ])).toBe(deposit);
  });

  it('is zero without a registration', () => {
    expect(stakeRegistrationDeposit([{ __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep }])).toBe(0n);
    expect(stakeRegistrationDeposit([{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential }])).toBe(0n);
    expect(stakeRegistrationDeposit(undefined)).toBe(0n);
  });
});
