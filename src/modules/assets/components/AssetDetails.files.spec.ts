import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { VImg } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';
import { i18nPlugin } from '@/plugins/i18n';
import { Blockchain, Network, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import AssetDetails from './AssetDetails.vue';

enableAutoUnmount(afterEach);
beforeEach(() => {
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal } as never;
  vi.spyOn(window, 'open').mockReturnValue(null);
});
afterEach(() => {
  walletStore.loggedWallet = null;
  vi.restoreAllMocks();
});

function render(src: string | string[], mediaType: string) {
  return mount(AssetDetails, {
    props: { asset: {
      unit: 'ab'.repeat(28) + '01', name: 'Gallery test', fingerprint: 'asset1test', quantity: 1,
      onchain_metadata: { files: [{ src, mediaType }] },
    } },
    global: { plugins: [createTestVuetify(), i18nPlugin], stubs: { CopyButton: true, ExplorerLink: true } },
  });
}

describe('mainnet NFT detail files', () => {
  it('renders a chunked SVG with a charset, keeps the market hidden and opens the external image', async () => {
    const parts = ['https://assets.gerowallet.io/', 'gallery.svg'];
    const wrapper = render(parts, 'image/svg+xml; charset=utf-8');
    expect(wrapper.find('[data-testid="asset-market-actions"]').exists()).toBe(false);
    const image = wrapper.getComponent(VImg);
    expect(image.props('src')).toBe(parts.join(''));
    await image.trigger('click');
    expect(window.open).toHaveBeenCalledWith(parts.join(''), '_blank');
  });

  it.each([
    ['a chunked data URI', ['data:image/png;base64,', 'iVBORw0KGgo=']],
    ['a raw base64 image', 'iVBORw0KGgo='],
  ])('previews %s and leaves it in the gallery when clicked', async (_, src) => {
    const wrapper = render(src, 'image/png');
    const image = wrapper.getComponent(VImg);
    expect(image.props('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    await image.trigger('click');
    expect(window.open).not.toHaveBeenCalled();
  });
});
