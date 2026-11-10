import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: h.send } }));
vi.mock('@/shared/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string, args?: Record<string, unknown>) => (args?.['address'] ? `${k}:${args['address']}` : args?.['count'] !== undefined ? `${k}:${args['count']}` : k),
    tc: (k: string, n: number) => `${k}#${n}`,
  }),
}));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: { network: 'Mainnet' } }) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNotIncludedCard from './MidnightNotIncludedCard.vue';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightPendingRowStatus from './MidnightPendingRowStatus.vue';
// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightNoticeSlot from './MidnightNoticeSlot.vue';
import { midnightStore } from '@/stores/midnightStore';
import { takeMidnightSendPrefill } from '@/chains/midnight/midnightSendPrefill';
import { PENDING_EXPIRY_MS } from '@/chains/midnight/midnightPendingSends';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';
import { MessageTypes } from '@/models/MessageTypes';

const NOW = new Date('2026-11-10T12:00:00Z').getTime();
const stubs = {
  'v-icon': true,
  GButton: { props: ['tier'], emits: ['click'], template: '<button :data-tier="tier" @click="$emit(\'click\')"><slot /></button>' },
};
const notFound = { at: NOW - 60_000, upgrade: true, notFound: true };
const sent = (hash: string, extra: Partial<MidnightTransaction> = {}): MidnightTransaction => ({
  hash, type: 'send', token: 'NIGHT', amount: 40_000_000n, counterparty: 'mn_addr1qq9fk2x7qa5s8d7w3e77cd', timestamp: NOW - 2 * 86_400_000,
  status: 'pending', fee: 0n, isShielded: false, ledgerHash: true, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.send.mockReset().mockResolvedValue({ data: { success: true, result: { outcome: 'notFound' } } });
  midnightStore.transactions = [];
  midnightStore.refreshSnapshot = null;
  midnightStore.refreshing = null;
  takeMidnightSendPrefill();
});
afterEach(() => vi.useRealTimers());

describe('"Didn\'t go through" card (after a chain reset)', () => {
  it('lists only kept sends the lookup did not find, with amount, recipient and both actions', () => {
    midnightStore.transactions = [
      sent('aa', { beforeReset: notFound }),
      sent('bb', { status: 'confirmed' }),
      sent('cc', { beforeReset: { at: NOW - 1_000, upgrade: true } }), // not looked up yet: "Not confirmed", not here
    ];
    const w = mount(MidnightNotIncludedCard, { global: { stubs } });
    const items = w.findAll('[data-test="midnight-not-included-item"]');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain('40.00 NIGHT');
    expect(items[0].text()).toContain('midnight.pending.toAddress:mn_addr qq9f k2x7 … 77cd');
    expect(w.get('[data-test="midnight-send-again"]').attributes('data-tier')).toBe('secondary');
    expect(w.get('[data-test="midnight-dismiss-not-included"]').attributes('data-tier')).toBe('tertiary');
  });

  it('"network upgrade" and "No funds moved" only when the server gave that cause; singular or plural; no live region of its own', () => {
    midnightStore.transactions = [sent('aa', { beforeReset: notFound })];
    let w = mount(MidnightNotIncludedCard, { global: { stubs } });
    expect(w.get('[data-test="midnight-not-included"]').attributes('role')).toBeUndefined();
    // The card comes and goes: the slot's always-mounted region says it.
    expect(w.get('[data-test="midnight-not-included-text"]').attributes('role')).toBeUndefined();
    expect(w.get('[data-test="midnight-not-included-text"]').text()).toBe('midnight.pending.notIncludedUpgrade#1');
    midnightStore.transactions = [sent('aa', { beforeReset: { ...notFound, upgrade: false } }), sent('dd', { beforeReset: notFound })];
    w = mount(MidnightNotIncludedCard, { global: { stubs } });
    expect(w.get('[data-test="midnight-not-included-text"]').text()).toBe('midnight.pending.notIncluded#2');
  });

  it('shows the newest two, then "Show N more"; "Dismiss all" when there is more than one', async () => {
    midnightStore.transactions = ['a1', 'a2', 'a3'].map((hash, i) => sent(hash, { timestamp: NOW - i * 1_000, beforeReset: notFound }));
    const w = mount(MidnightNotIncludedCard, { global: { stubs } });
    expect(w.findAll('[data-test="midnight-not-included-item"]')).toHaveLength(2);
    expect(w.get('[data-test="midnight-not-included-more"]').text()).toBe('midnight.pending.showMore:1');
    await w.get('[data-test="midnight-not-included-more"]').trigger('click');
    expect(w.findAll('[data-test="midnight-not-included-item"]')).toHaveLength(3);
    await w.get('[data-test="midnight-dismiss-all"]').trigger('click');
    await flushPromises();
    expect(h.send.mock.calls.map((c) => c[0].data.hash)).toEqual(['a1', 'a2', 'a3']);
  });

  it('Send again fills Send in and asks the parent to open it; nothing is sent', async () => {
    midnightStore.transactions = [sent('aa', { beforeReset: notFound })];
    const w = mount(MidnightNotIncludedCard, { global: { stubs } });
    await w.get('[data-test="midnight-send-again"]').trigger('click');
    expect(w.emitted('send-again')).toHaveLength(1);
    expect(takeMidnightSendPrefill()).toEqual({ recipient: 'mn_addr1qq9fk2x7qa5s8d7w3e77cd', amount: 40_000_000n, token: 'NIGHT', shielded: false });
    expect(h.send).not.toHaveBeenCalled();
  });

  it('the side panel offers no Send again for a shielded send (its Send is unshielded only)', () => {
    midnightStore.transactions = [sent('aa', { isShielded: true, beforeReset: notFound })];
    expect(mount(MidnightNotIncludedCard, { props: { layout: 'panel' }, global: { stubs } }).find('[data-test="midnight-send-again"]').exists()).toBe(false);
    expect(mount(MidnightNotIncludedCard, { props: { layout: 'page' }, global: { stubs } }).find('[data-test="midnight-send-again"]').exists()).toBe(true);
  });

  it('Dismiss asks the background to drop the row and keeps focus in the card', async () => {
    midnightStore.transactions = [sent('aa', { beforeReset: notFound }), sent('bb', { beforeReset: notFound, timestamp: NOW - 3 * 86_400_000 })];
    const w = mount(MidnightNotIncludedCard, { attachTo: document.body, global: { stubs } });
    h.send.mockImplementation(async () => { midnightStore.transactions = [midnightStore.transactions[1]]; return { data: { success: true } }; });
    await w.findAll('[data-test="midnight-dismiss-not-included"]')[0].trigger('click');
    await flushPromises();
    expect(h.send).toHaveBeenCalledWith({ method: MessageTypes.DISMISS_MIDNIGHT_PENDING_TX, data: { hash: 'aa', token: 'NIGHT' } });
    expect(document.activeElement?.closest('[data-test="midnight-not-included-item"]')).not.toBeNull();
    w.unmount();
  });
});

describe('"Not confirmed" on a history row', () => {
  it('a pending send past 30 minutes reads "Not confirmed"; Check again stays put, held and busy, while it asks', async () => {
    let answer: (v: unknown) => void = () => undefined;
    h.send.mockImplementation(() => new Promise((r) => { answer = r; }));
    const w = mount(MidnightPendingRowStatus, { props: { tx: sent('aa', { timestamp: NOW - PENDING_EXPIRY_MS }) }, global: { stubs } });
    expect(w.get('[data-test="midnight-not-confirmed"]').text()).toBe('midnight.pending.notConfirmed');
    await w.get('[data-test="midnight-check-again"]').trigger('click');
    const button = w.get('[data-test="midnight-check-again"]');
    expect([button.text(), button.attributes('aria-disabled'), button.attributes('aria-busy')]).toEqual(['midnight.pending.checking', 'true', 'true']);
    expect(h.send).toHaveBeenCalledWith({ method: MessageTypes.CHECK_MIDNIGHT_PENDING_TX, data: { hash: 'aa', token: 'NIGHT' } });
    answer({ data: { success: true, result: { outcome: 'notFound' } } });
    await flushPromises();
    expect(w.get('[data-test="midnight-check-outcome"]').text()).toBe('midnight.pending.stillNotConfirmed');
    expect(w.get('[data-test="midnight-check-outcome"]').attributes('aria-live')).toBe('polite');
  });

  it('Check again that could not ask says so, never "Still not confirmed"', async () => {
    const tx = sent('ab', { timestamp: NOW - PENDING_EXPIRY_MS });
    const outcome = async (reply: () => Promise<unknown>) => {
      h.send.mockImplementationOnce(reply);
      const w = mount(MidnightPendingRowStatus, { props: { tx }, global: { stubs } });
      await w.get('[data-test="midnight-check-again"]').trigger('click');
      await flushPromises();
      return w.get('[data-test="midnight-check-outcome"]').text();
    };
    await expect(outcome(async () => ({ data: { success: true, result: { outcome: 'unknown' } } }))).resolves.toBe('midnight.pending.couldNotCheck');
    await expect(outcome(async () => ({ data: { success: false, error: 'down' } }))).resolves.toBe('midnight.pending.couldNotCheck');
    await expect(outcome(async () => { throw new Error('no background'); })).resolves.toBe('midnight.pending.couldNotCheck');
    // Found without its result yet: still not confirmed.
    await expect(outcome(async () => ({ data: { success: true, result: { outcome: 'waiting' } } }))).resolves.toBe('midnight.pending.stillNotConfirmed');
  });

  it('Check again gives the lookup\'s verdict: a kept send the indexer doesn\'t have never went through, and joins the card', async () => {
    h.send.mockResolvedValueOnce({ data: { success: true, result: { outcome: 'notFound' } } });
    const kept = sent('ad', { beforeReset: { at: NOW - 60_000, upgrade: true } });
    const w = mount(MidnightPendingRowStatus, { props: { tx: kept }, global: { stubs } });
    await w.get('[data-test="midnight-check-again"]').trigger('click');
    await flushPromises();
    expect(w.get('[data-test="midnight-check-outcome"]').text()).toBe('midnight.pending.neverWentThrough');
    // The background marks it, as the lookup after a rebuild does.
    const background = readFileSync(join(__dirname, '../../../chrome/background.ts'), 'utf8');
    expect(background).toContain("else if (outcome === 'notFound' && row?.beforeReset && !midnightStore.refreshing) midnightActions.markPendingNotIncluded(hash, rowToken);");
  });

  it('a row keyed by the extrinsic hash offers Dismiss but no Check again', () => {
    const w = mount(MidnightPendingRowStatus, { props: { tx: sent('ee', { ledgerHash: undefined, timestamp: NOW - PENDING_EXPIRY_MS }) }, global: { stubs } });
    expect(w.find('[data-test="midnight-check-again"]').exists()).toBe(false);
    expect(w.find('[data-test="midnight-dismiss-pending"]').exists()).toBe(true);
  });

  it('while Midnight data is rebuilt, the chip alone: no actions, no outcome', () => {
    midnightStore.refreshSnapshot = { balances: midnightStore.balances, transactions: [], utxos: [], dustState: null, tip: { hash: null, height: 0, timestamp: 0 } };
    midnightStore.refreshing = { startedAt: NOW, reason: null, stalled: false, progress: null };
    const w = mount(MidnightPendingRowStatus, { props: { tx: sent('ff', { timestamp: NOW - PENDING_EXPIRY_MS }) }, global: { stubs } });
    expect(w.find('[data-test="midnight-not-confirmed"]').exists()).toBe(true);
    expect(w.find('[data-test="midnight-check-again"]').exists()).toBe(false);
  });

  it('a fresh pending row shows nothing; the full history list shows the chip alone', () => {
    expect(mount(MidnightPendingRowStatus, { props: { tx: sent('bb', { timestamp: NOW - 60_000 }) }, global: { stubs } })
      .find('[data-test="midnight-pending-status"]').exists()).toBe(false);
    const compact = mount(MidnightPendingRowStatus, { props: { tx: sent('dd', { timestamp: NOW - PENDING_EXPIRY_MS }), compact: true }, global: { stubs } });
    expect(compact.find('[data-test="midnight-not-confirmed"]').exists()).toBe(true);
    expect(compact.find('[data-test="midnight-check-again"]').exists()).toBe(false);
  });
});

describe('the notice slot says the card', () => {
  it('when it appears and when its sentence changes, from the always-mounted region', async () => {
    vi.useRealTimers();
    const w = mount(MidnightNoticeSlot, { global: { stubs } });
    const said = async () => {
      await flushPromises();
      await new Promise((r) => setTimeout(r, 300));
      return w.get('[data-test="midnight-notice-announcer"]').text();
    };
    await expect(said()).resolves.toBe('');
    midnightStore.transactions = [sent('aa', { beforeReset: notFound })];
    await expect(said()).resolves.toBe('midnight.pending.notIncludedUpgrade#1');
    expect(w.find('[data-test="midnight-not-included"]').exists()).toBe(true);
    midnightStore.transactions = [sent('aa', { beforeReset: notFound }), sent('bb', { beforeReset: notFound })];
    await expect(said()).resolves.toBe('midnight.pending.notIncludedUpgrade#2');
  });
});

describe('wiring', () => {
  const src = join(__dirname, '../../..');
  const read = (path: string) => readFileSync(join(src, path), 'utf8');

  it('the card is a notice in the slot, after refreshing; Send again opens each surface\'s Send', () => {
    const slot = read('modules/dashboard/components/MidnightNoticeSlot.vue');
    expect(slot).toContain('notIncluded: MidnightNotIncludedCard,');
    expect(slot).toContain("const notIncluded = computed(() => !refreshing.value && notIncludedSentence.value !== '');");
    expect(read('modules/dashboard/components/midnightNotices.ts')).toContain("['update', 'upgrade', 'refreshing', 'notIncluded', 'stagenet']");
    expect(read('modules/portfolio/PortfolioPage.vue')).toContain('<MidnightNoticeSlot class="portfolio-upgrade-banner" @send-again="openDialog(\'SEND\')" />');
    expect(read('sidepanel/pages/HomePage.vue')).toContain('@send-again="showMidnightSend = true"');
    expect(read('modules/dashboard/dialogs/MidnightSendDialog.vue')).toContain("watch(() => props.isOpen, (open) => { if (open) applySendAgain(); }, { immediate: true });");
  });

  it('history rows mount the status only for pending rows (or one with a Check again outcome)', () => {
    const condition = `v-if="tx.status === 'pending' || hasPendingOutcome(tx)" :tx="tx" />`;
    expect(read('modules/dashboard/components/MidnightTransactionsCard.vue')).toContain(`<MidnightPendingRowStatus ${condition}`);
    expect(read('sidepanel/pages/ActivityPage.vue')).toContain(`<MidnightPendingRowStatus ${condition}`);
    expect(read('modules/transactions/components/MidnightTransactionsList.vue')).toContain(`<MidnightPendingRowStatus v-if="tx.status === 'pending'" :tx="tx" compact />`);
  });

  it('a submitted send is recorded for the wallet that sent it, with whether its hash is the ledger hash', () => {
    for (const file of ['modules/dashboard/dialogs/MidnightSendDialog.vue', 'sidepanel/components/flows/MidnightSendSheet.vue']) {
      const source = read(file);
      expect(source).toContain('ledgerHash: !!result.ledgerTxHash, fromAddress: wallet.baseAddress');
      expect(source).toContain('if (isSameWallet(wallet))');
      expect(source).not.toContain('pendingSnapshot');
    }
    const background = read('chrome/background.ts');
    expect(background).toContain('midnightStore.activeWalletKey !== fromAddress');
    expect(background).toContain('...(ledgerHash === true ? { ledgerHash: true } : {}),');
  });
});
