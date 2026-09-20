import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Cardano, Extensions, WalletInstance } from '@/models/types';

/**
 * inject.ts installs the CIP-30 provider on `window.cardano.gerowallet` as an
 * import side effect, so the suite imports the module and drives the real
 * provider object. Only `enable()` is stubbed; every other export keeps its real
 * binding, so a new export in webpage.ts cannot break this spec at module load.
 */
vi.mock('./webpage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./webpage')>()),
  enable: vi.fn(async () => true),
}));
vi.mock('./injectMidnight', () => ({}));

let provider: Cardano[string];

beforeAll(async () => {
  await import('./inject');
  provider = window.cardano['gerowallet'];
});

// What the api says it enabled.
const reported = async (api: WalletInstance) =>
  (await api.getExtensions()).map(e => e.cip).sort((a, b) => a - b);

// What the api actually carries, read off the object instead of a fixed list, so
// a CIP added later is covered by these assertions without touching the spec.
const attached = (api: WalletInstance) =>
  Object.keys(api)
    .filter(k => /^cip\d+$/.test(k))
    .map(k => Number(k.slice(3)))
    .sort((a, b) => a - b);

describe('CIP-30 getExtensions()', () => {
  it('reports nothing when the dApp requests no extensions', async () => {
    const api = await provider.enable();
    expect(await reported(api)).toEqual([]);
    expect(attached(api)).toEqual([]);
  });

  it('reports CIP-142 when it is requested, and attaches it', async () => {
    const api = await provider.enable({ extensions: [{ cip: 142 }] });
    expect(await reported(api)).toEqual([142]);
    expect(api['cip142']).toBeDefined();
  });

  it('reports exactly the requested subset, not the full supported list', async () => {
    const api = await provider.enable({ extensions: [{ cip: 95 }] });
    expect(await reported(api)).toEqual([95]);
    expect(api['cip104']).toBeUndefined();
    expect(api['cip142']).toBeUndefined();
  });

  it('reports exactly what it attaches, in both directions', async () => {
    const combinations: Extensions['extensions'][] = [
      [],
      [{ cip: 95 }],
      [{ cip: 104 }, { cip: 142 }],
      [{ cip: 95 }, { cip: 104 }, { cip: 142 }],
    ];
    for (const extensions of combinations) {
      const api = await provider.enable({ extensions });
      expect(await reported(api)).toEqual(attached(api));
    }
  });

  it('ignores an extension it does not support instead of failing', async () => {
    // CIP-30: "wallets aren't expected to fail should they not recognize or not
    // support a particular combination of extensions. Instead, they should decide
    // what they enable and reflect their choice in the response to
    // api.getExtensions()".
    const api = await provider.enable({ extensions: [{ cip: 95 }, { cip: 9999 }] });
    expect(await reported(api)).toEqual([95]);
    expect(api['cip9999']).toBeUndefined();
  });

  it('hands out a fresh list, so a caller cannot corrupt later calls', async () => {
    const api = await provider.enable({ extensions: [{ cip: 95 }] });
    const first = await api.getExtensions();
    first[0].cip = 104;
    first.push({ cip: 142 });
    expect(await reported(api)).toEqual([95]);
  });

  it('does not leak state between enable() calls', async () => {
    await provider.enable({ extensions: [{ cip: 95 }, { cip: 104 }, { cip: 142 }] });
    const api = await provider.enable();
    expect(await reported(api)).toEqual([]);
  });

  it('returns a promise, as CIP-30 declares', async () => {
    // Asserted on the un-awaited call: `await` alone would pass on a bare array
    // and hide a synchronous return, which is what used to make .then() throw.
    const api = await provider.enable({ extensions: [{ cip: 95 }] });
    const result = api.getExtensions();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual([{ cip: 95 }]);
    // The shape a dApp written against CIP-30 actually uses.
    expect(await new Promise(resolve => api.getExtensions().then(resolve))).toEqual([{ cip: 95 }]);
  });
});

describe('CIP-30 supportedExtensions', () => {
  it('advertises the extensions enable() can attach, and not CIP-30 itself', () => {
    expect(provider.supportedExtensions.map(e => e.cip).sort((a, b) => a - b)).toEqual([95, 104, 142]);
  });

  it('attaches every extension it advertises', async () => {
    const api = await provider.enable({ extensions: provider.supportedExtensions });
    expect(await reported(api)).toEqual(provider.supportedExtensions.map(e => e.cip).sort((a, b) => a - b));
  });
});
