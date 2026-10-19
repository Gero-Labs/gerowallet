import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
  dialog: {
    props: ['title', 'subtitle', 'isOpen'],
    render(this: Vue.ComponentPublicInstance & { title: string }) {
      return Vue.h('div', [Vue.h('h2', { class: 'dialog-title' }, this.title), this.$slots['default']?.()]);
    },
  },
  button: {
    props: ['href', 'disabled', 'loading', 'tier'],
    render(this: Vue.ComponentPublicInstance & { href?: string; disabled?: boolean }) {
      return this.href
        ? Vue.h('a', { href: this.href }, this.$slots['default']?.())
        : Vue.h('button', { ...this.$attrs, disabled: this.disabled }, this.$slots['default']?.());
    },
  },
  empty: { render() { return Vue.h('div'); } },
  phone: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    render(this: Vue.ComponentPublicInstance & { modelValue: string }) {
      return Vue.h('input', {
        class: 'phone-stub',
        value: this.modelValue,
        onInput: (event: Event) => this.$emit('update:modelValue', (event.target as HTMLInputElement).value),
      });
    },
  },
}));

const card = vi.hoisted(() => ({
  state: { cards: [] as unknown[], exchangeRate: null },
  getMissingCardholderDetails: vi.fn(),
  fillCardholderDetails: vi.fn(),
  orderCard: vi.fn(),
  orderPhysicalCard: vi.fn(),
  getExchangeRate: vi.fn(),
  fetchCardData: vi.fn(),
  getDeliveryPayment: vi.fn(),
}));

const snackbar = vi.hoisted(() => ({ setError: vi.fn(), fireSuccess: vi.fn() }));

vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key, locale: 'us' } }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: stubs.dialog }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: stubs.button }));
vi.mock('@/shared/components/iso/IsoScene.vue', () => ({ default: stubs.empty }));
vi.mock('@/shared/components/PhoneNumberInput.vue', () => ({ default: stubs.phone }));
vi.mock('../ui/CardSignSection.vue', () => ({ default: stubs.empty }));
vi.mock('@/stores/modules/card', () => ({ default: card }));
vi.mock('@/stores/featureFlagsStore', () => ({ default: { isPhysicalCardOrderingEnabled: () => true } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { baseAddress: 'addr_test1', network: 'preprod' }, utxos: [] } }));
vi.mock('@/plugins/snackbar', () => ({ default: snackbar }));
vi.mock('@/api/nexus-tx-api', () => ({
  nexusTxApi: {}, walletUtxosToNexusInputs: vi.fn(), txOutToNexusOutput: vi.fn(), requiredAssetsFromOutputs: vi.fn(),
}));

import ModalSfc from './OrderCardFlowModal.vue';
import CardCountrySelect from '../ui/CardCountrySelect.vue';

const Modal = ModalSfc as unknown as Parameters<typeof mount>[0];

let wrapper: VueWrapper;

async function open(): Promise<VueWrapper> {
  wrapper = mount(Modal, {
    props: { open: true },
    global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } },
  });
  await flushPromises();
  return wrapper;
}

const title = () => wrapper.find('.dialog-title').text();
const button = (label: string) => wrapper.findAll('button').find(candidate => candidate.text() === label)!;
const field = (label: string) => wrapper.findAll('.v-text-field').find(candidate => candidate.text().includes(label))!.find('input');
const refusal = (status: number, data: unknown) => Object.assign(new Error('Request failed'), { response: { status, data } });

async function orderVirtual(): Promise<void> {
  await wrapper.find('input[value="virtual"]').trigger('change');
  await button('card.continueButton').trigger('click');
  await flushPromises();
}

beforeEach(() => {
  vi.clearAllMocks();
  card.state.cards = [];
});

afterEach(() => wrapper?.unmount());

describe('OrderCardFlowModal cardholder details', () => {
  it('starts on the details step and asks only for the missing fields', async () => {
    card.getMissingCardholderDetails.mockResolvedValue(['firstName', 'nationality']);
    await open();
    expect(title()).toBe('card.details.title');
    expect(wrapper.text()).toContain('card.details.firstName');
    expect(wrapper.text()).toContain('card.details.nationality');
    expect(wrapper.text()).not.toContain('card.details.lastName');
    expect(wrapper.text()).not.toContain('card.details.homeAddress');
  });

  it('goes straight to the card types when nothing is missing', async () => {
    card.getMissingCardholderDetails.mockResolvedValue([]);
    await open();
    expect(title()).toBe('card.orderYourGeroCard');
    expect(wrapper.text()).toContain('card.virtualCardOnly');
  });

  it('does not block ordering when the check itself fails', async () => {
    card.getMissingCardholderDetails.mockRejectedValue(refusal(404, ''));
    await open();
    expect(title()).toBe('card.orderYourGeroCard');
    expect(wrapper.text()).toContain('card.virtualCardOnly');
  });

  it('saves the home address in Zione characters, then offers it for delivery', async () => {
    card.getMissingCardholderDetails.mockResolvedValue(['address', 'city', 'region', 'zipCode', 'country']);
    card.fillCardholderDetails.mockResolvedValue([]);
    await open();

    await field('card.streetAddress').setValue('Vnoučkova 2007,');
    await field('card.city').setValue('Benešov');
    await field('card.stateProvince').setValue('Středočeský kraj');
    await field('card.zipCode').setValue('25601');
    wrapper.findComponent(CardCountrySelect).vm.$emit('update:modelValue', 'CZ');
    await button('card.details.saveAndContinue').trigger('click');
    await flushPromises();

    expect(card.fillCardholderDetails).toHaveBeenCalledWith({
      address: 'Vnouckova 2007', city: 'Benesov', region: 'Stredocesky kraj', zipCode: '25601', country: 'CZ',
    });
    expect(snackbar.fireSuccess).toHaveBeenCalledWith('card.details.saved');
    expect(title()).toBe('card.orderYourGeroCard');

    await wrapper.find('input[value="physical"]').trigger('change');
    await button('card.continueButton').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('card.shipToHomeAddress');
    expect(wrapper.text()).toContain('Vnouckova 2007, 25601 Benesov, Stredocesky kraj');
  });

  it('does not send a form that breaks Zione rules', async () => {
    card.getMissingCardholderDetails.mockResolvedValue(['firstName']);
    await open();
    await field('card.details.firstName').setValue('Anne 2');
    await button('card.details.saveAndContinue').trigger('click');
    await flushPromises();
    expect(card.fillCardholderDetails).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('card.details.nameCharacters {"chars":"2"}');
  });

  it('shows Zione field errors from a refused save on the field', async () => {
    card.getMissingCardholderDetails.mockResolvedValue(['zipCode']);
    card.fillCardholderDetails.mockRejectedValue(refusal(422, {
      message: 'Zip code contains forbidden symbols!',
      errors: { zipCode: ['Zip code contains forbidden symbols!'] },
    }));
    await open();
    await field('card.zipCode').setValue('25601');
    await button('card.details.saveAndContinue').trigger('click');
    await flushPromises();
    expect(title()).toBe('card.details.title');
    expect(wrapper.text()).toContain('Zip code contains forbidden symbols!');
    expect(wrapper.text()).toContain('card.details.fixHighlighted');
  });

  it('keeps asking for fields Zione still lists after a save', async () => {
    card.getMissingCardholderDetails.mockResolvedValue(['firstName', 'lastName']);
    card.fillCardholderDetails.mockResolvedValue(['lastName']);
    await open();
    await field('card.details.firstName').setValue('John');
    await field('card.details.lastName').setValue('Doe');
    await button('card.details.saveAndContinue').trigger('click');
    await flushPromises();
    expect(title()).toBe('card.details.title');
    expect(wrapper.text()).toContain('card.details.stillMissing');
    expect(wrapper.text()).not.toContain('card.details.firstName');
    expect(wrapper.text()).toContain('card.details.lastName');
  });
});

describe('OrderCardFlowModal refused orders', () => {
  it('explains stored details only Zione support can fix, with a way to reach them', async () => {
    card.getMissingCardholderDetails.mockResolvedValue([]);
    card.orderCard.mockRejectedValue(refusal(400, 'Address contains forbidden symbols!'));
    await open();
    await orderVirtual();
    expect(wrapper.text()).toContain('card.details.rejectedTitle');
    expect(wrapper.text()).toContain('card.details.rejectedReason {"reason":"Address contains forbidden symbols!"}');
    expect(wrapper.find('a[href^="mailto:support@zione.com"]').exists()).toBe(true);
    expect(snackbar.setError).not.toHaveBeenCalled();
  });

  it('sends the user to the details step when an order fails on a missing field', async () => {
    card.getMissingCardholderDetails.mockResolvedValueOnce([]).mockResolvedValueOnce(['nationality']);
    card.orderCard.mockRejectedValue(refusal(400, 'The address field is required.'));
    await open();
    await orderVirtual();
    expect(title()).toBe('card.details.title');
    expect(wrapper.text()).toContain('card.details.nationality');
    expect(snackbar.setError).toHaveBeenCalledWith('card.details.neededToOrder');
  });

  it('falls back to the provider reason for any other refusal', async () => {
    card.getMissingCardholderDetails.mockResolvedValue([]);
    card.orderCard.mockRejectedValue(refusal(400, 'User is unverified'));
    await open();
    await orderVirtual();
    expect(snackbar.setError).toHaveBeenCalledWith('card.failedToOrderCard User is unverified');
    expect(wrapper.text()).not.toContain('card.details.rejectedTitle');
  });
});
