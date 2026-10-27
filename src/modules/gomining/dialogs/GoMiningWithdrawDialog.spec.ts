// Withdrawing mining income: the wallet asks for an amount and a speed, never a
// destination (gero-backend pays only the linked address), reads the typed amount
// to the exact satoshi, and retries with the same request id so a lost reply is
// not paid out twice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import * as Vue from 'vue';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

vi.mock('@/api/gomining-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/gomining-api')>();
  return { ...actual, default: { getWithdrawalTerms: vi.fn(), withdraw: vi.fn() } };
});
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  default: { name: 'BaseDialogStub', setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
}));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    name: 'GButtonStub',
    props: ['disabled', 'loading', 'tier', 'compact'],
    emits: ['click'],
    setup(props: { disabled?: boolean }, { slots, emit }: { slots: Vue.Slots; emit: (event: string) => void }) {
      return () => Vue.h('button', { disabled: props.disabled, onClick: () => emit('click') }, slots['default']?.());
    },
  },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import GoMiningWithdrawDialog from './GoMiningWithdrawDialog.vue';
import goMiningApi, { GoMiningApiError } from '@/api/gomining-api';

const api = vi.mocked(goMiningApi);
const withSession = vi.fn(<T,>(call: (token: string) => Promise<T>) => call('tok'));
let wrapper: VueWrapper;

function mountDialog(availableSats = 500_000) {
  wrapper = mount(GoMiningWithdrawDialog, {
    props: { modelValue: true, payoutAddress: 'tb1qlinked', availableSats, withSession },
    global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: {
        'v-icon': true,
        'v-card-text': { setup: (_p: unknown, { slots }: { slots: Vue.Slots }) => () => Vue.h('div', slots['default']?.()) },
      },
    },
  });
}

const button = (label: string) => wrapper.findAll('button').find((b) => b.text().includes(label))!;
const amountInput = () => wrapper.find('input.gm-input__control--amount');

beforeEach(() => {
  api.getWithdrawalTerms.mockReset().mockResolvedValue({ fastMinSats: 100_000, fastFeePercent: null, fastFeeSats: 2_000 });
  api.withdraw.mockReset().mockResolvedValue(undefined);
  withSession.mockClear();
});

afterEach(() => { wrapper?.unmount(); });

describe('GoMiningWithdrawDialog', () => {
  it('sends the exact amount and speed, and no address', async () => {
    mountDialog();
    await vi.waitFor(() => expect(api.getWithdrawalTerms).toHaveBeenCalled());
    await amountInput().setValue('0.0015');
    await button('gomining.confirmWithdraw').trigger('click');
    await vi.waitFor(() => expect(api.withdraw).toHaveBeenCalled());

    expect(api.withdraw).toHaveBeenCalledWith('tok', { amountSats: 150_000, speed: 'fast', requestId: expect.any(String) });
    expect(wrapper.emitted('success')).toHaveLength(1);
  });

  it("shows GoMining's fast fee and what arrives", async () => {
    mountDialog();
    await vi.waitFor(() => expect(api.getWithdrawalTerms).toHaveBeenCalled());
    await amountInput().setValue('0.0015');
    await Vue.nextTick();
    expect(wrapper.text()).toContain('0.00002000 BTC');
    expect(wrapper.text()).toContain('0.00148000 BTC');
  });

  it('holds a fast withdrawal under the minimum, and lets a 24-hour one through', async () => {
    mountDialog();
    await vi.waitFor(() => expect(api.getWithdrawalTerms).toHaveBeenCalled());
    await amountInput().setValue('0.0005');
    await Vue.nextTick();
    expect(wrapper.text()).toContain('gomining.belowFastMinimum');
    expect(button('gomining.confirmWithdraw').attributes('disabled')).toBeDefined();

    await wrapper.findAll('[role="radio"]')[1].trigger('click');
    expect(button('gomining.confirmWithdraw').attributes('disabled')).toBeUndefined();
    await button('gomining.confirmWithdraw').trigger('click');
    await vi.waitFor(() => expect(api.withdraw).toHaveBeenCalled());
    expect(api.withdraw.mock.calls[0][1]).toMatchObject({ amountSats: 50_000, speed: 'standard' });
  });

  it('refuses more than the balance and amounts it cannot read exactly', async () => {
    mountDialog(120_000);
    await vi.waitFor(() => expect(api.getWithdrawalTerms).toHaveBeenCalled());
    for (const typed of ['0.0013', '0.000000001', '1e-3']) {
      await amountInput().setValue(typed);
      expect(button('gomining.confirmWithdraw').attributes('disabled')).toBeDefined();
    }
  });

  it('retries with the same request id after a failure', async () => {
    api.withdraw.mockRejectedValueOnce(new GoMiningApiError('upstream_unavailable', 502));
    mountDialog();
    await vi.waitFor(() => expect(api.getWithdrawalTerms).toHaveBeenCalled());
    await amountInput().setValue('0.0015');
    await button('gomining.confirmWithdraw').trigger('click');
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').text()).toContain('gomining.errorUnavailable'));

    await button('gomining.confirmWithdraw').trigger('click');
    await vi.waitFor(() => expect(api.withdraw).toHaveBeenCalledTimes(2));
    expect(api.withdraw.mock.calls[1][1].requestId).toBe(api.withdraw.mock.calls[0][1].requestId);
  });
});
