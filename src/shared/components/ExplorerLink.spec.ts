import { reactive } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestVuetify } from '@test/helpers/vuetify';

vi.mock('@/stores/walletStore', () => ({
  walletStore: reactive({
    loggedWallet: { id: 1, chain: 'Cardano', network: 'Preprod' },
    config: { explorer: 'cardanoscan' },
  }),
  default: { setExplorer: vi.fn() },
}));

import ExplorerLink from './ExplorerLink.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  walletStore.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod' } as typeof walletStore.loggedWallet;
  walletStore.config = { explorer: 'cardanoscan' };
});

const POOL = 'pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy';
const TX = '7ecfdae7a4a2b8ea1bd2b4cb6b3d1b4ec5e9e5e3c5f4b0c7f6c3e9d2a1b0c9d8';

function mountLink(props: { type: string; id: string; xSmall?: boolean; small?: boolean }) {
  return mount(ExplorerLink, {
    props,
    global: {
      plugins: [createTestVuetify()],
      mocks: { $t: (key: string) => key },
    },
  });
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

  it.each([
    [{ xSmall: true }, 'x-small', 12],
    [{ small: true }, 'small', 16],
    [{}, 'default', 24],
  ] as const)('renders a compact unfilled explorer control for %j', (sizeProps, size, iconPixels) => {
    const wrapper = mountLink({ type: 'pool', id: POOL, ...sizeProps });
    const link = wrapper.get('a');
    expect(link.classes()).toContain('v-btn--variant-text');
    expect(link.classes()).toContain(`v-btn--size-${size}`);
    expect(wrapper.get('.v-icon').attributes('style')).toContain(`font-size: ${iconPixels}px`);
    expect(link.attributes('x-small')).toBeUndefined();
    expect(link.attributes('small')).toBeUndefined();
  });

  it('renders nothing when there is no page to open', () => {
    expect(mountLink({ type: 'pool', id: '' }).find('a').exists()).toBe(false);
    expect(mountLink({ type: 'drep', id: 'drep_always_abstain' }).find('a').exists()).toBe(false);
  });

  it('renders nothing on a chain without explorer pages for the id', async () => {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, chain: 'Midnight', network: 'Stagenet' } as typeof walletStore.loggedWallet;
    expect(mountLink({ type: 'tx', id: TX }).find('a').exists()).toBe(false);
  });
});
