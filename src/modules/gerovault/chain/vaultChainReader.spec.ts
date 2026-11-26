import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { TX_SUBMIT_UNCONFIRMED_MESSAGE } from '@/chrome/config';
import { MessageTypes } from '@/models/MessageTypes';

const { token, reauth } = vi.hoisted(() => ({ token: vi.fn(), reauth: vi.fn() }));
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: token, reauthenticateNexus: reauth }));

import { MAX_UTXO_PAGES, UTXO_PAGE_SIZE, createNexusReadClient, createVaultChainReader, type VaultReadHttp } from './vaultChainReader';

// A synthetic vault address: script payment and script stake hashes that are no real vault's.
const script = (hash: string) => ({ type: Cardano.CredentialType.ScriptHash, hash: Hash28ByteBase16(hash) });
const VAULT = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, script('a1'.repeat(28)), script('a2'.repeat(28)))
  .toAddress().toBech32();
const OTHER = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, script('b1'.repeat(28)), script('b2'.repeat(28)))
  .toAddress().toBech32();
const MAINNET_VAULT = Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Mainnet, script('a1'.repeat(28)), script('a2'.repeat(28)))
  .toAddress().toBech32();

const row = (n: number, address = VAULT) => ({
  txHash: n.toString(16).padStart(64, '0'),
  txIndex: 0,
  address,
  value: '2000000',
  assetList: [{ unit: `${'c3'.repeat(28)}74657374`, quantity: '5' }],
});
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => row(from + i));

function httpAnswering(...pages: Array<unknown[] | Error>) {
  const get = vi.fn(async (_url: string, _config?: unknown) => {
    const next = pages.shift();
    if (next instanceof Error) throw next;
    return { data: next ?? [] };
  });
  return { get } as unknown as VaultReadHttp & { get: typeof get };
}

const notFound = () => new AxiosError('Not found', 'ERR_BAD_REQUEST', undefined, undefined, { status: 404 } as AxiosResponse);

const signedTx = () => Serialization.Transaction.fromCore({
  id: Cardano.TransactionId('00'.repeat(32)),
  body: {
    inputs: [{ txId: Cardano.TransactionId('d1'.repeat(32)), index: 0 }],
    outputs: [{ address: Cardano.PaymentAddress(OTHER), value: { coins: 2_000_000n } }],
    fee: 180_000n,
  },
  witness: { signatures: new Map() },
});

describe('vault chain reader: UTxOs', () => {
  it('pages through every UTxO at the address on the right network, converted', async () => {
    const http = httpAnswering(rows(1, UTXO_PAGE_SIZE), rows(1000, 3));
    const reader = createVaultChainReader('preprod', { http });
    const signal = new AbortController().signal;

    const utxos = await reader.utxos(VAULT, { signal });

    expect(utxos).toHaveLength(UTXO_PAGE_SIZE + 3);
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(http.get.mock.calls[0]).toEqual([
      `/api/addresses/${VAULT}/utxos`,
      { params: { network: 'cardano-preprod', page: 1, pageSize: UTXO_PAGE_SIZE }, signal },
    ]);
    expect(http.get.mock.calls[1][1]).toMatchObject({ params: { page: 2 } });
    const [txIn, txOut] = utxos[0];
    expect(txIn).toMatchObject({ txId: row(1).txHash, index: 0 });
    expect(txOut.value.coins).toBe(2_000_000n);
    expect(txOut.value.assets?.get(Cardano.AssetId(`${'c3'.repeat(28)}74657374`))).toBe(5n);
  });

  it('reads an address that holds nothing (404) as no UTxOs', async () => {
    expect(await createVaultChainReader('preprod', { http: httpAnswering(notFound()) }).utxos(VAULT)).toEqual([]);
  });

  it('refuses an answer it cannot read whole', async () => {
    await expect(createVaultChainReader('preprod', { http: httpAnswering([row(1, OTHER)]) }).utxos(VAULT)).rejects.toThrow(/another address/);
    await expect(createVaultChainReader('preprod', { http: httpAnswering({} as never) }).utxos(VAULT)).rejects.toThrow(/list/);
    const endless = { get: vi.fn(async () => ({ data: rows(1, UTXO_PAGE_SIZE) })) };
    await expect(createVaultChainReader('preprod', { http: endless as unknown as VaultReadHttp }).utxos(VAULT)).rejects.toThrow(/more than/);
    expect(endless.get).toHaveBeenCalledTimes(MAX_UTXO_PAGES);
  });

  it('passes on a provider failure other than 404', async () => {
    const failure = new AxiosError('Service Unavailable', 'ERR_BAD_RESPONSE', undefined, undefined, { status: 503 } as AxiosResponse);
    await expect(createVaultChainReader('preprod', { http: httpAnswering(failure) }).utxos(VAULT)).rejects.toBe(failure);
  });

  it('asks nothing for an address of another network or not in canonical bech32', async () => {
    const http = httpAnswering();
    const reader = createVaultChainReader('preprod', { http });
    for (const address of [MAINNET_VAULT, VAULT.toUpperCase(), 'not-an-address', '']) {
      await expect(reader.utxos(address)).rejects.toThrow(TypeError);
    }
    expect(http.get).not.toHaveBeenCalled();
  });
});

describe('vault chain reader: history', () => {
  it('reads one page newest first, each transaction once', async () => {
    const http = httpAnswering([
      { txHash: 'AA'.repeat(32), blockHeight: 120, blockTime: 1_800_000_000, input: true },
      { txHash: 'aa'.repeat(32), blockHeight: 120, blockTime: 1_800_000_000, output: true },
      { txHash: 'bb'.repeat(32), blockHeight: null },
    ]);
    const history = await createVaultChainReader('preprod', { http }).history(VAULT, { page: 2, pageSize: 50 });

    expect(history).toEqual([
      { txHash: 'aa'.repeat(32), blockHeight: 120, blockTime: 1_800_000_000 },
      { txHash: 'bb'.repeat(32), blockHeight: null, blockTime: null },
    ]);
    expect(http.get.mock.calls[0]).toEqual([
      `/api/addresses/transactions/${VAULT}`,
      { params: { network: 'cardano-preprod', page: 2, pageSize: 50, order: 'desc' }, signal: undefined },
    ]);
  });

  it('reads no history (404) as none, and refuses rows it cannot read and bad pages', async () => {
    expect(await createVaultChainReader('preprod', { http: httpAnswering(notFound()) }).history(VAULT)).toEqual([]);
    await expect(createVaultChainReader('preprod', { http: httpAnswering([{ txHash: 'zz' }]) }).history(VAULT)).rejects.toThrow(/cannot read/);
    const reader = createVaultChainReader('preprod', { http: httpAnswering() });
    await expect(reader.history(VAULT, { page: 0 })).rejects.toThrow(RangeError);
    await expect(reader.history(VAULT, { pageSize: 101 })).rejects.toThrow(RangeError);
  });
});

describe('vault chain reader: creating transactions and submit', () => {
  it('uses the caller\'s creating-transaction source, or the backend\'s', () => {
    const source = vi.fn(async () => new Map<string, string>());
    expect(createVaultChainReader('preprod', { txCbor: source }).txCbor).toBe(source);
    expect(typeof createVaultChainReader('preprod').txCbor).toBe('function');
  });

  it('submits through the background\'s SUBMIT_TX and returns the id it computed itself', async () => {
    const tx = signedTx();
    const send = vi.fn(async () => ({ data: { txId: tx.getId().toUpperCase() } }));
    const id = await createVaultChainReader('preprod', { sendToBackground: send }).submit(tx.toCbor());

    expect(id).toBe(tx.getId());
    expect(send).toHaveBeenCalledWith({ method: MessageTypes.SUBMIT_TX, data: { txCbor: tx.toCbor() } });
  });

  it('passes the worker\'s refusal on, and never takes a lost or mismatched answer for a submit', async () => {
    const tx = signedTx();
    const reader = (answer: unknown) => createVaultChainReader('preprod', { sendToBackground: vi.fn(async () => answer) });

    await expect(reader({ data: { error: 'BadInputsUTxO' } }).submit(tx.toCbor())).rejects.toThrow('BadInputsUTxO');
    await expect(reader({ error: 'The message port closed' }).submit(tx.toCbor())).rejects.toThrow(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    await expect(reader(undefined).submit(tx.toCbor())).rejects.toThrow(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    await expect(reader({ data: { txId: 'ee'.repeat(32) } }).submit(tx.toCbor())).rejects.toThrow(/another transaction/);
    await expect(reader({ data: { txId: tx.getId() } }).submit('nope')).rejects.toThrow(TypeError);
  });

  it('knows only the three vault networks', () => {
    expect(() => createVaultChainReader('testnet' as never)).toThrow(TypeError);
    expect(createVaultChainReader('mainnet').network).toBe('mainnet');
  });
});

describe('Nexus read client', () => {
  beforeEach(() => {
    token.mockReset();
    reauth.mockReset();
  });

  it('sends the device token, and after a 401 logs in again once and retries with the new token', async () => {
    token.mockResolvedValueOnce('old-token').mockResolvedValue('new-token');
    reauth.mockResolvedValue('new-token');
    const seen: string[] = [];
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      seen.push(String(AxiosHeaders.from(config.headers).get('Authorization')));
      if (seen.length === 1) {
        throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, { status: 401, data: {}, headers: {}, statusText: '', config } as AxiosResponse);
      }
      return { status: 200, data: [], headers: {}, statusText: 'OK', config };
    });

    const response = await createNexusReadClient({ adapter }).get('/api/addresses/x/utxos');

    expect(response.status).toBe(200);
    expect(seen).toEqual(['Bearer old-token', 'Bearer new-token']);
    expect(reauth).toHaveBeenCalledTimes(1);
  });

  it('does not retry twice', async () => {
    token.mockResolvedValue('token');
    reauth.mockResolvedValue('token');
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      throw new AxiosError('Forbidden', 'ERR_BAD_REQUEST', config, undefined, { status: 403, data: {}, headers: {}, statusText: '', config } as AxiosResponse);
    });
    await expect(createNexusReadClient({ adapter }).get('/x')).rejects.toMatchObject({ response: { status: 403 } });
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});
