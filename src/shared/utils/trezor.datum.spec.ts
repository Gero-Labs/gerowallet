import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import type * as Trezor from '@trezor/connect';
import { Blockchain, Keys, Network } from '@/models/types';
import networks from '@/utils/networks';
import { INLINE_DATUM_UTXOS } from '@/shared/utils/__fixtures__/mainnetDatumUtxos';
import {
  COLLATERAL_DATUM,
  COLLATERAL_SCRIPT,
  inlineDatumOption,
  OUTPUT_DATUM,
  OUTPUT_SCRIPT,
  SCRIPT_REF_TX,
  SCRIPT_REF_TX_ID,
  WALLET_ADDRESS,
} from '@/shared/utils/__fixtures__/handAssembledTxs';

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

import trezor from './trezor';
import trezorWeb from './trezorWeb';

type SignTransaction = typeof trezor.signTransaction;

const SIGNERS: [string, { cardanoSignTransaction: Mock }, SignTransaction][] = [
  ['trezor (service worker)', connectWebextension, (...args) => trezor.signTransaction(...args)],
  ['trezorWeb (document)', connectWeb, (...args) => trezorWeb.cardanoSignTransaction(...args)],
];

/** A wallet that owns none of the inputs: it signs a transaction a dApp built. */
const KEYS: Keys = {
  payment: [{ address: WALLET_ADDRESS, cred: '11'.repeat(28), path: "m/1852'/1815'/0'/0/0" }],
  change: [],
  stake: [],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
};
const UTXOS: Cardano.Utxo[] = [
  [
    { txId: Cardano.TransactionId('00'.repeat(32)), index: 0, address: Cardano.PaymentAddress(WALLET_ADDRESS) },
    { address: Cardano.PaymentAddress(WALLET_ADDRESS), value: { coins: 5_000_000n } },
  ],
];
const MAINNET = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);

// The input resolver logs each input the wallet does not own: all of them here.
beforeAll(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe.each(SIGNERS)('%s: outputs reach the device as the transaction holds them', (_, connect, signTransaction) => {
  /** Signs a transaction as a dApp hands it over, and returns what the device was asked to sign. */
  async function deviceRequest(txCbor: string, txId: string): Promise<Trezor.CardanoSignTransaction> {
    // The device's answer when it serializes the body it was sent back to the same bytes.
    connect.cardanoSignTransaction.mockResolvedValueOnce({ success: true, payload: { hash: txId, witnesses: [] } });
    const tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).toCore();
    await signTransaction(tx, KEYS, UTXOS, false, MAINNET, 'unused-xpub', txCbor);
    return connect.cardanoSignTransaction.mock.lastCall![0];
  }

  it.each(INLINE_DATUM_UTXOS)('inline datums of $nexusRow.txHash', async ({ nexusRow, datumCbor, txCbor }) => {
    const { outputs } = await deviceRequest(txCbor, nexusRow.txHash);
    const datums = outputs.map((output) => output.inlineDatum);

    // The UTxO the fixture cut out of this transaction.
    expect(datums[nexusRow.txIndex]).toBe(datumCbor);
    // Outputs 0-5 hold inline datums, all definite-length lists; output 6 holds none.
    expect(datums.map(Boolean)).toEqual([true, true, true, true, true, true, false]);
    expect(datums.filter((datum) => datum && !txCbor.includes(inlineDatumOption(datum)))).toEqual([]);
  });

  it('reference scripts, and the collateral return’s datum and script', async () => {
    const { outputs, collateralReturn } = await deviceRequest(SCRIPT_REF_TX, SCRIPT_REF_TX_ID);

    expect(outputs[0]).toMatchObject({ inlineDatum: OUTPUT_DATUM, referenceScript: OUTPUT_SCRIPT });
    expect(collateralReturn).toMatchObject({ inlineDatum: COLLATERAL_DATUM, referenceScript: COLLATERAL_SCRIPT });
  });
});
