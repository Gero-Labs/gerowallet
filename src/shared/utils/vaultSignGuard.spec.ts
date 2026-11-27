// The vault guard on its own: which CIP-1854 keys the generic signers may use (rule 1), and what
// of a transaction touches a known vault (rule 2), matched by credential. The signers that run it
// are in vaultHardwareSigners.spec.ts and src/chrome/vaultSign.walletBg.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { VAULT_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import type { Keys } from '@/models/types';

const { knownVaults } = vi.hoisted(() => ({ knownVaults: vi.fn() }));
vi.mock('@/shared/utils/knownVaults', () => ({ knownVaultScriptHashes: knownVaults }));

import {
  assertGenericSigningPaths,
  assertNoVaultSignature,
  findVaultTouch,
  isGenericSigningPath,
  isVaultSignRefusal,
  plannedSigningPaths,
} from './vaultSignGuard';

const H = 0x80000000;
// Synthetic hashes, never a real vault's or wallet's.
const VAULT_PAYMENT = 'a1'.repeat(28);
const VAULT_STAKE = 'a2'.repeat(28);
const WALLET_PAYMENT = '11'.repeat(28);
const WALLET_STAKE = '22'.repeat(28);
const OTHER_STAKE = '33'.repeat(28);

const key = (hash: string) => ({ type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(hash) });
const script = (hash: string) => ({ type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(hash) });
const base = (payment: Cardano.Credential, stake: Cardano.Credential) =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, payment, stake).toAddress().toBech32() as Cardano.PaymentAddress;
const reward = (stake: Cardano.Credential) =>
  Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Mainnet, stake).toAddress().toBech32() as Cardano.RewardAccount;

const WALLET_ADDRESS = base(key(WALLET_PAYMENT), key(WALLET_STAKE));
const VAULT_ADDRESS = base(script(VAULT_PAYMENT), script(VAULT_STAKE));
/** The vault's payment script under another stake part: the same vault, another address. */
const VAULT_PAYMENT_OTHER_STAKE = base(script(VAULT_PAYMENT), key(OTHER_STAKE));
const VAULT_ENTERPRISE = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, script(VAULT_PAYMENT))
  .toAddress().toBech32() as Cardano.PaymentAddress;

const VAULTS = { payment: new Set([VAULT_PAYMENT]), stake: new Set([VAULT_STAKE]) };
const NO_VAULTS = { payment: new Set<string>(), stake: new Set<string>() };

const txIn = (byte: string) => ({ txId: Cardano.TransactionId(byte.repeat(32)), index: 0 });
const WALLET_IN = txIn('f1');
const VAULT_IN = txIn('b1');
const utxo = (input: Cardano.TxIn, address: Cardano.PaymentAddress): Cardano.Utxo =>
  [{ ...input, address }, { address, value: { coins: 5_000_000n } }];

const tx = (body: Partial<Cardano.TxBody>): Cardano.Tx => ({
  id: Cardano.TransactionId('00'.repeat(32)),
  body: { inputs: [WALLET_IN], outputs: [{ address: WALLET_ADDRESS, value: { coins: 2_000_000n } }], fee: 200_000n, ...body },
  witness: { signatures: new Map() },
});

describe('rule 1: the CIP-1854 keys the generic signers may use', () => {
  it.each([
    "m/1854'/1815'/0'/0/0",
    "m/1854'/1815'/7'/0/0",
    "1854'/1815'/0'/0/0",
    [1854 + H, 1815 + H, H, 0, 0],
    [1854 + H, 1815 + H, 3 + H, 0, 0],
  ])('the payment key 0 of an account: %j', (path) => {
    expect(isGenericSigningPath(path)).toBe(true);
  });

  it.each([
    ['payment key 1', "m/1854'/1815'/0'/0/1"],
    ['payment key 2', "m/1854'/1815'/0'/0/2"],
    ['stake key 0', "m/1854'/1815'/0'/2/0"],
    ['stake key 1', "m/1854'/1815'/0'/2/1"],
    ['payment key 1 as numbers', [1854 + H, 1815 + H, H, 0, 1]],
    ['stake key 0 as numbers', [1854 + H, 1815 + H, H, 2, 0]],
    ['another role', "m/1854'/1815'/0'/1/0"],
    ['a hardened role', "m/1854'/1815'/0'/0'/0"],
    ['a hardened index', "m/1854'/1815'/0'/0/0'"],
    ['an unhardened account', "m/1854'/1815'/0/0/0"],
    ['an unhardened purpose', 'm/1854/1815/0/0/0'],
    ['another coin type', "m/1854'/1'/0'/0/0"],
    ['an account key', "m/1854'/1815'/0'"],
    ['a path deeper than a key', "m/1854'/1815'/0'/0/0/0"],
    ['a malformed level', "m/1854'/1815'/x'/0/0"],
  ])('never any other: %s', (_, path) => {
    expect(isGenericSigningPath(path)).toBe(false);
  });

  it.each([
    "m/1852'/1815'/0'/0/1",
    "m/1852'/1815'/0'/2/0",
    "m/1855'/1815'/0'",
    "m/18540'/1815'/0'/0/1",
    [1852 + H, 1815 + H, H, 2, 0],
  ])('leaves every key outside CIP-1854 to the signers: %j', (path) => {
    expect(isGenericSigningPath(path)).toBe(true);
  });

  it('refuses a list with one such key, with the vault refusal, and skips keys with no path', () => {
    expect(() => assertGenericSigningPaths(["m/1852'/1815'/0'/0/0", undefined, '', "m/1854'/1815'/0'/0/0"])).not.toThrow();
    let error: unknown;
    try {
      assertGenericSigningPaths(["m/1852'/1815'/0'/0/0", "m/1854'/1815'/0'/0/1"]);
    } catch (e) {
      error = e;
    }
    expect(error).toEqual(new Error(VAULT_SIGN_REFUSAL_MESSAGE));
    expect(isVaultSignRefusal(error)).toBe(true);
    expect(isVaultSignRefusal(new Error('Device disconnected'))).toBe(false);
  });

  it('reads the keys the shared plan signs with: the input’s key, then each other witness', () => {
    const keys: Keys = {
      payment: [{ address: WALLET_ADDRESS, cred: WALLET_PAYMENT, path: "m/1852'/1815'/0'/0/0" }],
      change: [],
      stake: [{ address: reward(key(WALLET_STAKE)), cred: WALLET_STAKE, path: "m/1854'/1815'/0'/2/0" }],
      script: [], ccCold: [], ccHot: [], drep105: [], drep129: [],
    };
    const paths = plannedSigningPaths(
      tx({ requiredExtraSignatures: [Ed25519KeyHashHex(WALLET_STAKE)] }),
      keys,
      [utxo(WALLET_IN, WALLET_ADDRESS)],
    );

    expect(paths).toEqual(["m/1852'/1815'/0'/0/0", "m/1854'/1815'/0'/2/0"]);
  });
});

describe('rule 2: what touches a known vault, by credential', () => {
  it('a spent input at the vault’s payment script', () => {
    const spend = tx({ inputs: [VAULT_IN, WALLET_IN] });
    expect(findVaultTouch(spend, VAULTS, [utxo(VAULT_IN, VAULT_ADDRESS), utxo(WALLET_IN, WALLET_ADDRESS)]))
      .toEqual([`spends:${VAULT_IN.txId}#0`]);
  });

  it.each([
    ['another stake key', VAULT_PAYMENT_OTHER_STAKE],
    ['no stake part', VAULT_ENTERPRISE],
  ])('a spent input at the vault’s payment script under %s', (_, address) => {
    expect(findVaultTouch(tx({ inputs: [VAULT_IN] }), VAULTS, [utxo(VAULT_IN, address)])).toEqual([`spends:${VAULT_IN.txId}#0`]);
  });

  it('a withdrawal from the vault’s stake script', () => {
    const withdraw = tx({ withdrawals: [{ stakeAddress: reward(script(VAULT_STAKE)), quantity: 1_000_000n }] });
    expect(findVaultTouch(withdraw, VAULTS, [utxo(WALLET_IN, WALLET_ADDRESS)])).toEqual([`withdraws:${reward(script(VAULT_STAKE))}`]);
  });

  it.each([
    ['a stake registration', { __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: script(VAULT_STAKE) }],
    ['a stake delegation', {
      __typename: Cardano.CertificateType.StakeDelegation,
      stakeCredential: script(VAULT_STAKE),
      poolId: Cardano.PoolId.fromKeyHash(Ed25519KeyHashHex('44'.repeat(28))),
    }],
    ['a vote delegation', { __typename: Cardano.CertificateType.VoteDelegation, stakeCredential: script(VAULT_STAKE), dRep: { __typename: 'AlwaysAbstain' } }],
    ['a DRep registration', {
      __typename: Cardano.CertificateType.RegisterDelegateRepresentative,
      dRepCredential: script(VAULT_STAKE),
      deposit: 500_000_000n,
      anchor: null,
    }],
  ])('a certificate under the vault’s stake script: %s', (_, certificate) => {
    const certify = tx({ certificates: [certificate as Cardano.Certificate] });
    expect(findVaultTouch(certify, VAULTS, [utxo(WALLET_IN, WALLET_ADDRESS)])).toEqual(['certificate:0']);
  });

  it('nothing in a payment to the vault: no input of the vault', () => {
    const pay = tx({ outputs: [{ address: VAULT_ADDRESS, value: { coins: 10_000_000n } }, { address: WALLET_ADDRESS, value: { coins: 2_000_000n } }] });
    expect(findVaultTouch(pay, VAULTS, [utxo(WALLET_IN, WALLET_ADDRESS)])).toEqual([]);
  });

  it('nothing for the wallet’s own withdrawal and stake certificate', () => {
    const own = tx({
      withdrawals: [{ stakeAddress: reward(key(WALLET_STAKE)), quantity: 1_000_000n }],
      certificates: [{ __typename: Cardano.CertificateType.StakeRegistration, stakeCredential: key(WALLET_STAKE) }],
    });
    expect(findVaultTouch(own, VAULTS, [utxo(WALLET_IN, WALLET_ADDRESS)])).toEqual([]);
  });

  it('nothing for another script, or with no vault known', () => {
    const other = 'cc'.repeat(28);
    const spend = tx({ inputs: [VAULT_IN], withdrawals: [{ stakeAddress: reward(script(other)), quantity: 1n }] });
    expect(findVaultTouch(spend, VAULTS, [utxo(VAULT_IN, base(script(other), script(other)))])).toEqual([]);
    expect(findVaultTouch(tx({ inputs: [VAULT_IN] }), NO_VAULTS, [utxo(VAULT_IN, VAULT_ADDRESS)])).toEqual([]);
  });

  it('matches hashes whatever their case', () => {
    const upper = { payment: new Set([VAULT_PAYMENT.toUpperCase()]), stake: new Set<string>() };
    expect(findVaultTouch(tx({ inputs: [VAULT_IN] }), upper, [utxo(VAULT_IN, VAULT_ADDRESS)])).toEqual([`spends:${VAULT_IN.txId}#0`]);
  });

  it('reads the stake set for withdrawals and certificates, never the payment set', () => {
    const paymentOnly = { payment: new Set([VAULT_STAKE]), stake: new Set<string>() };
    const withdraw = tx({ withdrawals: [{ stakeAddress: reward(script(VAULT_STAKE)), quantity: 1n }] });
    expect(findVaultTouch(withdraw, paymentOnly, [])).toEqual([]);
  });
});

describe('assertNoVaultSignature', () => {
  const keys: Keys = {
    payment: [{ address: WALLET_ADDRESS, cred: WALLET_PAYMENT, path: "m/1852'/1815'/0'/0/0" }],
    change: [],
    stake: [{ address: reward(key(WALLET_STAKE)), cred: WALLET_STAKE, path: "m/1852'/1815'/0'/2/0" }],
    script: [], ccCold: [], ccHot: [], drep105: [], drep129: [],
  };
  const utxos = [utxo(VAULT_IN, VAULT_ADDRESS), utxo(WALLET_IN, WALLET_ADDRESS)];

  beforeEach(() => {
    knownVaults.mockReset();
    knownVaults.mockResolvedValue(NO_VAULTS);
  });

  it('passes the vault spend while no vault is known', async () => {
    await expect(assertNoVaultSignature(tx({ inputs: [VAULT_IN, WALLET_IN] }), keys, utxos)).resolves.toBeUndefined();
  });

  it('refuses it once the provider knows the vault', async () => {
    knownVaults.mockResolvedValue(VAULTS);
    await expect(assertNoVaultSignature(tx({ inputs: [VAULT_IN, WALLET_IN] }), keys, utxos)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
  });

  it('refuses when the provider cannot answer', async () => {
    knownVaults.mockRejectedValue(new Error('vault store unreadable'));
    await expect(assertNoVaultSignature(tx({}), keys, utxos)).rejects.toThrow('vault store unreadable');
  });

  it('refuses a vault key in the plan without asking the provider', async () => {
    const vaultKey: Keys = { ...keys, payment: [{ ...keys.payment[0], path: "m/1854'/1815'/0'/0/1" }] };
    await expect(assertNoVaultSignature(tx({}), vaultKey, utxos)).rejects.toThrow(VAULT_SIGN_REFUSAL_MESSAGE);
    expect(knownVaults).not.toHaveBeenCalled();
  });
});
