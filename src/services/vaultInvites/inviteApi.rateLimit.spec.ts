// A 429 from gero-sync in the shared invite client: `Retry-After` is honoured, the same kind of
// request is held back here until it has passed, and it is never read as "offline".
import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_BACKOFF_CAP_MS, createInviteApi, rateLimitScope, type InviteTransport } from './inviteApi';

const SETUP = 'a1'.repeat(16);
const INVITE = 'b2'.repeat(16);
const RESPONSES = { setupId: SETUP, network: 'cardano-preprod', state: 'open', expiresAt: 9, invites: [], links: [], responses: [] };
const limited = (retryAfterMs?: number) => ({ name: 'NotifyError', status: 429, code: 'rate_limited', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });

function client() {
  let clock = 1_000_000;
  const send = vi.fn(async (): Promise<unknown> => RESPONSES);
  const api = createInviteApi({ send } as unknown as InviteTransport, { now: () => clock });
  return { api, send, tick: (ms: number) => { clock += ms; }, now: () => clock };
}

describe('rate limits in the invite client', () => {
  it('maps a 429 to rate_limited with the Retry-After, never to network', async () => {
    const c = client();
    c.send.mockRejectedValueOnce(limited(45_000));
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 45_000 });
  });

  it('a Retry-After the notify client deferred is still a rate limit, with the time left', async () => {
    const c = client();
    c.send.mockRejectedValueOnce({ name: 'NotifyDeferred', code: 'rate_limited', dueAt: c.now() + 1_800_000 });
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 1_800_000 });
    // Another deferral (a server fault) stays what it was.
    const other = client();
    other.send.mockRejectedValueOnce({ name: 'NotifyDeferred', code: 'http_503', dueAt: other.now() + 60_000 });
    await expect(other.api.responses(SETUP)).rejects.toMatchObject({ code: 'deferred' });
  });

  it('sends nothing of the same kind until Retry-After has passed, then asks again', async () => {
    const c = client();
    c.send.mockRejectedValueOnce(limited(120_000));
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(c.send).toHaveBeenCalledTimes(1);
    c.tick(119_000);
    // Both lists share gero-sync's limit (PROTOCOL 7.6).
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 1_000 });
    await expect(c.api.listInvites()).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 1_000 });
    expect(c.send).toHaveBeenCalledTimes(1);
    c.tick(1_000);
    await expect(c.api.responses(SETUP)).resolves.toMatchObject({ setupId: SETUP });
    expect(c.send).toHaveBeenCalledTimes(2);
  });

  it('does not hold back other kinds of request', async () => {
    const c = client();
    c.send.mockRejectedValueOnce(limited(120_000));
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ code: 'rate_limited' });
    c.send.mockResolvedValueOnce(null);
    await c.api.revoke(SETUP, INVITE, 'AbC');
    c.send.mockResolvedValueOnce(null);
    await c.api.deleteSetup(SETUP);
    expect(c.send).toHaveBeenCalledTimes(3);
  });

  it('a reminder limit holds that invitation only', async () => {
    const c = client();
    c.send.mockRejectedValueOnce(limited(6 * 3_600_000));
    await expect(c.api.remind(SETUP, INVITE)).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 6 * 3_600_000 });
    await expect(c.api.remind(SETUP, INVITE)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(c.send).toHaveBeenCalledTimes(1);
    c.send.mockResolvedValueOnce(null);
    await c.api.remind(SETUP, 'c3'.repeat(16));
    expect(c.send).toHaveBeenCalledTimes(2);
  });

  it('backs off on its own when no Retry-After came, doubling to a cap, and starts over after a success', async () => {
    const c = client();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      c.send.mockRejectedValueOnce(limited());
      const error = await c.api.responses(SETUP).then(() => ({ retryAfterMs: -1 }), e => e as { retryAfterMs: number });
      waits.push(error.retryAfterMs);
      c.tick(error.retryAfterMs);
    }
    expect(waits).toEqual([60_000, 120_000, 240_000, 480_000, RATE_LIMIT_BACKOFF_CAP_MS, RATE_LIMIT_BACKOFF_CAP_MS]);
    await c.api.responses(SETUP);
    c.send.mockRejectedValueOnce(limited());
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ retryAfterMs: 60_000 });
  });

  it('never waits less than gero-sync asked', async () => {
    const c = client();
    c.send.mockRejectedValueOnce(limited(3_600_000));
    await expect(c.api.responses(SETUP)).rejects.toMatchObject({ retryAfterMs: 3_600_000 });
  });

  it('names the limit each route counts against', () => {
    expect(rateLimitScope('GET', '/vault-invites')).toBe('read');
    expect(rateLimitScope('GET', `/vault-setups/${SETUP}/responses`)).toBe('read');
    expect(rateLimitScope('POST', `/vault-setups/${SETUP}/responses`)).toBe('respond');
    expect(rateLimitScope('POST', `/vault-setups/${SETUP}/invites`)).toBe('invite');
    expect(rateLimitScope('POST', '/vault-invites/recipients')).toBe('directory');
    expect(rateLimitScope('POST', '/vault-invites/by-link')).toBe('by-link');
    expect(rateLimitScope('POST', `/vault-setups/${SETUP}/invites/${INVITE}/remind`)).toBe(`remind:${INVITE}`);
    expect(rateLimitScope('POST', `/vault-setups/${SETUP}/invites/${INVITE}/revoke`)).toBeNull();
    expect(rateLimitScope('DELETE', `/vault-setups/${SETUP}`)).toBeNull();
  });
});
