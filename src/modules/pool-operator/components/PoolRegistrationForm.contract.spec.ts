import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { VBtn, VTextField } from 'vuetify/components';
import { createTestVuetify } from '../../../../test/helpers/vuetify';
import { i18nPlugin } from '@/plugins/i18n';

const calls = vi.hoisted(() => ({ register: vi.fn(), update: vi.fn() }));
vi.mock('@/shared/composables/usePoolRegistration', async () => {
  const { ref } = await import('vue');
  return { usePoolRegistration: () => ({ txData: ref(null), loading: ref(false), isConfirmDialogOpen: ref(false), registerPool: calls.register, updatePool: calls.update, closeConfirmDialog: vi.fn() }) };
});
vi.mock('@/stores/poolOperatorStore', async () => {
  const { reactive } = await import('vue');
  return { poolOperatorStore: reactive({ isRegistered: false, registeredParams: { pledge: '1000000', cost: '340000000', margin: { numerator: 5, denominator: 100 }, relays: [] } }) };
});
vi.mock('../dialogs/PoolConfirmDialog.vue', () => ({ default: { template: '<div />' } }));
import PoolRegistrationForm from './PoolRegistrationForm.vue';

enableAutoUnmount(afterEach);
beforeEach(() => { calls.register.mockReset(); calls.update.mockReset(); });
const render = () => mount(PoolRegistrationForm, { global: { plugins: [createTestVuetify(), i18nPlugin] } });
const submit = (wrapper: ReturnType<typeof render>) => wrapper.findAllComponents(VBtn).find(button => button.props('block'))!;

describe('pool registration real async Vuetify form', () => {
  it('rejects invalid core parameters even if submission is dispatched directly', async () => {
    const wrapper = render();
    await wrapper.findAllComponents(VTextField)[1]!.find('input').setValue('1');
    submit(wrapper).vm.$emit('click');
    await flushPromises();
    expect(calls.register).not.toHaveBeenCalled();
    expect(calls.update).not.toHaveBeenCalled();
  });
  it('builds once while validation or the unsigned transaction build is pending', async () => {
    let resolve!: () => void;
    calls.register.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const wrapper = render();
    await flushPromises();
    submit(wrapper).vm.$emit('click');
    submit(wrapper).vm.$emit('click');
    await flushPromises();
    expect(calls.register).toHaveBeenCalledTimes(1);
    expect(calls.register).toHaveBeenCalledWith(expect.objectContaining({ pledge: 1000000n, cost: 340000000n, relays: [] }));
    submit(wrapper).vm.$emit('click');
    await flushPromises();
    expect(calls.register).toHaveBeenCalledTimes(1);
    resolve();
    await flushPromises();
  });
});
