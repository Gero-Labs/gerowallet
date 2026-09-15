import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  api: vi.fn(),
  health: vi.fn(),
  proofServer: { mode: 'remote', localUrl: 'http://localhost:6300', localProfile: 'stagenet' },
}));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.send } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: mocks.api }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { proofServer: mocks.proofServer } }));
vi.mock('@/chains/midnight/midnightLocalProver', () => ({ checkProofServerHealth: mocks.health }));
vi.mock('@/chains/midnight/midnightZkpaas', () => ({
  resolveZkpaasUrl: () => 'https://prover.example',
  buildZkpaasHeaders: () => ({}),
  isZkpaasConfigured: () => true,
}));

import { MessageTypes } from '@/models/MessageTypes';
import { checkWalletProvingPreflight, registerNightForDust, sendShieldedNight, sendUnshieldedNight, shieldNight } from './midnight-tx.service';

describe('Midnight ledger-specific orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proofServer.mode = 'remote';
    mocks.proofServer.localProfile = 'stagenet';
    mocks.health.mockResolvedValue(true);
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
    mocks.proofServer.localProfile = 'legacy';
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
    await sendShieldedNight('Stagenet', [{ receiverAddress: 'shielded-recipient', amount: 7n, tokenType: '12'.repeat(32) }], {}, 'InBlock', undefined, false, sponsor);
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
    expect(mocks.send.mock.calls[1][0].data.proving.url).toBe(mode === 'local' ? 'http://localhost:6300' : 'https://prover.example');
    expect(submitProven).toHaveBeenCalledOnce();
    expect(cloud).not.toHaveBeenCalled();
  });

  it('fails before authorization when the preferred prover is unreachable, without implicit cloud fallback', async () => {
    mocks.proofServer.mode = 'local';
    mocks.health.mockResolvedValue(false);
    await expect(sendUnshieldedNight('Stagenet', { fromAddress: 'sender', outputs: [], ttlMs: Date.now() + 60000 }, {}))
      .rejects.toThrow('Proof server not reachable');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it('rejects the declared legacy local server for Stagenet even when its health endpoint is reachable', async () => {
    mocks.proofServer.mode = 'local'; mocks.proofServer.localProfile = 'legacy';
    expect(await checkWalletProvingPreflight('Stagenet')).toBe(false);
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
      data: { segments: [{ index: 1, role: 'NightExternal', dataHex: '0xcc' }], unprovenTxHex: 'aabb', password: undefined, prfSecret: undefined },
    });
    expect(result).toEqual({ status: 'failed', message: 'Signing payload mismatch' });
    expect(submit).not.toHaveBeenCalled();
  });
});
