import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { decodeCredential, decodeHash28, type CredentialView } from './address';
import { readArray, readSet, readUint, type Bytes } from './cbor';
import type { DecodeContext } from './context';
import { FieldRefusal, type RefusalCode } from './refusals';

/**
 * Certificates (body key 4). Rendered: stake registration, stake pool delegation, the two
 * together, and deregistration, in their Shelley and Conway encodings, each with the deposit it
 * pays or the refund it returns. Every other tag refuses by name. Tags are the Conway CDDL's
 * (the SDK's internal `CertificateKind` uses the same numbers, which is not exported).
 *
 * Deposits: a Conway certificate states its amount; a Shelley one does not, and pays (or
 * returns) the protocol's `keyDeposit`, which the caller supplies. Either way the balance check
 * holds the body to the amount shown.
 */

export interface DepositView {
  lovelace: bigint;
  /** `body`: stated in the certificate (Conway). `protocol`: the stake key deposit the caller gave (Shelley form). */
  source: 'body' | 'protocol';
}

export interface PoolView {
  /** The complete bech32 pool id (pool1…). */
  poolId: string;
  /** The pool's operator key hash, lower-case hex. */
  keyHash: string;
}

export type CertificateView =
  | { kind: 'stake_registration'; form: 'shelley' | 'conway'; credential: CredentialView; deposit: DepositView }
  | { kind: 'stake_deregistration'; form: 'shelley' | 'conway'; credential: CredentialView; refund: DepositView }
  | { kind: 'stake_delegation'; credential: CredentialView; pool: PoolView }
  | { kind: 'stake_registration_delegation'; credential: CredentialView; pool: PoolView; deposit: DepositView };

/** Certificate tags of the Conway CDDL. */
export const Kind = {
  StakeRegistration: 0,
  StakeDeregistration: 1,
  StakeDelegation: 2,
  PoolRegistration: 3,
  PoolRetirement: 4,
  GenesisKeyDelegation: 5,
  MoveInstantaneousRewards: 6,
  Registration: 7,
  Unregistration: 8,
  VoteDelegation: 9,
  StakeVoteDelegation: 10,
  StakeRegistrationDelegation: 11,
  VoteRegistrationDelegation: 12,
  StakeVoteRegistrationDelegation: 13,
  AuthCommitteeHot: 14,
  ResignCommitteeCold: 15,
  DrepRegistration: 16,
  DrepUnregistration: 17,
  UpdateDrep: 18,
} as const;

/** Refused tags and the code each refuses with. A tag not here and not rendered is `certificate_unknown`. */
const REFUSED_TAGS: ReadonlyMap<number, RefusalCode> = new Map<number, RefusalCode>([
  [Kind.PoolRegistration, 'certificate_pool_unsupported'],
  [Kind.PoolRetirement, 'certificate_pool_unsupported'],
  [Kind.VoteDelegation, 'certificate_vote_delegation_unsupported'],
  [Kind.StakeVoteDelegation, 'certificate_vote_delegation_unsupported'],
  [Kind.VoteRegistrationDelegation, 'certificate_vote_delegation_unsupported'],
  [Kind.StakeVoteRegistrationDelegation, 'certificate_vote_delegation_unsupported'],
  [Kind.AuthCommitteeHot, 'certificate_governance_unsupported'],
  [Kind.ResignCommitteeCold, 'certificate_governance_unsupported'],
  [Kind.DrepRegistration, 'certificate_governance_unsupported'],
  [Kind.DrepUnregistration, 'certificate_governance_unsupported'],
  [Kind.UpdateDrep, 'certificate_governance_unsupported'],
  // Genesis key delegation and MIR left the ledger with Conway.
  [Kind.GenesisKeyDelegation, 'certificate_unknown'],
  [Kind.MoveInstantaneousRewards, 'certificate_unknown'],
]);

/** Tags this module renders. */
export const RENDERED_CERTIFICATE_TAGS: readonly number[] = [
  Kind.StakeRegistration,
  Kind.StakeDeregistration,
  Kind.StakeDelegation,
  Kind.Registration,
  Kind.Unregistration,
  Kind.StakeRegistrationDelegation,
];

/** The code a certificate tag refuses with, or null when it is rendered. */
export function certificateTagRefusal(tag: number): RefusalCode | null {
  if (RENDERED_CERTIFICATE_TAGS.includes(tag)) return null;
  return REFUSED_TAGS.get(tag) ?? 'certificate_unknown';
}

function pool(item: Bytes, path: string): PoolView {
  const keyHash = decodeHash28(item, path);
  return { keyHash, poolId: String(Cardano.PoolId.fromKeyHash(Ed25519KeyHashHex(keyHash))) };
}

function protocolDeposit(ctx: DecodeContext, path: string): DepositView {
  if (ctx.stakeKeyDepositLovelace === undefined) throw new FieldRefusal('deposit_unknown', path);
  return { lovelace: ctx.stakeKeyDepositLovelace, source: 'protocol' };
}

function arity(parts: Bytes[], want: number, path: string): void {
  if (parts.length !== want) throw new FieldRefusal('field_malformed', path, 'certificate_length');
}

/** One certificate, rendered or refused. */
export function decodeCertificate(item: Bytes, path: string, ctx: DecodeContext): CertificateView {
  const parts = readArray(item, path);
  if (parts.length === 0) throw new FieldRefusal('field_malformed', path, 'certificate_length');
  const tag = readUint(parts[0], path);
  const refusal = tag > 0xffn ? 'certificate_unknown' : certificateTagRefusal(Number(tag));
  if (refusal) throw new FieldRefusal(refusal, path, `tag_${tag}`);
  const credential = () => decodeCredential(parts[1], `${path}.credential`);
  switch (Number(tag)) {
    case Kind.StakeRegistration:
      arity(parts, 2, path);
      return { kind: 'stake_registration', form: 'shelley', credential: credential(), deposit: protocolDeposit(ctx, path) };
    case Kind.StakeDeregistration:
      arity(parts, 2, path);
      return { kind: 'stake_deregistration', form: 'shelley', credential: credential(), refund: protocolDeposit(ctx, path) };
    case Kind.StakeDelegation:
      arity(parts, 3, path);
      return { kind: 'stake_delegation', credential: credential(), pool: pool(parts[2], `${path}.pool`) };
    case Kind.Registration:
      arity(parts, 3, path);
      return { kind: 'stake_registration', form: 'conway', credential: credential(), deposit: { lovelace: readUint(parts[2], path), source: 'body' } };
    case Kind.Unregistration:
      arity(parts, 3, path);
      return { kind: 'stake_deregistration', form: 'conway', credential: credential(), refund: { lovelace: readUint(parts[2], path), source: 'body' } };
    case Kind.StakeRegistrationDelegation:
      arity(parts, 4, path);
      return {
        kind: 'stake_registration_delegation',
        credential: credential(),
        pool: pool(parts[2], `${path}.pool`),
        deposit: { lovelace: readUint(parts[3], path), source: 'body' },
      };
    default:
      throw new FieldRefusal('certificate_unknown', path, `tag_${tag}`);
  }
}

/** The certificates field: a set of certificates, each rendered or refused on its own. */
export function decodeCertificates(item: Bytes, path: string, ctx: DecodeContext): CertificateView[] {
  const views: CertificateView[] = [];
  const items = readSet(item, path);
  if (items.length === 0) throw new FieldRefusal('field_malformed', path, 'empty');
  items.forEach((cert, i) => {
    const view = ctx.refusals.guard(`${path}[${i}]`, () => decodeCertificate(cert, `${path}[${i}]`, ctx));
    if (view) views.push(view);
  });
  return views;
}

/** Deposits the certificates pay and refunds they return, in lovelace. */
export function certificateDeposits(certificates: readonly CertificateView[]): { paid: bigint; refunded: bigint } {
  let paid = 0n;
  let refunded = 0n;
  for (const cert of certificates) {
    if (cert.kind === 'stake_registration' || cert.kind === 'stake_registration_delegation') paid += cert.deposit.lovelace;
    if (cert.kind === 'stake_deregistration') refunded += cert.refund.lovelace;
  }
  return { paid, refunded };
}
