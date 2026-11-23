// The dashboard and side-panel proof server widgets with Gero Prover chosen. The flag
// store loads after the widget mounts, so the first check probes the Docker server; when
// the flag arrives the widget must show Gero Prover's status, even if that Docker probe
// finishes afterwards (it once left "Not detected" for the five minutes until the next
// helper poll).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { LEDGER8_PROTOCOL_VERSION as L8, LEDGER9_PROTOCOL_VERSION_SAMPLE as L9, useMidnightChains } from '@test/helpers/midnightChains';

const mocks = vi.hoisted(() => ({
  health: vi.fn(),
  version: vi.fn(),
  refresh: vi.fn(),
}));
const flags = vi.hoisted(() => ({ helper: null as unknown as { value: boolean } }));
const store = vi.hoisted(() => ({
  proofServer: {
    mode: 'local', localEngine: 'helper', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301',
    zkpaasUrl: '', zkpaasApiKey: '', zkpaasApiSecret: '',
  },
}));

vi.mock('@/chains/midnight/midnightLocalProver', () => ({ checkProofServerHealth: mocks.health, checkProofServerVersion: mocks.version }));
vi.mock('@/chains/midnight/geroProverState', () => ({ refreshGeroProver: mocks.refresh }));
vi.mock('@/chains/midnight/geroProverFlag', () => ({
  geroProverOfferedHere: () => flags.helper.value,
  threadedProvingOfferedHere: () => false,
}));
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { useMidnightProofServer } from './useProofServerSettings';

function mountSettings() {
  let api!: ReturnType<typeof useMidnightProofServer>;
  const wrapper = mount(defineComponent({ setup() { api = useMidnightProofServer(); return () => h('div'); } }));
  return { wrapper, api: () => api };
}

beforeEach(() => {
  vi.resetAllMocks();
  useMidnightChains({ preprod: [L9, L8] });
  flags.helper = ref(false);
  mocks.refresh.mockResolvedValue({ connection: 'connected', version: '1.0.0', os: 'windows' });
});

describe('proof server status with Gero Prover chosen', () => {
  it('shows Gero Prover as detected when the flag arrives during a Docker probe that then fails', async () => {
    let finishDockerProbe!: (healthy: boolean) => void;
    mocks.health.mockReturnValue(new Promise<boolean>((resolve) => { finishDockerProbe = resolve; }));
    const { wrapper, api } = mountSettings();
    await flushPromises();
    expect(mocks.health).toHaveBeenCalledTimes(1);

    flags.helper.value = true;
    await flushPromises();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(api().healthStatus.value).toBe('detected');

    finishDockerProbe(false);
    await flushPromises();
    expect(api().healthStatus.value).toBe('detected');
    wrapper.unmount();
  });

  it('still reports a Gero Prover that is not there', async () => {
    flags.helper.value = true;
    mocks.refresh.mockResolvedValue({ connection: 'not-found' });
    const { wrapper, api } = mountSettings();
    await flushPromises();
    expect(mocks.health).not.toHaveBeenCalled();
    expect(api().healthStatus.value).toBe('notDetected');
    wrapper.unmount();
  });
});
