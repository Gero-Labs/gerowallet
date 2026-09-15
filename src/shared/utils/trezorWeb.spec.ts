import { beforeAll, describe, expect, test } from 'vitest';

// Minimal chrome global stub — trezorWeb's TREZOR_MANIFEST is built at module load
// time (copied verbatim from trezor.ts), same pattern as other specs in this repo
// (see src/chrome/mpcLoginShareCache.spec.ts). A static top-level
// `import trezorWeb from '@/shared/utils/trezorWeb'` would be hoisted ahead of this
// assignment by ESM semantics, so the module is loaded dynamically in beforeAll
// after the stub is in place.
//
// getURL is stubbed with the moz-extension form on purpose: appUrl is derived from
// chrome.runtime.getURL('') rather than a hardcoded 'chrome-extension://' prefix
// precisely so it is correct on Firefox too, and a Chrome-shaped stub would hide a
// regression in that.
// @ts-expect-error minimal chrome global for the test
globalThis.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: (path: string) => `moz-extension://test-extension-id/${path}`,
  },
};

describe('trezorWeb', () => {
  let trezorWeb: Record<string, unknown>;

  beforeAll(async () => {
    trezorWeb = (await import('@/shared/utils/trezorWeb')).default as unknown as Record<string, unknown>;
  });

  test('trezorWeb exposes the Trezor interface', () => {
    for (const m of [
      'init',
      'getFeatures',
      'getXpub',
      'cardanoSignTransaction',
      'cardanoSignMessage',
      'getAddress',
      'initBitcoinTrezor',
      'signTransaction',
      'verifyBitcoinAddress',
    ]) {
      expect(typeof trezorWeb[m]).toBe('function');
    }
  });
});
