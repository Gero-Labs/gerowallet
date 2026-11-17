import { Cardano } from '@cardano-sdk/core';
import { WalletType } from '@/models/types';

/**
 * Whether the wallet's signer needs separate Conway stake certificates instead of the
 * combined ones (`StakeVoteDelegation`, `StakeRegistrationDelegation`,
 * `VoteRegistrationDelegation`, `StakeVoteRegistrationDelegation`).
 *
 * Trezor maps none of the combined certificates. Ledger's Cardano app 7 refuses them all
 * before anything reaches the device (ledgerjs: "Combined certificate not supported");
 * app 8 signs both shapes, so every Ledger gets separate certificates and nothing has to
 * ask the device for its app version first (issue 1431).
 */
export function signsSeparateStakeCertificates(walletType: string | undefined): boolean {
  return walletType === WalletType.Ledger || walletType === WalletType.Trezor;
}

export interface DelegationCertificateRequest {
  stakeCredential: Cardano.Credential;
  /** Register the stake key first, locking this deposit. */
  registrationDeposit?: bigint;
  poolId?: Cardano.PoolId;
  dRep?: Cardano.DelegateRepresentative;
  /** `signsSeparateStakeCertificates` for the signing wallet. */
  separate: boolean;
}

/**
 * The certificates of a registration, pool delegation and/or vote delegation of one stake
 * credential: one combined certificate, or with `separate` the individual ones in the
 * order Nexus emits them (registration, pool, vote). Both shapes lock the same deposit.
 */
export function delegationCertificates(request: DelegationCertificateRequest): Cardano.Certificate[] {
  const { stakeCredential, registrationDeposit: deposit, poolId, dRep } = request;
  const register = deposit !== undefined;

  if (request.separate) {
    const certificates: Cardano.Certificate[] = [];
    if (register) certificates.push({ __typename: Cardano.CertificateType.Registration, stakeCredential, deposit });
    if (poolId) certificates.push({ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential, poolId });
    if (dRep) certificates.push({ __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep });
    return certificates;
  }

  if (register && poolId && dRep) {
    return [{ __typename: Cardano.CertificateType.StakeVoteRegistrationDelegation, stakeCredential, poolId, dRep, deposit }];
  }
  if (register && poolId) {
    return [{ __typename: Cardano.CertificateType.StakeRegistrationDelegation, stakeCredential, poolId, deposit }];
  }
  if (register && dRep) {
    return [{ __typename: Cardano.CertificateType.VoteRegistrationDelegation, stakeCredential, dRep, deposit }];
  }
  if (register) return [{ __typename: Cardano.CertificateType.Registration, stakeCredential, deposit }];
  if (poolId && dRep) return [{ __typename: Cardano.CertificateType.StakeVoteDelegation, stakeCredential, poolId, dRep }];
  if (poolId) return [{ __typename: Cardano.CertificateType.StakeDelegation, stakeCredential, poolId }];
  if (dRep) return [{ __typename: Cardano.CertificateType.VoteDelegation, stakeCredential, dRep }];
  return [];
}

/**
 * The deposit a stake key registration among `certificates` locks, separate or combined;
 * 0 without one. The legacy `StakeRegistration` carries no deposit field.
 */
export function stakeRegistrationDeposit(certificates: readonly Cardano.Certificate[] | undefined): bigint {
  const registration = certificates?.find(cert => Cardano.isCertType(cert, Cardano.StakeRegistrationCertificateTypes));
  return registration && 'deposit' in registration ? BigInt(registration.deposit ?? 0n) : 0n;
}
