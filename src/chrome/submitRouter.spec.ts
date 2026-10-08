import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { getDb } from '@/db/wallet-db';
import { writeSubmitApi } from './submitApiStore';
import {
  dappRoutedError,
  describeRoutedFailure,
  fromAxiosSubmit,
  fromFetchSubmit,
  probeSubmitEndpoint,
  submitCardanoTx,
  type SubmitOutcome,
} from './submitRouter';
import {
  SUBMIT_API_ENDPOINT_PREFIX,
  SUBMIT_API_HASH_MISMATCH_MESSAGE,
  SUBMIT_API_INVALID_MESSAGE,
  TX_SUBMIT_UNCONFIRMED_MESSAGE,
} from './config';
import { dappSubmitError, describeSubmitFailure } from './submitErrors';
import type { SubmitApiConfig } from '@/shared/utils/submitApiConfig';

const WALLET_ID = 880101;
const SECRET = 'super-secret-key';
const URL_ = 'https://node.example/api/submit/tx';
const CONFIG: SubmitApiConfig = { version: 1, url: URL_, headerName: 'project_id', hasAuth: true, fallbackToDefault: false };

const sessionSet = vi.fn();
const fetchMock = vi.fn();

function signedTx(): { cbor: string; id: string } {
  const address = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
    type: Cardano.CredentialType.KeyHash,
    hash: 'a'.repeat(56) as Cardano.Credential['hash'],
  }).toAddress().toBech32() as Cardano.PaymentAddress;
  const tx = Serialization.Transaction.fromCore({
    body: {
      inputs: [{ txId: Cardano.TransactionId('1'.repeat(64)), index: 0 }],
      outputs: [{ address, value: { coins: 2_000_000n } }],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
    isValid: true,
  } as Cardano.Tx);
  return { cbor: tx.toCbor(), id: tx.getId() };
}

function response(status: number, body: string): Response {
  return new Response(body, { status });
}

function defaultOk(): () => Promise<SubmitOutcome> {
  return vi.fn().mockResolvedValue({ ok: true, via: 'default', body: 'default-hash' });
}

beforeEach(() => {
  vi.stubGlobal('chrome', { storage: { session: { set: sessionSet } } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  sessionSet.mockReset();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  await (await getDb(WALLET_ID))?.delete();
});

describe('submitCardanoTx: default path', () => {
  it('runs defaultSubmit untouched when there is no wallet context', async () => {
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor: '00', walletId: undefined, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: true, via: 'default', body: 'default-hash' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runs defaultSubmit untouched and records nothing when the wallet has no Submit API', async () => {
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor: '00', walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: true, via: 'default', body: 'default-hash' });
    expect(defaultSubmit).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });
});

describe('submitCardanoTx: custom endpoint', () => {
  beforeEach(async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, SECRET);
  });

  it('POSTs raw CBOR with the header, refusing redirects, and returns the local tx id', async () => {
    const { cbor, id } = signedTx();
    fetchMock.mockResolvedValue(response(202, `"${id}"`));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });

    expect(outcome).toEqual({ ok: true, via: 'custom', body: id });
    expect(defaultSubmit).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/cbor', project_id: SECRET },
    });
    expect(Buffer.from(init.body as Uint8Array).toString('hex')).toBe(cbor);
    expect(sessionSet).toHaveBeenCalledWith({
      [`submitApiLastResult:${WALLET_ID}`]: expect.objectContaining({ via: 'custom' }),
    });
  });

  it.each(['UPPER', 'newline', 'bare'])('accepts the hash in %s form', async (shape) => {
    const { cbor, id } = signedTx();
    const body = shape === 'UPPER' ? `"${id.toUpperCase()}"` : shape === 'newline' ? `${id}\n` : id;
    fetchMock.mockResolvedValue(response(200, body));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toEqual({ ok: true, via: 'custom', body: id });
  });

  it('refuses a hash that is not this transaction', async () => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(202, `"${'f'.repeat(64)}"`));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toEqual({ ok: false, via: 'custom', reason: 'hashMismatch' });
  });

  it('reports an unparseable 2xx body as an unexpected response', async () => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(200, 'maintenance'));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toMatchObject({ ok: false, via: 'custom', reason: 'unexpectedResponse', body: 'maintenance' });
  });

  it('never falls back on a 400 node rejection, even with fallback on', async () => {
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(400, 'BadInputsUTxO'));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: false, via: 'custom', status: 400, body: 'BadInputsUTxO', reason: 'endpointPrefix' });
    expect(defaultSubmit).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 405, 408, 415, 425, 429, 500, 503])('HTTP %i fails closed with fallback off', async (status) => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(status, 'nope'));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toMatchObject({ ok: false, via: 'custom', status, reason: 'endpointPrefix' });
    expect(defaultSubmit).not.toHaveBeenCalled();
    expect(sessionSet).toHaveBeenCalledWith({
      [`submitApiLastResult:${WALLET_ID}`]: expect.objectContaining({ via: 'custom', error: { code: 'http', status } }),
    });
  });

  it.each([401, 403, 404, 405, 408, 415, 425, 429, 500, 503])('HTTP %i falls back with fallback on', async (status) => {
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(status, 'nope'));
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: true, via: 'default', body: 'default-hash' });
    expect(sessionSet).toHaveBeenCalledWith({
      [`submitApiLastResult:${WALLET_ID}`]: expect.objectContaining({ via: 'default', error: { code: 'http', status } }),
    });
  });

  it('treats a network error as unreachable, failing closed or falling back', async () => {
    const { cbor } = signedTx();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() }))
      .toEqual({ ok: false, via: 'custom', reason: 'endpointPrefix' });

    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    expect(await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() }))
      .toEqual({ ok: true, via: 'default', body: 'default-hash' });
  });

  it('calls a 400 from the fallback after a custom timeout "outcome unknown"', async () => {
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    const { cbor } = signedTx();
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const defaultSubmit = vi.fn().mockResolvedValue({ ok: false, via: 'default', status: 400, body: 'BadInputsUTxO' });
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: false, via: 'default', reason: 'outcomeUnknown' });
  });

  it('redacts the header value from an endpoint body that echoes it', async () => {
    const { cbor } = signedTx();
    fetchMock.mockResolvedValue(response(401, `invalid project_id ${SECRET}`));
    const outcome = await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
    expect(describeRoutedFailure(outcome as Extract<SubmitOutcome, { ok: false }>)).not.toContain(SECRET);
    expect(JSON.stringify(sessionSet.mock.calls)).not.toContain(SECRET);
  });

  it('never sends a body that is not hex CBOR', async () => {
    const outcome = await submitCardanoTx({ cbor: 'zz', walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() });
    expect(outcome).toMatchObject({ ok: false, via: 'custom', status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the saved endpoint whatever the feature flag says (the flag gates UI only)', async () => {
    vi.stubGlobal('chrome', {
      storage: { session: { set: sessionSet }, local: { get: vi.fn().mockResolvedValue({ featureFlags: { isSubmitApiEnabled: false } }) } },
    });
    const { cbor, id } = signedTx();
    fetchMock.mockResolvedValue(response(202, id));
    expect(await submitCardanoTx({ cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit: defaultOk() }))
      .toEqual({ ok: true, via: 'custom', body: id });
  });
});

describe('submitCardanoTx: invalid saved config fails closed', () => {
  it.each([
    ['a non-http URL', { ...CONFIG, url: 'ftp://node.example' }, SECRET],
    ['hasAuth without a secret row', CONFIG, null],
    ['a secret with a line break', CONFIG, 'a\nb'],
  ])('%s', async (_label, config, secret) => {
    await writeSubmitApi(WALLET_ID, config as SubmitApiConfig, secret);
    const defaultSubmit = defaultOk();
    const outcome = await submitCardanoTx({ cbor: signedTx().cbor, walletId: WALLET_ID, network: 'Mainnet', defaultSubmit });
    expect(outcome).toEqual({ ok: false, via: 'custom', reason: 'invalidConfig' });
    expect(defaultSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('adapters', () => {
  it('fromAxiosSubmit passes the value through and maps error.response', async () => {
    expect(await fromAxiosSubmit(async () => 'abc')()).toEqual({ ok: true, via: 'default', body: 'abc' });
    const failure = await fromAxiosSubmit(async () => {
      throw { response: { status: 502, data: 'Bad Gateway' } };
    })();
    expect(failure).toEqual({ ok: false, via: 'default', status: 502, body: 'Bad Gateway' });
    expect(await fromAxiosSubmit(async () => { throw new Error('reset'); })())
      .toEqual({ ok: false, via: 'default', status: undefined, body: undefined });
  });

  it('fromFetchSubmit reads the body and lets a network error propagate as before', async () => {
    expect(await fromFetchSubmit(async () => response(200, 'abc'))()).toEqual({ ok: true, via: 'default', body: 'abc' });
    expect(await fromFetchSubmit(async () => response(400, 'bad'))()).toEqual({ ok: false, via: 'default', status: 400, body: 'bad' });
    await expect(fromFetchSubmit(async () => { throw new TypeError('offline'); })()).rejects.toThrow('offline');
  });
});

describe('describeRoutedFailure / dappRoutedError', () => {
  it('leaves default-path failures exactly as before', () => {
    const failure = { ok: false as const, via: 'default' as const, status: 400, body: 'rejected' };
    expect(describeRoutedFailure(failure)).toBe(describeSubmitFailure(400, 'rejected'));
    expect(dappRoutedError(failure)).toEqual(dappSubmitError(400, 'rejected'));
  });

  it('names the custom endpoint and keeps the fixed messages', () => {
    expect(describeRoutedFailure({ ok: false, via: 'custom', status: 503, body: 'x', reason: 'endpointPrefix' }))
      .toBe(`${SUBMIT_API_ENDPOINT_PREFIX}${describeSubmitFailure(503, 'x')}`);
    expect(describeRoutedFailure({ ok: false, via: 'custom', reason: 'invalidConfig' })).toBe(SUBMIT_API_INVALID_MESSAGE);
    expect(describeRoutedFailure({ ok: false, via: 'custom', reason: 'hashMismatch' })).toBe(SUBMIT_API_HASH_MISMATCH_MESSAGE);
    expect(describeRoutedFailure({ ok: false, via: 'default', reason: 'outcomeUnknown' })).toContain(TX_SUBMIT_UNCONFIRMED_MESSAGE);
    expect(dappRoutedError({ ok: false, via: 'custom', reason: 'invalidConfig' }))
      .toMatchObject({ info: SUBMIT_API_INVALID_MESSAGE, message: SUBMIT_API_INVALID_MESSAGE });
  });
});

describe('probeSubmitEndpoint', () => {
  it.each([
    [400, { kind: 'ok', status: 400 }],
    [202, { kind: 'acceptedInvalid' }],
    [401, { kind: 'auth', status: 401 }],
    [403, { kind: 'auth', status: 403 }],
    [404, { kind: 'path', status: 404 }],
    [405, { kind: 'path', status: 405 }],
    [503, { kind: 'server', status: 503 }],
    [415, { kind: 'other', status: 415 }],
  ])('HTTP %i maps to %o', async (status, expected) => {
    fetchMock.mockResolvedValue(response(status, ''));
    expect(await probeSubmitEndpoint(URL_, 'project_id', SECRET)).toEqual(expected);
    const [, init] = fetchMock.mock.calls[0];
    expect(Array.from(init.body as Uint8Array)).toEqual([0]);
    expect(init.redirect).toBe('error');
  });

  it('reports a network failure as unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await probeSubmitEndpoint(URL_, null, null)).toEqual({ kind: 'unreachable' });
  });
});
