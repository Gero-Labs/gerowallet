import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wallet = vi.hoisted(() => ({ loggedWallet: null as { chain: string; network: string } | null }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive(wallet) }));

// @ts-ignore: tsconfig ships no `*.vue` shim; vite resolves this fine.
import MidnightStagenetNotice from './MidnightStagenetNotice.vue';
import { walletStore } from '@/stores/walletStore';
import { MIDNIGHT_PREVIEW_FAUCET_URL } from '@/chains/midnight/midnightConfig';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import es from '@/plugins/i18n/es';

const stubs = { 'v-icon': { template: '<i class="v-icon-stub" />' } };
const setWallet = (chain: string, network: string) => {
  (walletStore as { loggedWallet: { chain: string; network: string } | null }).loggedWallet = { chain, network };
};

beforeEach(() => setWallet('Midnight', 'Stagenet'));

describe('Midnight Stagenet notice (issue 1477, step 1)', () => {
  it('tells a Stagenet wallet about the move, with the Preview faucet linked inside the sentence', () => {
    const w = mount(MidnightStagenetNotice, { global: { stubs } });
    const notice = w.get('[data-test="midnight-stagenet-notice"]');
    expect(notice.get('.stagenet-notice__text').text()).toBe(
      'Midnight Stagenet is being retired. Your wallet will move to Preview, a new test network. '
      + 'Stagenet tokens and history don\'t carry over. Get new tNIGHT from the Preview faucet(opens in a new tab).',
    );
    const link = notice.get('[data-test="midnight-stagenet-faucet"]');
    // The visible name, the external-link glyph, and the new tab said to screen readers only.
    expect(link.text()).toBe('Preview faucet(opens in a new tab)');
    expect(link.get('.g-sr-only').text()).toBe('(opens in a new tab)');
    expect(link.find('.v-icon-stub').exists()).toBe(true);
    expect(link.attributes('href')).toBe(MIDNIGHT_PREVIEW_FAUCET_URL);
    expect(link.attributes('target')).toBe('_blank');
    expect(link.attributes('rel')).toContain('noopener');
    // Standing information, not a live update: a note, never announced on its own.
    expect(notice.attributes('role')).toBe('note');
  });

  it('points at a real https faucet for Preview, not the Stagenet one', () => {
    expect(MIDNIGHT_PREVIEW_FAUCET_URL).toMatch(/^https:\/\/[^/]+preview[^/]*$/);
  });

  it.each([
    ['Midnight', 'Preprod'],
    ['Midnight', 'Mainnet'],
    ['Cardano', 'Preprod'],
    ['Cardano', 'Stagenet'],
  ])('renders nothing for a %s %s wallet, so a parent spacing class takes no room', (chain, network) => {
    setWallet(chain, network);
    const w = mount(MidnightStagenetNotice, { attrs: { class: 'slot' }, global: { stubs } });
    expect(w.find('[data-test="midnight-stagenet-notice"]').exists()).toBe(false);
    expect(w.find('.slot').exists()).toBe(false);
  });

  it('goes when the wallet moves off Stagenet', async () => {
    const w = mount(MidnightStagenetNotice, { global: { stubs } });
    expect(w.find('[data-test="midnight-stagenet-notice"]').exists()).toBe(true);
    setWallet('Midnight', 'Preprod');
    await nextTick();
    expect(w.find('[data-test="midnight-stagenet-notice"]').exists()).toBe(false);
  });

  it('every locale places the faucet link once, inside its sentence', () => {
    for (const messages of [us, de, es] as Array<Record<string, string>>) {
      expect(messages['midnight.stagenet.retiring'].match(/\{faucet\}/g)).toHaveLength(1);
      expect(messages['midnight.stagenet.faucetLink']).toBeTruthy();
    }
  });

  it('is one of the notices the slot shows on the Midnight dashboard and in the side panel', () => {
    const src = join(__dirname, '../../..');
    const portfolio = readFileSync(join(src, 'modules/portfolio/PortfolioPage.vue'), 'utf8');
    const home = readFileSync(join(src, 'sidepanel/pages/HomePage.vue'), 'utf8');
    const slot = readFileSync(join(src, 'modules/dashboard/components/MidnightNoticeSlot.vue'), 'utf8');
    expect(portfolio).toContain('<MidnightNoticeSlot class="portfolio-upgrade-banner"');
    expect(home).toContain('<MidnightNoticeSlot v-if="isMidnight" layout="panel" class="home-upgrade-banner"');
    expect(slot).toContain('stagenet: MidnightStagenetNotice,');
  });
});
