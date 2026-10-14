import { mockGlobalProperties } from '@test/helpers/globalProperties';
vi.mock('@/shared/composables/useTranslation', async () => ({ useTranslation: (await import('@test/helpers/translations')).useMockTranslation }));
// Two things the row now says that it did not before, and one it must never
// say:
//
//  1. A concluded action is visibly quieter than a live one. The quiet is
//     carried by a CLASS, and the StatusPill keeps naming the outcome in words,
//     so the distinction never rests on tone alone.
//  2. The remaining epochs also read as a rough calendar day.
//  3. An unknown epoch produces NO date. Not today's, not the epoch 0 date —
//     nothing, because we do not know.
import { describe, it, expect, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import ActionRow from './ActionRow.vue';
import type { GovProposal } from '@/api/governance.types';

/** Echoes params so a wrong interpolated value cannot hide inside the key. */
const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

function proposal(over: Partial<GovProposal> = {}): GovProposal {
  return {
    govActionId: 'gov_action1test#0',
    govActionIdCip129: 'gov_action1test#0',
    txHash: '7d3722'.padEnd(64, '0'),
    index: 0,
    slot: null,
    type: 'TreasuryWithdrawals',
    status: 'active',
    deposit: null,
    returnAddress: null,
    anchorUrl: 'https://example.test/a.json',
    anchorHash: null,
    title: 'A test action',
    submittedEpoch: 649,
    expiresEpoch: 660,
    ...over,
  } as GovProposal;
}

/**
 * Only Vuetify is stubbed. StatusPill is a `<script setup>` SFC Vue 2.7 resolves
 * lexically, so it renders for real — which is the point of the "the pill is
 * still the cue" assertions below.
 */
function mountRow(props: Record<string, unknown> = {}): VueWrapper {
  return mount(ActionRow, { props: { action: proposal(), currentEpoch: 650, ...props }, global: { config: { globalProperties: mockGlobalProperties({ $t }) }, stubs: { 'v-icon': true } } });
}

describe('ActionRow lifetime', () => {
  it('shows the remaining epochs and the rough day they work out to', () => {
    const wrapper = mountRow();

    // 660 - 650 = 10 epochs.
    expect(wrapper.html()).toContain('governance.epochsRemaining:{"n":10}');
    expect(wrapper.find('.action-row__expires').exists()).toBe(true);
    // The "≈" is the approximation, so the key that carries it is the one used.
    expect(wrapper.html()).toContain('governance.approxExpiryDate');
    wrapper.unmount();
  });

  it('renders no date at all when the current epoch is unknown', () => {
    // The tip has not been read yet. A date here would be invented.
    const wrapper = mountRow({ currentEpoch: null });

    expect(wrapper.find('.action-row__expires').exists()).toBe(false);
    expect(wrapper.html()).not.toContain('governance.approxExpiryDate');
    expect(wrapper.html()).not.toContain('governance.epochsRemaining');
    wrapper.unmount();
  });

  it('renders no date when upstream carries no expiry epoch', () => {
    const wrapper = mountRow({ action: proposal({ expiresEpoch: null }) });

    expect(wrapper.find('.action-row__expires').exists()).toBe(false);
    wrapper.unmount();
  });

  it('names an actual year in the date, not a placeholder', () => {
    // Guards the formatter end to end: `$t` echoes its params, so the real
    // interpolated string is in the DOM.
    const wrapper = mountRow();
    const text = wrapper.find('.action-row__expires').text();

    expect(text).toMatch(/\d{4}/);
    expect(text).not.toContain('1970');
    wrapper.unmount();
  });
});

describe('ActionRow status weight', () => {
  it('leaves a live row at full contrast', () => {
    const wrapper = mountRow();

    expect(wrapper.find('.action-row').classes()).not.toContain('action-row--concluded');
    wrapper.unmount();
  });

  it.each(['ratified', 'enacted', 'expired', 'dropped'])('quiets a %s row', status => {
    const wrapper = mountRow({ action: proposal({ status }) });

    expect(wrapper.find('.action-row').classes()).toContain('action-row--concluded');
    // Quiet, not silent: the pill is still there and still carries the word,
    // so the row's state never rests on its tone alone. `$t` here echoes the
    // key, which StatusPill treats as a missing translation and falls back to
    // the raw status — still a word, which is all this case is about.
    const pill = wrapper.find('.status-pill');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toBe(status);
    wrapper.unmount();
  });

  it('gives a concluded row no lifetime figures to be quiet about', () => {
    // Epochs left and an expiry date are claims about a window that has closed.
    const wrapper = mountRow({ action: proposal({ status: 'expired' }) });

    expect(wrapper.html()).not.toContain('governance.epochsRemaining');
    expect(wrapper.find('.action-row__expires').exists()).toBe(false);
    wrapper.unmount();
  });

  it('treats an unrecognised status as concluded rather than as live', () => {
    // `isOpen` is an allow-list of one, so anything new reads as decided —
    // which is the safe direction: it withholds a countdown, it does not invent
    // one.
    const wrapper = mountRow({ action: proposal({ status: 'something-new' }) });

    expect(wrapper.find('.action-row').classes()).toContain('action-row--concluded');
    wrapper.unmount();
  });
});
