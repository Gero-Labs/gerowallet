import Vue from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.observable({
    loggedWallet: { id: 1, chain: 'Cardano', network: 'Preprod' },
    config: { explorer: 'cardanoscan' },
  }),
  default: { setExplorer: vi.fn() },
}));

import ExplorerLinkSfc from './ExplorerLink.vue';
import { walletStore } from '@/stores/walletStore';

Vue.use(Vuetify);
const ExplorerLink = ExplorerLinkSfc as unknown as Parameters<typeof mount>[0];

const POOL = 'pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy';
const TX = '7ecfdae7a4a2b8ea1bd2b4cb6b3d1b4ec5e9e5e3c5f4b0c7f6c3e9d2a1b0c9d8';

function mountLink(propsData: Record<string, unknown>) {
  return mount(ExplorerLink, { vuetify: new Vuetify(), mocks: { $t: (key: string) => key }, propsData });
}

describe('ExplorerLink', () => {
  it('links the id on the wallet\'s chosen explorer and network, in a new tab without an opener', () => {
    const link = mountLink({ type: 'pool', id: POOL, xSmall: true }).find('a');
    expect(link.attributes('href')).toBe(`https://preprod.cardanoscan.io/pool/${POOL}`);
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toBe('noopener noreferrer');
    expect(link.attributes('aria-label')).toBe('miniGero.viewOnExplorer');
  });

  it('opens the creating transaction for a UTxO reference', () => {
    const link = mountLink({ type: 'tx', id: `${TX}#2` }).find('a');
    expect(link.attributes('href')).toBe(`https://preprod.cardanoscan.io/transaction/${TX}`);
  });

  it('renders nothing when there is no page to open', () => {
    expect(mountLink({ type: 'pool', id: '' }).html()).toBe('');
    expect(mountLink({ type: 'drep', id: 'drep_always_abstain' }).html()).toBe('');
  });

  it('renders nothing on a chain without explorer pages for the id', async () => {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, chain: 'Midnight', network: 'Stagenet' } as typeof walletStore.loggedWallet;
    expect(mountLink({ type: 'tx', id: TX }).html()).toBe('');
  });
});
