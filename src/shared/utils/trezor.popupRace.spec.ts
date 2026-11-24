// Without Trezor Suite desktop, Connect runs each call in its Suite Web popup and closes the popup
// when the call ends. Pairing asks getFeatures and then the account keys back to back, and the
// second call met the first one's popup closing: "Popup closed", nothing paired (issue 1653).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reads chrome.runtime.id as it loads (TREZOR_MANIFEST).
vi.hoisted(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'test-extension-id' } };
});

const { connect } = vi.hoisted(() => ({
  connect: { init: vi.fn(async () => undefined), getFeatures: vi.fn(), cardanoGetPublicKey: vi.fn() },
}));
vi.mock('@trezor/connect-webextension', () => ({ default: connect }));

import trezor, { callAfterPopup, POPUP_CLOSE_RACE_MS } from './trezor';

const POPUP_CLOSED = { success: false, error: { message: 'Popup closed', code: 'Method_Interrupted' } } as const;
const FEATURES = { success: true, payload: { label: 'My Trezor', model: 'T' } };
const accountKey = (byte: string) => ({ node: { public_key: byte.repeat(32), chain_code: 'cc'.repeat(32) } });
const KEYS = { success: true, payload: [accountKey('0a'), accountKey('0b')] };

describe('callAfterPopup', () => {
  it('sends the call again once when it met the previous popup closing', async () => {
    const call = vi.fn().mockResolvedValueOnce(POPUP_CLOSED).mockResolvedValueOnce({ success: true, payload: 1 });
    await expect(callAfterPopup(call, () => 0)).resolves.toEqual({ success: true, payload: 1 });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('retries only once', async () => {
    const call = vi.fn().mockResolvedValue(POPUP_CLOSED);
    await expect(callAfterPopup(call, () => 0)).resolves.toEqual(POPUP_CLOSED);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('answers a popup the user closed as it came', async () => {
    let time = 0;
    const call = vi.fn(async () => { time += POPUP_CLOSE_RACE_MS + 1; return POPUP_CLOSED; });
    await expect(callAfterPopup(call, () => time)).resolves.toEqual(POPUP_CLOSED);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not retry another failure or a success', async () => {
    const cancelled = { success: false, error: { message: 'Cancelled', code: 'Method_Cancel' } };
    const failed = vi.fn().mockResolvedValue(cancelled);
    await expect(callAfterPopup(failed, () => 0)).resolves.toEqual(cancelled);
    expect(failed).toHaveBeenCalledTimes(1);

    const succeeded = vi.fn().mockResolvedValue(FEATURES);
    await expect(callAfterPopup(succeeded, () => 0)).resolves.toEqual(FEATURES);
    expect(succeeded).toHaveBeenCalledTimes(1);
  });
});

describe('pairing a Trezor through the Suite Web popup', () => {
  beforeEach(() => {
    connect.getFeatures.mockResolvedValue(FEATURES);
  });
  afterEach(() => {
    // Reset, not clear: an unused queued answer must not reach the next test.
    vi.resetAllMocks();
  });

  it('pairs when the key request meets the getFeatures popup closing', async () => {
    connect.cardanoGetPublicKey.mockResolvedValueOnce(POPUP_CLOSED).mockResolvedValueOnce(KEYS);

    const paired = await trezor.getAccountXpubs([0, 1]);

    expect(connect.cardanoGetPublicKey).toHaveBeenCalledTimes(2);
    expect(paired.productName).toBe('My Trezor');
    expect(paired.accounts.map((account) => account.accountIndex)).toEqual([0, 1]);
  });

  it('still fails when the user closes the popup', async () => {
    vi.useFakeTimers();
    try {
      connect.cardanoGetPublicKey.mockImplementation(async () => {
        vi.advanceTimersByTime(POPUP_CLOSE_RACE_MS + 1);
        return POPUP_CLOSED;
      });

      await expect(trezor.getAccountXpubs([0])).rejects.toThrow('Popup closed');
      expect(connect.cardanoGetPublicKey).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
