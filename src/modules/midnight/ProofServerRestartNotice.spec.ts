import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import * as Vue from 'vue';
import { defineComponent } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const send = vi.hoisted(() => vi.fn());
const stores = vi.hoisted(() => ({
  midnight: { proofServer: { mode: 'remote', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301' } },
  wallet: { loggedWallet: { id: 1, network: 'Mainnet' } as { id: number; network: string } | null, isLocked: false },
}));

vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: (stores.midnight = Vue.reactive(stores.midnight)) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: (stores.wallet = Vue.reactive(stores.wallet)) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import ProofServerRestartNotice from './ProofServerRestartNotice.vue';
import { i18nPlugin } from '@/plugins/i18n';
import us from '@/plugins/i18n/us';
import { PROOF_SERVER_RESTART_NOTICE_KEY } from '@/chains/midnight/proofServerRestartNotice';
import { midnightProofServerCommand } from '@/chains/midnight/midnightConfig';

const BaseDialogStub = defineComponent({
  props: { isOpen: Boolean, title: String, subtitle: String, icon: String },
  emits: ['close'],
  render() {
    if (!this.isOpen) return null;
    return Vue.h('div', { 'data-test': 'dialog', 'data-subtitle': String(this.subtitle ?? ''), 'data-icon': this.icon }, [
      Vue.h('h2', this.title),
      Vue.h('button', { 'data-test': 'dialog-close', onClick: () => this.$emit('close') }),
      this.$slots['default']?.(),
    ]);
  },
});
const GButtonStub = defineComponent({
  render() { return Vue.h('button', { ...this.$attrs }, this.$slots['default']?.()); },
});

enableAutoUnmount(afterEach);

/** The notice waits for the page to settle before it opens. */
async function mountNotice(props: Record<string, unknown> = {}) {
  const w = mount(ProofServerRestartNotice, {
    props,
    global: {
      plugins: [i18nPlugin],
      stubs: { BaseDialog: BaseDialogStub, GButton: GButtonStub, 'v-card-actions': { template: '<div><slot /></div>' } },
    },
  });
  await flushPromises();
  await vi.advanceTimersByTimeAsync(1_500);
  return w;
}

const writeText = vi.fn(async () => undefined);
const msg = (key: string) => (us as Record<string, string>)[key]!;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.removeItem(PROOF_SERVER_RESTART_NOTICE_KEY);
  stores.midnight.proofServer = { mode: 'remote', localUrl: 'http://localhost:6300', localUrlLedger9: 'http://localhost:6301' };
  stores.wallet.loggedWallet = { id: 1, network: 'Mainnet' };
  stores.wallet.isLocked = false;
  send.mockReset();
  send.mockResolvedValue({ data: { success: true, settings: { serveProofs: false } } });
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  localStorage.removeItem(PROOF_SERVER_RESTART_NOTICE_KEY);
  vi.useRealTimers();
});

describe('ProofServerRestartNotice', () => {
  it('never shows to a Gero Cloud user', async () => {
    const w = await mountNotice();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('never shows to an Arkhia user', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'zkpaas' };
    const w = await mountNotice();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('waits for the page to settle before it opens', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = mount(ProofServerRestartNotice, { global: { plugins: [i18nPlugin], stubs: { BaseDialog: BaseDialogStub, GButton: GButtonStub } } });
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(w.find('[data-test="dialog"]').exists()).toBe(true);
  });

  it('puts the body in the dialog, not the subtitle, and uses the shield icon', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = await mountNotice();
    const dialog = w.find('[data-test="dialog"]');
    expect(dialog.attributes('data-subtitle')).toBe('');
    expect(dialog.attributes('data-icon')).toBe('mdi-shield-alert-outline');
    expect(w.find('[data-test="proof-server-restart-body"]').text()).toBe(msg('midnight.proofServerRestart.body'));
  });

  it('orders the steps so the new server is started in a new terminal, last', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = await mountNotice();
    const steps = w.findAll('[data-test="proof-server-restart-steps"] > li');
    expect(steps).toHaveLength(4);
    expect(steps[0].text()).toBe(msg('midnight.proofServerRestart.step1'));
    expect(steps[1].text()).toContain('docker rm');
    // --rm is rendered as code inside its sentence.
    expect(steps[1].findAll('code').map((c) => c.text())).toContain('--rm');
    expect(steps[1].text()).toContain('If you started it with --rm, stopping it already removed it.');
    expect(steps[2].text()).toBe(msg('midnight.proofServerRestart.step3'));
    expect(steps[3].text()).toContain(msg('midnight.proofServerRestart.step4'));
    expect(steps[3].find('[data-test="command-block-code"]').text()).toBe(midnightProofServerCommand('Mainnet'));
  });

  it('shows the new command, without the verbose flag, until Done', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = await mountNotice();
    const command = w.find('[data-test="command-block-code"]').text();
    expect(command).not.toMatch(/(?:^|\s)-v(?:\s|$)/);

    await w.find('[data-test="proof-server-restart-done"]').trigger('click');
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    expect(localStorage.getItem(PROOF_SERVER_RESTART_NOTICE_KEY)).not.toBeNull();

    const again = await mountNotice();
    expect(again.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it.each([
    ['Not now', '[data-test="proof-server-restart-not-now"]'],
    ['the close button', '[data-test="dialog-close"]'],
  ])('%s hides it for this page only', async (_name, selector) => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, localUrl: 'http://127.0.0.1:7000' };
    const w = await mountNotice();
    await w.find(selector).trigger('click');
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    expect(localStorage.getItem(PROOF_SERVER_RESTART_NOTICE_KEY)).toBeNull();
    const again = await mountNotice();
    expect(again.find('[data-test="dialog"]').exists()).toBe(true);
  });

  it('shows to a wallet with "Prove for your phone" on', async () => {
    send.mockResolvedValue({ data: { success: true, settings: { serveProofs: true } } });
    const w = await mountNotice();
    expect(w.find('[data-test="dialog"]').exists()).toBe(true);
  });

  it('copies the new command for the open wallet\'s ledger from inside the command block', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    stores.wallet.loggedWallet = { id: 2, network: 'Stagenet' };
    const w = await mountNotice();
    await w.find('[data-test="command-block-copy"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith(midnightProofServerCommand('Stagenet'));
  });

  it('shows both commands to someone who saved custom URLs for both ledgers', async () => {
    stores.midnight.proofServer = { mode: 'local', localUrl: 'http://127.0.0.1:7000', localUrlLedger9: 'http://127.0.0.1:7001' };
    const w = await mountNotice();
    expect(w.findAll('[data-test="command-block-code"]').map((c) => c.text()))
      .toEqual([midnightProofServerCommand('Mainnet'), midnightProofServerCommand('Stagenet')]);
  });

  it('waits while suppressed and while locked', async () => {
    stores.midnight.proofServer = { ...stores.midnight.proofServer, mode: 'local' };
    const w = await mountNotice({ suppressed: true });
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
    await w.setProps({ suppressed: false });
    expect(w.find('[data-test="dialog"]').exists()).toBe(true);
    stores.wallet.isLocked = true;
    await flushPromises();
    expect(w.find('[data-test="dialog"]').exists()).toBe(false);
  });

  it('is mounted on the dashboard and in the side panel', () => {
    const src = join(__dirname, '../..');
    expect(readFileSync(join(src, 'modules/navigation/layouts/ContentLayout.vue'), 'utf8')).toContain('<ProofServerRestartNotice');
    expect(readFileSync(join(src, 'sidepanel/App.vue'), 'utf8')).toMatch(/<ProofServerRestartNotice\s+v-if="hasActiveWallet && !isLocked"/);
  });
});
