import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  api: vi.fn(),
  health: vi.fn(),
  proofServer: { mode: 'remote', localUrl: 'http://localhost:6300' },
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
import { checkWalletProvingPreflight, registerNightForDust, sendShieldedNight, shieldNight } from './midnight-tx.service';

describe('Midnight ledger-specific orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proofServer.mode = 'remote';
    mocks.health.mockResolvedValue(true);
  });

  it.each(['remote', 'local', 'zkpaas'])('refuses Stagenet shielded sends before authorization or HTTP (%s)', async mode => {
    mocks.proofServer.mode = mode;
    for (const forceRemote of [false, true]) {
      await expect(sendShieldedNight('Stagenet', [{ receiverAddress: 'unused', amount: 1n }], {}, 'InBlock', undefined, forceRemote))
        .rejects.toThrow('Shielded transfers is not supported');
      await expect(shieldNight('Stagenet', 1n, {}, 'InBlock', undefined, forceRemote))
        .rejects.toThrow('Shielding is not supported');
    }
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it.each(['local', 'zkpaas'])('does not accept a ledger-8 prover health response for Stagenet (%s)', async mode => {
    mocks.proofServer.mode = mode;
    expect(await checkWalletProvingPreflight('Stagenet')).toBe(false);
    expect(mocks.health).not.toHaveBeenCalled();
    expect(await checkWalletProvingPreflight('Preprod')).toBe(true);
    expect(mocks.health).toHaveBeenCalledOnce();
  });

  it('retains remote unshielded availability without calling a local prover', async () => {
    expect(await checkWalletProvingPreflight('Stagenet')).toBe(true);
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
