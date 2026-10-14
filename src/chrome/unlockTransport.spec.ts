import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageTypes } from '@/models/MessageTypes';
import { sendUnlockAfterWake } from './unlockTransport';

const send = vi.hoisted(() => vi.fn());
vi.mock('./messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
const request = { method: MessageTypes.UNLOCK as const, data: { walletId: 7, unlockCredential: 'public-test-password' } };
beforeEach(() => { vi.useFakeTimers(); send.mockReset(); });
afterEach(() => vi.useRealTimers());

describe('unlock transport after worker termination', () => {
  it('retries only the read-only wake probe, then dispatches credentials once', async () => {
    send.mockResolvedValueOnce({ error: 'The message port closed before a response was received.' })
      .mockResolvedValueOnce({ data: { ready: true } }).mockResolvedValueOnce({ data: { success: true } });
    const result = sendUnlockAfterWake(request, () => true);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ data: { success: true } });
    expect(send.mock.calls.map(([message]) => message.method)).toEqual(['BACKGROUND_READY', 'BACKGROUND_READY', 'UNLOCK']);
    expect(send.mock.calls[0][0].data).toEqual({});
    expect(send.mock.calls[1][0].data).toEqual({});
  });

  it.each([{ error: 'The message port closed before a response was received.' }, { data: { success: false } }])
  ('does not replay an unlock after an ambiguous or refused response', async response => {
    send.mockResolvedValueOnce({ data: { ready: true } }).mockResolvedValueOnce(response);
    await expect(sendUnlockAfterWake(request, () => true)).resolves.toEqual(response);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not send credentials if the page closes or the wallet changes during wake', async () => {
    let current = true;
    send.mockImplementation(async () => { current = false; return { data: { ready: true } }; });
    await expect(sendUnlockAfterWake(request, () => current)).resolves.toHaveProperty('error');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bounds unresponsive probes and never sends credentials without readiness', async () => {
    send.mockImplementation(() => new Promise(() => {}));
    const result = sendUnlockAfterWake(request, () => true);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toHaveProperty('error');
    expect(send).toHaveBeenCalledTimes(10);
    expect(send.mock.calls.every(([message]) => message.method === 'BACKGROUND_READY')).toBe(true);
  });
});
