import Vue from 'vue';
import type { CreateElement } from 'vue';
import Vuetify from 'vuetify';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The transaction the signer was handed, one entry per signing attempt.
const signed = vi.hoisted(() => ({ txs: [] as unknown[] }));

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), fireSuccess: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { type: 'Normal' } }) };
});
// Signs whatever options.tx holds and never marks it signed, as after a wrong password. Its own
// autofill handler signs straight away, like the real one (which waits 300 ms first).
vi.mock('@/shared/composables/useTransactionSigning', async () => {
  const { ref } = await import('vue');
  return {
    useTransactionSigning: (options: { tx: { value: unknown } }) => {
      const handleSign = vi.fn(async () => {
        signed.txs.push(options.tx.value);
      });
      return {
        loading: ref(false),
        spendingPassword: ref(''),
        isSubmit: ref(false),
        isBT: ref(false),
        isPrfWallet: ref(false),
        isBTSupported: ref(false),
        passwordRules: [],
        privateKeyBytes: ref(null),
        overlay: ref(false),
        keystoneType: ref(''),
        keystoneCbor: ref(''),
        handleSign,
        resetState: vi.fn(),
        handlePassKeySuccess: () => {
          void handleSign();
        },
        handlePassKeyError: vi.fn(),
        handlePassKeyAuthError: vi.fn(),
        setPasswordFieldRef: vi.fn(),
        onKeystoneScan: vi.fn(),
        onKeystoneError: vi.fn(),
        onKeystoneProgress: vi.fn(),
      };
    },
  };
});
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({
  default: { name: 'TransactionAuthSection', render: (h: CreateElement) => h('div') },
}));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({
  default: { name: 'KeystoneSignDialog', render: (h: CreateElement) => h('div') },
}));

import CardSignSectionSfc from './CardSignSection.vue';

Vue.use(Vuetify);
const CardSignSection = CardSignSectionSfc as unknown as Parameters<typeof mount>[0];
const TX_1 = { id: 'tx-1' };
const TX_2 = { id: 'tx-2' };

function render(prepare: () => Promise<unknown>) {
  const wrapper = mount(CardSignSection, { vuetify: new Vuetify(), propsData: { label: 'Sign', prepare } });
  return wrapper.findComponent({ name: 'TransactionAuthSection' });
}

// Lets the prepare -> sign chain run to the end.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CardSignSection', () => {
  afterEach(() => {
    signed.txs.length = 0;
    vi.clearAllMocks();
  });

  it('prepares the transaction before signing a password PassKey autofilled', async () => {
    const prepare = vi.fn().mockResolvedValue(TX_1);
    const auth = render(prepare);
    auth.vm.$emit('update:password', 'from-passkey');
    auth.vm.$emit('autofill-success');
    await settle();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(signed.txs).toEqual([TX_1]);
  });

  it('prepares a fresh transaction when autofill follows a failed attempt', async () => {
    const prepare = vi.fn().mockResolvedValueOnce(TX_1).mockResolvedValueOnce(TX_2);
    const auth = render(prepare);
    auth.vm.$emit('update:password', 'wrong');
    auth.vm.$emit('submit');
    await settle();
    auth.vm.$emit('update:password', 'from-passkey');
    auth.vm.$emit('autofill-success');
    await settle();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(signed.txs).toEqual([TX_1, TX_2]);
  });
});
