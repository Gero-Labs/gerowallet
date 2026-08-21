import { describe, it, expect, beforeAll, vi } from 'vitest';

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

type Cip30Api = Record<string, unknown>;
type Cip30Provider = { enable: (e?: unknown) => Promise<Cip30Api> };

let provider: Cip30Provider;

beforeAll(async () => {
  await import('./inject');
  provider = (window as unknown as { cardano: Record<string, Cip30Provider> }).cardano['gerowallet'];
});

const getExtensions = (api: Cip30Api) => (api['getExtensions'] as () => { cip: number }[])();

// What the api says it enabled.
const reported = (api: Cip30Api) =>
  getExtensions(api).map(e => e.cip).sort((a, b) => a - b);

// What the api actually carries, read off the object instead of a fixed list, so
// a CIP added later is covered by these assertions without touching the spec.
const attached = (api: Cip30Api) =>
  Object.keys(api)
    .filter(k => /^cip\d+$/.test(k))
    .map(k => Number(k.slice(3)))
    .sort((a, b) => a - b);

describe('CIP-30 getExtensions()', () => {
  it('reports nothing when the dApp requests no extensions', async () => {
    const api = await provider.enable();
    expect(reported(api)).toEqual([]);
    expect(attached(api)).toEqual([]);
  });

  it('reports CIP-142 when it is requested, and attaches it', async () => {
    const api = await provider.enable({ extensions: [{ cip: 142 }] });
    expect(reported(api)).toEqual([142]);
    expect(api['cip142']).toBeDefined();
  });

  it('reports exactly the requested subset, not the full supported list', async () => {
    const api = await provider.enable({ extensions: [{ cip: 95 }] });
    expect(reported(api)).toEqual([95]);
    expect(api['cip104']).toBeUndefined();
    expect(api['cip142']).toBeUndefined();
  });

  it('reports exactly what it attaches, in both directions', async () => {
    const combinations: { cip: number }[][] = [
      [],
      [{ cip: 95 }],
      [{ cip: 104 }, { cip: 142 }],
      [{ cip: 95 }, { cip: 104 }, { cip: 142 }],
    ];
    for (const extensions of combinations) {
      const api = await provider.enable({ extensions });
      expect(reported(api)).toEqual(attached(api));
    }
  });

  it('ignores an extension it does not support instead of failing', async () => {
    // CIP-30: "wallets aren't expected to fail should they not recognize or not
    // support a particular combination of extensions. Instead, they should decide
    // what they enable and reflect their choice in the response to
    // api.getExtensions()".
    const api = await provider.enable({ extensions: [{ cip: 95 }, { cip: 9999 }] });
    expect(reported(api)).toEqual([95]);
    expect(api['cip9999']).toBeUndefined();
  });

  it('hands out a fresh list, so a caller cannot corrupt later calls', async () => {
    const api = await provider.enable({ extensions: [{ cip: 95 }] });
    const first = getExtensions(api);
    first[0].cip = 104;
    first.push({ cip: 142 });
    expect(reported(api)).toEqual([95]);
  });

  it('does not leak state between enable() calls', async () => {
    await provider.enable({ extensions: [{ cip: 95 }, { cip: 104 }, { cip: 142 }] });
    const api = await provider.enable();
    expect(reported(api)).toEqual([]);
  });
});
