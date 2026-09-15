// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock('./midnightPrivateSync', () => ({ startMidnightPrivateSync: mocks.start, stopMidnightPrivateSync: mocks.stop }));
import { prepareMidnightPrivateSession, activateMidnightPrivateSession, clearMidnightPrivateSession, midnightPrivateSessionEpoch } from './midnightPrivateSyncSession';

beforeEach(async () => { await clearMidnightPrivateSession(); vi.clearAllMocks(); });

describe('private key unlock lifetime', () => {
  it('holds an independent copy until the matching wallet logs in, then wipes the handoff buffer', async () => {
    const seed = new Uint8Array(32).fill(7);
    let received: Uint8Array | undefined;
    mocks.start.mockImplementation(async (args: { seed: Uint8Array }) => {
      expect(args.seed).toEqual(new Uint8Array(32).fill(7));
      received = args.seed;
    });
    prepareMidnightPrivateSession(1, 'Stagenet', seed, midnightPrivateSessionEpoch());
    seed.fill(0);
    await activateMidnightPrivateSession(2, 'Stagenet');
    await activateMidnightPrivateSession(1, 'Preprod');
    expect(mocks.start).not.toHaveBeenCalled();
    await activateMidnightPrivateSession(1, 'Stagenet');
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(received).toEqual(new Uint8Array(32));
    await activateMidnightPrivateSession(1, 'Stagenet');
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('does not reactivate from a derivation that completes after a lock', async () => {
    const beforeUnlock = midnightPrivateSessionEpoch();
    await clearMidnightPrivateSession();
    prepareMidnightPrivateSession(1, 'Stagenet', new Uint8Array(32).fill(7), beforeUnlock);
    await activateMidnightPrivateSession(1, 'Stagenet');
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('drops prepared key material on an explicit logout', async () => {
    prepareMidnightPrivateSession(1, 'Stagenet', new Uint8Array(32).fill(7), midnightPrivateSessionEpoch());
    await clearMidnightPrivateSession();
    await activateMidnightPrivateSession(1, 'Stagenet');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('can preserve an already authorized incoming wallet while retiring the outgoing wallet', async () => {
    mocks.start.mockResolvedValue(undefined);
    prepareMidnightPrivateSession(2, 'Stagenet', new Uint8Array(32).fill(7), midnightPrivateSessionEpoch());
    await clearMidnightPrivateSession(1);
    await activateMidnightPrivateSession(2, 'Stagenet');
    expect(mocks.start).toHaveBeenCalledOnce();
  });
});
