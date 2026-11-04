// The page half of the legacy-listing rescue: prepare in the worker (the refs only), then sign and
// submit the CBOR exactly as the worker returned it. Messaging is stubbed; the order of messages
// and the bytes they carry are what is checked. The signing machinery itself is shared with
// Gero's CIP-113 Send (usePreparedTxFlow) and pinned for that flow by useCip113Send.spec.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, walletState, deviceSign, signerOptions, cosign, prompt } = vi.hoisted(() => ({
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

import { useLegacyRescue } from './useLegacyRescue';
import { MessageTypes } from '@/models/MessageTypes';

const TX_CBOR = '84a400d9010281825820bb';
const TX_ID = 'cd'.repeat(32);
const REFS = [`${'aa'.repeat(32)}#0`, `${'bb'.repeat(32)}#2`];
const SUMMARY = { txId: TX_ID, feeLovelace: '412345', refs: REFS, items: [] };
const COLLATERAL_REF = `${'ee'.repeat(32)}#3`;

type Handler = (data: Record<string, unknown>) => unknown;
function respond(handlers: Partial<Record<string, Handler>>) {
  send.mockImplementation(async ({ method, data }: { method: string; data: Record<string, unknown> }) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected ${method}`);
    return { data: handler(data) };
  });
}

const prepared = (summary: Record<string, unknown> = SUMMARY) => () => ({
  success: true,
  result: { txCbor: TX_CBOR, txId: TX_ID, summary },
});
const methods = () => send.mock.calls.map(([message]) => (message as { method: string }).method);
const messageAt = (index: number) => send.mock.calls[index][0] as { method: string; data: Record<string, unknown> };

describe('useLegacyRescue', () => {
  beforeEach(() => {
    send.mockReset();
    deviceSign.mockReset();
    cosign.mockReset();
    prompt.begin.mockReset();
    prompt.end.mockReset();
    signerOptions.length = 0;
    walletState.loggedWallet = undefined;
  });

  it('prepare sends LEGACY_LISTING_PREPARE_CANCEL with the refs and nothing else', async () => {
    respond({ [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared() });
    const flow = useLegacyRescue();

    expect(await flow.prepare(REFS)).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(messageAt(0)).toEqual({ method: MessageTypes.LEGACY_LISTING_PREPARE_CANCEL, data: { refs: REFS } });
    expect(flow.stage.value).toBe('review');
    expect(flow.prepared.value).toEqual({ txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY });
    expect(flow.failure.value).toBeNull();
  });

  it('LISTING_NOT_FOUND from the worker lands in failure.code', async () => {
    respond({
      [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: () => ({ success: false, error: 'gone', errorCode: 'LISTING_NOT_FOUND' }),
    });
    const flow = useLegacyRescue();

    expect(await flow.prepare(REFS)).toBe(false);

    expect(flow.failure.value).toEqual({ code: 'LISTING_NOT_FOUND' });
    expect(flow.stage.value).toBe('idle');
    expect(flow.prepared.value).toBeNull();
  });

  it.each(['NOT_OWNED', 'VERIFY_FAILED', 'WALLET_UNSUPPORTED', 'NETWORK_UNSUPPORTED', 'EVALUATION_FAILED'])(
    'carries the worker code %s through unchanged',
    async (code) => {
      respond({ [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: () => ({ success: false, error: 'no', errorCode: code }) });
      const flow = useLegacyRescue();

      expect(await flow.prepare(REFS)).toBe(false);
      expect(flow.failure.value?.code).toBe(code);
    },
  );

  it('treats a missing or malformed prepare reply as a failed build', async () => {
    send.mockRejectedValueOnce(new Error('port closed'));
    const flow = useLegacyRescue();
    expect(await flow.prepare(REFS)).toBe(false);
    expect(flow.failure.value?.code).toBe('BUILD_FAILED');

    respond({ [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: () => ({ success: true, result: { txCbor: TX_CBOR } }) });
    expect(await flow.prepare(REFS)).toBe(false);
    expect(flow.failure.value?.code).toBe('BUILD_FAILED');
  });

  it('signAndSubmit signs the exact CBOR and submits it with the witnesses', async () => {
    respond({
      [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared(),
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: true }),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    const flow = useLegacyRescue();

    expect(await flow.prepare(REFS)).toBe(true);
    expect(await flow.signAndSubmit({ password: 'secret' })).toBe(true);

    expect(methods()).toEqual([
      MessageTypes.LEGACY_LISTING_PREPARE_CANCEL,
      MessageTypes.VERIFY_SPENDING_PASSWORD,
      MessageTypes.SIGN_TX,
      MessageTypes.SUBMIT_TX,
    ]);
    const signCall = messageAt(2);
    const submitCall = messageAt(3);
    expect(signCall.data).toHaveProperty('txCbor', flow.prepared.value?.txCbor);
    expect(signCall.data).toMatchObject({
      txCbor: TX_CBOR,
      partialSign: false,
      mergeWitnesses: false,
      password: 'secret',
      utxos: walletState.utxos,
      addresses: walletState.keys,
    });
    expect(submitCall.data).toEqual({ txCbor: TX_CBOR, witnessHex: 'WITNESSES' });
    expect(flow.submittedTxId.value).toBe(TX_ID);
    expect(flow.stage.value).toBe('done');
  });

  it('stops at a wrong password without signing', async () => {
    respond({
      [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared(),
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: false }),
    });
    const flow = useLegacyRescue();
    await flow.prepare(REFS);

    expect(await flow.signAndSubmit({ password: 'wrong' })).toBe(false);
    expect(flow.failure.value?.code).toBe('WRONG_PASSWORD');
    expect(methods()).not.toContain(MessageTypes.SIGN_TX);
    expect(flow.stage.value).toBe('review');
  });

  it('reports a failed signature and keeps the review, sending nothing', async () => {
    respond({
      [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared(),
      [MessageTypes.SIGN_TX]: () => ({ error: 'nope' }),
    });
    const flow = useLegacyRescue();
    await flow.prepare(REFS);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SIGN_FAILED');
    expect(flow.stage.value).toBe('review');
    expect(flow.prepared.value?.txId).toBe(TX_ID);
    expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
  });

  it('treats a failed submit after signing as unconfirmed and asks to prepare again', async () => {
    respond({
      [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared(),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => { throw new Error('port closed'); },
    });
    const flow = useLegacyRescue();
    await flow.prepare(REFS);

    expect(await flow.signAndSubmit()).toBe(false);
    expect(flow.failure.value?.code).toBe('SUBMIT_FAILED');
    expect(flow.prepared.value).toBeNull();
    expect(flow.stage.value).toBe('idle');
  });

  it('cannot sign before anything was prepared', async () => {
    const flow = useLegacyRescue();
    expect(await flow.signAndSubmit()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('reset returns to a clean idle flow', async () => {
    respond({ [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared() });
    const flow = useLegacyRescue();
    await flow.prepare(REFS);

    flow.reset();

    expect(flow.stage.value).toBe('idle');
    expect(flow.prepared.value).toBeNull();
    expect(flow.failure.value).toBeNull();
    expect(flow.submittedTxId.value).toBeNull();
  });

  describe('on a hardware wallet', () => {
    beforeEach(() => {
      walletState.loggedWallet = { type: 'Ledger', network: 'Mainnet' };
    });

    it("hands the Ledger the user's transport choice", () => {
      const getIsBT = () => true;
      useLegacyRescue({ getIsBT });
      expect(signerOptions).toEqual([{ getIsBT }]);
    });

    it('signs the CBOR untouched on the device, never in the worker, and submits that signature', async () => {
      respond({
        [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared(),
        [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
      });
      deviceSign.mockResolvedValue('DEVICE_WITNESSES');
      const flow = useLegacyRescue();
      await flow.prepare(REFS);

      expect(await flow.signAndSubmit()).toBe(true);

      expect(deviceSign).toHaveBeenCalledWith(TX_CBOR);
      expect(methods()).toEqual([MessageTypes.LEGACY_LISTING_PREPARE_CANCEL, MessageTypes.SUBMIT_TX]);
      expect(messageAt(1).data).toEqual({ txCbor: TX_CBOR, witnessHex: 'DEVICE_WITNESSES' });
      expect(cosign).not.toHaveBeenCalled();
      expect(prompt.begin).toHaveBeenCalledWith('Ledger');
      expect(prompt.end).toHaveBeenCalled();
    });

    it("adds Nexus's witness for the collateral it lent, before submitting", async () => {
      respond({
        [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared({ ...SUMMARY, sponsoredCollateralRef: COLLATERAL_REF }),
        [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
      });
      deviceSign.mockResolvedValue('DEVICE_WITNESSES');
      cosign.mockResolvedValue({ witness: 'POOL_WITNESS' });
      const flow = useLegacyRescue();
      await flow.prepare(REFS);

      expect(await flow.signAndSubmit()).toBe(true);

      expect(cosign).toHaveBeenCalledWith(TX_CBOR, COLLATERAL_REF, 'cardano-mainnet');
      expect(messageAt(1).data).toEqual({ txCbor: TX_CBOR, witnessHex: 'DEVICE_WITNESSES+POOL_WITNESS' });
    });

    it('keeps the review when the device is cancelled or fails', async () => {
      respond({ [MessageTypes.LEGACY_LISTING_PREPARE_CANCEL]: prepared() });
      deviceSign.mockRejectedValue(new Error('Keystone signing cancelled'));
      const flow = useLegacyRescue();
      await flow.prepare(REFS);

      expect(await flow.signAndSubmit()).toBe(false);
      expect(flow.failure.value?.code).toBe('SIGN_FAILED');
      expect(flow.stage.value).toBe('review');
      expect(methods()).not.toContain(MessageTypes.SUBMIT_TX);
    });
  });
});

describe('usePreparedTxFlow', () => {
  it('names no CIP-113 message, constant or copy key: those stay in the CIP-113 wrapper', () => {
    const source = readFileSync(join(__dirname, 'usePreparedTxFlow.ts'), 'utf8');
    expect(source).not.toMatch(/cip113/i);
    expect(source).not.toMatch(/programmableTokens/);
  });
});
