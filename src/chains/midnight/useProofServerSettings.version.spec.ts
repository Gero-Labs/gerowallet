// Issue 1475: a local proof server for the other ledger answers /health and
// then fails at proving, so Settings reads its release and says so, and the
// one-time "update to 9.0.x" notice shows to local-mode users until they
// dismiss it or a check finds the right release.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { LEDGER8_PROTOCOL_VERSION as L8, LEDGER9_PROTOCOL_VERSION_SAMPLE as L9, useMidnightChains } from '@test/helpers/midnightChains';

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  version: vi.fn(),
}));
const store = vi.hoisted(() => ({
  proofServer: { mode: 'local', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301', zkpaasUrl: '', zkpaasApiKey: '', zkpaasApiSecret: '' },
}));

vi.mock('@/chains/midnight/midnightLocalProver', () => ({ checkProofServerHealth: mocks.health, checkProofServerVersion: mocks.version }));
vi.mock('@/stores/midnightStore', async () => {
  const vue = await import('vue');
  return { midnightStore: vue.reactive(store) };
});
vi.mock('@/stores/walletStore', async () => {
  const vue = await import('vue');
  return { walletStore: vue.reactive({ loggedWallet: { network: 'Preprod' } }) };
});
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/plugins/snackbar', () => ({ default: { show: vi.fn() } }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string, args?: Record<string, string>) => (args ? `${key}:${JSON.stringify(args)}` : key) }),
}));

import { useMidnightProofServer } from './useProofServerSettings';
import {
  isProofServerLedger9NoticeDone,
  PROOF_SERVER_LEDGER9_NOTICE_KEY,
  resetProofServerLedger9NoticeForTests,
} from './proofServerLedger9Notice';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import ProofServerLedger9Notice from '@/modules/midnight/ProofServerLedger9Notice.vue';

function mountSettings() {
  let api!: ReturnType<typeof useMidnightProofServer>;
  const wrapper = mount(defineComponent({ setup() { api = useMidnightProofServer(); return () => h('div'); } }));
  return { wrapper, api: () => api };
}

beforeEach(() => {
  vi.resetAllMocks();
  store.proofServer.mode = 'local';
  localStorage.removeItem(PROOF_SERVER_LEDGER9_NOTICE_KEY);
  resetProofServerLedger9NoticeForTests();
  useMidnightChains({ preprod: [L9, L8] });
  mocks.health.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('proof server settings: the release check', () => {
  it('shows a server on the ledger 8 release as the wrong version for a ledger 9 chain', async () => {
    mocks.version.mockResolvedValue({ status: 'mismatch', version: '8.1.0' });
    const { wrapper, api } = mountSettings();
    await flushPromises();
    expect(mocks.version).toHaveBeenCalledWith('http://localhost:6301', 9);
    expect(api().healthStatus.value).toBe('wrongVersion');
    expect(api().serverVersion.value).toBe('8.1.0');
    expect(api().requiredVersion.value).toBe('9.0.x');
    expect(api().healthStatusLabel.value).toBe('midnight.proofServer.statusWrongVersion:{"version":"8.1.0"}');
    expect(isProofServerLedger9NoticeDone()).toBe(false);
    wrapper.unmount();
  });

  it('reads a matching release as detected and retires the update notice', async () => {
    mocks.version.mockResolvedValue({ status: 'match', version: '9.0.1' });
    const { wrapper, api } = mountSettings();
    await flushPromises();
    expect(api().healthStatus.value).toBe('detected');
    expect(isProofServerLedger9NoticeDone()).toBe(true);
    wrapper.unmount();
  });

  it('keeps a server that does not say its release as detected', async () => {
    mocks.version.mockResolvedValue({ status: 'unknown' });
    const { wrapper, api } = mountSettings();
    await flushPromises();
    expect(api().healthStatus.value).toBe('detected');
    expect(api().serverVersion.value).toBeNull();
    wrapper.unmount();
  });

  it('never asks zkPaaS for its release', async () => {
    store.proofServer.mode = 'zkpaas';
    store.proofServer.zkpaasApiKey = 'synthetic-key';
    const { wrapper, api } = mountSettings();
    await flushPromises();
    expect(mocks.version).not.toHaveBeenCalled();
    expect(api().healthStatus.value).toBe('detected');
    store.proofServer.zkpaasApiKey = '';
    wrapper.unmount();
  });
});

describe('ProofServerLedger9Notice', () => {
  const global = { stubs: { CommandBlock: { props: ['command'], template: '<code data-test="cmd">{{ command }}</code>' }, 'v-icon': true, 'v-btn': { template: '<button v-bind="$attrs"><slot /></button>' } }, mocks: { $t: (key: string, args?: Record<string, string>) => (args ? `${key}:${JSON.stringify(args)}` : key) } };

  it('shows local-mode users the 9.0.x command until they dismiss it', async () => {
    const wrapper = mount(ProofServerLedger9Notice, { props: { network: 'Preprod' }, global });
    expect(wrapper.text()).toContain('midnight.proofServer.ledger9Notice:{"required":"9.0.x"}');
    expect(wrapper.find('[data-test="cmd"]').text()).toContain('midnightntwrk/proof-server:9.0.0');
    await wrapper.find('[data-test="proof-server-ledger9-notice-done"]').trigger('click');
    await nextTick();
    expect(wrapper.find('[data-test="proof-server-ledger9-notice"]').exists()).toBe(false);
    expect(localStorage.getItem(PROOF_SERVER_LEDGER9_NOTICE_KEY)).not.toBeNull();
  });

  it.each(['remote', 'zkpaas'] as const)('stays hidden in %s mode', mode => {
    store.proofServer.mode = mode;
    const wrapper = mount(ProofServerLedger9Notice, { props: { network: 'Preprod' }, global });
    expect(wrapper.find('[data-test="proof-server-ledger9-notice"]').exists()).toBe(false);
  });

  it('stays hidden on a chain still on ledger 8', () => {
    useMidnightChains({ preprod: [L8, L8] });
    const wrapper = mount(ProofServerLedger9Notice, { props: { network: 'Preprod' }, global });
    expect(wrapper.find('[data-test="proof-server-ledger9-notice"]').exists()).toBe(false);
  });
});

