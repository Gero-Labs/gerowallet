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
