import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  api: vi.fn(),
  health: vi.fn(),
  proofServer: { mode: 'remote', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301' },
  /** When true, the user has accepted the notice of the remote prover the current mode uses. */
  consented: true,
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: mocks.api }));
vi.mock('@/stores/midnightStore', () => ({
  midnightStore: {
    proofServer: mocks.proofServer,
    get shieldedProvingConsent() {
      if (!mocks.consented) return null;
      return { version: 4, acceptedAt: 1, provider: mocks.proofServer.mode === 'zkpaas' ? 'zkpaas' : 'cloud' };
    },
  },
}));
vi.mock('@/chains/midnight/midnightLocalProver', () => ({ checkProofServerHealth: mocks.health }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/chains/midnight/midnightZkpaas', () => ({
  resolveZkpaasUrl: () => 'https://prover.example',
  buildZkpaasHeaders: () => ({}),
  isZkpaasConfigured: () => true,
}));

import { MessageTypes } from '@/models/MessageTypes';
import { MidnightApiError } from '@/api/midnightApiError';
import { noteMidnightNetworkUpgrading, resetMidnightWriteGateForTests } from '@/chains/midnight/midnightWriteGate';
import { resetMidnightWriteStatusForTests } from '@/chains/midnight/midnightWriteStatus';
import { balanceConnectorTransaction, buildAndSignUnshieldedTransfer, buildConnectorIntent, checkWalletProvingPreflight, registerNightForDust, sendShieldedNight, sendUnshieldedNight, shieldNight } from './midnight-tx.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('Midnight ledger-specific orchestration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.consented = true;
    mocks.proofServer.mode = 'remote';
    mocks.proofServer.localUrlLedger9 = 'http://localhost:6301';
    mocks.health.mockResolvedValue(true);
  });

  it.each(['send', 'connector'])('stops %s before building or signing when authorization becomes stale', async operation => {
    let current = true;
    const keys = deferred<{ data: { success: boolean; publicKeyHex: string; addressHex: string } }>();
    const build = vi.fn();
    mocks.api.mockReturnValue({ buildUnshieldedTx: build });
    mocks.send.mockReturnValue(keys.promise);
    const request = { fromAddress: 'sender', outputs: [], ttlMs: 12345 };
    const result = operation === 'send'
      ? sendUnshieldedNight('Preprod', request, {}, undefined, undefined, false, () => current)
      : buildAndSignUnshieldedTransfer('Preprod', request, {}, undefined, () => current);
    const rejected = expect(result).rejects.toThrow('Approval is no longer current');
    // The write-gate check (midnightWriteGate.ts) runs first, so the key request is one tick later.
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    current = false;
    keys.resolve({ data: { success: true, publicKeyHex: '11', addressHex: '22' } });
    await rejected;
    expect(build).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(['send', 'connector'])('stops %s before signing when its transaction build becomes stale', async operation => {
    let current = true;
    const built = deferred<{ unprovenTxHex: string; txHash: string }>();
    const build = vi.fn().mockReturnValue(built.promise);
    mocks.api.mockReturnValue({ buildUnshieldedTx: build });
    mocks.send.mockResolvedValue({ data: { success: true, publicKeyHex: '11', addressHex: '22' } });
    const request = { fromAddress: 'sender', outputs: [], ttlMs: 12345 };
    const result = operation === 'send'
      ? sendUnshieldedNight('Preprod', request, {}, undefined, undefined, false, () => current)
      : buildAndSignUnshieldedTransfer('Preprod', request, {}, undefined, () => current);
    const rejected = expect(result).rejects.toThrow('Approval is no longer current');
    await vi.waitFor(() => expect(build).toHaveBeenCalledOnce());
    current = false;
    built.resolve({ unprovenTxHex: 'aa', txHash: 'built' });
    await rejected;
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it('never submits a public transaction whose signing approval was cancelled', async () => {
    let current = true;
    const signed = deferred<{ data: { success: boolean; signedTxHex: string; proven: boolean } }>();
    const submit = vi.fn();
    mocks.api.mockReturnValue({
      buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }), submitMidnightTx: submit, submitProvenMidnightTx: submit,
    });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockReturnValueOnce(signed.promise);
    const result = sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: 12345 }, {}, undefined, undefined, false, () => current);
    const rejected = expect(result).rejects.toThrow('Approval is no longer current');
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    current = false;
    // Gero Cloud mode proves a public send's fee on this device, so the BG returns it proven.
    signed.resolve({ data: { success: true, signedTxHex: 'bb', proven: true } });
    await rejected;
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['remote', 'local'])('never submits a stale shielded signing result through %s proving', async mode => {
    mocks.proofServer.mode = mode;
    let current = true;
    const signed = deferred<{ data: { success: boolean; signedTxHex: string; proven: boolean } }>();
    const submit = vi.fn();
    mocks.api.mockReturnValue({ submitProvenMidnightTx: submit, proveAndSubmitMidnightTx: submit });
    mocks.send.mockReturnValue(signed.promise);
    const result = sendShieldedNight('Preprod', [{ receiverAddress: 'recipient', amount: 1n, tokenType: '12'.repeat(32) }], {}, 'InBlock', undefined, false, undefined, () => current);
    const rejected = expect(result).rejects.toThrow('Approval is no longer current');
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    current = false;
    signed.resolve({ data: { success: true, signedTxHex: 'bb', proven: mode === 'local' } });
    await rejected;
    expect(submit).not.toHaveBeenCalled();
  });

  it('refuses stale connector balancing before dispatch and discards stale completions', async () => {
    let current = false;
    await expect(balanceConnectorTransaction('Preprod', 'aa', {}, () => current)).rejects.toThrow('Approval is no longer current');
    expect(mocks.send).not.toHaveBeenCalled();
    current = true;
    const signed = deferred<{ data: { success: boolean; tx: string } }>();
    mocks.send.mockReturnValue(signed.promise);
    const result = balanceConnectorTransaction('Preprod', 'aa', {}, () => current);
    const rejected = expect(result).rejects.toThrow('Approval is no longer current');
    // The write-gate check runs first, so the dispatch is one tick later.
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    current = false;
    signed.resolve({ data: { success: true, tx: 'signed' } });
    await rejected;
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(['remote', 'local', 'zkpaas'])('refuses native NIGHT privacy conversion before authorization or HTTP (%s)', async mode => {
    mocks.proofServer.mode = mode;
    for (const forceRemote of [false, true]) {
      await expect(sendShieldedNight('Stagenet', [{ receiverAddress: 'unused', amount: 1n, tokenType: 'native' }], {}, 'InBlock', undefined, forceRemote))
        .rejects.toThrow('unshielded token');
      await expect(shieldNight('Stagenet', 1n, {}, 'InBlock', undefined, forceRemote))
        .rejects.toThrow('NIGHT is a public token');
    }
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it.each(['local', 'zkpaas'])('checks the configured wallet-side prover for both ledger stacks (%s)', async mode => {
    mocks.proofServer.mode = mode;
    expect(await checkWalletProvingPreflight('Stagenet')).toBe(true);
    expect(await checkWalletProvingPreflight('Preprod')).toBe(true);
    expect(mocks.health).toHaveBeenCalledTimes(2);
  });

  it('retains remote unshielded availability without calling a local prover', async () => {
    expect(await checkWalletProvingPreflight('Stagenet')).toBe(true);
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it.each(['remote', 'local', 'zkpaas'])('routes a shielded custom token through the selected prover (%s)', async mode => {
    mocks.proofServer.mode = mode;
    const submitProven = vi.fn().mockResolvedValue({ txHash: 'confirmed', status: 'InBlock' });
    const proveAndSubmit = vi.fn().mockResolvedValue({ txHash: 'confirmed', status: 'InBlock' });
    mocks.api.mockReturnValue({ submitProvenMidnightTx: submitProven, proveAndSubmitMidnightTx: proveAndSubmit });
    mocks.send.mockResolvedValue({ data: { success: true, signedTxHex: 'aabb', proven: mode !== 'remote' } });
    const sponsor = { walletId: 2, password: 'synthetic-test-password' };
    const stages: string[] = [];
    await sendShieldedNight('Stagenet', [{ receiverAddress: 'shielded-recipient', amount: 7n, tokenType: '12'.repeat(32) }], {}, 'InBlock', (s) => stages.push(s), false, sponsor);
    // Gero Cloud proves inside the submit request: the timeline names it (X-09).
    expect(stages).toContain(mode === 'remote' ? 'provingCloud' : 'submitting');
    expect(stages).not.toContain(mode === 'remote' ? 'submitting' : 'provingCloud');
    expect(mocks.send.mock.calls[0][0].data.outputs[0].tokenType).toBe('12'.repeat(32));
    expect(mocks.send.mock.calls[0][0].data.sponsor.walletId).toBe(2);
    expect(submitProven).toHaveBeenCalledTimes(mode === 'remote' ? 0 : 1);
    expect(proveAndSubmit).toHaveBeenCalledTimes(mode === 'remote' ? 1 : 0);
  });

  it.each(['local', 'zkpaas'])('honors %s proving for a public send, including DUST witnesses', async mode => {
    mocks.proofServer.mode = mode;
    const cloud = vi.fn();
    const submitProven = vi.fn().mockResolvedValue({ txHash: 'confirmed' });
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitProvenMidnightTx: submitProven, submitMidnightTx: cloud });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'bb', proven: true } });
    await sendUnshieldedNight('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {});
    // Stagenet is ledger 9, so local mode reaches the ledger-9 server — not the ledger-8 one at :6300.
    expect(mocks.send.mock.calls[1][0].data.proving.url).toBe(mode === 'local' ? 'http://localhost:6301' : 'https://prover.example');
    expect(submitProven).toHaveBeenCalledOnce();
    expect(cloud).not.toHaveBeenCalled();
  });

  it.each(['local', 'zkpaas'])('dapp makeTransfer proves with the %s prover and never hands Gero the proof inputs (PRIV-01)', async mode => {
    mocks.proofServer.mode = mode;
    const cloud = vi.fn();
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }), submitMidnightTx: cloud });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'sealed', proven: true } });
    const { tx } = await buildAndSignUnshieldedTransfer('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {});
    expect(tx).toBe('sealed');
    expect(mocks.send.mock.calls[1][0].data.proving.url).toBe(mode === 'local' ? 'http://localhost:6300' : 'https://prover.example');
    expect(cloud).not.toHaveBeenCalled();
  });

  it('dapp makeTransfer refuses when the prover changed after approval (Local approved, zkPaaS at build)', async () => {
    // PRIV-01 review P1: approve in Local mode, switch to zkPaaS while the PassKey prompt is open.
    mocks.proofServer.mode = 'zkpaas';
    await expect(buildAndSignUnshieldedTransfer('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, 'local'))
      .rejects.toThrow('The proof-server setting changed during approval');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it('refuses to build for a zkpaas prover without its recorded consent, before any credential is used', async () => {
    mocks.proofServer.mode = 'zkpaas';
    mocks.consented = false;
    const client = { buildUnshieldedTx: vi.fn(), submitMidnightTx: vi.fn(), submitProvenMidnightTx: vi.fn(), proveAndSubmitMidnightTx: vi.fn() };
    mocks.api.mockReturnValue(client);
    const req = { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 };
    await expect(buildAndSignUnshieldedTransfer('Preprod', req, {}, 'zkpaas')).rejects.toThrow('needs your consent');
    await expect(sendUnshieldedNight('Preprod', req, {})).rejects.toThrow('needs your consent');
    await expect(sendShieldedNight('Preprod', [{ receiverAddress: 'r', amount: 1n, tokenType: '12'.repeat(32) }], {})).rejects.toThrow('needs your consent');
    expect(mocks.send).not.toHaveBeenCalled();
    // No request reaches Nexus (getting the client object sends nothing).
    for (const method of Object.values(client)) expect(method).not.toHaveBeenCalled();
  });

  it('in Gero Cloud mode needs consent only where Gero Cloud still proves: private sends and Stagenet', async () => {
    mocks.consented = false;
    const client = { buildUnshieldedTx: vi.fn(), submitMidnightTx: vi.fn(), submitProvenMidnightTx: vi.fn(), proveAndSubmitMidnightTx: vi.fn() };
    mocks.api.mockReturnValue(client);
    const req = { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 };
    await expect(sendShieldedNight('Preprod', [{ receiverAddress: 'r', amount: 1n, tokenType: '12'.repeat(32) }], {})).rejects.toThrow('needs your consent');
    await expect(sendUnshieldedNight('Stagenet', req, {})).rejects.toThrow('needs your consent');
    await expect(buildAndSignUnshieldedTransfer('Stagenet', req, {}, 'cloud')).rejects.toThrow('needs your consent');
    expect(mocks.send).not.toHaveBeenCalled();
    for (const method of Object.values(client)) expect(method).not.toHaveBeenCalled();
  });

  it('proves a public send\'s DUST fee on this device in Gero Cloud mode, with no consent and nothing secret to Gero', async () => {
    mocks.consented = false;
    const submitProven = vi.fn().mockResolvedValue({ txHash: '0xextrinsic', status: 'InBlock' });
    const submitRemote = vi.fn();
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitProvenMidnightTx: submitProven, submitMidnightTx: submitRemote });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'sealed', proven: true, ledgerTxHash: 'ledger', txIdentifiers: ['00ab'] } });
    const result = await sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {});
    expect(mocks.send.mock.calls[1][0].data.proving).toEqual({ device: true });
    expect(mocks.health).not.toHaveBeenCalled();
    expect(submitRemote).not.toHaveBeenCalled();
    expect(submitProven).toHaveBeenCalledWith({ signedTxHex: 'sealed', waitFor: 'InBlock' }, { identifiers: ['00ab'] });
    expect(result.ledgerTxHash).toBe('ledger');
  });

  it('the one-off fallback from an unreachable local server proves a public send on this device, not on Gero Cloud', async () => {
    mocks.proofServer.mode = 'local';
    mocks.consented = false;
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitProvenMidnightTx: vi.fn().mockResolvedValue({ txHash: '0x1', status: 'InBlock' }) });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'sealed', proven: true } });
    await sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, undefined, undefined, true);
    expect(mocks.send.mock.calls[1][0].data.proving).toEqual({ device: true });
  });

  it('dapp makeTransfer in Gero Cloud mode proves the fee on this device and returns a sealed tx', async () => {
    mocks.consented = false;
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }) });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'sealed', proven: true } });
    const { tx } = await buildAndSignUnshieldedTransfer('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, 'device');
    expect(tx).toBe('sealed');
    expect(mocks.send.mock.calls[1][0].data.proving).toEqual({ device: true });
  });

  it('dapp makeTransfer on Stagenet in Gero Cloud mode returns the tx unproven, for Gero Cloud to prove on submit', async () => {
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }) });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'unproven', proven: false } });
    const { tx } = await buildAndSignUnshieldedTransfer('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {});
    expect(tx).toBe('unproven');
    expect(mocks.send.mock.calls[1][0].data.proving).toBeUndefined();
  });

  it('dapp makeTransfer refuses an unreachable or non-loopback local prover instead of falling back to Gero Cloud', async () => {
    mocks.proofServer.mode = 'local';
    mocks.health.mockResolvedValue(false);
    await expect(buildAndSignUnshieldedTransfer('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}))
      .rejects.toThrow('Proof server not reachable');
    mocks.health.mockResolvedValue(true);
    const saved = mocks.proofServer.localUrl;
    mocks.proofServer.localUrl = 'https://abc.trycloudflare.com';
    try {
      await expect(buildAndSignUnshieldedTransfer('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}))
        .rejects.toThrow('Proof server not reachable');
    } finally { mocks.proofServer.localUrl = saved; }
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('fails before authorization when the preferred prover is unreachable, without implicit cloud fallback', async () => {
    mocks.proofServer.mode = 'local';
    mocks.health.mockResolvedValue(false);
    await expect(sendUnshieldedNight('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}))
      .rejects.toThrow('Proof server not reachable');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('fails before authorization when no ledger-9 URL is set for Stagenet, without touching the ledger-8 server', async () => {
    mocks.proofServer.mode = 'local'; mocks.proofServer.localUrlLedger9 = '';
    expect(await checkWalletProvingPreflight('Stagenet', 'unshielded')).toBe(false);
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it('passes the registration envelope to background validation and never submits a rejected payload', async () => {
    const submit = vi.fn();
    mocks.api.mockReturnValue({
      buildNightDustRegistrationTx: vi.fn().mockResolvedValue({ unprovenTxHex: 'aabb', signaturePayloadHex: '0xcc' }),
      submitNightDustRegistrationTx: submit,
    });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: 'dd', addressHex: 'ee' } })
      .mockResolvedValueOnce({ data: { success: false, error: 'Signing payload mismatch' } });
    const result = await registerNightForDust('Stagenet', { fromAddress: 'unused', dustReceiverAddressBech32: 'unused' }, {});
    expect(mocks.send).toHaveBeenLastCalledWith({
      method: MessageTypes.SIGN_MIDNIGHT_SEGMENTS,
      data: {
        segments: [{ index: 1, role: 'NightExternal', dataHex: '0xcc' }], unprovenTxHex: 'aabb',
        // The background checks the registration against the chosen DUST address before signing.
        dustReceiverAddressBech32: 'unused', password: undefined, prfSecret: undefined,
      },
    });
    expect(result).toEqual({ status: 'failed', message: 'Signing payload mismatch' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('hands the background the requested outputs, and reports a refused build in the user\'s language', async () => {
    const outputs = [{ address: 'mn_addr_preprod1recipient', amount: '10', token: 'NIGHT' }];
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }), submitMidnightTx: vi.fn() });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: false, error: 'MIDNIGHT_BUILT_TX_MISMATCH' } });
    await expect(sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs, ttlMs: Date.now() + 60000 }, {}))
      .rejects.toThrow('txGuard.builtTxMismatch');
    expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({
      method: MessageTypes.BALANCE_AND_SIGN_MIDNIGHT_UNSHIELDED_TX,
      data: expect.objectContaining({ unprovenTxHex: 'aa', intendedOutputs: outputs }),
    }));
  });

  it.each([
    ['MIDNIGHT_BUILT_TX_MISMATCH', 'txGuard.builtTxMismatch'],
    ['MIDNIGHT_BUILT_TX_UNREADABLE', 'txGuard.builtTxUnreadable'],
    ['MIDNIGHT_BUILT_TX_LEDGER_UNSUPPORTED', 'midnight.errors.updateRequired'],
  ])('reports the background refusal %s with its own copy and code, and submits nothing', async (code, copy) => {
    const submit = vi.fn();
    const submitProven = vi.fn();
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }), submitMidnightTx: submit, submitProvenMidnightTx: submitProven });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: false, error: code } });
    const thrown = await sendUnshieldedNight('Preprod', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {})
      .catch((e: unknown) => e);
    expect(thrown).toMatchObject({ name: 'MidnightBuiltTxRefusedError', code, message: copy });
    expect(submit).not.toHaveBeenCalled();
    expect(submitProven).not.toHaveBeenCalled();
  });

  it('a LEDGER_MISMATCH send can be tried again, and the retry asks for a new build', async () => {
    const build = vi.fn().mockResolvedValue({ unprovenTxHex: 'aa', txHash: 'built' });
    const submitProven = vi.fn()
      .mockRejectedValueOnce(new MidnightApiError('ledgerMismatch', { status: 409, errorCode: 'LEDGER_MISMATCH' }, 'Preprod'))
      .mockResolvedValueOnce({ txHash: 'ok', status: 'InBlock' });
    mocks.api.mockReturnValue({ buildUnshieldedTx: build, submitProvenMidnightTx: submitProven });
    mocks.send.mockImplementation(async ({ method }: { method: MessageTypes }) => (method === MessageTypes.GET_MIDNIGHT_WALLET_KEYS
      ? { data: { success: true, publicKeyHex: '11', addressHex: '22' } }
      : { data: { success: true, signedTxHex: 'signed', proven: true } }));
    const request = { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 };
    await expect(sendUnshieldedNight('Preprod', request, {})).rejects.toMatchObject({ kind: 'ledgerMismatch', message: 'midnight.errors.ledgerMismatch' });
    expect(build).toHaveBeenCalledTimes(1);
    await expect(sendUnshieldedNight('Preprod', request, {})).resolves.toMatchObject({ txHash: 'ok' });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('classifies a DUST registration failure by the server\'s own sentence, and keeps its kind', async () => {
    const build = vi.fn();
    mocks.api.mockReturnValue({ buildNightDustRegistrationTx: build });
    mocks.send.mockResolvedValue({ data: { success: true, publicKeyHex: 'dd', addressHex: 'ee' } });
    build.mockRejectedValueOnce(new MidnightApiError('server', { status: 400, message: 'No NIGHT UTxOs available' }, 'Preprod'));
    await expect(registerNightForDust('Preprod', { fromAddress: 'a', dustReceiverAddressBech32: 'd' }, {}))
      .resolves.toEqual({ status: 'no_night_utxos', message: 'No NIGHT UTxOs available' });
    build.mockRejectedValueOnce(new MidnightApiError('networkUpgrading', { status: 501, errorCode: 'MIDNIGHT_NETWORK_UPGRADING' }, 'Preprod'));
    await expect(registerNightForDust('Preprod', { fromAddress: 'a', dustReceiverAddressBech32: 'd' }, {}))
      .resolves.toEqual({ status: 'failed', message: 'midnight.errors.networkUpgrading', errorKind: 'networkUpgrading' });
  });

  describe('on a network whose sends are paused for an upgrade', () => {
    beforeEach(async () => {
      resetMidnightWriteGateForTests();
      resetMidnightWriteStatusForTests();
      await noteMidnightNetworkUpgrading('Preprod', 'response');
    });
    afterEach(() => resetMidnightWriteGateForTests());
    const request = { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 };

    it('a public send stops before keys, build or signing', async () => {
      const build = vi.fn();
      mocks.api.mockReturnValue({ buildUnshieldedTx: build });
      await expect(sendUnshieldedNight('Preprod', request, {})).rejects.toMatchObject({ kind: 'networkUpgrading' });
      expect(mocks.send).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
    });

    it('a private send stops before the shielded sync and before proving', async () => {
      const proveAndSubmit = vi.fn();
      mocks.api.mockReturnValue({ proveAndSubmitMidnightTx: proveAndSubmit, getWriteStatus: async () => ({ kind: 'unknown', unsupported: true }) });
      await expect(sendShieldedNight('Preprod', [{ receiverAddress: 'r', amount: 1n, tokenType: '12'.repeat(32) }], {}))
        .rejects.toMatchObject({ kind: 'networkUpgrading' });
      // The background builds, syncs and proves: it is never asked.
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.health).not.toHaveBeenCalled();
      expect(proveAndSubmit).not.toHaveBeenCalled();
    });

    it('a private send asks the status read first, so a pause the wallet did not know about also stops it there', async () => {
      resetMidnightWriteGateForTests();
      const getWriteStatus = vi.fn(async () => ({ kind: 'closed', reason: 'NETWORK_UPGRADING' }));
      mocks.api.mockReturnValue({ getWriteStatus });
      await expect(sendShieldedNight('Mainnet', [{ receiverAddress: 'r', amount: 1n, tokenType: '12'.repeat(32) }], {}))
        .rejects.toMatchObject({ kind: 'networkUpgrading' });
      expect(getWriteStatus).toHaveBeenCalledOnce();
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('a dapp makeTransfer, balance, makeIntent and a DUST registration stop before keys', async () => {
      mocks.api.mockReturnValue({ buildUnshieldedTx: vi.fn(), buildNightDustRegistrationTx: vi.fn() });
      await expect(buildAndSignUnshieldedTransfer('Preprod', request, {})).rejects.toMatchObject({ kind: 'networkUpgrading' });
      await expect(balanceConnectorTransaction('Preprod', 'aa', {})).rejects.toMatchObject({ kind: 'networkUpgrading' });
      await expect(buildConnectorIntent('Preprod', { desiredInputs: [], desiredOutputs: [], options: {} }, {}))
        .rejects.toMatchObject({ kind: 'networkUpgrading' });
      await expect(registerNightForDust('Preprod', { fromAddress: 'a', dustReceiverAddressBech32: 'd' }, {}))
        .resolves.toEqual({ status: 'failed', message: 'midnight.errors.networkUpgrading', errorKind: 'networkUpgrading' });
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('another network is not affected', async () => {
      const build = vi.fn().mockRejectedValue(new Error('reached the build'));
      mocks.api.mockReturnValue({ buildUnshieldedTx: build });
      mocks.send.mockResolvedValue({ data: { success: true, publicKeyHex: '11', addressHex: '22' } });
      await expect(sendUnshieldedNight('Mainnet', request, {})).rejects.toThrow('reached the build');
      expect(build).toHaveBeenCalledOnce();
    });
  });

  // ── which side names the ledger hash ─────────────────────────────────────
  //
  // The relay's txHash is the Substrate extrinsic hash; history is keyed on
  // the ledger hash. Exactly one side can produce it per path: the sidecar
  // on the remote paths, the wallet's own prover on the proven path.

  it('surfaces the sidecar ledger hash on a remote public send', async () => {
    // Gero Cloud still proves public sends on Stagenet (no on-device keys for ledger 9).
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitMidnightTx: vi.fn().mockResolvedValue({ txHash: '0xextrinsic', status: 'InBlock', ledgerTxHash: '0xledger' }) });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'bb', proven: false } });
    const stages: string[] = [];
    const result = await sendUnshieldedNight('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}, (s) => stages.push(s));
    expect(result).toEqual({ txHash: '0xextrinsic', status: 'InBlock', ledgerTxHash: '0xledger' });
    // The transaction is unproven, so Gero Cloud proves it inside the submit.
    expect(stages.slice(-2)).toEqual(['provingCloud', 'done']);
  });

  it('carries the wallet-proved ledger hash onto a submit-proven result that has none', async () => {
    mocks.proofServer.mode = 'local';
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitProvenMidnightTx: vi.fn().mockResolvedValue({ txHash: '0xextrinsic', status: 'InBlock' }) });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'bb', proven: true, ledgerTxHash: 'ledger-from-bg' } });
    const result = await sendUnshieldedNight('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {});
    expect(result.ledgerTxHash).toBe('ledger-from-bg');
    expect(result.txHash).toBe('0xextrinsic');
  });

  it('carries the wallet-proved ledger hash for a locally proven shielded send', async () => {
    mocks.proofServer.mode = 'local';
    mocks.api.mockReturnValue({ submitProvenMidnightTx: vi.fn().mockResolvedValue({ txHash: '0xextrinsic', status: 'InBlock' }) });
    mocks.send.mockResolvedValue({ data: { success: true, signedTxHex: 'aabb', proven: true, ledgerTxHash: 'ledger-from-bg' } });
    const result = await sendShieldedNight('Stagenet', [{ receiverAddress: 'shielded-recipient', amount: 7n, tokenType: '12'.repeat(32) }], {});
    expect(result.ledgerTxHash).toBe('ledger-from-bg');
  });

  it('leaves the result without a ledger hash when neither side had one (older Nexus)', async () => {
    mocks.api.mockReturnValue({ buildUnshieldedTx: async () => ({ unprovenTxHex: 'aa', txHash: 'built' }),
      submitMidnightTx: vi.fn().mockResolvedValue({ txHash: '0xextrinsic', status: 'InBlock' }) });
    mocks.send.mockResolvedValueOnce({ data: { success: true, publicKeyHex: '11', addressHex: '22' } })
      .mockResolvedValueOnce({ data: { success: true, signedTxHex: 'bb', proven: false } });
    const result = await sendUnshieldedNight('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {});
    expect(result).toEqual({ txHash: '0xextrinsic', status: 'InBlock' });
    expect('ledgerTxHash' in result).toBe(false);
  });
});
