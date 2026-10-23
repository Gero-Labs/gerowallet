// The popup connect prompt offers every account of the logged wallet, as the
// side panel does (#1331). It only answers; the background connects the site
// to the chosen account, switching to it first.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';

const mocks = vi.hoisted(() => ({ request: vi.fn(), returnData: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: {
  createInternalController: () => ({ requestData: mocks.request, returnData: mocks.returnData }),
} }));
vi.mock('@/stores/walletStore', async () => ({ default: { state: (await import('vue')).reactive({ loggedWallet: null }) } }));
vi.mock('@/stores/geroStore', async () => ({ geroStore: (await import('vue')).reactive({ wallets: {} }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/popup/modules/components/PopupHeader.vue', () => ({ default: { template: '<main><slot /></main>' } }));
vi.mock('@/shared/components/EmbeddedSiteWarning.vue', () => ({ default: { template: '<div />' } }));

import DappConnect from './DappConnect.vue';
import WalletStore from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import { Blockchain, Network, WalletType } from '@/models/types';

const wallet = { chain: Blockchain.BITCOIN, network: Network.MAINNET, type: WalletType.Normal };
const MAIN = { id: 1, name: 'Main', ...wallet };
const SECOND = { id: 2, name: 'Account #1', accountIndex: 1, parentWalletId: 1, ...wallet };

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({});
  mocks.returnData.mockResolvedValue(undefined);
  WalletStore.state.loggedWallet = MAIN;
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function render() {
  const view = mount(DappConnect, { global: {
    plugins: [createTestVuetify()],
    config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key, $route: { query: { website: 'https://dapp.example/path' } } }) },
  } });
  await flushPromises();
  await view.find('input[type="checkbox"]').setValue(true);
  return view;
}
type View = Awaited<ReturnType<typeof render>>;
const button = (view: View, text: string) => view.findAll('button').find((entry) => entry.text() === text)!;

describe('the popup connect prompt', () => {
  it('answers with the account the user picked and connects nothing itself', async () => {
    Object.assign(geroStore.wallets, { 1: MAIN, 2: SECOND });
    const view = await render();
    await view.findAll('[role="radio"]')[1].trigger('click');
    await button(view, 'navigation.confirm').trigger('click');
    await flushPromises();

    expect(mocks.returnData).toHaveBeenCalledExactlyOnceWith({ data: { accountId: 2 }, error: {} });
    expect(window.close).toHaveBeenCalledTimes(1);
  });

  it('answers true for a wallet with one account, as before', async () => {
    for (const id of Object.keys(geroStore.wallets)) delete (geroStore.wallets as Record<string, unknown>)[id];
    Object.assign(geroStore.wallets, { 1: MAIN });
    const view = await render();

    expect(view.findAll('[role="radio"]')).toHaveLength(0);
    await button(view, 'navigation.confirm').trigger('click');
    await flushPromises();
    expect(mocks.returnData).toHaveBeenCalledExactlyOnceWith({ data: true, error: {} });
  });
});
