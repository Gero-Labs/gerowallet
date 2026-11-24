import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type LoggedWallet = { id: number; chain: string; network: string };
const state = vi.hoisted(() => ({
  loggedWallet: null as LoggedWallet | null,
  config: {} as Record<string, unknown>,
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(state) }));
const db = vi.hoisted(() => ({ setWalletConfiguration: vi.fn(async (..._args: unknown[]) => undefined) }));
vi.mock('@/db/wallet-db', () => db);

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightPreviewMoveNotice from './MidnightPreviewMoveNotice.vue';
import { showsPreviewMoveNotice } from './midnightPreviewMoveNotice';
import { walletStore } from '@/stores/walletStore';
import { MIDNIGHT_PREVIEW_FAUCET_URL } from '@/chains/midnight/midnightConfig';
import { PREVIEW_MOVE_NOTICE_CONFIG_KEY } from '@/chains/midnight/midnightPreviewMove';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import es from '@/plugins/i18n/es';

const stubs = {
  'v-icon': { template: '<i class="v-icon-stub" />' },
  GButton: { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
};
const store = walletStore as unknown as typeof state;
const flag = (notice: unknown): Record<string, unknown> => (notice === 'unset' ? {} : { [PREVIEW_MOVE_NOTICE_CONFIG_KEY]: notice });
const setWallet = (chain: string, network: string, notice: unknown = true, id = 7) => {
  store.loggedWallet = { id, chain, network };
  store.config = flag(notice);
};
const NOTICE = '[data-test="midnight-preview-move-notice"]';

beforeEach(() => {
  db.setWalletConfiguration.mockReset();
  db.setWalletConfiguration.mockResolvedValue(undefined);
  setWallet('Midnight', 'Preview');
});

describe('Midnight "moved to Preview" notice (issue 1453)', () => {
  it('tells a moved wallet it is on Preview now, with the Preview faucet linked inside the sentence', () => {
    const w = mount(MidnightPreviewMoveNotice, { global: { stubs } });
    const notice = w.get(NOTICE);
    expect(notice.get('.preview-move-notice__text').text()).toBe(
      'Your Stagenet wallet moved to Midnight Preview, a new test network. '
      + 'Stagenet tokens and history don\'t carry over. Get new tNIGHT from the Preview faucet(opens in a new tab).',
    );
    const link = notice.get('[data-test="midnight-preview-move-faucet"]');
    // The visible name, the external-link glyph, and the new tab said to screen readers only.
    expect(link.text()).toBe('Preview faucet(opens in a new tab)');
    expect(link.get('.g-sr-only').text()).toBe('(opens in a new tab)');
    expect(link.find('.v-icon-stub').exists()).toBe(true);
    expect(link.attributes('href')).toBe(MIDNIGHT_PREVIEW_FAUCET_URL);
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toContain('noopener');
    // Standing information, not a live update: a note, never announced on its own.
    expect(notice.attributes('role')).toBe('note');
    expect(notice.get('[data-test="midnight-preview-move-dismiss"]').text()).toBe('Dismiss');
  });

  it('points at a real https faucet for Preview', () => {
    expect(MIDNIGHT_PREVIEW_FAUCET_URL).toMatch(/^https:\/\/[^/]+preview[^/]*$/);
  });

  it.each([
    ['Midnight', 'Preview', false],
    ['Midnight', 'Preview', 'unset'],
    ['Midnight', 'Preview', 'true'],
    ['Midnight', 'Preprod', true],
    ['Midnight', 'Mainnet', true],
    ['Midnight', 'Stagenet', true],
    ['Cardano', 'Preview', true],
  ])('renders nothing for a %s %s wallet with the flag %s, so a parent spacing class takes no room', (chain, network, notice) => {
    setWallet(chain, network, notice);
    const w = mount(MidnightPreviewMoveNotice, { attrs: { class: 'slot' }, global: { stubs } });
    expect(w.find(NOTICE).exists()).toBe(false);
    expect(w.find('.slot').exists()).toBe(false);
  });

  it('dismissal is written to the wallet\'s own config and hides the notice at once', async () => {
    const w = mount(MidnightPreviewMoveNotice, { global: { stubs } });
    await w.get('[data-test="midnight-preview-move-dismiss"]').trigger('click');
    await flushPromises();
    expect(db.setWalletConfiguration).toHaveBeenCalledTimes(1);
    expect(db.setWalletConfiguration).toHaveBeenCalledWith(7, PREVIEW_MOVE_NOTICE_CONFIG_KEY, false);
    expect(w.find(NOTICE).exists()).toBe(false);
  });

  it('stays dismissed once the config loader brings the row back, and shows for another moved wallet', async () => {
    const w = mount(MidnightPreviewMoveNotice, { global: { stubs } });
    await w.get('[data-test="midnight-preview-move-dismiss"]').trigger('click');
    await flushPromises();
    store.config = { [PREVIEW_MOVE_NOTICE_CONFIG_KEY]: false };
    await nextTick();
    expect(w.find(NOTICE).exists()).toBe(false);
    setWallet('Midnight', 'Preview', true, 8);
    await nextTick();
    expect(w.find(NOTICE).exists()).toBe(true);
  });

  it('keeps the notice when the dismissal could not be saved, so it can be dismissed again', async () => {
    db.setWalletConfiguration.mockRejectedValueOnce(new Error('quota'));
    const w = mount(MidnightPreviewMoveNotice, { global: { stubs } });
    await w.get('[data-test="midnight-preview-move-dismiss"]').trigger('click');
    await flushPromises();
    expect(w.find(NOTICE).exists()).toBe(true);
    await w.get('[data-test="midnight-preview-move-dismiss"]').trigger('click');
    await flushPromises();
    expect(db.setWalletConfiguration).toHaveBeenCalledTimes(2);
    expect(w.find(NOTICE).exists()).toBe(false);
  });

  it('shows only for a Midnight Preview wallet whose config carries the flag', () => {
    expect(showsPreviewMoveNotice({ chain: 'Midnight', network: 'Preview' }, { [PREVIEW_MOVE_NOTICE_CONFIG_KEY]: true })).toBe(true);
    expect(showsPreviewMoveNotice({ chain: 'Midnight', network: 'Preview' }, {})).toBe(false);
    expect(showsPreviewMoveNotice({ chain: 'Midnight', network: 'Preview' }, null)).toBe(false);
    expect(showsPreviewMoveNotice(null, { [PREVIEW_MOVE_NOTICE_CONFIG_KEY]: true })).toBe(false);
  });

  it('every locale places the faucet link once, inside its sentence', () => {
    for (const messages of [us, de, es] as Array<Record<string, string>>) {
      expect(messages['midnight.previewMove.moved'].match(/\{faucet\}/g)).toHaveLength(1);
      expect(messages['midnight.previewMove.faucetLink']).toBeTruthy();
      expect(messages['midnight.previewMove.opensNewTab']).toBeTruthy();
      expect(messages['midnight.pending.dismiss']).toBeTruthy();
      // The Stagenet retirement warning it replaced is gone.
      expect(Object.keys(messages).filter((key) => key.startsWith('midnight.stagenet.'))).toEqual([]);
    }
  });

  it('is one of the notices the slot shows on the Midnight dashboard and in the side panel', () => {
    const src = join(__dirname, '../../..');
    const portfolio = readFileSync(join(src, 'modules/portfolio/PortfolioPage.vue'), 'utf8');
    const home = readFileSync(join(src, 'sidepanel/pages/HomePage.vue'), 'utf8');
    const slot = readFileSync(join(src, 'modules/dashboard/components/MidnightNoticeSlot.vue'), 'utf8');
    expect(portfolio).toContain('<MidnightNoticeSlot class="portfolio-upgrade-banner"');
    expect(home).toContain('<MidnightNoticeSlot v-if="isMidnight" layout="panel" class="home-upgrade-banner"');
    expect(slot).toContain('previewMove: MidnightPreviewMoveNotice,');
  });
});
