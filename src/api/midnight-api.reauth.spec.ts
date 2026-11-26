// @vitest-environment node
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

// As the real service does: after a login, the cached token is the new one.
const auth = vi.hoisted(() => {
  let cached = 'token-1';
  return {
    reset: () => { cached = 'token-1'; },
    token: vi.fn(async () => cached),
    reauth: vi.fn(async (_refused?: string) => { cached = 'token-2'; return cached; }),
  };
});
vi.mock('@/services/nexusDevice.service', () => ({ getNexusAccessToken: auth.token, reauthenticateNexus: auth.reauth }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

const { MidnightApi } = await import('./midnight-api');

const state = { dust_balance: '1', dust_generating: '0', dust_cap: '0', night_registered: '0',
  dust_registration_status: 'Unregistered', dust_generation_status: 'empty', dust_time_remaining_seconds: null };
const originalAdapter = axios.defaults.adapter;
afterEach(() => { axios.defaults.adapter = originalAdapter; auth.reauth.mockClear(); auth.reset(); });

describe('MidnightApi re-authentication', () => {
  it.each([401, 403])('hands re-authentication the token the %i refused, and retries with the new one', async status => {
    const sent: unknown[] = [];
    const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
      sent.push(config.headers.Authorization);
      const response = { status: sent.length === 1 ? status : 200, statusText: '', headers: {}, config, data: sent.length === 1 ? {} : state };
      if (sent.length === 1) throw new AxiosError('refused', 'ERR_BAD_REQUEST', config, null, response);
      return response;
    };
    axios.defaults.adapter = adapter;

    await expect(new MidnightApi('Mainnet').getDustAccountState('mn_addr_test')).resolves.toMatchObject({ dust_balance: '1' });
    expect(auth.reauth).toHaveBeenCalledOnce();
    expect(auth.reauth).toHaveBeenCalledWith('token-1');
    expect(sent).toEqual(['Bearer token-1', 'Bearer token-2']);
  });
});
