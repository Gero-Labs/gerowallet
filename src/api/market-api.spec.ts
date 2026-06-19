import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('market-api axios instance', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./market-api');
    expect(mod.marketAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('attaches no client-side auth interceptor (auth handled by the backend proxy)', async () => {
    const mod = await import('./market-api');
    const handlers = (mod.marketAxiosInstance.interceptors.request as unknown as { handlers: unknown[] }).handlers;
    expect(handlers.length).toBe(0);
  });
});
