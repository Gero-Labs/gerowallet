// The page half of Gero's own CIP-113 Send: prepare in the worker, then sign and submit the
// CBOR exactly as the worker returned it. Messaging is stubbed; the order of messages and the
// bytes they carry are what is checked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, walletState } = vi.hoisted(() => ({
  send: vi.fn(),
  walletState: {
    keys: { payment: [{ address: 'addr_p', cred: 'p', path: "m/1852'/1815'/0'/0/0" }], change: [], stake: [] },
    utxos: [['fee-utxo']] as unknown[],
  },
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...args: unknown[]) => send(...args) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));

import { cip113SendErrorKey, useCip113Send } from './useCip113Send';
import { MessageTypes } from '@/models/MessageTypes';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';

const TX_CBOR = '84a400d9010281825820aa';
const TX_ID = 'ab'.repeat(32);
const SUMMARY = { txId: TX_ID, fee: '352696', moduleId: 'freeze-and-seize' };
const INTENT = { unit: 'cd'.repeat(28) + '4d', quantity: '1000000', recipientAddress: 'addr_test1recipient' };

type Handler = (data: Record<string, unknown>) => unknown;
function respond(handlers: Partial<Record<string, Handler>>) {
  send.mockImplementation(async ({ method, data }: { method: string; data: Record<string, unknown> }) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected ${method}`);
    return { data: handler(data) };
  });
}

const prepared = () => ({ success: true, result: { txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY } });
const methods = () => send.mock.calls.map(([message]) => (message as { method: string }).method);

describe('useCip113Send', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('prepares, verifies the password, signs and submits the CBOR untouched, in that order', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: true }),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    const flow = useCip113Send();

    expect(await flow.prepare(INTENT)).toBe(true);
    expect(flow.stage.value).toBe('review');
    expect(flow.prepared.value?.summary).toEqual(SUMMARY);
    expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);

    expect(methods()).toEqual([
      MessageTypes.CIP113_PREPARE_TRANSFER,
      MessageTypes.VERIFY_SPENDING_PASSWORD,
      MessageTypes.SIGN_TX,
      MessageTypes.SUBMIT_TX,
    ]);
    const [prepareCall, , signCall, submitCall] = send.mock.calls.map(([message]) => message as { data: Record<string, unknown> });
    // The page sends intent only, never inputs.
    expect(prepareCall.data).toEqual(INTENT);
    expect(signCall.data).toMatchObject({ txCbor: TX_CBOR, password: 'secret', utxos: walletState.utxos, addresses: walletState.keys });
    expect(submitCall.data).toEqual({ txCbor: TX_CBOR, witnessHex: 'WITNESSES' });
    expect(flow.submittedTxId.value).toBe(TX_ID);
    expect(flow.stage.value).toBe('done');
  });

  it('signs a PassKey wallet with its decrypted key, and wipes the key afterwards', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);
    const key = new Uint8Array([1, 2, 3]);

    expect(await flow.signAndSubmit({ privateKeyBytes: key })).toBe(true);
    expect(methods()).not.toContain(MessageTypes.VERIFY_SPENDING_PASSWORD);
    expect((send.mock.calls[1][0] as { data: { privateKeyBytes: number[] } }).data.privateKeyBytes).toEqual([1, 2, 3]);
    expect([...key]).toEqual([0, 0, 0]);
  });

  it('signs a Google wallet with no credentials at all', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(true);
    const signData = (send.mock.calls[1][0] as { data: Record<string, unknown> }).data;
    expect(signData).not.toHaveProperty('password');
    expect(signData).not.toHaveProperty('privateKeyBytes');
  });

  it("reports the worker's refusal code and the most one transfer can send", async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: false, errorCode: 'NOT_IN_ONE_TRANSFER', maxSingleTransfer: '21000000' }),
    });
    const flow = useCip113Send();

    expect(await flow.prepare(INTENT)).toBe(false);
    expect(flow.failure.value).toEqual({ code: 'NOT_IN_ONE_TRANSFER', maxSingleTransfer: '21000000' });
    expect(flow.stage.value).toBe('idle');
    expect(flow.prepared.value).toBeNull();
  });

  it('treats a missing or malformed prepare reply as a failed build', async () => {
    send.mockRejectedValueOnce(new Error('port closed'));
    const flow = useCip113Send();
    expect(await flow.prepare(INTENT)).toBe(false);
    expect(flow.failure.value?.code).toBe('BUILD_FAILED');

    respond({ [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: true, result: { txCbor: TX_CBOR } }) });
    expect(await flow.prepare(INTENT)).toBe(false);
    expect(flow.failure.value?.code).toBe('BUILD_FAILED');
  });

  it('stops at a wrong password without signing', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: false }),
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit({ password: 'wrong' })).toBe(false);
    expect(flow.failure.value?.code).toBe('WRONG_PASSWORD');
    expect(methods()).not.toContain(MessageTypes.SIGN_TX);
    expect(flow.stage.value).toBe('review');
  });

  it('asks for a new build when the worker no longer allows signing', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SIGN_TX]: () => ({ error: CIP113_SIGN_REFUSAL_MESSAGE }),
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('EXPIRED');
    expect(flow.prepared.value).toBeNull();
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('asks for a new build after a failed submit, since the signature was already used', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ error: 'node said no' }),
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SUBMIT_FAILED');
    expect(flow.prepared.value).toBeNull();
  });

  it('treats a submit that throws after signing as unconfirmed, never as "nothing was sent"', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => { throw new Error('port closed'); },
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SUBMIT_FAILED');
    expect(flow.prepared.value).toBeNull();
    expect(flow.stage.value).toBe('idle');
  });

  it('reports a signing exception as a failed signature, keeping the review', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SIGN_TX]: () => { throw new Error('port closed'); },
    });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SIGN_FAILED');
    expect(flow.stage.value).toBe('review');
  });

  it('cannot sign before anything was prepared', async () => {
    const flow = useCip113Send();
    expect(await flow.signAndSubmit()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('cip113SendErrorKey', () => {
  it('names a sentence for each code the user can act on, and a generic one otherwise', () => {
    expect(cip113SendErrorKey('INSUFFICIENT')).toBe('programmableTokens.send.error.INSUFFICIENT');
    expect(cip113SendErrorKey('MODULE_UNSUPPORTED')).toBe('programmableTokens.send.error.MODULE_UNSUPPORTED');
    expect(cip113SendErrorKey('MIXED_OWNERS')).toBe('programmableTokens.send.error.UNSUPPORTED_TOKEN');
    expect(cip113SendErrorKey('SOMETHING_NEW')).toBe('programmableTokens.send.error.BUILD_FAILED');
    expect(cip113SendErrorKey('WRONG_PASSWORD')).toBe('errors.wrongPassword');
  });
});
