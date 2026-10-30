import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import type { Keys } from '@/models/types';
import { rewardAccountKeyHash, stakeKeyFor, walletWitnessPlan } from './keyCreds';

// Synthetic hashes, never a real wallet's keys.
const STAKE = 'a3'.repeat(28);
const OTHER = 'b4'.repeat(28);
const rewardAccount = (hash: string, type = Cardano.CredentialType.KeyHash) => Cardano.RewardAddress.fromCredentials(
  Cardano.NetworkId.Testnet, { type, hash: hash as Cardano.Credential['hash'] },
).toAddress().toBech32() as Cardano.RewardAccount;
const STAKE_PATH = "m/1852'/1815'/1'/2/0";
const tx = (body: Partial<Cardano.TxBody>) => ({ body: { inputs: [], outputs: [], fee: 0n, ...body } }) as unknown as Cardano.Tx;

describe('stakeKeyFor', () => {
  const byCred = { stake: [{ address: rewardAccount(OTHER), cred: STAKE, path: STAKE_PATH }] } as Partial<Keys>;

  it('finds the stake key carrying a reward account\'s key hash', () => {
    expect(stakeKeyFor(byCred, rewardAccount(STAKE))?.path).toBe(STAKE_PATH);
    expect(stakeKeyFor(byCred, rewardAccount(STAKE.toUpperCase()))?.path).toBe(STAKE_PATH);
  });

  it('finds the stake key at the reward address only when it carries no other hash', () => {
    const credless = { stake: [{ address: rewardAccount(OTHER), cred: '', path: STAKE_PATH }] } as Partial<Keys>;
    expect(stakeKeyFor(credless, rewardAccount(OTHER))?.path).toBe(STAKE_PATH);
    expect(stakeKeyFor(byCred, rewardAccount(OTHER))).toBeUndefined();
  });

  it('finds none for a script\'s reward account, an unparseable one, or a missing key set', () => {
    expect(rewardAccountKeyHash(rewardAccount(STAKE, Cardano.CredentialType.ScriptHash))).toBeUndefined();
    expect(stakeKeyFor(byCred, rewardAccount(STAKE, Cardano.CredentialType.ScriptHash))).toBeUndefined();
    expect(stakeKeyFor(byCred, 'stake_test1notanaddress')).toBeUndefined();
    expect(stakeKeyFor(null, rewardAccount(STAKE))).toBeUndefined();
  });
});

describe('walletWitnessPlan', () => {
  it('flags the pool cold key for a pool registration, a retirement and a pool\'s vote', () => {
    const registration = { __typename: Cardano.CertificateType.PoolRegistration, poolParameters: { owners: [] } } as unknown as Cardano.Certificate;
    const retirement = { __typename: Cardano.CertificateType.PoolRetirement } as unknown as Cardano.Certificate;
    const poolVote = [{ voter: { __typename: Cardano.VoterType.stakePoolKeyHash, credential: { type: Cardano.CredentialType.KeyHash, hash: OTHER } }, votes: [] }];
    expect(walletWitnessPlan(tx({ certificates: [registration] }), {}, []).needsPoolColdKey).toBe(true);
    expect(walletWitnessPlan(tx({ certificates: [retirement] }), {}, []).needsPoolColdKey).toBe(true);
    expect(walletWitnessPlan(tx({ votingProcedures: poolVote } as never), {}, []).needsPoolColdKey).toBe(true);
    expect(walletWitnessPlan(tx({}), {}, []).needsPoolColdKey).toBe(false);
  });

  it('lists one witness per key hash, with the role its first signer gives it', () => {
    const keys = { stake: [{ address: rewardAccount(STAKE), cred: STAKE, path: STAKE_PATH }] } as Partial<Keys>;
    const plan = walletWitnessPlan(tx({
      withdrawals: [{ stakeAddress: rewardAccount(STAKE), quantity: 1n }],
      requiredExtraSignatures: [Ed25519KeyHashHex(STAKE).toUpperCase() as Ed25519KeyHashHex, Ed25519KeyHashHex(OTHER)],
    }), keys, []);
    expect(plan.witnesses.map(({ keyHash, role, key }) => ({ keyHash, role, path: key.path }))).toEqual([{ keyHash: STAKE, role: 'stake', path: STAKE_PATH }]);
  });
});
