// Issue 1197: the sort button's label was glued together as "Sort by" + ": " + the
// sort's name, which fixes the word order and the colon for every language. It is now
// one translatable sentence, `walletLibrary.sortedBy`, with the sort's name inside it.
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

const state = vi.hoisted(() => ({ sort: 'oldest' as string }));
vi.mock('@/shared/composables/useWalletLibrary', async () => {
  const { computed: vueComputed, ref: vueRef } = await import('vue');
  return {
    useWalletLibrary: () => ({
      preferences: vueRef({ categories: [], uncategorizedCollapsed: false }),
      query: vueRef(''), favoritesOnly: vueRef(false), sort: vueRef(state.sort), ready: vueRef(true), saving: vueRef(false),
      error: vueRef(''), indexing: vueRef(false), pendingCount: vueRef(0), favoriteCount: vueRef(0),
      wallets: vueComputed(() => []), filtered: vueComputed(() => []), filtering: vueRef(false), reorderable: vueRef(false),
      groups: vueComputed(() => []), run: vi.fn(), toggleFavorite: vi.fn(), moveWallet: vi.fn(), accountsFor: () => [],
    }),
  };
});
vi.mock('@/shared/composables/useWalletValues', () => ({ useWalletValues: () => ({ valueOf: () => undefined, isPending: () => false }) }));
vi.mock('@/db/wallet-library', () => ({ walletLibraryRepository: {} }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isMultiAccountEnabled: () => false } }));
vi.mock('@/stores/geroStore', () => ({ geroStore: { config: {}, wallets: {} } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { config: {} } }));
// A language that puts the sort's name first and uses no colon, which the old
// concatenation could never produce.
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (key === 'walletLibrary.sortedBy' ? `«${params?.['sort']}» zuerst` : key),
    tc: (key: string) => key,
  }),
}));

import WalletLibrary from './WalletLibrary.vue';

async function sortButton(sort: string) {
  state.sort = sort;
  const view = mount(defineComponent({ setup: () => () => h(WalletLibrary, { availableWallets: [] }) }), {
    global: { plugins: [createTestVuetify()], stubs: { 'v-img': true } },
  });
  await flushPromises();
  return view.find('.library-sort');
}

describe('the wallet list\'s sort button label', () => {
  it('is one translatable sentence with the current sort inside it', async () => {
    const button = await sortButton('oldest');

    expect(button.attributes('aria-label')).toBe('«governance.sortOldest» zuerst');
    expect(button.attributes('title')).toBe('«governance.sortOldest» zuerst');
  });

  it('follows the chosen sort', async () => {
    expect((await sortButton('name')).attributes('aria-label')).toBe('«assets.sortNameAZ» zuerst');
  });
});
