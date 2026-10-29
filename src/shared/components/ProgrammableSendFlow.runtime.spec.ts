// Gero's own Send of a CIP-113 token, mounted with real Vuetify: amount and recipient, the
// review of what the worker verified, then password, signature and submit. Messaging is
// stubbed; the messages, their order and the bytes they carry are what is checked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createTestVuetify } from '@test/helpers/vuetify';

const UNIT = 'cd'.repeat(28) + '4d69636b79';
const TX_CBOR = '84a400';
const TX_ID = 'ab'.repeat(32);

const { send, walletState, deviceSign, device } = vi.hoisted(() => ({
  send: vi.fn(),
  deviceSign: vi.fn(),
  // What the page handed the device signer, and the Keystone dialog's switch.
  device: { options: undefined as { getIsBT?: () => boolean } | undefined, keystoneShow: undefined as { value: boolean } | undefined },
  walletState: {
    loggedWallet: { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Normal' } as Record<string, unknown>,
    programmableTokens: {} as Record<string, unknown>,
    keys: { payment: [], change: [], stake: [] },
    utxos: [],
  },
}));

vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: (...args: unknown[]) => send(...args) } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive(walletState) };
});
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('@/shared/composables/useExplorer', () => ({ useExplorer: () => ({ explorerUrl: (_: string, id: string) => (id ? `https://explorer/${id}` : '') }) }));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: () => ({ currencyTicker: 'tADA' }) } }));
// The password field's PassKey autofill needs WebAuthn; a plain input stands in for it.
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue', 'enter'],
    template: `<input data-test="password" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
  },
}));
vi.mock('@/shared/components/PassKeyAuthButton.vue', () => ({ default: { template: '<button data-test="passkey" />' } }));
// The device is out of scope (cip113HardwareSigners.spec.ts); signsOnDevice stays real.
vi.mock('@/shared/composables/useHardwareTxSigner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/composables/useHardwareTxSigner')>();
  const { ref } = await import('vue');
  device.keystoneShow = ref(false);
  return {
    ...actual,
    useHardwareTxSigner: (options: { getIsBT?: () => boolean }) => {
      device.options = options;
      return {
        sign: (cbor: string) => deviceSign(cbor),
        keystone: {
          keystoneShow: device.keystoneShow,
          keystoneType: ref('crypto-psbt'),
          keystoneCbor: ref('aa'),
          onKeystoneScan: vi.fn(),
          cancelKeystone: vi.fn(),
          failKeystone: vi.fn(),
        },
      };
    },
  };
});
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({
  default: { props: ['isOpen', 'keystoneType', 'keystoneCbor'], template: '<div data-test="keystone-dialog" />' },
}));

import ProgrammableSendFlow from './ProgrammableSendFlow.vue';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);

const SUMMARY = {
  txId: TX_ID,
  unit: UNIT,
  quantity: '1500000',
  recipientAddress: 'addr_test1qrecipient',
  recipientProgrammableAddress: 'addr_test1zprogrammable',
  recipientOwner: { type: 'stake_key', hash: '2c'.repeat(28) },
  lovelaceToRecipient: '1236970',
  changeProgrammableAddress: 'addr_test1zchange',
  lovelaceToChange: '1236970',
  fee: '352696',
  collateralAtRisk: '529044',
  moduleId: 'freeze-and-seize',
  transferLogicHash: '39'.repeat(28),
  validityStart: 1,
  validityEnd: 2,
};

type Handler = (data: Record<string, unknown>) => unknown;
function respond(handlers: Partial<Record<string, Handler>>) {
  send.mockImplementation(async ({ method, data }: { method: string; data: Record<string, unknown> }) => {
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected ${method}`);
    return { data: await handler(data) };
  });
}

function render() {
  return mount(ProgrammableSendFlow, {
    attachTo: document.body,
    props: { unit: UNIT, ticker: 'MICKY', decimals: 6 },
    global: { plugins: [createTestVuetify()] },
  });
}

async function fillForm(wrapper: ReturnType<typeof render>, amount: string, recipient = 'addr_test1qrecipient') {
  await wrapper.get('[data-testid="programmable-send-amount"] input').setValue(amount);
  await wrapper.get('[data-testid="programmable-send-recipient"] input').setValue(recipient);
}

const methods = () => send.mock.calls.map(([message]) => (message as { method: string }).method);

describe('ProgrammableSendFlow', () => {
  const store = walletStore as unknown as typeof walletState;

  beforeEach(() => {
    send.mockReset();
    store.programmableTokens = { [UNIT]: { unit: UNIT, quantity: '21000000', isProgrammable: true, cip113Registered: true } };
    store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Normal' };
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('sends the intent in base units, shows what the worker verified, then signs and submits', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: true, result: { txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY } }),
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: true }),
      [MessageTypes.SIGN_TX]: () => ({ witnesses: 'WITNESSES' }),
      [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
    });
    const wrapper = render();
    expect(wrapper.text()).toContain('21');

    await fillForm(wrapper, '1.5');
    await wrapper.get('[data-testid="programmable-send-continue"]').trigger('click');
    await flushPromises();

    expect((send.mock.calls[0][0] as { data: unknown }).data).toEqual({ unit: UNIT, quantity: '1500000', recipientAddress: 'addr_test1qrecipient' });
    const review = wrapper.get('[data-testid="programmable-send-review"]').text();
    expect(review).toContain('1.5 MICKY');
    expect(review).toContain('addr_test1zprogrammable');
    expect(review).toContain('programmableTokens.send.ownerStakeKey');
    expect(review).toContain('1.23697 tADA');
    expect(review).toContain('0.352696 tADA');
    expect(review).toContain('0.529044 tADA');
    expect(wrapper.find('[data-testid="programmable-send-seize"]').exists()).toBe(true);

    await wrapper.get('[data-test="password"]').setValue('secret');
    await wrapper.get('[data-testid="programmable-send-confirm"]').trigger('click');
    await flushPromises();

    expect(methods()).toEqual([
      MessageTypes.CIP113_PREPARE_TRANSFER,
      MessageTypes.VERIFY_SPENDING_PASSWORD,
      MessageTypes.SIGN_TX,
      MessageTypes.SUBMIT_TX,
    ]);
    expect((send.mock.calls[3][0] as { data: unknown }).data).toEqual({ txCbor: TX_CBOR, witnessHex: 'WITNESSES' });
    expect(wrapper.get('[data-testid="programmable-send-done"]').text()).toContain(TX_ID);
  });

  it('refuses amounts it can tell are wrong before asking the worker', async () => {
    const wrapper = render();
    const continueButton = () => wrapper.get('[data-testid="programmable-send-continue"]');

    await fillForm(wrapper, '1.0000001');
    expect(wrapper.text()).toContain('programmableTokens.send.tooManyDecimals');
    expect(continueButton().attributes('disabled')).toBeDefined();

    await fillForm(wrapper, '22');
    expect(wrapper.text()).toContain('errors.insufficientBalance');
    expect(continueButton().attributes('disabled')).toBeDefined();

    await fillForm(wrapper, '5', '');
    expect(continueButton().attributes('disabled')).toBeDefined();
    expect(send).not.toHaveBeenCalled();
  });

  it("explains the worker's refusal, with the most one transfer can send", async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: false, errorCode: 'NOT_IN_ONE_TRANSFER', maxSingleTransfer: '7500000' }),
    });
    const wrapper = render();
    await fillForm(wrapper, '10');
    await wrapper.get('[data-testid="programmable-send-continue"]').trigger('click');
    await flushPromises();

    const error = wrapper.get('[data-testid="programmable-send-error"]').text();
    expect(error).toContain('programmableTokens.send.error.NOT_IN_ONE_TRANSFER');
    expect(error).toContain('7.5 MICKY');
    expect(wrapper.find('[data-testid="programmable-send-review"]').exists()).toBe(false);
  });

  it('fills Max with the whole holding, and goes back to the form from the review', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: true, result: { txCbor: TX_CBOR, txId: TX_ID, summary: { ...SUMMARY, moduleId: 'dummy' } } }),
    });
    const wrapper = render();
    await wrapper.findAll('button').find((button) => button.text() === 'common.max')!.trigger('click');
    expect((wrapper.get('[data-testid="programmable-send-amount"] input').element as HTMLInputElement).value).toBe('21');

    await wrapper.get('[data-testid="programmable-send-recipient"] input').setValue('addr_test1qrecipient');
    await wrapper.get('[data-testid="programmable-send-continue"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="programmable-send-seize"]').exists()).toBe(false);

    await wrapper.findAll('button').find((button) => button.text() === 'common.back')!.trigger('click');
    expect(wrapper.find('[data-testid="programmable-send-review"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="programmable-send-amount"]').exists()).toBe(true);
  });

  it('starts over when the wallet changes while a transfer is on screen', async () => {
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: true, result: { txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY } }),
    });
    const wrapper = render();
    await fillForm(wrapper, '1');
    await wrapper.get('[data-testid="programmable-send-continue"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="programmable-send-review"]').exists()).toBe(true);

    store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Preprod', type: 'Normal' };
    await flushPromises();
    expect(wrapper.find('[data-testid="programmable-send-review"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="programmable-send-amount"]').exists()).toBe(true);
  });

  describe('on a hardware wallet', () => {
    const toReview = async (wrapper: ReturnType<typeof render>) => {
      await fillForm(wrapper, '1');
      await wrapper.get('[data-testid="programmable-send-continue"]').trigger('click');
      await flushPromises();
    };

    beforeEach(() => {
      deviceSign.mockReset();
      device.keystoneShow!.value = false;
      respond({
        [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: true, result: { txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY } }),
        [MessageTypes.SUBMIT_TX]: () => ({ txId: TX_ID }),
      });
    });

    it('asks the Ledger, with no password, and submits its signature', async () => {
      store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Ledger' };
      deviceSign.mockResolvedValue('DEVICE_WITNESSES');
      const wrapper = render();
      await toReview(wrapper);

      expect(wrapper.get('[data-testid="programmable-send-device"]').text()).toContain('miniGero.connectLedger');
      expect(wrapper.find('[data-test="password"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="programmable-send-keystone-hash"]').exists()).toBe(false);

      await wrapper.get('[data-testid="programmable-send-confirm"]').trigger('click');
      await flushPromises();

      expect(deviceSign).toHaveBeenCalledWith(TX_CBOR);
      expect(methods()).toEqual([MessageTypes.CIP113_PREPARE_TRANSFER, MessageTypes.SUBMIT_TX]);
      expect((send.mock.calls[1][0] as { data: unknown }).data).toEqual({ txCbor: TX_CBOR, witnessHex: 'DEVICE_WITNESSES' });
      expect(wrapper.find('[data-testid="programmable-send-done"]').exists()).toBe(true);
    });

    it('offers Bluetooth only for a Ledger that supports it, and USB until the user picks it', async () => {
      store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Ledger' };
      let wrapper = render();
      await toReview(wrapper);
      expect(wrapper.get('[data-testid="programmable-send-device"]').text()).not.toContain('wallet.bluetooth');
      wrapper.unmount();

      store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Ledger', btSupported: true };
      wrapper = render();
      await toReview(wrapper);
      expect(wrapper.get('[data-testid="programmable-send-device"]').text()).toContain('wallet.bluetooth');
      expect(device.options?.getIsBT?.()).toBe(false);
      await wrapper.get('[data-testid="programmable-send-device"] input[type="checkbox"]').setValue(true);
      await flushPromises();
      expect(device.options?.getIsBT?.()).toBe(true);
    });

    it('asks the Trezor, with no Bluetooth choice', async () => {
      store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Trezor', btSupported: true };
      const wrapper = render();
      await toReview(wrapper);

      const notice = wrapper.get('[data-testid="programmable-send-device"]').text();
      expect(notice).toContain('miniGero.connectTrezor');
      expect(notice).not.toContain('wallet.bluetooth');
    });

    it('warns that a Keystone may show only a hash, and opens its QR dialog to sign', async () => {
      store.loggedWallet = { id: 1, chain: 'Cardano', network: 'Preprod', type: 'Keystone' };
      deviceSign.mockImplementation(() => {
        device.keystoneShow!.value = true;
        return new Promise(() => undefined);
      });
      const wrapper = render();
      await toReview(wrapper);

      expect(wrapper.get('[data-testid="programmable-send-device"]').text()).toContain('miniGero.keystoneSign');
      // The hash the device may show instead of the transfer, to compare against.
      expect(wrapper.get('[data-testid="programmable-send-keystone-hash"]').text()).toContain(TX_ID);
      expect(wrapper.find('[data-test="keystone-dialog"]').exists()).toBe(false);

      await wrapper.get('[data-testid="programmable-send-confirm"]').trigger('click');
      await flushPromises();
      expect(wrapper.find('[data-test="keystone-dialog"]').exists()).toBe(true);
    });
  });

  it('starts over once the request settles when the wallet changed while it was signing', async () => {
    let finishSigning: (reply: unknown) => void = () => undefined;
    respond({
      [MessageTypes.CIP113_PREPARE_TRANSFER]: () => ({ success: true, result: { txCbor: TX_CBOR, txId: TX_ID, summary: SUMMARY } }),
      [MessageTypes.VERIFY_SPENDING_PASSWORD]: () => ({ success: true }),
      [MessageTypes.SIGN_TX]: () => new Promise((resolve) => { finishSigning = resolve; }),
    });
    const wrapper = render();
    await fillForm(wrapper, '1');
    await wrapper.get('[data-testid="programmable-send-continue"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-test="password"]').setValue('secret');
    await wrapper.get('[data-testid="programmable-send-confirm"]').trigger('click');
    await flushPromises();

    // Mid-signature: the review stays while the request is in flight.
    store.loggedWallet = { id: 2, chain: 'Cardano', network: 'Preprod', type: 'Normal' };
    await flushPromises();
    expect(wrapper.find('[data-testid="programmable-send-review"]').exists()).toBe(true);

    // The worker refuses (another wallet) and the screen returns to the form, not the old transfer.
    finishSigning({ error: 'Signing failed' });
    await flushPromises();
    expect(wrapper.find('[data-testid="programmable-send-review"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="programmable-send-amount"]').exists()).toBe(true);
  });
});
