// A card payment sent as a sweep: the section hands the signer the merges, passes on where
// the sweep is, and says whether this wallet can sign one at all.
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  options: null as null | {
    prerequisites?: { value: unknown };
    onProgress?: (progress: unknown) => void;
    onInterrupted?: (stop: unknown) => void;
  },
  requiresRemote: false,
}));

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), fireSuccess: vi.fn() } }));
vi.mock('@/stores/walletStore', async () => {
  const { reactive } = await import('vue');
  return { walletStore: reactive({ loggedWallet: { type: 'Normal' } }) };
});
vi.mock('@/shared/composables/useTransactionSigning', async () => {
  const { ref, computed } = await import('vue');
  return {
    useTransactionSigning: (options: typeof state.options) => {
      state.options = options;
      return {
        loading: ref(false), spendingPassword: ref(''), isSubmit: ref(false), isBT: ref(false),
        isPrfWallet: ref(false), isBTSupported: ref(false), passwordRules: [], privateKeyBytes: ref(null),
        overlay: ref(false), keystoneType: ref(''), keystoneCbor: ref(''),
        requiresRemoteForSend: computed(() => state.requiresRemote),
        handleSign: vi.fn(), captureAuthorization: () => () => true, resetState: vi.fn(),
        handlePassKeyError: vi.fn(), handlePassKeyAuthError: vi.fn(), setPasswordFieldRef: vi.fn(),
        onKeystoneScan: vi.fn(), onKeystoneError: vi.fn(), onKeystoneProgress: vi.fn(),
      };
    },
  };
});
vi.mock('@/shared/components/TransactionAuthSection.vue', () => ({ default: { name: 'TransactionAuthSection', render: () => Vue.h('div') } }));
vi.mock('@/shared/dialogs/KeystoneSignDialog.vue', () => ({ default: { name: 'KeystoneSignDialog', render: () => Vue.h('div') } }));

import CardSignSectionSfc from './CardSignSection.vue';
import { walletStore } from '@/stores/walletStore';

const CardSignSection = CardSignSectionSfc as unknown as Parameters<typeof mount>[0];
const MERGES = { cbors: ['merge'], outputs: [] };

function render(props: Record<string, unknown> = {}) {
  return mount(CardSignSection, {
    props: { label: 'Sign', prepare: vi.fn(), ...props },
    global: { plugins: [createTestVuetify()] },
  });
}

describe('CardSignSection with a sweep', () => {
  afterEach(() => {
    state.options = null;
    state.requiresRemote = false;
    walletStore.loggedWallet = { type: 'Normal' } as never;
  });

  it('hands the signer the merges it is given, and none by default', async () => {
    const wrapper = render();
    expect(state.options?.prerequisites?.value).toBeNull();
    await wrapper.setProps({ prerequisites: MERGES } as never);
    expect(state.options?.prerequisites?.value).toEqual(MERGES);
  });

  it('passes on where the sweep is and where it stopped', () => {
    const wrapper = render({ prerequisites: MERGES });
    const progress = { phase: 'sending', step: 2, total: 3 };
    const stop = { step: 2, total: 3, mergesSent: 1, reason: 'refused' };
    state.options?.onProgress?.(progress);
    state.options?.onInterrupted?.(stop);
    expect(wrapper.emitted('progress')).toEqual([[progress]]);
    expect(wrapper.emitted('interrupted')).toEqual([[stop]]);
  });

  it('can sign a sweep with a password, PassKey or Google wallet, never with a device or a remote-only policy', () => {
    const canSweep = () => (render().vm as unknown as { canSweep: boolean }).canSweep;
    expect(canSweep()).toBe(true);
    walletStore.loggedWallet = { type: 'Google' } as never;
    expect(canSweep()).toBe(true);
    walletStore.loggedWallet = { type: 'Ledger' } as never;
    expect(canSweep()).toBe(false);
    walletStore.loggedWallet = { type: 'Normal' } as never;
    state.requiresRemote = true;
    expect(canSweep()).toBe(false);
  });
});
