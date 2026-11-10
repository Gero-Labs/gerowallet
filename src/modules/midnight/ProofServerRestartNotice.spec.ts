import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import * as Vue from 'vue';
import { defineComponent } from 'vue';

const send = vi.hoisted(() => vi.fn());
const stores = vi.hoisted(() => ({
  midnight: { proofServer: { mode: 'remote', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301' } },
  wallet: { loggedWallet: { id: 1, network: 'Mainnet' } as { id: number; network: string } | null, isLocked: false },
}));

vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: (stores.midnight = Vue.reactive(stores.midnight)) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: (stores.wallet = Vue.reactive(stores.wallet)) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import ProofServerRestartNotice from './ProofServerRestartNotice.vue';
import { PROOF_SERVER_RESTART_NOTICE_KEY } from '@/chains/midnight/proofServerRestartNotice';
import { midnightProofServerCommand } from '@/chains/midnight/midnightConfig';

const BaseDialogStub = defineComponent({
  props: { isOpen: Boolean, title: String, subtitle: String },
  emits: ['close'],
  render() {
    if (!this.isOpen) return null;
    return Vue.h('div', { 'data-test': 'dialog' }, [
      Vue.h('h2', this.title),
      Vue.h('p', this.subtitle),
      Vue.h('button', { 'data-test': 'dialog-close', onClick: () => this.$emit('close') }),
      this.$slots['default']?.(),
    ]);
  },
});
const GButtonStub = defineComponent({
  render() { return Vue.h('button', { ...this.$attrs }, this.$slots['default']?.()); },
});

function mountNotice(props: Record<string, unknown> = {}) {
  return mount(ProofServerRestartNotice, {
    props,
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { BaseDialog: BaseDialogStub, GButton: GButtonStub, 'v-card-actions': { template: '<div><slot /></div>' } },
    },
  });
}

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  localStorage.removeItem(PROOF_SERVER_RESTART_NOTICE_KEY);
  stores.midnight.proofServer = { mode: 'remote', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301' };
  stores.wallet.loggedWallet = { id: 1, network: 'Mainnet' };
  stores.wallet.isLocked = false;
  send.mockReset();
  send.mockResolvedValue({ data: { success: true, settings: { serveProofs: false } } });
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => localStorage.removeItem(PROOF_SERVER_RESTART_NOTICE_KEY));

describe('ProofServerRestartNotice', () => {
  it('never shows to a Gero Cloud user', async () => {
    const w = mountNotice();
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('never shows to an Arkhia user', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'zkpaas' };
    const w = mountNotice();
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('shows to local mode, with the new command, until Done', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = mountNotice();
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(true);
    expect(w.text()).toContain('midnight.proofServerRestart.title');
    const command = w.find('[data-test="proof-server-restart-command"]').text();
    expect(command).toBe(midnightProofServerCommand('Mainnet'));
    expect(command).not.toMatch(/(?:^|\s)-v(?:\s|$)/);

    await w.find('[data-test="proof-server-restart-done"]').trigger('click');
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    expect(localStorage.getItem(PROOF_SERVER_RESTART_NOTICE_KEY)).not.toBeNull();

    // A later open (a browser restart) does not show it again.
    const again = mountNotice();
    await flushPromises();
    expect(again.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('comes back on the next open when closed without Done', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, localUrl: 'http://127.0.0.1:7000' };
    const w = mountNotice();
    await flushPromises();
    await w.find('[data-test="dialog-close"]').trigger('click');
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    expect(localStorage.getItem(PROOF_SERVER_RESTART_NOTICE_KEY)).toBeNull();

    const again = mountNotice();
    await flushPromises();
    expect(again.find('[data-test="dialog"]').exists()).toBe(true);
  });

  it('shows to a wallet with "Prove for your phone" on', async () => {
    send.mockResolvedValue({ data: { success: true, settings: { serveProofs: true } } });
    const w = mountNotice();
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(true);
  });

  it('copies the new command for the open wallet\'s ledger', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    stores.wallet.loggedWallet = { id: 2, network: 'Stagenet' };
    const w = mountNotice();
    await flushPromises();
    await w.find('[data-test="proof-server-restart-copy"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith(midnightProofServerCommand('Stagenet'));
  });

  it('waits while suppressed and while locked', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = mountNotice({ suppressed: true });
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    await w.setProps({ suppressed: false });
    expect(w.find('[data-test="dialog"]').exists()).toBe(true);
    stores.wallet.isLocked = true;
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });
});
