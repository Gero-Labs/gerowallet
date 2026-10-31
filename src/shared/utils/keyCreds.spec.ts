import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import type { Keys } from '@/models/types';
import { isMarkedToFail, keyAtAddress, rewardAccountKeyHash, stakeKeyFor, walletWitnessPlan } from './keyCreds';

// Synthetic hashes, never a real wallet's keys.
const STAKE = 'a3'.repeat(28);
const OTHER = 'b4'.repeat(28);
const PAYMENT = 'c5'.repeat(28);
const keyCred = (hash: string, type = Cardano.CredentialType.KeyHash) => ({ type, hash: Hash28ByteBase16(hash) });
const rewardAccount = (hash: string, type = Cardano.CredentialType.KeyHash, network = Cardano.NetworkId.Testnet) =>
  Cardano.RewardAddress.fromCredentials(network, keyCred(hash, type)).toAddress().toBech32() as Cardano.RewardAccount;
const baseAddress = (payment: string) => Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, keyCred(payment), keyCred(STAKE))
  .toAddress().toBech32() as Cardano.PaymentAddress;
const enterpriseAddress = (payment: string) => Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, keyCred(payment))
  .toAddress().toBech32() as Cardano.PaymentAddress;
const STAKE_PATH = "m/1852'/1815'/1'/2/0";
const PAYMENT_PATH = "m/1852'/1815'/1'/0/0";
const OTHER_PATH = "m/1852'/1815'/1'/0/1";
const tx = (body: Partial<Cardano.TxBody>, isValid?: boolean) =>
  ({ body: { inputs: [], outputs: [], fee: 0n, ...body }, ...(isValid === undefined ? {} : { isValid }) }) as unknown as Cardano.Tx;
const utxo = (index: number, address: Cardano.PaymentAddress): Cardano.Utxo => [
  { txId: Cardano.TransactionId('11'.repeat(32)), index, address },
  { address, value: { coins: 5_000_000n } },
];

describe('stakeKeyFor', () => {
  const byCred = { stake: [{ address: rewardAccount(OTHER), cred: STAKE, path: STAKE_PATH }] } as Partial<Keys>;

  it('finds the stake key carrying a reward account\'s key hash', () => {
    expect(stakeKeyFor(byCred, rewardAccount(STAKE))?.path).toBe(STAKE_PATH);
    expect(stakeKeyFor(byCred, rewardAccount(STAKE.toUpperCase()))?.path).toBe(STAKE_PATH);
  });

  it('finds the stake key at the reward address only when it carries no hash', () => {
    const credless = { stake: [{ address: rewardAccount(OTHER), cred: '', path: STAKE_PATH }] } as Partial<Keys>;
    expect(stakeKeyFor(credless, rewardAccount(OTHER))?.path).toBe(STAKE_PATH);
    expect(stakeKeyFor(byCred, rewardAccount(OTHER))).toBeUndefined();
  });

  it('finds none for the same key hash on another network', () => {
    const testnet = { stake: [{ address: rewardAccount(STAKE), cred: STAKE, path: STAKE_PATH }] } as Partial<Keys>;
    expect(stakeKeyFor(testnet, rewardAccount(STAKE, Cardano.CredentialType.KeyHash, Cardano.NetworkId.Mainnet))).toBeUndefined();
  });

  it('finds none for a script\'s reward account, an unparseable one, or a missing key set', () => {
    expect(rewardAccountKeyHash(rewardAccount(STAKE, Cardano.CredentialType.ScriptHash))).toBeUndefined();
    expect(stakeKeyFor(byCred, rewardAccount(STAKE, Cardano.CredentialType.ScriptHash))).toBeUndefined();
    expect(stakeKeyFor(byCred, 'stake_test1notanaddress')).toBeUndefined();
    expect(stakeKeyFor(null, rewardAccount(STAKE))).toBeUndefined();
  });
});

describe('keyAtAddress', () => {
  const keys = { payment: [{ address: baseAddress(PAYMENT), cred: PAYMENT, path: PAYMENT_PATH }] } as Partial<Keys>;

  it('finds the key at an address, else the one carrying its payment key hash', () => {
    expect(keyAtAddress(keys, baseAddress(PAYMENT))?.path).toBe(PAYMENT_PATH);
    // The enterprise address of the same key is in no key list.
    expect(keyAtAddress(keys, enterpriseAddress(PAYMENT))?.path).toBe(PAYMENT_PATH);
  });

  it('prefers a key with a path to one without for the same hash', () => {
    const shadowed = { payment: [{ address: '', cred: PAYMENT, path: '' }], change: [{ address: 'addr_test_change', cred: PAYMENT, path: PAYMENT_PATH }] } as Partial<Keys>;
    expect(keyAtAddress(shadowed, enterpriseAddress(PAYMENT))?.path).toBe(PAYMENT_PATH);
  });

  it('finds none for a key the key set doesn\'t carry or a script-locked address', () => {
    expect(keyAtAddress(keys, enterpriseAddress(OTHER))).toBeUndefined();
    const script = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, keyCred(PAYMENT, Cardano.CredentialType.ScriptHash))
      .toAddress().toBech32();
    expect(keyAtAddress(keys, script)).toBeUndefined();
  });
});

describe('walletWitnessPlan', () => {
  const keys = {
    payment: [
      { address: baseAddress(PAYMENT), cred: PAYMENT, path: PAYMENT_PATH },
      // No hash: an older key set's. The collateral witness takes it from the address.
      { address: baseAddress(OTHER), cred: '', path: OTHER_PATH },
    ],
    stake: [{ address: rewardAccount(STAKE), cred: STAKE, path: STAKE_PATH }],
  } as unknown as Partial<Keys>;
  const utxos = [utxo(0, baseAddress(PAYMENT)), utxo(1, baseAddress(OTHER))];
  const spending = { inputs: [{ txId: utxos[0][0].txId, index: 0 }], collaterals: [{ txId: utxos[1][0].txId, index: 1 }] };

  it('witnesses collateral at a key no input uses, with its hash from the address when the key has none, and the UTxO\'s address', () => {
    expect(walletWitnessPlan(tx(spending), keys, utxos).witnesses.map(({ keyHash, role, key, address }) => ({ keyHash, role, path: key.path, address })))
      .toEqual([{ keyHash: OTHER, role: 'payment', path: OTHER_PATH, address: baseAddress(OTHER) }]);
  });

  // An input's witness authorises a collateral UTxO at the same key, so leaving out the
  // collateral witness can't protect it: the signers refuse the transaction instead.
  it('marks only a transaction whose isValid is false as marked to fail', () => {
    expect(isMarkedToFail(tx(spending, false))).toBe(true);
    expect(isMarkedToFail(tx(spending, true))).toBe(false);
    expect(isMarkedToFail(tx(spending))).toBe(false);
  });

  it('reads no UTxO when none are given', () => {
    expect(walletWitnessPlan(tx(spending), keys, undefined)).toEqual({ inputs: [], witnesses: [] });
  });

  it('witnesses a DRep vote with the DRep key that has a path when another list carries the hash without one', () => {
    const DREP = 'e7'.repeat(28);
    const drepKeys = { drep105: [{ cred: DREP, path: '' }], drep129: [{ cred: DREP, path: "m/1852'/1815'/1'/3/0" }] } as unknown as Partial<Keys>;
    const vote = [{ voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: keyCred(DREP) }, votes: [] }];
    expect(walletWitnessPlan(tx({ votingProcedures: vote } as never), drepKeys, []).witnesses.map(({ key }) => key.path)).toEqual(["m/1852'/1815'/1'/3/0"]);
  });

  it('gives a MIR certificate naming the stake credential no stake witness', () => {
    const mir = { __typename: Cardano.CertificateType.MIR, kind: Cardano.MirCertificateKind.ToStakeCreds, stakeCredential: keyCred(STAKE), quantity: 1n, pot: Cardano.MirCertificatePot.Reserves };
    expect(walletWitnessPlan(tx({ certificates: [mir as Cardano.Certificate] }), keys, []).witnesses).toEqual([]);
  });

  it('lists one witness per key hash, with the role its first signer gives it', () => {
    const plan = walletWitnessPlan(tx({
      withdrawals: [{ stakeAddress: rewardAccount(STAKE), quantity: 1n }],
      requiredExtraSignatures: [Ed25519KeyHashHex(STAKE).toUpperCase() as Ed25519KeyHashHex, Ed25519KeyHashHex('d6'.repeat(28))],
    }), keys, []);
    expect(plan.witnesses.map(({ keyHash, role, key }) => ({ keyHash, role, path: key.path }))).toEqual([{ keyHash: STAKE, role: 'stake', path: STAKE_PATH }]);
  });
});
