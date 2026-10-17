// A hardware wallet record holds one account of the device. Ledger and Trezor are sent
// full BIP-32 paths, so every path in what the device is asked to sign must be under that
// account: its inputs, its change output, its certificate and extra-witness keys. These
// sign the wallet's own transaction (its input, change back to it, a vote delegation of its
// stake key) for a wallet on account #1, and check that nothing in the device request says 0'.
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { bech32 } from 'bech32';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { CommunicationType, KeyPurpose } from '@cardano-sdk/key-management';
import type { MessageData, SignTransactionRequest } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import type Transport from '@ledgerhq/hw-transport';
import type * as Trezor from '@trezor/connect';
import { Blockchain, Keys, Network } from '@/models/types';
import networks from '@/utils/networks';
import { WALLET_ACCOUNT_XPUB, WALLET_ADDRESS } from '@/shared/utils/__fixtures__/handAssembledTxs';
import { InvalidAccountIndexError } from '@/shared/utils/walletAccount';

// Both Trezor modules read chrome.runtime.id as they load (TREZOR_MANIFEST).
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension-id' } };
});
const { connectWebextension, connectWeb } = vi.hoisted(() => {
  const connect = () => ({ init: vi.fn(async () => undefined), cardanoSignTransaction: vi.fn() });
  return { connectWebextension: connect(), connectWeb: connect() };
});
vi.mock('@trezor/connect-webextension', () => ({ default: connectWebextension }));
vi.mock('@trezor/connect-web', () => ({ default: connectWeb }));
// See trezor.datum.spec.ts: the package entry cannot load under the Node CI pins.
vi.mock('@trezor/connect', async () => ({ PROTO: (await import('@trezor/connect/lib/constants')).PROTO }));

import ledgerUtils from './ledger';
import trezor from './trezor';
import trezorWeb from './trezorWeb';

const STAKE_ADDRESS = 'stake1uy3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsflrjnr';

const keysOnAccount = (account: number): Keys => ({
  payment: [{ address: WALLET_ADDRESS, cred: '11'.repeat(28), path: `m/1852'/1815'/${account}'/0/0` }],
  change: [],
  stake: [{ address: STAKE_ADDRESS, cred: '22'.repeat(28), path: `m/1852'/1815'/${account}'/2/0` }],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
});
const UTXOS: Cardano.Utxo[] = [
  [
    { txId: Cardano.TransactionId('aa'.repeat(32)), index: 0, address: Cardano.PaymentAddress(WALLET_ADDRESS) },
    { address: Cardano.PaymentAddress(WALLET_ADDRESS), value: { coins: 10_000_000n } },
  ],
];
const MAINNET = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);

/**
 * `[body, {}, true, null]`: spends the wallet's input (aa…#0), returns change to it, and
 * delegates its stake key's vote to Abstain, so the device needs the stake key too.
 */
const OWN_TX = [
  '84a4',
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81825839${Cardano.Address.fromBech32(WALLET_ADDRESS).toBytes()}1a004c4b40`, // outputs: change
  '02 1a00030d40', // fee
  `04 81 8309 8200581c${'22'.repeat(28)} 8102`, // certificates: vote delegation to Abstain
  'a0 f5 f6',
].join('').replace(/ /g, '');
/** The device answers with witnesses its xpub (the wallet's) verifies. */
const XPUB = bech32.encode('xpub', bech32.toWords(Buffer.from(WALLET_ACCOUNT_XPUB, 'hex')), 1023);
const OWN_TX_ID = Serialization.Transaction.fromCbor(Serialization.TxCBOR(OWN_TX)).getId();
const ownTx = () => Serialization.Transaction.fromCbor(Serialization.TxCBOR(OWN_TX)).toCore();

/** Every BIP-32 path string in a device request. */
function pathStrings(request: unknown): string[] {
  return (JSON.stringify(request).match(/m\/1852'\/1815'\/\d+'[^"]*/g) ?? []);
}

const HARDENED = 0x80000000;
/** Every numeric BIP-32 path (Ledger's form) in a device request, as m/… strings. */
function numericPaths(request: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      if (value.length >= 3 && value.every((n) => typeof n === 'number') && value[0] === HARDENED + 1852) {
        found.push(`m/${(value as number[]).map((n) => (n >= HARDENED ? `${n - HARDENED}'` : `${n}`)).join('/')}`);
        return;
      }
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(request);
  return found;
}

beforeAll(() => {
  // The input resolvers log each input the wallet does not own.
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

type SignTransaction = typeof trezor.signTransaction;
const TREZOR_SIGNERS: [string, { cardanoSignTransaction: Mock }, SignTransaction][] = [
  ['trezor (service worker)', connectWebextension, (...args) => trezor.signTransaction(...args)],
  ['trezorWeb (document)', connectWeb, (...args) => trezorWeb.cardanoSignTransaction(...args)],
];

describe.each(TREZOR_SIGNERS)('%s on account #1', (_, connect, signTransaction) => {
  async function deviceRequest(keys: Keys): Promise<Trezor.CardanoSignTransaction & { additionalWitnessRequests?: string[] }> {
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: OWN_TX_ID, witnesses: [] } });
    await signTransaction(ownTx(), keys, UTXOS, false, MAINNET, XPUB, OWN_TX);
    return connect.cardanoSignTransaction.mock.lastCall![0];
  }

  it('asks for the input, the change output and the stake witness under account 1', async () => {
    const request = await deviceRequest(keysOnAccount(1));

    expect(request.inputs[0].path).toBe("m/1852'/1815'/1'/0/0");
    expect(request.outputs[0]).toMatchObject({
      addressParameters: { path: "m/1852'/1815'/1'/0/0", stakingPath: "m/1852'/1815'/1'/2/0" },
    });
    expect(request.certificates?.[0].path).toBe("m/1852'/1815'/1'/2/0");
    expect(request.additionalWitnessRequests).toEqual(["m/1852'/1815'/1'/2/0"]);
    expect(pathStrings(request).filter((path) => !path.startsWith("m/1852'/1815'/1'/"))).toEqual([]);
  });

  it('keeps an account 0 wallet’s paths under account 0', async () => {
    const request = await deviceRequest(keysOnAccount(0));

    expect(request.inputs[0].path).toBe("m/1852'/1815'/0'/0/0");
    expect(pathStrings(request).filter((path) => !path.startsWith("m/1852'/1815'/0'/"))).toEqual([]);
  });

  it('refuses a key set that spans two accounts', async () => {
    const mixed = { ...keysOnAccount(1), stake: keysOnAccount(0).stake };
    await expect(signTransaction(ownTx(), mixed, UTXOS, false, MAINNET, XPUB, OWN_TX))
      .rejects.toThrow(InvalidAccountIndexError);
  });
});

describe('Ledger on account #1', () => {
  let bip32Ed25519: Crypto.Bip32Ed25519;
  beforeAll(async () => {
    bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A connected Ledger holding whatever account the agent is created for. */
  function connectedLedger() {
    vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue({ decorateAppAPIMethods: vi.fn() } as unknown as Transport);
    vi.spyOn(ledgerUtils, 'ensureLedgerVersion').mockResolvedValue(undefined);
    vi.spyOn(LedgerKeyAgent, 'createDeviceConnection').mockResolvedValue({} as never);
    const createWithDevice = vi.spyOn(LedgerKeyAgent, 'createWithDevice').mockImplementation(
      async ({ chainId, accountIndex }) =>
        new LedgerKeyAgent(
          {
            accountIndex,
            chainId,
            communicationType: CommunicationType.Web,
            extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB),
            purpose: KeyPurpose.STANDARD,
          },
          { bip32Ed25519, logger: console },
        ),
    );
    const signTransaction = vi.fn(async (_request: SignTransactionRequest) => ({
      txHashHex: OWN_TX_ID,
      witnesses: [],
      auxiliaryDataSupplement: null,
    }));
    const signMessage = vi.fn(async (_request: MessageData) => ({
      signatureHex: 'ab'.repeat(64),
      signingPublicKeyHex: 'cd'.repeat(32),
      addressFieldHex: Cardano.Address.fromBech32(WALLET_ADDRESS).toBytes(),
    }));
    vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction, signMessage } as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    return { createWithDevice, signTransaction };
  }

  it('opens the device at account 1 and asks for every key under it', async () => {
    const { createWithDevice, signTransaction } = connectedLedger();

    await ledgerUtils.txToLedger(ownTx(), keysOnAccount(1), UTXOS, true, MAINNET, OWN_TX);

    expect(createWithDevice.mock.lastCall![0]).toMatchObject({ accountIndex: 1 });
    const paths = numericPaths(signTransaction.mock.lastCall![0]);
    expect(paths).toEqual(expect.arrayContaining(["m/1852'/1815'/1'/0/0", "m/1852'/1815'/1'/2/0"]));
    expect(paths.filter((path) => !path.startsWith("m/1852'/1815'/1'/"))).toEqual([]);
  });

  it('builds known addresses on the wallet’s account', () => {
    const known = ledgerUtils.createKnownAddressesFromKeys(keysOnAccount(1), MAINNET);
    expect(known.length).toBeGreaterThan(0);
    expect(known.every((address) => address.accountIndex === 1)).toBe(true);
  });

  it('witnesses a pool owner on account 1', async () => {
    const { createWithDevice } = connectedLedger();

    await ledgerUtils.poolOwnerWitness(ownTx(), keysOnAccount(1), UTXOS, true, MAINNET).catch(() => undefined);

    expect(createWithDevice.mock.lastCall![0]).toMatchObject({ accountIndex: 1 });
  });
});
