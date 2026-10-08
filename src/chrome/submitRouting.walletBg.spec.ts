import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { Blockchain, type Wallet } from '@/models/types';
import { writeSubmitApi } from './submitApiStore';
import { SUBMIT_API_ENDPOINT_PREFIX } from './config';

const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const URL_ = 'https://node.example/api/submit/tx';
let sequence = 975000;
const wallets: WalletBg[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('chrome', {
    alarms: {
      getAll: (cb: (alarms: unknown[]) => void) => cb([]), clear: vi.fn(), create: vi.fn(),
      onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
    },
    storage: { local: { set: vi.fn(), get: vi.fn() }, session: { set: vi.fn() } }, runtime: {},
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  fetchMock.mockReset();
  vi.restoreAllMocks();
  for (const wallet of wallets.splice(0)) {
    wallet.unsubscribeAll();
    await (await wallet.getDb()).delete();
  }
});

async function walletWithTx() {
  WalletStore.clearForWalletSwitch();
  const bg = new WalletBg({ id: ++sequence, name: 'route-test', chain: Blockchain.CARDANO, network: 'Preprod', publicKey: XPUB } as Wallet);
  wallets.push(bg);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  const tx = Serialization.Transaction.fromCore({
    body: {
      inputs: [{ txId: Cardano.TransactionId('1'.repeat(64)), index: 0 }],
      outputs: [{ address: bg.baseAddress as Cardano.PaymentAddress, value: { coins: 9_800_000n } }],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
    isValid: true,
  } as Cardano.Tx);
  return { bg, cbor: tx.toCbor(), id: tx.getId() };
}

describe('WalletBg.submitTx through the Submit API router', () => {
  it('sends to the custom endpoint, not Gero, and records the pending tx', async () => {
    const { bg, cbor, id } = await walletWithTx();
    await writeSubmitApi(bg.id, { version: 1, url: URL_, headerName: null, hasAuth: false, fallbackToDefault: false }, null);
    const gero = vi.spyOn(bg.api, 'submitTx');
    fetchMock.mockResolvedValue(new Response(`"${id}"`, { status: 202 }));

    expect(await bg.submitTx(cbor, [])).toBe(id);
    expect(gero).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(URL_, expect.objectContaining({ method: 'POST' }));
    await vi.waitFor(async () => expect(await (await bg.getDb()).table('transactions').get(id)).toMatchObject({ pending: true }));
  });

  it('fails closed with the endpoint prefix and writes no pending tx when fallback is off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bg, cbor } = await walletWithTx();
    await writeSubmitApi(bg.id, { version: 1, url: URL_, headerName: null, hasAuth: false, fallbackToDefault: false }, null);
    const gero = vi.spyOn(bg.api, 'submitTx');
    const setTxs = vi.spyOn(bg, 'setAccountTransactions');
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));

    await expect(bg.submitTx(cbor, [])).rejects.toThrow(SUBMIT_API_ENDPOINT_PREFIX);
    expect(gero).not.toHaveBeenCalled();
    expect(setTxs).not.toHaveBeenCalled();
  });

  it('falls back to Gero when the user opted in', async () => {
    const { bg, cbor, id } = await walletWithTx();
    await writeSubmitApi(bg.id, { version: 1, url: URL_, headerName: null, hasAuth: false, fallbackToDefault: true }, null);
    const gero = vi.spyOn(bg.api, 'submitTx').mockResolvedValue(id);
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));

    expect(await bg.submitTx(cbor, [])).toBe(id);
    // The custom endpoint was tried first, then Gero.
    expect(fetchMock).toHaveBeenCalledWith(URL_, expect.objectContaining({ method: 'POST' }));
    expect(gero).toHaveBeenCalledWith(cbor);
    // The pending write is fire-and-forget; settle it before the wallet DB is torn down.
    await vi.waitFor(async () => expect(await (await bg.getDb()).table('transactions').get(id)).toMatchObject({ pending: true }));
  });
});
