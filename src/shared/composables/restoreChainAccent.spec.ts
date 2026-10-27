import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';

vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({ loggedWallet: null as { chain: string } | null }) }));
vi.mock('@/plugins/vuetify', () => ({ updateVuetifyTheme: vi.fn() }));

import { restoreChainAccent } from './restoreChainAccent';
import { walletStore } from '@/stores/walletStore';
import { updateVuetifyTheme } from '@/plugins/vuetify';

const accent = () => document.documentElement.style.getPropertyValue('--g-accent');

beforeEach(() => {
  vi.mocked(updateVuetifyTheme).mockClear();
  document.documentElement.removeAttribute('style');
});

describe('restoreChainAccent', () => {
  it('re-themes a signed-in Bitcoin wallet after onboarding left Vuetify on another chain', () => {
    walletStore.loggedWallet = { chain: 'Bitcoin' } as typeof walletStore.loggedWallet;

    restoreChainAccent('Cardano');

    expect(updateVuetifyTheme).toHaveBeenCalledExactlyOnceWith('Bitcoin');
    expect(accent()).toBe('#F7931A');
  });

  it('themes the default chain, and leaves the CSS accent alone, when no wallet is signed in', () => {
    walletStore.loggedWallet = null;

    restoreChainAccent('Cardano');

    expect(updateVuetifyTheme).toHaveBeenCalledExactlyOnceWith('Cardano');
    expect(accent()).toBe('');
  });
});
