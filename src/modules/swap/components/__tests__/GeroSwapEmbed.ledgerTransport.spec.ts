import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Vue, { ref } from 'vue';

// The embed's own logic around the shared signer: which Ledger transport it asks for.
// The signer is stubbed (useNativeSwapSigner has its own spec); its signTx reports the
// transport the embed handed it through getIsBT().

const { signerOpts, sharedSignTx, wallet } = vi.hoisted(() => ({
  signerOpts: { current: null as null | { getIsBT?: () => boolean } },
  sharedSignTx: vi.fn(),
  wallet: { loggedWallet: null as null | Record<string, unknown> },
}));

vi.mock('@/modules/market/composables/useMarketData', () => ({
  getTokenByUnit: () => undefined,
  getTokenImage: () => '',
  marketTokensRef: ref([]),
}));

Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'gero-swap'];

vi.mock('../../composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: (opts: { getIsBT?: () => boolean }) => {
    signerOpts.current = opts;
    return {
      signer: { meta: { name: 'Gero' }, signTx: sharedSignTx },
      keystone: { keystoneShow: { value: false }, keystoneType: { value: '' }, keystoneCbor: { value: '' }, onKeystoneScan: vi.fn(), cancelKeystone: vi.fn(), failKeystone: vi.fn() },
    };
  },
}));
vi.mock('../../composables/useSwapTokenResolver', () => ({
  useSwapTokenResolver: () => ({ resolveToken: vi.fn() }),
  buildHeldBalanceMap: () => new Map(),
}));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isSwapEnabled: () => true } }));
vi.mock('@/stores/tokenMetadataStore', async () => {
  const { reactive } = await import('vue');
  const state = reactive({ tokens: {} as Record<string, unknown> });
  return { default: { state }, tokenMetadataStore: state };
});
vi.mock('@/stores/walletStore', () => ({ walletStore: wallet }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn() } }));
vi.mock('@/plugins/i18n', () => ({ default: { t: (k: string) => k } }));

// Render functions, not templates: vi.mock output is not compiled. Hoisted because
// the component import below is.
const { slotDiv } = vi.hoisted(() => ({
  slotDiv: (name: string, props: string[] = []) => ({
    __esModule: true,
    default: {
      name,
      props,
      render(
        this: { $slots: { default?: unknown }; title?: string },
        h: (...a: unknown[]) => unknown,
      ) {
        return h('div', { attrs: { 'data-title': this.title } }, this.$slots.default);
      },
    },
  }),
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => slotDiv('BaseDialog', ['title']));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => slotDiv('KeystoneSignDialog'));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => slotDiv('PassKeyAuthButton'));

import GeroSwapEmbed from '../GeroSwapEmbed.vue';

function mountEmbed() {
  return mount(GeroSwapEmbed, {
    mocks: { $t: (key: string) => key },
    stubs: {
      'v-card-text': { template: '<div><slot /></div>' },
      'v-text-field': true,
      'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
    },
  });
}

type Wrapper = ReturnType<typeof mountEmbed>;
type WidgetSigner = { signTx(cbor: string): Promise<string> };

/** The signer the embed hands the widget, i.e. what a swap or order cancel signs with. */
const widgetSigner = (w: Wrapper) => (w.find('gero-swap').element as HTMLElement & { signer: WidgetSigner }).signer;

const transportPrompt = (w: Wrapper) => w.find('[data-title="wallet.ledgerTransport"]');

function button(w: Wrapper, label: string) {
  const found = w.findAll('button').wrappers.find((b) => b.text() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

describe('GeroSwapEmbed Ledger transport', () => {
  beforeEach(() => {
    sharedSignTx.mockReset().mockImplementation(async () =>
      (signerOpts.current?.getIsBT?.() ? 'signed-over-bt' : 'signed-over-usb'));
  });

  it('asks a Bluetooth-capable Ledger how it is connected, and USB means USB', async () => {
    wallet.loggedWallet = { network: 'Mainnet', type: 'Ledger', btSupported: true };
    const w = mountEmbed();

    const signing = widgetSigner(w).signTx('84a0');
    await w.vm.$nextTick();
    expect(transportPrompt(w).exists()).toBe(true);
    expect(sharedSignTx).not.toHaveBeenCalled();

    await button(w, 'governance.usb').trigger('click');

    await expect(signing).resolves.toBe('signed-over-usb');
    expect(transportPrompt(w).exists()).toBe(false);
  });

  it('uses Bluetooth only when the user picks it, and asks again next time', async () => {
    wallet.loggedWallet = { network: 'Mainnet', type: 'Ledger', btSupported: true };
    const w = mountEmbed();

    const first = widgetSigner(w).signTx('84a0');
    await w.vm.$nextTick();
    await button(w, 'governance.bluetooth').trigger('click');
    await expect(first).resolves.toBe('signed-over-bt');

    // A later signature (e.g. cancelling that order) starts from USB, not the old answer.
    const second = widgetSigner(w).signTx('84a0');
    await w.vm.$nextTick();
    expect(transportPrompt(w).exists()).toBe(true);
    expect(signerOpts.current?.getIsBT?.()).toBe(false);
    await button(w, 'governance.usb').trigger('click');
    await expect(second).resolves.toBe('signed-over-usb');
  });

  it('goes straight to USB for a Ledger without Bluetooth, without asking', async () => {
    wallet.loggedWallet = { network: 'Mainnet', type: 'Ledger', btSupported: false };
    const w = mountEmbed();

    await expect(widgetSigner(w).signTx('84a0')).resolves.toBe('signed-over-usb');
    expect(transportPrompt(w).exists()).toBe(false);
  });

  it('does not ask other wallet types', async () => {
    wallet.loggedWallet = { network: 'Mainnet', type: 'Normal', btSupported: true };
    const w = mountEmbed();

    await expect(widgetSigner(w).signTx('84a0')).resolves.toBe('signed-over-usb');
    expect(transportPrompt(w).exists()).toBe(false);
  });

  it('treats closing the question as cancelling the signature', async () => {
    wallet.loggedWallet = { network: 'Mainnet', type: 'Ledger', btSupported: true };
    const w = mountEmbed();

    const signing = widgetSigner(w).signTx('84a0');
    await w.vm.$nextTick();
    w.findAllComponents({ name: 'BaseDialog' }).wrappers
      .find((d) => d.props('title') === 'wallet.ledgerTransport')!
      .vm.$emit('close');

    await expect(signing).rejects.toThrow('cancelled');
    expect(sharedSignTx).not.toHaveBeenCalled();
  });
});
