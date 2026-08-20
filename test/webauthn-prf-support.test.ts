import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * isPrfSupported() — Brave detection (#655-2 follow-up)
 *
 * Brave's getClientCapabilities() reports `extension:prf: true`, but its
 * platform authenticator then creates credentials with the PRF extension
 * disabled (prf.enabled=false, no results). Trusting the capability probe on
 * Brave therefore offers (and defaults to) a PassKey wallet that can never
 * unlock, and every attempt leaves an orphaned passkey in the OS store.
 * isPrfSupported() must report unsupported on Brave regardless of what the
 * capability probe claims.
 *
 * isPrfSupported() memoizes its result at module scope, so each test
 * re-imports the module fresh via vi.resetModules().
 */

type BraveNavigator = Navigator & { brave?: { isBrave: () => Promise<boolean> } };

const loadIsPrfSupported = async (): Promise<() => Promise<boolean>> => {
  vi.resetModules();
  const mod = await import('../src/shared/utils/webauthn-prf');
  return mod.isPrfSupported;
};

describe('isPrfSupported', () => {
  const originalPkc = window.PublicKeyCredential;

  beforeEach(() => {
    (window as unknown as Record<string, unknown>).PublicKeyCredential = {
      getClientCapabilities: vi.fn().mockResolvedValue({ 'extension:prf': true }),
    };
  });

  afterEach(() => {
    (window as unknown as Record<string, unknown>).PublicKeyCredential = originalPkc;
    delete (navigator as BraveNavigator).brave;
  });

  it('returns true when capabilities report PRF support (non-Brave)', async () => {
    const isPrfSupported = await loadIsPrfSupported();
    await expect(isPrfSupported()).resolves.toBe(true);
  });

  it('returns false on Brave even when capabilities claim PRF support', async () => {
    (navigator as BraveNavigator).brave = { isBrave: () => Promise.resolve(true) };
    const isPrfSupported = await loadIsPrfSupported();
    await expect(isPrfSupported()).resolves.toBe(false);
  });

  it('returns false when capabilities report no PRF support', async () => {
    (window as unknown as Record<string, unknown>).PublicKeyCredential = {
      getClientCapabilities: vi.fn().mockResolvedValue({ 'extension:prf': false }),
    };
    const isPrfSupported = await loadIsPrfSupported();
    await expect(isPrfSupported()).resolves.toBe(false);
  });

  it('still trusts the capability probe when navigator.brave errors', async () => {
    (navigator as BraveNavigator).brave = { isBrave: () => Promise.reject(new Error('boom')) };
    const isPrfSupported = await loadIsPrfSupported();
    await expect(isPrfSupported()).resolves.toBe(true);
  });
});
