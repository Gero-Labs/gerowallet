// A Trezor signs the wallet's own withdrawal and required signers by key path. The
// key-management helpers return the full BIP32 path, which a { role, index } guard
// never let through, so they went to the device as key hashes (issue 1328).
import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import type * as Trezor from '@trezor/connect';
import { Blockchain, Keys, Network } from '@/models/types';
import networks from '@/utils/networks';
import { WALLET_ACCOUNT_XPUB, WALLET_ADDRESS } from '@/shared/utils/__fixtures__/handAssembledTxs';
import { deviceWitnessPaths } from '@/shared/utils/__fixtures__/trezorDeviceWitnesses';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';
import { MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE, TREZOR_GOVERNANCE_REFUSAL_MESSAGE } from '@/chrome/config';

// Both modules read chrome.runtime.id as they load (TREZOR_MANIFEST).
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension-id' } };
});

// The device, one per Connect flavour: records what it is asked to sign.
const { connectWebextension, connectWeb } = vi.hoisted(() => {
  const connect = () => ({ init: vi.fn(async () => undefined), cardanoSignTransaction: vi.fn() });
  return { connectWebextension: connect(), connectWeb: connect() };
});
vi.mock('@trezor/connect-webextension', () => ({ default: connectWebextension }));
vi.mock('@trezor/connect-web', () => ({ default: connectWeb }));
// As in trezor.datum.spec.ts: the modules only read PROTO from @trezor/connect.
vi.mock('@trezor/connect', async () => ({ PROTO: (await import('@trezor/connect/lib/constants')).PROTO }));

import trezor from './trezor';
import trezorWeb from './trezorWeb';

type SignTransaction = typeof trezor.signTransaction;

const SIGNERS: [string, { cardanoSignTransaction: Mock }, SignTransaction][] = [
  ['trezor (service worker)', connectWebextension, (...args) => trezor.signTransaction(...args)],
  ['trezorWeb (document)', connectWeb, (...args) => trezorWeb.cardanoSignTransaction(...args)],
];

const MAINNET = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
/** An account xpub in the bech32 form the signer reads. */
const XPUB = bech32.encode('xpub', bech32.toWords(Buffer.from(WALLET_ACCOUNT_XPUB, 'hex')), 1023);
// WALLET_ADDRESS is a base address with payment key hash 11… and stake key hash 22….
const PAYMENT_HASH = '11'.repeat(28);
const STAKE_HASH = '22'.repeat(28);
const FOREIGN_HASH = '33'.repeat(28);
const REWARD_ACCOUNT = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
  type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(STAKE_HASH),
}).toAddress().toBech32() as Cardano.RewardAccount;

/** Account #1 of a Trezor: its payment and stake keys, at that account's paths. */
const KEYS: Keys = {
  payment: [{ address: WALLET_ADDRESS, cred: PAYMENT_HASH, path: "m/1852'/1815'/1'/0/0" }],
  change: [],
  stake: [{ address: REWARD_ACCOUNT, cred: STAKE_HASH, path: "m/1852'/1815'/1'/2/0" }],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
};
const INPUT = { txId: Cardano.TransactionId('00'.repeat(32)), index: 0 };
const UTXOS: Cardano.Utxo[] = [[{ ...INPUT, address: Cardano.PaymentAddress(WALLET_ADDRESS) }, { address: Cardano.PaymentAddress(WALLET_ADDRESS), value: { coins: 5_000_000n } }]];

/** Withdraws the wallet's rewards, and names its own keys and a foreign one as required signers. */
const TX: Cardano.Tx = {
  id: Cardano.TransactionId('00'.repeat(32)),
  body: {
    inputs: [INPUT],
    outputs: [{ address: Cardano.PaymentAddress(WALLET_ADDRESS), value: { coins: 5_800_000n } }],
    fee: 200_000n,
    withdrawals: [{ stakeAddress: REWARD_ACCOUNT, quantity: 1_000_000n }],
    requiredExtraSignatures: [PAYMENT_HASH, STAKE_HASH, FOREIGN_HASH].map((hash) => Ed25519KeyHashHex(hash)),
  },
  witness: { signatures: new Map() },
};

// The input resolver logs each input it looks up.
beforeAll(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe.each(SIGNERS)('%s: the wallet’s own keys go to the device by path', (_, connect, signTransaction) => {
  async function deviceRequest(): Promise<Trezor.CardanoSignTransaction> {
    const txId = Serialization.Transaction.fromCore(TX).body().hash();
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: txId, witnesses: [] } });
    // The wallet owns the input, so its witness key is derived from an account xpub.
    await signTransaction(TX, KEYS, UTXOS, false, MAINNET, XPUB);
    return connect.cardanoSignTransaction.mock.lastCall![0];
  }

  it('the withdrawal from the wallet’s reward account, by its stake key path at the account', async () => {
    const { withdrawals } = await deviceRequest();

    expect(withdrawals).toEqual([{ amount: '1000000', path: "m/1852'/1815'/1'/2/0", keyHash: undefined, scriptHash: undefined }]);
  });

  it('its own payment and stake keys as required signers by path, a foreign one by hash', async () => {
    const { requiredSigners } = await deviceRequest();

    expect(requiredSigners).toEqual([
      { keyHash: undefined, keyPath: "m/1852'/1815'/1'/0/0" },
      { keyHash: undefined, keyPath: "m/1852'/1815'/1'/2/0" },
      { keyHash: FOREIGN_HASH, keyPath: undefined },
    ]);
  });
});

// Synthetic hashes, never a real wallet's keys.
const DREP_HASH = '44'.repeat(28);
const CC_COLD_HASH = '55'.repeat(28);
const CC_HOT_HASH = '66'.repeat(28);
const OTHER_PAYMENT_HASH = '77'.repeat(28);
const keyCred = (hash: string, type = Cardano.CredentialType.KeyHash) => ({ type, hash: Hash28ByteBase16(hash) });
/** A second payment key of the wallet, at its own base address: a dApp may take its UTxO as collateral. */
const OTHER_ADDRESS = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, keyCred(OTHER_PAYMENT_HASH), keyCred(STAKE_HASH))
  .toAddress().toBech32() as Cardano.PaymentAddress;
/** The enterprise address of the first payment key: in no key list, signed for by that key. */
const ENTERPRISE_ADDRESS = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, keyCred(PAYMENT_HASH))
  .toAddress().toBech32() as Cardano.PaymentAddress;
/** KEYS with a second payment key and the DRep and committee keys, all on account #1. */
const FULL_KEYS: Keys = {
  ...KEYS,
  payment: [...KEYS.payment, { address: OTHER_ADDRESS, cred: OTHER_PAYMENT_HASH, path: "m/1852'/1815'/1'/0/1" }],
  drep129: [{ address: 'drep1synthetic', cred: DREP_HASH, path: "m/1852'/1815'/1'/3/0" }],
  ccCold: [{ cred: CC_COLD_HASH, path: "m/1852'/1815'/1'/4/0" }],
  ccHot: [{ cred: CC_HOT_HASH, path: "m/1852'/1815'/1'/5/0" }],
};
const COLLATERAL_IN = { txId: Cardano.TransactionId('01'.repeat(32)), index: 0 };
const ENTERPRISE_IN = { txId: Cardano.TransactionId('02'.repeat(32)), index: 0 };
const FULL_UTXOS: Cardano.Utxo[] = [
  ...UTXOS,
  [{ ...COLLATERAL_IN, address: OTHER_ADDRESS }, { address: OTHER_ADDRESS, value: { coins: 5_000_000n } }],
  [{ ...ENTERPRISE_IN, address: ENTERPRISE_ADDRESS }, { address: ENTERPRISE_ADDRESS, value: { coins: 5_000_000n } }],
];
const SCRIPT_HASH = 'cc'.repeat(28);
const stakeCertificate = (__typename: Cardano.CertificateType, stakeCredential: Cardano.Credential): Cardano.Certificate => {
  switch (__typename) {
    case Cardano.CertificateType.VoteDelegation:
      return { __typename, stakeCredential, dRep: { __typename: 'AlwaysAbstain' } };
    case Cardano.CertificateType.StakeDelegation:
      return { __typename, stakeCredential, poolId: Cardano.PoolId.fromKeyHash(Ed25519KeyHashHex('12'.repeat(28))) };
    case Cardano.CertificateType.Registration:
      return { __typename, stakeCredential, deposit: 2_000_000n };
    default:
      return { __typename, stakeCredential } as Cardano.Certificate;
  }
};
const txWith = (body: Partial<Cardano.TxBody>, isValid?: boolean): Cardano.Tx => ({
  ...TX,
  body: { inputs: [INPUT], outputs: TX.body.outputs, fee: TX.body.fee, ...body },
  ...(isValid === undefined ? {} : { isValid }),
});

describe.each(SIGNERS)('%s: the shared witness plan decides which keys sign', (_, connect, signTransaction) => {
  async function deviceRequest(tx: Cardano.Tx, keys: Keys = FULL_KEYS, witnesses: Array<{ pubKey: string; signature: string }> = []) {
    const txId = Serialization.Transaction.fromCore(tx).body().hash();
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: txId, witnesses } });
    const signatures = await signTransaction(tx, keys, FULL_UTXOS, false, MAINNET, XPUB);
    return { request: connect.cardanoSignTransaction.mock.lastCall![0] as Trezor.CardanoSignTransaction, signatures };
  }

  // The software signer (and the fee estimate) follow the plan, so a Trezor is asked for exactly
  // the keys the fee was sized for.
  it('witnesses the keys the software signer signs with', async () => {
    const bodies: Array<Partial<Cardano.TxBody>> = [
      TX.body,
      { certificates: [stakeCertificate(Cardano.CertificateType.VoteDelegation, keyCred(STAKE_HASH)), stakeCertificate(Cardano.CertificateType.Registration, keyCred(STAKE_HASH))] },
      // A pre-Conway registration needs no witness on chain, and the plan still witnesses it.
      { certificates: [stakeCertificate(Cardano.CertificateType.StakeRegistration, keyCred(STAKE_HASH))] },
      // A Plutus transaction: collateral at a key no input uses, and certificates of another key and a script.
      {
        collaterals: [COLLATERAL_IN],
        certificates: [
          stakeCertificate(Cardano.CertificateType.StakeDelegation, keyCred(FOREIGN_HASH)),
          stakeCertificate(Cardano.CertificateType.VoteDelegation, keyCred(SCRIPT_HASH, Cardano.CredentialType.ScriptHash)),
        ],
        requiredExtraSignatures: [DREP_HASH, CC_COLD_HASH, CC_HOT_HASH, FOREIGN_HASH].map((hash) => Ed25519KeyHashHex(hash)),
      },
      { inputs: [ENTERPRISE_IN], withdrawals: [{ stakeAddress: REWARD_ACCOUNT, quantity: 0n }] },
    ];
    for (const body of bodies) {
      const tx = txWith(body);
      const { request } = await deviceRequest(tx);
      const software = analyzeTransactionForSignatures(tx, FULL_UTXOS, FULL_KEYS).map(({ derivationPath }) => `m/1852'/1815'/1'/${derivationPath.join('/')}`);
      expect(new Set(deviceWitnessPaths(request))).toEqual(new Set(software));
    }
  });

  // Mapped to the wallet's stake path, the device would build the certificate for the wallet's
  // own credential: a different body from the one the dApp built, signed with the stake key.
  it('gives the device another key’s or a script’s stake credential by its hash, the wallet’s by its path', async () => {
    const { request } = await deviceRequest(txWith({
      collaterals: [COLLATERAL_IN],
      certificates: [
        stakeCertificate(Cardano.CertificateType.StakeDelegation, keyCred(FOREIGN_HASH)),
        stakeCertificate(Cardano.CertificateType.VoteDelegation, keyCred(SCRIPT_HASH, Cardano.CredentialType.ScriptHash)),
        stakeCertificate(Cardano.CertificateType.StakeDeregistration, keyCred(STAKE_HASH)),
      ],
    }));

    expect(request.certificates?.map(({ path, keyHash, scriptHash }) => ({ path, keyHash, scriptHash }))).toEqual([
      { path: undefined, keyHash: FOREIGN_HASH, scriptHash: undefined },
      { path: undefined, keyHash: undefined, scriptHash: SCRIPT_HASH },
      { path: "m/1852'/1815'/1'/2/0", keyHash: undefined, scriptHash: undefined },
    ]);
    // The input's and the collateral's keys, and the stake key for the wallet's own deregistration only.
    expect(new Set(deviceWitnessPaths(request))).toEqual(new Set(["m/1852'/1815'/1'/0/0", "m/1852'/1815'/1'/0/1", "m/1852'/1815'/1'/2/0"]));
  });

  it('asks for the DRep and committee keys a required signer names by their paths', async () => {
    const { request } = await deviceRequest(txWith({ requiredExtraSignatures: [DREP_HASH, CC_COLD_HASH, CC_HOT_HASH].map((hash) => Ed25519KeyHashHex(hash)) }));

    expect(request.requiredSigners?.map(({ keyPath }) => keyPath)).toEqual(["m/1852'/1815'/1'/3/0", "m/1852'/1815'/1'/4/0", "m/1852'/1815'/1'/5/0"]);
  });

  it('signs an input at an enterprise address of a wallet key with that key', async () => {
    const { request } = await deviceRequest(txWith({ inputs: [ENTERPRISE_IN] }));

    expect(request.inputs).toEqual([{ path: "m/1852'/1815'/1'/0/0", prev_hash: ENTERPRISE_IN.txId, prev_index: 0 }]);
  });

  it('keeps only the witnesses of the keys the plan signs with', async () => {
    const stakeKey = trezor.derivePublicKeyFromXpub(XPUB, { role: 2, index: 0 });
    const unrelated = trezor.derivePublicKeyFromXpub(XPUB, { role: 0, index: 7 });
    const tx = txWith({ withdrawals: [{ stakeAddress: REWARD_ACCOUNT, quantity: 0n }] });
    const { signatures } = await deviceRequest(tx, FULL_KEYS, [
      { pubKey: stakeKey, signature: 'aa'.repeat(64) },
      { pubKey: unrelated, signature: 'bb'.repeat(64) },
    ]);

    expect([...signatures.keys()]).toEqual([stakeKey]);
  });

  describe('refuses before the device is asked', () => {
    it.each([
      ['a transaction marked to fail', txWith({ collaterals: [COLLATERAL_IN] }, false), MARKED_TO_FAIL_SIGN_REFUSAL_MESSAGE],
      ['a governance vote, which the request cannot carry', txWith({
        votingProcedures: [{
          voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(DREP_HASH) } },
          votes: [{ actionId: { id: Cardano.TransactionId('44'.repeat(32)), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
        }],
      }), TREZOR_GOVERNANCE_REFUSAL_MESSAGE],
      ['a treasury donation', txWith({ donation: 1_000_000n }), TREZOR_GOVERNANCE_REFUSAL_MESSAGE],
    ])('%s', async (_name, tx, message) => {
      connect.cardanoSignTransaction.mockClear();
      await expect(signTransaction(tx, FULL_KEYS, FULL_UTXOS, false, MAINNET, XPUB)).rejects.toThrow(message);
      expect(connect.cardanoSignTransaction).not.toHaveBeenCalled();
    });
  });
});
