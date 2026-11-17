// Gero's own SOL send dialog: it checks what the worker will check, sends only the
// recipient, amount and fee level, and shows the worker's code as text, never raw errors.
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({ loggedWallet: null as unknown, solana: { lamports: '2000000000' as string | null } }),
}));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'SOL' } }));
vi.mock('@/utils/assets', () => ({ default: { sendSvg: '' } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
  },
}));

import SolanaSendDialog from './SolanaSendDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';

const FROM = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const TO = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const SIGNATURE = '5'.repeat(88);
const QUOTE = { fees: { standard: '5001', fast: '5012' }, prices: { standard: '1000', fast: '20000' }, live: true };

function answer(sendResult: unknown) {
  send.mockImplementation(async ({ method }: { method: string }) =>
    (method === MessageTypes.SOLANA_SEND_QUOTE ? { data: { success: true, result: QUOTE } } : sendResult));
}

function render() {
  return mount(SolanaSendDialog as unknown as Parameters<typeof mount>[0], {
    props: { modelValue: true },
    global: { plugins: [createTestVuetify()], mocks: { $t: (key: string) => key } },
  });
}

async function fillAndSend(wrapper: ReturnType<typeof render>, amount: string) {
  await wrapper.find('[data-test="sol-recipient"]').setValue(TO);
  await wrapper.find('[data-test="sol-amount"]').setValue(amount);
  await wrapper.find('[data-test="sol-continue"]').trigger('click');
  await wrapper.find('[data-test="sol-password"]').setValue('pw');
  await wrapper.find('[data-test="sol-send"]').trigger('click');
  await flushPromises();
}

enableAutoUnmount(afterEach);

describe('SolanaSendDialog', () => {
  beforeEach(() => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.SOLANA, network: Network.DEVNET, publicKey: FROM, encryptionMethod: 'password' } as never;
    (walletStore as unknown as { solana: unknown }).solana = { lamports: '2000000000' };
    send.mockReset();
    answer({ data: { success: true, result: { signature: SIGNATURE } } });
  });

  it('holds Continue on an own address or an amount the balance cannot cover', async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="sol-recipient"]').setValue(FROM);
    await wrapper.find('[data-test="sol-amount"]').setValue('1');
    expect(wrapper.text()).toContain('solana.sameAddress');
    expect(wrapper.find('[data-test="sol-continue"]').attributes('disabled')).toBeDefined();

    await wrapper.find('[data-test="sol-recipient"]').setValue(TO);
    await wrapper.find('[data-test="sol-amount"]').setValue('2');
    expect(wrapper.find('[data-test="sol-amount-error"]').text()).toBe('send.insufficientBalance');
    expect(wrapper.find('[data-test="sol-continue"]').attributes('disabled')).toBeDefined();
  });

  it('sends recipient, lamports and the fee level only, then links the signature', async () => {
    const wrapper = render();
    await flushPromises();
    await fillAndSend(wrapper, '0,5');

    expect(send).toHaveBeenLastCalledWith({
      method: MessageTypes.SEND_SOLANA,
      data: { recipientAddress: TO, lamports: '500000000', feeLevel: 'standard', password: 'pw' },
    });
    expect(wrapper.find('[data-test="sol-sent"]').exists()).toBe(true);
    expect(wrapper.find('a').attributes('href')).toBe(`https://solscan.io/tx/${SIGNATURE}?cluster=devnet`);
  });

  it('shows a refusal as its own text and clears the password', async () => {
    answer({ data: { success: false, error: 'RECIPIENT_BELOW_RENT' } });
    const wrapper = render();
    await flushPromises();
    await fillAndSend(wrapper, '0.0001');

    expect(wrapper.find('[data-test="sol-send-error"]').text()).toBe('solana.recipientBelowRent');
    expect((wrapper.find('[data-test="sol-password"]').element as HTMLInputElement).value).toBe('');
  });

  it('never reads an unreported balance as enough', async () => {
    (walletStore as unknown as { solana: unknown }).solana = { lamports: null };
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[data-test="sol-recipient"]').setValue(TO);
    await wrapper.find('[data-test="sol-amount"]').setValue('0.1');
    expect(wrapper.find('[data-test="sol-amount-error"]').text()).toBe('solana.balanceUnknown');
  });
});
