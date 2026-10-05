import Vue from 'vue';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAINNET_USDCX_UNIT, REALFI_ASSETS } from '../assets';

const catalog = vi.hoisted(() => {
  const store = {
    tokens: {} as Record<string, unknown>,
    state: {} as { tokens: Record<string, unknown> },
    loadTokens: vi.fn(),
  };
  store.state = store;
  return store;
});

vi.mock('@/stores/tokenMetadataStore', () => ({ default: catalog }));
vi.mock('@/stores/featureFlagsStore', () => ({ default: { isSwapEnabled: () => true } }));
vi.mock('@/stores/walletStore', () => ({
  default: {
    state: { loggedWallet: { id: 1, baseAddress: 'addr1', chain: 'Cardano', network: 'Mainnet' } },
  },
}));

import { useRealFiSwapAvailability } from './useRealFiSwapAvailability';

const USDRF = REALFI_ASSETS.mainnet.usdr;
const listed = (unit: string) => ({ [unit]: { unit, decimals: 6 } });

let availability: ReturnType<typeof useRealFiSwapAvailability>;
let wrapper: ReturnType<typeof mount>;

async function withCatalog(tokens: Record<string, unknown>) {
  catalog.loadTokens.mockImplementation(async () => {
    catalog.tokens = tokens;
    catalog.state = catalog;
    return true;
  });
  wrapper = mount(Vue.extend({
    setup() {
      availability = useRealFiSwapAvailability();
      return {};
    },
    render: (h) => h('div'),
  }));
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  catalog.tokens = {};
  catalog.loadTokens.mockReset();
});
afterEach(() => wrapper.destroy());

describe('useRealFiSwapAvailability', () => {
  it('offers ADA → USDCx when only USDCx is listed, and holds USDCx → USDrf', async () => {
    await withCatalog(listed(MAINNET_USDCX_UNIT));
    expect(availability.status.value).toBe('available');
    expect(availability.isUsdcxAvailable.value).toBe(true);
    expect(availability.isUsdrfAvailable.value).toBe(false);
  });

  it('offers both legs once USDrf is listed too', async () => {
    await withCatalog({ ...listed(MAINNET_USDCX_UNIT), ...listed(USDRF) });
    expect(availability.isUsdcxAvailable.value).toBe(true);
    expect(availability.isUsdrfAvailable.value).toBe(true);
  });

  it('offers neither leg without USDCx, even with USDrf listed', async () => {
    await withCatalog(listed(USDRF));
    expect(availability.status.value).toBe('unavailable');
    expect(availability.isUsdcxAvailable.value).toBe(false);
    expect(availability.isUsdrfAvailable.value).toBe(false);
  });
});
