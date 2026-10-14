import { describe, expect, it, vi } from 'vitest';
import { UnlockTargetChangedError, unlockAfterStartup } from './unlockStartup';

describe('unlock during worker startup', () => {
  it('waits for the real startup promise before verifying the password', async () => {
    let ready!: () => void;
    const startup = new Promise<void>(resolve => { ready = resolve; });
    const unlock = vi.fn().mockResolvedValue(true);
    const result = unlockAfterStartup(startup, 7, () => 7, unlock);
    await Promise.resolve();
    expect(unlock).not.toHaveBeenCalled();
    ready();
    await expect(result).resolves.toBe(true);
    expect(unlock).toHaveBeenCalledOnce();
  });

  it.each([undefined, 8])('refuses a request if startup selects another wallet (%s)', async activeId => {
    const unlock = vi.fn();
    await expect(unlockAfterStartup(Promise.resolve(), 7, () => activeId, unlock)).rejects.toBeInstanceOf(UnlockTargetChangedError);
    expect(unlock).not.toHaveBeenCalled();
  });

  it.each([undefined, '7', NaN])('refuses an unbound request (%s)', async walletId => {
    const unlock = vi.fn();
    await expect(unlockAfterStartup(Promise.resolve(), walletId, () => 7, unlock)).rejects.toBeInstanceOf(UnlockTargetChangedError);
    expect(unlock).not.toHaveBeenCalled();
  });
});
