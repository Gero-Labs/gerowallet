// The page half of Gero's own CIP-113 Send: prepare in the worker, then sign and submit the
// CBOR exactly as the worker returned it. Messaging is stubbed; the order of messages and the
// bytes they carry are what is checked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, walletState, deviceSign, signerOptions, cosign, prompt, checkDecimals } = vi.hoisted(() => ({
  checkDecimals: vi.fn(),
  send: vi.fn(),
  walletState: {
    keys: { payment: [{ address: 'addr_p', cred: 'p', path: "m/1852'/1815'/0'/0/0" }], change: [], stake: [] },
    utxos: [['fee-utxo']] as unknown[],
    loggedWallet: undefined as { type: string; network: string } | undefined,
  },
  deviceSign: vi.fn(),
  signerOptions: [] as unknown[],
  cosign: vi.fn(),
  prompt: { begin: vi.fn(), end: vi.fn() },
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...args: unknown[]) => send(...args) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));
// The device itself is out of scope here (cip113HardwareSigners.spec.ts maps T3 to each
// device's request); what is checked is what the page does with its answer.
vi.mock('@/shared/composables/useHardwareTxSigner', () => ({
  signsOnDevice: (type: string | undefined) => ['Ledger', 'Trezor', 'Keystone'].includes(type ?? ''),
  useHardwareTxSigner: (options: unknown) => {
    signerOptions.push(options);
    return { sign: (cbor: string) => deviceSign(cbor), keystone: {} };
  },
}));
vi.mock('@/api/nexus-collateral-api', () => ({
  nexusCollateralApi: { cosign: (...args: unknown[]) => cosign(...args) },
}));
vi.mock('@/shared/utils/witnessSets', () => ({
  mergeWitnessSets: async (user: string, extra: string) => `${user}+${extra}`,
}));
vi.mock('@/plugins/hardwareLoading', () => ({ default: prompt }));
vi.mock('@/shared/utils/verifiedDecimals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils/verifiedDecimals')>()),
  assertTokenDecimals: (...args: unknown[]) => checkDecimals(...args),
}));

import { cip113SendErrorKey, useCip113Send } from './useCip113Send';
import { TokenDecimalsError } from '@/shared/utils/verifiedDecimals';
import { MessageTypes } from '@/models/MessageTypes';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';

const TX_CBOR = '84a400d9010281825820aa';
const TX_ID = 'ab'.repeat(32);
const SUMMARY = { txId: TX_ID, fee: '352696', moduleId: 'freeze-and-seize' };
const WORKER_INTENT = { unit: 'cd'.repeat(28) + '4d', quantity: '1000000', recipientAddress: 'addr_test1recipient' };
const INTENT = { ...WORKER_INTENT, decimals: 6, network: 'Preprod' };

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
    checkDecimals.mockReset().mockResolvedValue(undefined);
    walletState.loggedWallet = undefined;
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
    expect(prepareCall.data).toEqual(WORKER_INTENT);
    expect(checkDecimals).toHaveBeenCalledWith([{ unit: INTENT.unit, decimals: 6 }], 'Preprod');
    expect(signCall.data).toMatchObject({ txCbor: TX_CBOR, password: 'secret', utxos: walletState.utxos, addresses: walletState.keys });
    expect(submitCall.data).toEqual({ txCbor: TX_CBOR, witnessHex: 'WITNESSES' });
    expect(flow.submittedTxId.value).toBe(TX_ID);
    expect(flow.stage.value).toBe('done');
  });

  it('confirms the decimals before the worker builds, and builds nothing when they are wrong', async () => {
    respond({ [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared });
    const flow = useCip113Send();

    checkDecimals.mockRejectedValueOnce(new TokenDecimalsError('mismatch', [INTENT.unit]));
    expect(await flow.prepare(INTENT)).toBe(false);
    expect(flow.failure.value).toEqual({ code: 'DECIMALS_MISMATCH' });
    expect(cip113SendErrorKey('DECIMALS_MISMATCH')).toBe('txGuard.tokenDecimalsMismatch');

    checkDecimals.mockRejectedValueOnce(new TokenDecimalsError('unverified', [INTENT.unit]));
    expect(await flow.prepare(INTENT)).toBe(false);
    expect(flow.failure.value).toEqual({ code: 'DECIMALS_UNVERIFIED' });
    expect(cip113SendErrorKey('DECIMALS_UNVERIFIED')).toBe('txGuard.tokenDecimalsUnverified');

    expect(send).not.toHaveBeenCalled();
    expect(flow.stage.value).toBe('idle');
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

describe('useCip113Send on a hardware wallet', () => {
  const REF = `${'ee'.repeat(32)}#3`;

  beforeEach(() => {
    send.mockReset();
    deviceSign.mockReset();
    cosign.mockReset();
    prompt.begin.mockReset();
    prompt.end.mockReset();
    signerOptions.length = 0;
    walletState.loggedWallet = { type: 'Ledger', network: 'Preprod' };
  });

  it('signs the CBOR untouched on the device, never in the worker, and submits that signature', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    deviceSign.mockResolvedValue('DEVICE_WITNESSES');
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(true);
    expect(deviceSign).toHaveBeenCalledWith(TX_CBOR);
    expect(methods()).toEqual([MessageTypes.CIP113_PREPARE_TRANSFER, MessageTypes.SUBMIT_TX]);
    expect(send.mock.calls[1][0]).toMatchObject({ data: { txCbor: TX_CBOR, witnessHex: 'DEVICE_WITNESSES' } });
    expect(cosign).not.toHaveBeenCalled();
    expect(prompt.begin).toHaveBeenCalledWith('Ledger');
    expect(prompt.end).toHaveBeenCalled();
    expect(flow.stage.value).toBe('done');
  });

  it("hands the Ledger the user's transport choice", () => {
    const getIsBT = () => true;
    useCip113Send({ getIsBT });
    expect(signerOptions).toEqual([{ getIsBT }]);
  });

  it('shows no device prompt for Keystone, whose QR dialog asks instead', async () => {
    walletState.loggedWallet = { type: 'Keystone', network: 'Preprod' };
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    deviceSign.mockResolvedValue('KEYSTONE_WITNESSES');
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(true);
    expect(prompt.begin).not.toHaveBeenCalled();
  });

  it("adds Nexus's witness for collateral it lent, before submitting", async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({
        success: true,
        result: { txCbor: TX_CBOR, txId: TX_ID, summary: { ...SUMMARY, sponsoredCollateralRef: REF } },
      }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    deviceSign.mockResolvedValue('DEVICE_WITNESSES');
    cosign.mockResolvedValue({ witness: 'POOL_WITNESS' });
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(true);
    expect(cosign).toHaveBeenCalledWith(TX_CBOR, REF, 'cardano-preprod');
    expect(send.mock.calls[1][0]).toMatchObject({ data: { txCbor: TX_CBOR, witnessHex: 'DEVICE_WITNESSES+POOL_WITNESS' } });
  });

  it("keeps the review when Nexus won't co-sign, having sent nothing", async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({
        success: true,
        result: { txCbor: TX_CBOR, txId: TX_ID, summary: { ...SUMMARY, sponsoredCollateralRef: REF } },
      }),
    });
    deviceSign.mockResolvedValue('DEVICE_WITNESSES');
    cosign.mockRejectedValue(new Error('cosign 503'));
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SIGN_FAILED');
    expect(flow.stage.value).toBe('review');
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('asks for a new build when the worker refuses the device signature', async () => {
    respond({ [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared });
    deviceSign.mockRejectedValue(new Error(CIP113_SIGN_REFUSAL_MESSAGE));
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('EXPIRED');
    expect(flow.prepared.value).toBeNull();
    expect(flow.stage.value).toBe('idle');
    expect(prompt.end).toHaveBeenCalled();
  });

  it('keeps the review when the device is cancelled or fails', async () => {
    respond({ [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared });
    deviceSign.mockRejectedValue(new Error('Keystone signing cancelled'));
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SIGN_FAILED');
    expect(flow.stage.value).toBe('review');
    expect(flow.prepared.value?.txId).toBe(TX_ID);
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('treats a failed submit after the device signed as unconfirmed', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: prepared,
      [MessageTypes.SUBMIT_TX]: () => { throw new Error('port closed'); },
    });
    deviceSign.mockResolvedValue('DEVICE_WITNESSES');
    const flow = useCip113Send();
    await flow.prepare(INTENT);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SUBMIT_FAILED');
    expect(flow.prepared.value).toBeNull();
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
