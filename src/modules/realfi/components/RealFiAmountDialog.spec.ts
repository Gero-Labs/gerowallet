import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

// A render function, not a template: vi.mock output is not compiled.
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({
  __esModule: true,
  default: {
    name: 'BaseDialog',
    render(this: { $slots: { default?: unknown } }, h: (tag: string, children: unknown) => unknown) {
      return h('div', this.$slots.default);
    },
  },
}));
vi.mock('@/plugins/i18n', () => ({
  default: {
    locale: 'en-US',
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}${JSON.stringify(values)}` : key,
  },
}));

import DialogSfc from './RealFiAmountDialog.vue';

const Dialog = DialogSfc as unknown as Parameters<typeof mount>[0];

function mountDialog(balanceUnits: string, mode: 'stake' | 'unstake' = 'stake', unlockDate?: string) {
  return mount(Dialog, {
    propsData: { isOpen: true, mode, balanceUnits, unlockDate },
    mocks: { $t: (key: string) => key },
    stubs: {
      'v-card-text': { template: '<div><slot /></div>' },
      'v-btn': {
        props: ['disabled'],
        template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
      },
      'v-text-field': {
        props: ['value', 'errorMessages', 'suffix'],
        template:
          '<div><input :value="value" @input="$emit(\'input\', $event.target.value)" />' +
          '<span class="err">{{ errorMessages }}</span><slot name="append" /></div>',
      },
    },
  });
}

type Wrapper = ReturnType<typeof mountDialog>;

function button(w: Wrapper, label: string) {
  const found = w.findAll('button').wrappers.find((b) => b.text() === label);
  if (!found) throw new Error(`no button labelled ${label}`);
  return found;
}

async function type(w: Wrapper, value: string) {
  await w.find('input').setValue(value);
}

describe('RealFiAmountDialog', () => {
  it('fills Max with the exact balance and orders exactly that', async () => {
    // 2^53 + 1 units: a float would round the last unit away.
    const w = mountDialog('9007199254740993');

    await button(w, 'common.max').trigger('click');
    expect((w.find('input').element as HTMLInputElement).value).toBe('9007199254.740993');
    await button(w, 'receive.tabStake').trigger('click');

    expect(w.emitted('confirm')).toEqual([['9007199254740993']]);
  });

  it('refuses more than the balance', async () => {
    const w = mountDialog('5000000');

    await type(w, '5.000001');

    expect(w.find('.err').text()).toBe('errors.insufficientBalance');
    expect(button(w, 'receive.tabStake').attributes('disabled')).toBeDefined();
    await button(w, 'receive.tabStake').trigger('click');
    expect(w.emitted('confirm')).toBeUndefined();
  });

  it('refuses more than six decimals', async () => {
    const w = mountDialog('5000000');

    await type(w, '0.0000001');

    expect(w.find('.err').text()).toBe('realfi.order.invalidAmount');
  });

  it('says when an unstake becomes claimable', () => {
    const w = mountDialog('5000000', 'unstake', '3 Oct 2026, 14:00');

    expect(w.text()).toContain('realfi.order.unstakeNote{"date":"3 Oct 2026, 14:00"}');
    expect(w.text()).toContain('staking.unstake');
  });
});
