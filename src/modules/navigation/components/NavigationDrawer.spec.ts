// The Governance section of the drawer, as rendered.
//
// It used to be one expandable row with a submenu, and that submenu is the bug
// these tests were written for: collapsed on /governance/dreps, Actions was not
// gated — it was not in the DOM at all, and nothing inside the group could
// bring it back. The pages are a SECTION now, so the property to hold is
// simpler and stronger: every governance page is a row, on every page, always.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const h = vi.hoisted(() => ({
  route: { path: '/governance/dreps', query: {} as Record<string, unknown> },
  push: vi.fn(),
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: vi.fn(), sendToBackground: vi.fn() },
}));
vi.mock('@/plugins/vuetify', () => ({ updateVuetifyTheme: vi.fn() }));
vi.mock('@/plugins/changeLog', () => ({ default: { setEnabled: vi.fn() } }));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
// Relies on the build's auto-import plugin for `ref`, which the test runner does
// not load. Nothing here is about feature badges.
vi.mock('@/shared/composables/useFeatureNotifications', () => ({
  hasNewFeaturesInPath: () => false,
  isFeatureNew: () => false,
  markFeatureAsSeen: vi.fn(),
}));

const $t = (key: string): string => key;
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: $t }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import NavigationDrawer from './NavigationDrawer.vue';
import { walletStore } from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { GOVERNANCE_ITEMS } from './governanceNav';

function mountDrawer(path: string): Wrapper<Vue> {
  h.route.path = path;
  return mount(NavigationDrawer, {
    propsData: { value: true },
    mocks: {
      $t,
      $route: h.route,
      $router: { push: h.push, currentRoute: h.route },
      $vuetify: { breakpoint: { mobile: false }, theme: { dark: true } },
    },
    stubs: {
      // The drawer itself renders its content through named slots.
      'v-navigation-drawer': {
        template: '<div><slot name="prepend" /><slot /><slot name="append" /></div>',
      },
      'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' },
      'v-img': true,
      'v-icon': true,
      'v-badge': { template: '<span><slot /></span>' },
      'v-tooltip': { template: '<span><slot name="activator" :on="{}" :attrs="{}" /></span>' },
      'v-chip': true,
      'v-progress-circular': true,
      'v-divider': true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/**
 * Every drawer row's target, in render order. Vuetify is not installed here, so
 * `v-list-item` stays an unresolved element and its `to` is a plain attribute —
 * which is exactly the binding under test.
 */
function rowLinks(w: Wrapper<Vue>): string[] {
  return w.findAll('.menuItem').wrappers.map(linkOf);
}

/** `attributes()` is typed `string | void`; narrow once rather than at each use. */
function linkOf(row: Wrapper<Vue>): string {
  const to = row.attributes('to');
  return typeof to === 'string' ? to : '';
}

/** Only the governance rows, in render order. */
function governanceLinks(w: Wrapper<Vue>): string[] {
  return rowLinks(w).filter(link => link.startsWith('/governance'));
}

/** The section headings the drawer renders, in order. */
function sectionHeadings(w: Wrapper<Vue>): string[] {
  return w.findAll('v-subheader').wrappers.map(node => node.text().trim());
}

/**
 * Governance rows a person can actually SEE. Gated rows are `v-show`n, so they
 * stay in the DOM with `display: none` rather than being removed — asserting on
 * presence alone would pass for a row nobody can click.
 */
function visibleGovernanceLinks(w: Wrapper<Vue>): string[] {
  return w
    .findAll('.menuItem')
    .wrappers.filter(row => (row.element as HTMLElement).style.display !== 'none')
    .map(linkOf)
    .filter(link => link.startsWith('/governance'));
}

let wrapper: Wrapper<Vue> | null = null;

/** Every concrete governance page a user can be standing on. */
const GOVERNANCE_PAGES = [
  '/governance/me',
  '/governance/dreps',
  '/governance/dreps/drep1ytjyvm958ywjkp57f8wm3havj72lc653tp7ajttxxt6ftgcmcmdk2',
  '/governance/actions',
  '/governance/actions/9f8e7d6c/0',
  '/governance/register',
];

// Injected by vite's `define` at build time; the runner has no such define.
vi.stubGlobal('APP_VERSION', '0.0.0-test');

beforeEach(() => {
  vi.clearAllMocks();
  // The drawer's footer card reads name/icon off the logged wallet.
  walletStore.loggedWallet = {
    chain: 'Cardano',
    network: 'Mainnet',
    baseAddress: null,
    name: 'Test wallet',
    icon: 'gero',
  } as never;
  vi.spyOn(featureFlagsStore, 'isGovernanceEnabled').mockReturnValue(true);
  vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(true);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('NavigationDrawer: the Governance section', () => {
  it('renders every governance page as a row, on every governance page', () => {
    // The property the submenu could not hold: no page in the section is ever
    // one that hides its siblings.
    for (const path of GOVERNANCE_PAGES) {
      wrapper = mountDrawer(path);
      expect(visibleGovernanceLinks(wrapper), path).toEqual(GOVERNANCE_ITEMS.map(item => item.link));
      wrapper.destroy();
      wrapper = null;
    }
  });

  it('renders them from outside the section too, with nothing to expand', () => {
    // The old row had to be opened first; standing on /staking, the governance
    // pages simply were not there.
    wrapper = mountDrawer('/staking');
    expect(visibleGovernanceLinks(wrapper)).toEqual(GOVERNANCE_ITEMS.map(item => item.link));
  });

  it('reaches Actions from the DReps screen, which is the bug this replaced', () => {
    wrapper = mountDrawer('/governance/dreps');
    expect(governanceLinks(wrapper)).toContain('/governance/actions');
  });

  it('gives every governance row the drawer own active treatment', () => {
    wrapper = mountDrawer('/governance/dreps');
    const rows = wrapper
      .findAll('.menuItem')
      .wrappers.filter(row => linkOf(row).startsWith('/governance'));
    expect(rows.length).toBe(GOVERNANCE_ITEMS.length);
    for (const row of rows) {
      expect(row.attributes('active-class')).toBe('activePageDark');
    }
  });

  it('heads the section, between Financial hub and Activities & rewards', () => {
    wrapper = mountDrawer('/governance/me');
    const headings = sectionHeadings(wrapper);

    // Also proves the negative case above is not vacuous: this selector really
    // does find the heading when the section is on.
    expect(headings).toContain('navigation.governance');
    expect(headings.indexOf('navigation.governance')).toBeGreaterThan(
      headings.indexOf('navigation.financialHub'),
    );
    expect(headings.indexOf('navigation.governance')).toBeLessThan(
      headings.indexOf('navigation.activitiesRewards'),
    );
  });

  // The Gero DAO row was retired along with its route (see router.ts — a direct
  // #/dao visit now falls through to the catch-all redirect). Kept as a negative
  // assertion rather than deleted so the row cannot quietly return.
  it('carries no Gero DAO row — the section was retired', () => {
    wrapper = mountDrawer('/governance/me');
    expect(rowLinks(wrapper)).not.toContain('/dao');
  });

  it('drops registration when the voting sub-flag is off', () => {
    vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(false);
    wrapper = mountDrawer('/governance/dreps');
    const links = visibleGovernanceLinks(wrapper);
    expect(links).not.toContain('/governance/register');
    expect(links).toContain('/governance/actions');
  });

  it('shows no governance rows, and no heading, when the master flag is off', () => {
    vi.spyOn(featureFlagsStore, 'isGovernanceEnabled').mockReturnValue(false);
    wrapper = mountDrawer('/staking');

    expect(visibleGovernanceLinks(wrapper)).toEqual([]);
    // And no orphaned heading above the nothing. Matched on the heading element
    // rather than the drawer's text, because "navigation.governance" is also a
    // PREFIX of every row key ("navigation.governanceMe") and a text search
    // would pass while the label was still on screen.
    expect(sectionHeadings(wrapper)).not.toContain('navigation.governance');
  });
});
