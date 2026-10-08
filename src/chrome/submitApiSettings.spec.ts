import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/db/wallet-db';
import { readSubmitApi, writeSubmitApi } from './submitApiStore';
import { resetSubmitApi, saveSubmitApi, testSubmitApi } from './submitApiSettings';
import { Blockchain } from '@/models/types';

const WALLET = { id: 880201, chain: Blockchain.CARDANO, network: 'Mainnet' };
const URL_ = 'https://node.example/api/submit/tx';
const fetchMock = vi.fn();
const sessionRemove = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', { storage: { session: { remove: sessionRemove, set: vi.fn() } } });
});

afterEach(async () => {
  fetchMock.mockReset();
  sessionRemove.mockReset();
  vi.unstubAllGlobals();
  await (await getDb(WALLET.id))?.delete();
});

const save = (overrides: Record<string, unknown> = {}) =>
  saveSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id', headerValue: 'key-1', fallbackToDefault: false, ...overrides });

describe('saveSubmitApi', () => {
  it('writes the public row and the secret', async () => {
    expect(await save({ url: `  ${URL_}#x ` })).toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toEqual({
      config: { version: 1, url: URL_, headerName: 'project_id', hasAuth: true, fallbackToDefault: false },
      auth: 'key-1',
    });
  });

  it('refuses without a logged-in wallet, on another chain, or for another wallet id', async () => {
    expect(await saveSubmitApi(null, { walletId: WALLET.id, url: URL_ })).toEqual({ success: false, error: 'walletMismatch' });
    expect(await saveSubmitApi({ ...WALLET, chain: Blockchain.BITCOIN }, { walletId: WALLET.id, url: URL_ }))
      .toEqual({ success: false, error: 'unsupportedChain' });
    expect(await save({ walletId: WALLET.id + 1 })).toEqual({ success: false, error: 'walletMismatch' });
    expect(await readSubmitApi(WALLET.id)).toEqual({ config: null, auth: null });
  });

  it('returns the first validation error and writes nothing', async () => {
    expect(await save({ url: 'ftp://x' })).toEqual({ success: false, error: 'urlInvalid', field: 'url' });
    expect(await readSubmitApi(WALLET.id)).toEqual({ config: null, auth: null });
  });

  it('keeps the saved secret when headerValue is absent', async () => {
    await save();
    expect(await saveSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id', fallbackToDefault: true }))
      .toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toMatchObject({ auth: 'key-1', config: { hasAuth: true, fallbackToDefault: true } });
  });

  it('asks for the secret again when the URL moves to another origin', async () => {
    await save();
    expect(await saveSubmitApi(WALLET, { walletId: WALLET.id, url: 'https://evil.example/submit', headerName: 'project_id', fallbackToDefault: false }))
      .toEqual({ success: false, error: 'headerValueReenter', field: 'headerValue' });
    expect((await readSubmitApi(WALLET.id)).config).toMatchObject({ url: URL_ });
  });

  it('removes the secret when headerValue is null', async () => {
    await save();
    expect(await save({ headerName: null, headerValue: null })).toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toMatchObject({ auth: null, config: { headerName: null, hasAuth: false } });
  });
});

describe('testSubmitApi', () => {
  it('probes with the typed values', async () => {
    fetchMock.mockResolvedValue(new Response('bad cbor', { status: 400 }));
    expect(await testSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id', headerValue: 'typed' }))
      .toEqual({ success: true, result: { kind: 'ok', status: 400 } });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ project_id: 'typed' });
  });

  it('uses the saved secret for the same origin only', async () => {
    await writeSubmitApi(WALLET.id, { version: 1, url: URL_, headerName: 'project_id', hasAuth: true, fallbackToDefault: false }, 'saved-key');
    fetchMock.mockResolvedValue(new Response('', { status: 400 }));
    await testSubmitApi(WALLET, { walletId: WALLET.id, url: URL_, headerName: 'project_id' });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ project_id: 'saved-key' });

    fetchMock.mockClear();
    expect(await testSubmitApi(WALLET, { walletId: WALLET.id, url: 'https://evil.example/submit', headerName: 'project_id' }))
      .toEqual({ success: false, error: 'headerValueReenter', field: 'headerValue' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('resetSubmitApi', () => {
  it('clears both rows and the last-result entry', async () => {
    await save();
    expect(await resetSubmitApi(WALLET, { walletId: WALLET.id })).toEqual({ success: true });
    expect(await readSubmitApi(WALLET.id)).toEqual({ config: null, auth: null });
    expect(sessionRemove).toHaveBeenCalledWith(`submitApiLastResult:${WALLET.id}`);
  });

  it('refuses another wallet id', async () => {
    expect(await resetSubmitApi(WALLET, { walletId: 1 })).toEqual({ success: false, error: 'walletMismatch' });
  });
});
