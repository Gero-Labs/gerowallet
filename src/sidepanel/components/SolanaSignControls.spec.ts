// The signing controls shared by the Solana dApp prompts: which control shows for which wallet,
// and that nothing signs while the request cannot be signed.
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ControlsSfc from './SolanaSignControls.vue';
import { WalletType } from '@/models/types';

const Controls = ControlsSfc as unknown as Parameters<typeof mount>[0];

const VBtn = Vue.defineComponent({
  props: { disabled: Boolean, loading: Boolean },
  emits: ['click'],
  render() {
    return Vue.h('button', { disabled: this.disabled, onClick: () => this.$emit('click') }, this.$slots['default']?.());
  },
});
const VTextField = Vue.defineComponent({
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'keyup'],
  render() {
    return Vue.h('input', {
      class: 'password',
      value: this.modelValue,
      onInput: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLInputElement).value),
    });
  },
});

function mountControls(props: Record<string, unknown>) {
  return mount(Controls, {
    props: {
      walletType: WalletType.Normal, isPrfWallet: false, password: '', signing: false, signError: '',
      canSign: true, signLabel: 'Sign', unsupportedText: 'Not here', ...props,
    },
    global: {
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: { 'v-btn': VBtn, 'v-text-field': VTextField },
    },
  });
}

const buttons = (w: ReturnType<typeof mountControls>) => w.findAll('button');

describe('SolanaSignControls', () => {
  it('a password wallet: Sign needs a password and a signable request', async () => {
    const w = mountControls({ password: '' });
    expect(buttons(w)[1].attributes('disabled')).toBeDefined();
    await w.setProps({ password: 'pw' } as never);
    expect(buttons(w)[1].attributes('disabled')).toBeUndefined();
    await buttons(w)[1].trigger('click');
    expect(w.emitted('sign-password')).toHaveLength(1);
    await w.setProps({ canSign: false } as never);
    expect(buttons(w)[1].attributes('disabled')).toBeDefined();
    await w.find('input.password').setValue('next');
    expect(w.emitted('update:password')?.at(-1)).toEqual(['next']);
  });

  it('a PassKey wallet signs with the PassKey and shows the error', async () => {
    const w = mountControls({ isPrfWallet: true, signError: 'PassKey cancelled' });
    expect(w.find('input.password').exists()).toBe(false);
    expect(w.text()).toContain('PassKey cancelled');
    await buttons(w)[1].trigger('click');
    expect(w.emitted('sign-prf')).toHaveLength(1);
  });

  it('any other wallet can only reject', async () => {
    const w = mountControls({ walletType: WalletType.Ledger });
    expect(buttons(w)).toHaveLength(1);
    expect(w.text()).toContain('Not here');
    await buttons(w)[0].trigger('click');
    expect(w.emitted('reject')).toHaveLength(1);
  });
});
