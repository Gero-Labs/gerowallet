import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as WebauthnPrf from '../src/shared/utils/webauthn-prf';

/**
 * getPrfSupportMode() / isPrfSupported() — Brave handling (#655-2, #987)
 *
 * Brave's getClientCapabilities() reports `extension:prf: true`, but its
 * platform passkey provider creates credentials with the PRF extension
 * disabled (prf.enabled=false, no results). Trusting the capability probe on
 * Brave therefore offered (and defaulted to) a platform PassKey wallet that
 * could never unlock, and every attempt left an orphaned passkey in the OS
 * store. Chromium's FIDO stack (which Brave keeps) does speak CTAP2
 * hmac-secret to external security keys, so on Brave PRF is available via a
 * hardware security key only: mode 'security-key', and registration must pin
 * authenticatorAttachment to 'cross-platform'.
 *
 * The module memoizes the probe at module scope, so each test re-imports the
 * module fresh via vi.resetModules().
 */

type BraveNavigator = Navigator & { brave?: { isBrave: () => Promise<boolean> } };

const loadModule = async (): Promise<typeof WebauthnPrf> => {
  vi.resetModules();
  return import('../src/shared/utils/webauthn-prf');
};

describe('PRF support detection', () => {
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

  it("reports 'platform' when capabilities report PRF support (non-Brave)", async () => {
    const mod = await loadModule();
    await expect(mod.getPrfSupportMode()).resolves.toBe('platform');
    await expect(mod.isPrfSupported()).resolves.toBe(true);
  });

  it("reports 'security-key' on Brave even when capabilities claim PRF support", async () => {
    (navigator as BraveNavigator).brave = { isBrave: () => Promise.resolve(true) };
    const mod = await loadModule();
    await expect(mod.getPrfSupportMode()).resolves.toBe('security-key');
    // PassKey wallets remain available on Brave — via hardware security key.
    await expect(mod.isPrfSupported()).resolves.toBe(true);
  });

  it("reports 'none' when capabilities report no PRF support", async () => {
    (window as unknown as Record<string, unknown>).PublicKeyCredential = {
      getClientCapabilities: vi.fn().mockResolvedValue({ 'extension:prf': false }),
    };
    const mod = await loadModule();
    await expect(mod.getPrfSupportMode()).resolves.toBe('none');
    await expect(mod.isPrfSupported()).resolves.toBe(false);
  });

  it('still trusts the capability probe when navigator.brave errors', async () => {
    (navigator as BraveNavigator).brave = { isBrave: () => Promise.reject(new Error('boom')) };
    const mod = await loadModule();
    await expect(mod.getPrfSupportMode()).resolves.toBe('platform');
  });

  // The Google/MPC steps show EITHER the passkey button OR the password
  // fields with no toggle, so 'security-key' mode (Brave) must not count as
  // available there — a user without a hardware key would dead-end.
  it('mpcPasskeyAvailable stays platform-only (false on Brave)', async () => {
    (navigator as BraveNavigator).brave = { isBrave: () => Promise.resolve(true) };
    vi.resetModules();
    const mpc = await import('../src/shared/utils/mpc/mpcPasskey');
    await expect(mpc.mpcPasskeyAvailable()).resolves.toBe(false);
  });

  it('mpcPasskeyAvailable true for platform mode', async () => {
    vi.resetModules();
    const mpc = await import('../src/shared/utils/mpc/mpcPasskey');
    await expect(mpc.mpcPasskeyAvailable()).resolves.toBe(true);
  });
});

describe('registerWebAuthnCredentialWithPrf authenticator attachment', () => {
  const originalPkc = window.PublicKeyCredential;
  let createSpy: ReturnType<typeof vi.fn>;

  const fakeCredential = {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).buffer } } }),
  };

  beforeEach(() => {
    (window as unknown as Record<string, unknown>).PublicKeyCredential = {
      getClientCapabilities: vi.fn().mockResolvedValue({ 'extension:prf': true }),
    };
    createSpy = vi.fn().mockResolvedValue(fakeCredential);
    vi.stubGlobal('navigator', Object.create(navigator, {
      credentials: { value: { create: createSpy }, configurable: true },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (window as unknown as Record<string, unknown>).PublicKeyCredential = originalPkc;
    delete (navigator as BraveNavigator).brave;
  });

  it("pins authenticatorAttachment 'platform' off Brave", async () => {
    const mod = await loadModule();
    await mod.registerWebAuthnCredentialWithPrf('1', 'Test Wallet');
    const options = createSpy.mock.calls[0][0].publicKey as PublicKeyCredentialCreationOptions;
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe('platform');
  });

  it("pins authenticatorAttachment 'cross-platform' on Brave (security-key mode)", async () => {
    (navigator as BraveNavigator).brave = { isBrave: () => Promise.resolve(true) };
    const mod = await loadModule();
    await mod.registerWebAuthnCredentialWithPrf('1', 'Test Wallet');
    const options = createSpy.mock.calls[0][0].publicKey as PublicKeyCredentialCreationOptions;
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe('cross-platform');
  });
});
