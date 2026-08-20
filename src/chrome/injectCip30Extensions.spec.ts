import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * inject.ts installs the CIP-30 provider on `window.cardano.gerowallet` as an
 * import side effect, so the suite imports the module and drives the real
 * provider object. Only `enable()` has to behave; the rest of the page-world
 * surface is stubbed so the module can load under happy-dom.
 */
vi.mock('./webpage', () => {
  const stub = () => vi.fn(async () => undefined);
  return {
    enable: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    getAccountPub: stub(), getAddress: stub(), getBalance: stub(),
    getCollateral: stub(), getNetworkId: stub(), getPubDRepKey: stub(),
    getRegisteredPubStakeKeys: stub(), getRewardAddresses: stub(),
    getUnregisteredPubStakeKeys: stub(), getUnusedAddresses: stub(),
    getUsedAddresses: stub(), getUtxos: stub(), signData: stub(),
    signTx: stub(), submitTx: stub(), getNetworkMagic: stub(),
    btcRequestAccounts: stub(), btcGetAccounts: stub(), btcGetPublicKey: stub(),
    btcGetNetwork: stub(), btcGetBalance: stub(), btcSignPsbt: stub(),
    btcSignPsbts: stub(), btcSignMessage: stub(), btcPushTx: stub(),
    btcPushPsbt: stub(),
  };
});
vi.mock('./injectMidnight', () => ({}));

type Cip30Api = Record<string, unknown>;
type Cip30Provider = { enable: (e?: unknown) => Promise<Cip30Api> };

let provider: Cip30Provider;

beforeAll(async () => {
  await import('./inject');
  provider = (window as unknown as { cardano: Record<string, Cip30Provider> }).cardano['gerowallet'];
});

const cips = (api: Cip30Api) =>
  (api['getExtensions'] as () => { cip: number }[])().map(e => e.cip).sort((a, b) => a - b);

describe('CIP-30 getExtensions()', () => {
  it('reports only the base API when the dApp requests no extensions', async () => {
    const api = await provider.enable();
    expect(cips(api)).toEqual([30]);
    // The guarantee that matters: nothing is advertised that isn't attached.
    expect(api['cip95']).toBeUndefined();
    expect(api['cip104']).toBeUndefined();
    expect(api['cip142']).toBeUndefined();
  });

  it('reports CIP-142 when it is requested, and attaches it', async () => {
    const api = await provider.enable({ extensions: [{ cip: 142 }] });
    expect(cips(api)).toEqual([30, 142]);
    expect(api['cip142']).toBeDefined();
  });

  it('reports exactly the requested subset, not the full supported list', async () => {
    const api = await provider.enable({ extensions: [{ cip: 95 }] });
    expect(cips(api)).toEqual([30, 95]);
    expect(api['cip95']).toBeDefined();
    expect(api['cip104']).toBeUndefined();
  });

  it('every reported extension has a matching object on the api', async () => {
    const api = await provider.enable({ extensions: [{ cip: 95 }, { cip: 104 }, { cip: 142 }] });
    expect(cips(api)).toEqual([30, 95, 104, 142]);
    for (const cip of cips(api).filter(c => c !== 30)) {
      expect(api[`cip${cip}`]).toBeDefined();
    }
  });

  it('does not leak state between enable() calls', async () => {
    await provider.enable({ extensions: [{ cip: 95 }, { cip: 104 }, { cip: 142 }] });
    const api = await provider.enable();
    expect(cips(api)).toEqual([30]);
  });
});
