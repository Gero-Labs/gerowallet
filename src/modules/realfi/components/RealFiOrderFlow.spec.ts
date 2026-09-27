import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The flow's own logic around the shared signer: which Ledger transport it asks for.
// The signer and the order runner are stubbed; each is covered by its own spec.

const { signerOpts, sharedSignTx, flowSigner, wallet } = vi.hoisted(() => ({
  signerOpts: { current: null as null | { getIsBT(): boolean } },
  sharedSignTx: vi.fn(),
  flowSigner: { current: null as null | { signTx(cbor: string): Promise<string> } },
  wallet: { loggedWallet: null as null | Record<string, unknown> },
}));

vi.mock('@/modules/swap/composables/useNativeSwapSigner', () => ({
  useNativeSwapSigner: (opts: { getIsBT(): boolean }) => {
    signerOpts.current = opts;
    return {
      signer: { signTx: sharedSignTx },
      keystone: {
        keystoneShow: ref(false),
        keystoneType: ref(''),
        keystoneCbor: ref(''),
        onKeystoneScan: vi.fn(),
        cancelKeystone: vi.fn(),
        failKeystone: vi.fn(),
      },
    };
  },
}));
vi.mock('../composables/useRealFiOrder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../composables/useRealFiOrder')>()),
  useRealFiOrder: (signer: { signTx(cbor: string): Promise<string> }) => {
    flowSigner.current = signer;
    return { stage: ref('idle'), kind: ref(null), error: ref(null), run: vi.fn(), reset: vi.fn() };
  },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: wallet }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: vi.fn(), setError: vi.fn() } }));
vi.mock('@/plugins/i18n', () => ({ default: { locale: 'en-US', t: (k: string) => k } }));

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

const { SigningCancelled } = await import('../composables/useRealFiOrder');
import FlowSfc from './RealFiOrderFlow.vue';

const Flow = FlowSfc as unknown as Parameters<typeof mount>[0];

function mountFlow() {
  return mount(Flow, {
    mocks: { $t: (key: string) => key },
    stubs: {
      'v-card-text': { template: '<div><slot /></div>' },
      'v-progress-linear': true,
      'v-text-field': true,
      'v-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
    },
  });
}

type Wrapper = ReturnType<typeof mountFlow>;

const transportPrompt = (w: Wrapper) => w.find('[data-title="realfi.order.ledgerTransport"]');

function button(w: Wrapper, label: string) {
  const found = w.findAll('button').wrappers.find((b) => b.text() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

describe('RealFiOrderFlow Ledger transport', () => {
  beforeEach(() => {
    sharedSignTx.mockReset().mockImplementation(async () => {
      return signerOpts.current?.getIsBT() ? 'signed-over-bt' : 'signed-over-usb';
    });
  });

  it('asks a Bluetooth-capable Ledger how it is connected, and USB means USB', async () => {
    wallet.loggedWallet = { type: 'Ledger', btSupported: true };
    const w = mountFlow();

    const signing = flowSigner.current!.signTx('84a0');
    await w.vm.$nextTick();
    expect(transportPrompt(w).exists()).toBe(true);
    expect(sharedSignTx).not.toHaveBeenCalled();

    await button(w, 'governance.usb').trigger('click');

    await expect(signing).resolves.toBe('signed-over-usb');
  });

  it('uses Bluetooth only when the user picks it', async () => {
    wallet.loggedWallet = { type: 'Ledger', btSupported: true };
    const w = mountFlow();

    const signing = flowSigner.current!.signTx('84a0');
    await w.vm.$nextTick();
    await button(w, 'governance.bluetooth').trigger('click');

    await expect(signing).resolves.toBe('signed-over-bt');
  });

  it('goes straight to USB for a Ledger without Bluetooth', async () => {
    wallet.loggedWallet = { type: 'Ledger', btSupported: false };
    const w = mountFlow();

    await expect(flowSigner.current!.signTx('84a0')).resolves.toBe('signed-over-usb');
    expect(transportPrompt(w).exists()).toBe(false);
  });

  it('does not ask other wallet types', async () => {
    wallet.loggedWallet = { type: 'Normal', btSupported: true };
    const w = mountFlow();

    await flowSigner.current!.signTx('84a0');
    expect(transportPrompt(w).exists()).toBe(false);
  });

  it('treats closing the question as a change of mind', async () => {
    wallet.loggedWallet = { type: 'Ledger', btSupported: true };
    const w = mountFlow();

    const signing = flowSigner.current!.signTx('84a0');
    await w.vm.$nextTick();
    w.findComponent({ name: 'BaseDialog' }).vm.$emit('close');

    await expect(signing).rejects.toBeInstanceOf(SigningCancelled);
    expect(sharedSignTx).not.toHaveBeenCalled();
  });
});
