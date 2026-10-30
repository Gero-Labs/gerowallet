import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

const signing = vi.hoisted(() => ({ loading: undefined as unknown as Vue.Ref<boolean> }));

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), fireSuccess: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { type: 'Normal' } }) };
});
vi.mock('@/shared/composables/useTransactionSigning', async () => {
  const { ref } = await import('vue');
  return {
    useTransactionSigning: () => {
      signing.loading = ref(false);
      return {
        loading: signing.loading,
        spendingPassword: ref(''), isSubmit: ref(false), isBT: ref(false), isPrfWallet: ref(false),
        isBTSupported: ref(false), passwordRules: [], privateKeyBytes: ref(null), overlay: ref(false),
        keystoneType: ref(''), keystoneCbor: ref(''), handleSign: vi.fn(), captureAuthorization: () => () => true,
        resetState: vi.fn(), handlePassKeyError: vi.fn(), handlePassKeyAuthError: vi.fn(),
        setPasswordFieldRef: vi.fn(), onKeystoneScan: vi.fn(), onKeystoneError: vi.fn(), onKeystoneProgress: vi.fn(),
      };
    },
  };
});
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: { render: () => Vue.h('div') } }));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({ default: { render: () => Vue.h('div') } }));

import CardSignSectionSfc from './CardSignSection.vue';

// Prop types erased, as in CardSignSection.spec.ts: the stub prepare() returns no real Tx.
const CardSignSection = CardSignSectionSfc as unknown as Vue.Component;

// Like the card modals: track `busy` and swap the sign section for a done view on success.
const Host = Vue.defineComponent({
  setup() {
    return { done: Vue.ref(false), busy: Vue.ref(false) };
  },
  render() {
    return this.done
      ? Vue.h('p', 'done')
      : Vue.h(CardSignSection, { label: 'Sign', prepare: async () => ({}), onBusy: (value: boolean) => { this.busy = value; } });
  },
});

describe('CardSignSection busy reporting', () => {
  it('reports not busy when a successful submit removes it in the same tick', async () => {
    const host = mount(Host, { global: { plugins: [createTestVuetify()] } });
    const vm = host.vm as unknown as { done: boolean; busy: boolean };

    signing.loading.value = true;
    await flushPromises();
    expect(vm.busy).toBe(true);

    // What submitTx does on success: onSuccess (the parent shows its done view), then loading off.
    vm.done = true;
    signing.loading.value = false;
    await flushPromises();

    expect(host.text()).toBe('done');
    expect(vm.busy).toBe(false);
  });

  it('says nothing extra when it is removed while idle', async () => {
    const busyEvents: boolean[] = [];
    const wrapper = mount(CardSignSection as Parameters<typeof mount>[0], {
      props: { label: 'Sign', prepare: async () => ({}), onBusy: (value: boolean) => busyEvents.push(value) },
      global: { plugins: [createTestVuetify()] },
    });
    wrapper.unmount();
    expect(busyEvents).toEqual([]);
  });
});
