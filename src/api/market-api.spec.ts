import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/nexusDevice.service', () => ({
  getNexusAccessToken: vi.fn().mockResolvedValue('device-jwt-token'),
  reauthenticateNexus: vi.fn().mockResolvedValue('fresh-jwt-token'),
}));

describe('market-api axios instance', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./market-api');
    expect(mod.marketAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('request interceptor attaches the device bearer token', async () => {
    const mod = await import('./market-api');
    const handlers = (mod.marketAxiosInstance.interceptors.request as any).handlers;
    const cfg = await handlers[0].fulfilled({ headers: {} });
    expect(cfg.headers.Authorization).toBe('Bearer device-jwt-token');
  });
});
