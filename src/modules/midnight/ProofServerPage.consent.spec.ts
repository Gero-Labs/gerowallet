// PRIV-01 review P2: dapp proving through Gero Cloud or Arkhia needs the
// user's recorded consent, and the refusal tells them to give it in the
// proof-server settings. This pins that the settings page can record it.
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Vue, { defineComponent, ref } from 'vue';

const state = vi.hoisted(() => ({ mode: 'zkpaas' as 'remote' | 'local' | 'zkpaas' }));
const store = vi.hoisted(() => ({ shieldedProvingConsent: null as unknown }));

vi.mock('@/chains/midnight/useProofServerSettings', () => ({
  formatRelativeTime: () => '',
  useMidnightProofServer: () => ({
    proofServerMode: ref(state.mode),
    proofServerSaving: ref(false),
    localUrlDraft: ref(''), localUrlError: ref(''), onLocalUrlBlur: vi.fn(),
    localUrlLedger9Draft: ref(''), localUrlLedger9Error: ref(''), onLocalUrlLedger9Blur: vi.fn(),
    activeLedger9: ref(false),
    zkpaasUrlDraft: ref(''), zkpaasUrlError: ref(''), onZkpaasUrlBlur: vi.fn(),
    zkpaasKeyDraft: ref(''), onZkpaasKeyBlur: vi.fn(),
    zkpaasSecretDraft: ref(''), onZkpaasSecretBlur: vi.fn(),
    zkpaasEffectiveUrl: ref(''), zkpaasConfigured: ref(true), arkhiaDashboardUrl: '',
    dockerRunCommand: ref(''), healthStatus: ref('idle'), healthStatusLabel: ref(''),
    testingConnection: ref(false), testConnection: vi.fn(),
    lastCheckedAt: ref(null), lastCheckLatencyMs: ref(null), provingHistory: ref([]),
  }),
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ loggedWallet: { chain: 'Midnight' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.observable(store) }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, args?: Record<string, string>) => (args?.['provider'] ? `${key}:${args['provider']}` : key) }),
}));
vi.mock('@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue', async () => {
  const { defineComponent: define } = await import('vue');
  return {
    default: define({
      name: 'ShieldedProvingConsentDialogStub',
      props: { isOpen: Boolean, provider: String },
      render(h) {
        const props = this.$props as { isOpen?: boolean; provider?: string };
        return h('div', { attrs: { 'data-testid': 'consent-dialog', 'data-open': String(props.isOpen), 'data-provider': props.provider } });
      },
    }),
  };
});

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import ProofServerPage from './ProofServerPage.vue';

// GButton is a <script setup> import (not stubbable by name); it renders a
// v-btn and forwards its listeners, so the v-btn stub must be clickable.
const VBtnStub = defineComponent({
  render(h) {
    return h('button', { attrs: this.$attrs, on: this.$listeners }, this.$slots['default']);
  },
});

function mountPage(mode: typeof state.mode, consent: unknown) {
  state.mode = mode;
  store.shieldedProvingConsent = consent;
  return mount(ProofServerPage, {
    stubs: {
      CopyButton: true, 'v-icon': true, 'v-layout': { template: '<div><slot /></div>' },
      'v-row': { template: '<div><slot /></div>' }, 'v-col': { template: '<div><slot /></div>' },
      'v-text-field': true, 'v-progress-circular': true, 'v-expansion-panels': true, 'v-expansion-panel': true,
      'v-expansion-panel-header': true, 'v-expansion-panel-content': true, 'v-btn': VBtnStub,
    },
  });
}

describe('proof-server settings: remote-prover consent', () => {
  it('offers to record zkPaaS consent when Arkhia is selected without it', async () => {
    const w = mountPage('zkpaas', null);
    const card = w.find('[data-testid="ps-consent-card"]');
    expect(card.text()).toContain('midnight.proofServerPage.consentNeededBody:midnight.proofServerPage.compareZkpaasTitle');
    expect(w.find('[data-testid="consent-dialog"]').attributes('data-open')).toBe('false');
    await w.find('[data-testid="ps-consent-review"]').trigger('click');
    const dialog = w.find('[data-testid="consent-dialog"]');
    expect(dialog.attributes('data-open')).toBe('true');
    expect(dialog.attributes('data-provider')).toBe('zkpaas');
  });

  it('asks for Gero Cloud consent in remote mode, and shows it as given once recorded', () => {
    expect(mountPage('remote', null).find('[data-testid="consent-dialog"]').attributes('data-provider')).toBe('cloud');
    const given = mountPage('remote', { version: 3, acceptedAt: 1, provider: 'cloud' });
    expect(given.find('[data-testid="ps-consent-card"]').text()).toContain('midnight.proofServerPage.consentGiven');
    expect(given.find('[data-testid="ps-consent-review"]').exists()).toBe(false);
  });

  it('consent for the other provider does not count, and local mode needs none', () => {
    expect(mountPage('zkpaas', { version: 3, acceptedAt: 1, provider: 'cloud' }).find('[data-testid="ps-consent-review"]').exists()).toBe(true);
    expect(mountPage('local', null).find('[data-testid="ps-consent-card"]').exists()).toBe(false);
  });
});
