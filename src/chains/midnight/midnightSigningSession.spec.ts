import { describe, expect, it } from 'vitest';
import { captureMidnightSigningSession, type MidnightSigningSessionState } from './midnightSigningSession';

describe('Midnight signing session', () => {
  it.each([
    { walletId: 2 }, { network: 'Mainnet' }, { locked: true }, { epoch: 2 }, { walletId: undefined },
  ])('rejects changed session %#', update => {
    let state: MidnightSigningSessionState = { walletId: 1, network: 'Stagenet', locked: false, epoch: 1 };
    const current = captureMidnightSigningSession(1, 'Stagenet', () => state);
    expect(current).not.toThrow();
    state = { ...state, ...update };
    expect(current).toThrow('Wallet changed or locked');
  });
  it('does not revive preparation when a locked wallet is unlocked again', () => {
    const state = { walletId: 1, network: 'Stagenet', locked: false, epoch: 1 };
    const current = captureMidnightSigningSession(1, 'Stagenet', () => state);
    state.locked = true; state.epoch += 1; state.locked = false;
    expect(current).toThrow();
  });
});
