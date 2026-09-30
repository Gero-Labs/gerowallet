// The claim approval prompt's software paths: a password wallet verifies the
// spending password first and signs through the extension-owned SIGN_DATA
// handler (never the CIP-30 one); a PassKey wallet signs with the bytes the
// PassKey button hands over and zeroes them afterwards. Hardware paths hand
// control to a device and are exercised against real devices, not here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';
import { WalletType } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';

// `<script setup>` imports are not registered by name, so the `stubs` option
// cannot replace them; each child is mocked as a module instead.
const stubs = vi.hoisted(() => ({
  // Render functions, not templates: the test build of Vue has no template compiler.
  BaseDialog: {
    name: 'BaseDialogStub',
    props: ['isOpen'],
    render(h: (tag: string, data: object, children?: unknown) => unknown) {
      return h('div', { attrs: { 'data-open': String(this.isOpen) } }, this.$slots.default);
    },
  },
  PasswordField: {
    name: 'PasswordFieldStub',
    props: ['value'],
    render(h: (tag: string, data: object) => unknown) {
      return h('input', {
        attrs: { 'data-testid': 'password', value: this.value },
        on: { input: (event: Event) => this.$emit('input', (event.target as HTMLInputElement).value) },
      });
    },
    methods: { showError() { /* the real field renders a tooltip */ } },
  },
  PassKeyButton: {
    name: 'PassKeyButtonStub',
    render(h: (tag: string, data: object) => unknown) { return h('button', { attrs: { 'data-testid': 'passkey' } }); },
  },
  Toggle: { name: 'ToggleStub', render(h: (tag: string) => unknown) { return h('div'); } },
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: stubs.BaseDialog }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({ default: stubs.PasswordField }));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => ({ default: stubs.PassKeyButton }));
vi.mock('@/shared/components/ToggleSwitch.vue', () => ({ default: stubs.Toggle }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ loggedWallet: null as unknown, keys: null }) }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { state: { flags: {} } } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
vi.mock('@/plugins/hardwareLoading', () => ({ default: { begin: vi.fn(), end: vi.fn() } }));
vi.mock('@/shared/utils/ledger', () => ({ default: {} }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: vi.fn() } }));
const $t = (key: string): string => key;
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: $t }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import CashbackSignDialog from './CashbackSignDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import snackbar from '@/plugins/snackbar';

const ADDRESS = 'addr1qy44ytv354nqrs0f3hfsecj45w623wgqskt7nx84qd8v6lgxeg90kc8dfzpcg9xl8nuhvdesgq5cz6ejq83vk60hpns2c2kwh';
const MESSAGE = 'Claim 12.5 ADA nonce 42';
const MESSAGE_HEX = Buffer.from(MESSAGE, 'utf8').toString('hex');


let wrapper: Wrapper<Vue>;
const send = vi.mocked(Messaging.sendToBackgroundFromOptions);

function mountDialog() {
  wrapper = mount(CashbackSignDialog, {
    propsData: { isOpen: false, requestId: 1, message: MESSAGE, address: ADDRESS, origin: 'https://portal.bringweb3.io' },
    mocks: { $t },
    stubs: {
      // Reports itself valid whenever it renders, the way the real form does once
      // its rules pass; the prompt resets validity on open and expects that.
      'v-form': {
        template: '<form><slot /></form>',
        mounted() { this.$emit('input', true); },
        updated() { this.$emit('input', true); },
        methods: { validate: () => true, resetValidation: vi.fn() },
      },
      'v-card-text': { template: '<div><slot /></div>' },
      'v-card-actions': { template: '<div><slot /></div>' },
      'v-alert': { template: '<div><slot /></div>' },
      'v-btn': { inheritAttrs: false, template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>' },
    },
  });
  return wrapper;
}

async function open() {
  await wrapper.setProps({ isOpen: true });
  await wrapper.vm.$nextTick();
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await wrapper.vm.$nextTick();
}

describe('cashback claim approval', () => {
  beforeEach(() => {
    walletStore.loggedWallet = { id: 1, type: WalletType.Normal, chain: 'cardano', network: 'mainnet' };
  });
  afterEach(() => {
    wrapper?.destroy();
    // Reset, not clear: a queued once-value a test never consumed must not leak.
    send.mockReset();
    vi.clearAllMocks();
  });

  it('shows the challenge verbatim and who is asking', async () => {
    mountDialog();
    await open();
    expect(wrapper.find('[data-testid="cashback-sign-message"]').text()).toBe(MESSAGE);
    expect(wrapper.text()).toContain('cashback.signRequestedBy');
  });

  it('verifies the spending password, then signs the UTF-8 challenge through SIGN_DATA', async () => {
    send
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { signature: 'sig', key: 'key' } });
    mountDialog();
    await open();
    await wrapper.find('[data-testid="password"]').setValue('hunter22');
    await wrapper.find('[data-testid="cashback-sign-confirm"]').trigger('click');
    await flush();
    expect(send).toHaveBeenNthCalledWith(1, { method: MessageTypes.VERIFY_SPENDING_PASSWORD, data: { password: 'hunter22' } });
    expect(send).toHaveBeenNthCalledWith(2, {
      method: MessageTypes.SIGN_DATA,
      data: { address: ADDRESS, payload: MESSAGE_HEX, password: 'hunter22', accountIndex: 0, isUsb: false },
    });
    expect(wrapper.emitted('signed')).toEqual([[{ requestId: 1, signature: 'sig', key: 'key' }]]);
  });

  it('signs the challenge that was approved, not one that replaced it while the password was being verified', async () => {
    send
      .mockImplementationOnce(async () => {
        // A second claim arrives from the portal before verification returns.
        await wrapper.setProps({ requestId: 2, message: 'Claim 99 ADA nonce 43' });
        return { data: { success: true } };
      })
      .mockResolvedValueOnce({ data: { signature: 'sig', key: 'key' } });
    mountDialog();
    await open();
    await wrapper.find('[data-testid="password"]').setValue('hunter22');
    await wrapper.find('[data-testid="cashback-sign-confirm"]').trigger('click');
    await flush();
    expect(send).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: MessageTypes.SIGN_DATA,
      data: expect.objectContaining({ payload: MESSAGE_HEX }),
    }));
    expect(wrapper.emitted('signed')).toEqual([[{ requestId: 1, signature: 'sig', key: 'key' }]]);
  });

  it('does not sign with a wrong password', async () => {
    send.mockResolvedValueOnce({ data: { success: false } });
    mountDialog();
    await open();
    await wrapper.find('[data-testid="password"]').setValue('nope');
    await wrapper.find('[data-testid="cashback-sign-confirm"]').trigger('click');
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('signed')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('surfaces a signing failure and stays open for another try', async () => {
    send
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { error: 'Wallet instance not available' } });
    mountDialog();
    await open();
    await wrapper.find('[data-testid="password"]').setValue('hunter22');
    await wrapper.find('[data-testid="cashback-sign-confirm"]').trigger('click');
    await flush();
    expect(snackbar.setError).toHaveBeenCalledWith('Wallet instance not available');
    expect(wrapper.emitted('signed')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('signs a PassKey wallet with the handed-over key bytes and zeroes them', async () => {
    walletStore.loggedWallet = { id: 1, type: WalletType.Normal, encryptionMethod: 'prf', chain: 'cardano', network: 'mainnet' };
    send.mockResolvedValueOnce({ data: { signature: 'sig', key: 'key' } });
    mountDialog();
    await open();
    const bytes = Uint8Array.from([1, 2, 3]);
    wrapper.findComponent({ name: 'PassKeyButtonStub' }).vm.$emit('success', bytes);
    await flush();
    expect(send).toHaveBeenCalledWith({
      method: MessageTypes.SIGN_DATA,
      data: { address: ADDRESS, payload: MESSAGE_HEX, password: '', privateKeyBytes: [1, 2, 3], accountIndex: 0, isUsb: false },
    });
    expect(Array.from(bytes)).toEqual([0, 0, 0]);
    expect(wrapper.emitted('signed')).toEqual([[{ requestId: 1, signature: 'sig', key: 'key' }]]);
  });

  it('withholds a signature produced after the wallet changed', async () => {
    send
      .mockResolvedValueOnce({ data: { success: true } })
      .mockImplementationOnce(async () => {
        walletStore.loggedWallet = { id: 2, type: WalletType.Normal, chain: 'cardano', network: 'mainnet' };
        return { data: { signature: 'sig', key: 'key' } };
      });
    mountDialog();
    await open();
    await wrapper.find('[data-testid="password"]').setValue('hunter22');
    await wrapper.find('[data-testid="cashback-sign-confirm"]').trigger('click');
    await flush();
    expect(wrapper.emitted('signed')).toBeUndefined();
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(snackbar.setError).toHaveBeenCalledWith('cashback.signWalletChanged');
  });

  it('offers only Cancel to a wallet type it cannot sign with', async () => {
    walletStore.loggedWallet = { id: 1, type: WalletType.Keystone, chain: 'cardano', network: 'mainnet' };
    mountDialog();
    await open();
    expect(wrapper.find('[data-testid="cashback-sign-unsupported"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cashback-sign-confirm"]').exists()).toBe(false);
    await wrapper.find('[data-testid="cashback-sign-cancel"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
