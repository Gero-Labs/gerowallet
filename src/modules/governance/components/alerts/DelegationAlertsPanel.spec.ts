// Render coverage for DelegationAlertsPanel.vue.
//
// `npm run typecheck` is plain `tsc --noEmit`, which does not look inside a
// `.vue` SFC, so without this the panel's template and its bindings are wholly
// unverified. What matters here is the seam between the store's facts and what
// the user actually reads: the three card types with their severity treatments,
// the settings card, and the stake rendered through the SHARED lovelace
// formatter rather than a fork.
//
// The store is stubbed rather than driven: its rules have their own 51-test
// spec (governanceAlertsStore.spec.ts), and importing it for real would drag in
// walletStore, Dexie and blockchain-api for a test about markup.
import { describe, it, expect, vi } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';

const { push, state } = vi.hoisted(() => {
  // 15 of 20 epochs into the window, 5 left; recent rationale rate well below
  // the long-run one. The same numbers the store's spec asserts against.
  const facts = {
    windowUsed: 15,
    epochsLeft: 5,
    activityWindow: 20,
    rationaleRecent: 20,
    rationaleLongRun: 76,
    recentWindow: 10,
    stakeLovelace: '23718000000',
  };
  return {
    push: vi.fn(() => Promise.resolve()),
    state: {
      alerts: [
        {
          id: 'inactivity:drep1abc',
          kind: 'inactivity',
          severity: 'warning',
          epoch: 653,
          drepId: 'drep1abc',
          dismissedUntilEpoch: null,
          facts,
        },
        {
          id: 'rationaleDrop:drep1abc',
          kind: 'rationaleDrop',
          severity: 'info',
          epoch: 652,
          drepId: 'drep1abc',
          dismissedUntilEpoch: null,
          facts,
        },
      ],
      settings: { inactivityWarnAt: 15, rationaleDropEnabled: true, pushEnabled: false },
      snoozes: {},
      drepId: 'drep1abc',
      evaluatedAt: 1_700_000_000_000,
      loading: false,
      errorKey: null,
    },
  };
});

vi.mock('vue-router/composables', () => ({
  useRouter: () => ({ push, resolve: () => ({ route: { matched: [] } }) }),
}));

vi.mock('@/stores/networkStore', () => ({
  networkStore: { tip: { epoch: 653 }, epochParams: null },
  isBitcoinTip: () => false,
  default: { getCurrentEpoch: () => 653 },
}));

vi.mock('@/stores/governanceAlertsStore', () => ({
  DEFAULT_SNOOZE_WARN_AT: 18,
  drepActivityWindow: () => 20,
  default: {
    state,
    activeAlerts: () => state.alerts,
    snooze: vi.fn(),
    dismiss: vi.fn(),
    setSettings: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
  },
}));

import Panel from '@/modules/governance/components/alerts/DelegationAlertsPanel.vue';

/**
 * Only the Vuetify layer is stubbed. Components the panel imports through
 * `<script setup>` (GButton, EmptyState, AsOf) are NOT stubbable by name under
 * Vue 2.7 — VTU never matches them — so they render for real, which is the
 * stricter test anyway. `v-btn` therefore has to be a real button for GButton's
 * `v-on="$listeners"` to reach a click.
 *
 * `$t` echoes the key plus its interpolation params, so an assertion can pin
 * both the translation contract and the VALUES bound into it without depending
 * on the English copy.
 */
function render(): Wrapper<Vue> {
  return mount(Panel, {
    mocks: {
      $t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}:${JSON.stringify(params)}` : key,
    },
    stubs: {
      'v-icon': { template: '<i><slot /></i>' },
      'v-btn': { template: '<button v-on="$listeners"><slot /></button>' },
      'v-skeleton-loader': true,
      'v-chip-group': { template: '<div><slot /></div>' },
      'v-chip': { template: '<span><slot /></span>' },
      'v-switch': true,
    },
  });
}

describe('DelegationAlertsPanel', () => {
  it('renders one card per active alert', () => {
    expect(render().findAll('.delegation-alerts__card')).toHaveLength(2);
  });

  it('gives the inactivity card the amber treatment and the clock glyph', () => {
    const card = render().findAll('.delegation-alerts__card').at(0);
    expect(card.classes()).toContain('delegation-alerts__card--warning');
    expect(card.find('.delegation-alerts__glyph--warning').exists()).toBe(true);
    expect(card.html()).toContain('mdi-clock-alert-outline');
    expect(card.html()).toContain('governance.alerts.inactivityTitle');
  });

  it('gives the rationale card the neutral info treatment and no severity tint', () => {
    const card = render().findAll('.delegation-alerts__card').at(1);
    expect(card.classes()).not.toContain('delegation-alerts__card--warning');
    expect(card.classes()).not.toContain('delegation-alerts__card--critical');
    expect(card.html()).toContain('mdi-message-text-outline');
    expect(card.html()).toContain('governance.alerts.rationaleTitle');
  });

  it('draws the inactivity progress track at 15 of 20 epochs', () => {
    const fill = render().find('.delegation-alerts__fill');
    expect(fill.attributes('style')).toContain('width: 75%');
    expect(render().html()).toContain('governance.alerts.inactivityProgress');
  });

  it('renders the stake through the shared lovelace formatter, not a fork', () => {
    // 23718000000 lovelace, via filters.toCurrency — grouped, symbol-prefixed,
    // and with no trailing zeros. A hand-rolled formatter would not match.
    expect(render().html()).toContain('₳23,718');
  });

  it('offers the snooze on the inactivity card only', () => {
    const cards = render().findAll('.delegation-alerts__card');
    expect(cards.at(0).html()).toContain('governance.alerts.remindMeAt');
    expect(cards.at(1).html()).not.toContain('governance.alerts.remindMeAt');
  });

  it('renders at most one gradient CTA across the whole surface', () => {
    expect(render().findAll('.g-btn--primary')).toHaveLength(1);
  });

  it('routes the replacement CTA to the directory, never to a named DRep', async () => {
    const wrapper = render();
    await wrapper.findAll('.delegation-alerts__card').at(0).find('button').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'governanceDReps' });
  });

  it('renders the alert-settings card and the honesty footer', () => {
    const html = render().html();
    expect(html).toContain('governance.alerts.settingsTitle');
    expect(html).toContain('governance.alerts.settingsInactivityValue');
    expect(html).toContain('governance.alerts.settingsRationale');
    expect(html).toContain('governance.alerts.settingsRetirement');
    expect(html).toContain('governance.alerts.alwaysOn');
    // Push is stated as off, because there is no push channel to switch on.
    expect(html).toContain('common.off');
    expect(html).toContain('governance.alerts.footer');
  });

  // This is the weight that renders "Find a replacement" and "Choose a new
  // DRep", so it is the weight where "Gero never suggests a specific
  // replacement" has to be readable. Behind a closed disclosure it is worth
  // least exactly where it is needed most, so on this shape it is a line on the
  // card, and the disclosure gives it up.
  it('states the neutrality promise in the open, not inside the disclosure, whenever alerts show', () => {
    const wrapper = render();
    expect(wrapper.find('.delegation-alerts__neutrality').text()).toContain('governance.alerts.footer');
    expect(wrapper.find('details').html()).not.toContain('governance.alerts.footer');
  });

  // A failed check and a running check both keep the feed card, and the promise
  // stays visible with it. There is no state of this card in which the reader
  // has to open something to find out what the wallet does not do.
  it('keeps the neutrality promise visible on the error and loading weights too', () => {
    state.errorKey = 'governance.alerts.checkFailed';
    try {
      expect(render().find('.delegation-alerts__neutrality').exists()).toBe(true);
    } finally {
      state.errorKey = null;
    }

    const alerts = state.alerts;
    state.alerts = [];
    state.loading = true;
    try {
      expect(render().find('.delegation-alerts__neutrality').exists()).toBe(true);
    } finally {
      state.alerts = alerts;
      state.loading = false;
    }
  });

  // The healthy strip is one row by design and flags nothing, so there is no
  // claim on screen for the promise to qualify. Only there does it fold back
  // into the disclosure — reachable, still mounted, and off the row.
  it('folds the neutrality promise back into the disclosure on the compact strip', () => {
    const alerts = state.alerts;
    state.alerts = [];
    try {
      const wrapper = render();
      expect(wrapper.find('.delegation-alerts__neutrality').exists()).toBe(false);
      expect(wrapper.find('details').html()).toContain('governance.alerts.footer');
    } finally {
      state.alerts = alerts;
    }
  });

  // The narrow-viewport rule used to give the sentence `flex-basis: 100%` while
  // the shield stayed a sibling flex item, so at extension-popup and side-panel
  // widths the icon wrapped onto a line of its own above the words it belongs
  // to. Grouping them is what makes that unreachable at ANY width, and grouping
  // is markup, so it is pinned here rather than left to a stylesheet.
  it('keeps the success shield inside the same flex item as its sentence', () => {
    const alerts = state.alerts;
    state.alerts = [];
    try {
      const lead = render().find('.delegation-alerts__strip-lead');
      expect(lead.exists()).toBe(true);
      expect(lead.html()).toContain('mdi-shield-check-outline');
      expect(lead.find('.delegation-alerts__strip-text').exists()).toBe(true);
    } finally {
      state.alerts = alerts;
    }
  });

  // Renamed from "shows the positive empty state ...": what this now guards is
  // the COMPACTION itself. The `.empty-state` assertion below is the load-
  // bearing one — without it nothing in the file would catch a regression back
  // to the tall block that used to spend half the page saying "nothing wrong".
  it('collapses to a compact strip, not a full empty-state block, when a watched DRep has nothing wrong', () => {
    const alerts = state.alerts;
    state.alerts = [];
    try {
      const wrapper = render();
      expect(wrapper.findAll('.delegation-alerts__card')).toHaveLength(0);
      // These two replace this test's original single assertion, which was
      // `expect(wrapper.find('.empty-state').exists()).toBe(true)`. That
      // selector pinned the tall EmptyState block the compaction removes, so
      // leaving it as-is would have pinned the very thing being deleted. It is
      // inverted rather than dropped: the pair now pins the SWAP — strip
      // rendered, EmptyState gone — so a revert to the tall block fails here
      // instead of quietly passing on a selector nobody asserts against.
      expect(wrapper.find('.delegation-alerts__strip').exists()).toBe(true);
      expect(wrapper.find('.empty-state').exists()).toBe(false);
      // And no feed card either: the eyebrow heading over a line that says
      // there is nothing to flag is the redundancy being removed.
      expect(wrapper.find('.delegation-alerts__feed').exists()).toBe(false);
      expect(wrapper.html()).toContain('governance.alerts.allHealthy');
    } finally {
      state.alerts = alerts;
    }
  });

  // Every control the settings card used to display outright is still mounted
  // and still wired; it is the disclosure that is shut, not the capability.
  // `<details>` keeps its children in the DOM when closed, so "is it hidden?"
  // has to be read off the `open` attribute, never off whether the nodes exist.
  it('keeps the settings disclosure closed by default in both shapes', () => {
    expect(render().find('details').attributes('open')).toBeUndefined();

    const alerts = state.alerts;
    state.alerts = [];
    try {
      expect(render().find('details').attributes('open')).toBeUndefined();
    } finally {
      state.alerts = alerts;
    }
  });

  it('keeps every alert setting reachable from the compact strip', () => {
    const alerts = state.alerts;
    state.alerts = [];
    try {
      const wrapper = render();
      const html = wrapper.html();
      // The four thresholds, the rationale switch, the always-on retirement
      // line, the unavailable push channel and the neutrality footnote.
      expect(html).toContain('governance.alerts.settingsTitle');
      expect(html).toContain('governance.alerts.settingsRationale');
      expect(html).toContain('governance.alerts.settingsRetirement');
      expect(html).toContain('governance.alerts.alwaysOn');
      expect(html).toContain('governance.alerts.pushUnavailable');
      expect(html).toContain('common.off');
      expect(html).toContain('governance.alerts.footer');
      expect(wrapper.findAll('.alert-settings .g-num')).toHaveLength(4);
    } finally {
      state.alerts = alerts;
    }
  });

  // The compaction is for the state that has nothing to say. The moment the
  // watchdog does have something, it takes the room back — that path is the
  // whole point of the feature and must not be traded away for the tidier one.
  it('expands to the full feed card the moment there is something to flag', () => {
    const wrapper = render();
    expect(wrapper.find('.delegation-alerts__feed').exists()).toBe(true);
    expect(wrapper.find('.delegation-alerts__strip').exists()).toBe(false);
    expect(wrapper.findAll('.delegation-alerts__card')).toHaveLength(2);
    // Snooze, dismiss and the countdown track all still there.
    expect(wrapper.html()).toContain('governance.alerts.remindMeAt');
    expect(wrapper.html()).toContain('governance.alerts.dismiss');
    expect(wrapper.find('.delegation-alerts__fill').exists()).toBe(true);
  });

  // The all-healthy copy claims the DRep "is registered, active and voting".
  // On registeredNoDRep / notInGovernance / a keyword delegation there is no
  // DRep to make that claim about, and the host's hero says the opposite right
  // above. The panel must render nothing at all, so mounting it unconditionally
  // stays safe for any host.
  it('renders nothing at all when there is no DRep to watch', () => {
    const alerts = state.alerts;
    const drepId = state.drepId;
    state.alerts = [];
    state.drepId = null;
    try {
      const wrapper = render();
      expect(wrapper.find('.delegation-alerts').exists()).toBe(false);
      expect(wrapper.html()).toBe('');
      // Specifically not the "your DRep is healthy" claim.
      expect(wrapper.text()).not.toContain('governance.alerts.allHealthy');
      // And no settings card for alerts that can never fire.
      expect(wrapper.text()).not.toContain('governance.alerts.settingsTitle');
    } finally {
      state.alerts = alerts;
      state.drepId = drepId;
    }
  });

  it('still shows the skeleton while a real DRep is being looked up', () => {
    const alerts = state.alerts;
    const drepId = state.drepId;
    state.alerts = [];
    state.drepId = null;
    state.loading = true;
    try {
      expect(render().find('.delegation-alerts__loading').exists()).toBe(true);
    } finally {
      state.alerts = alerts;
      state.drepId = drepId;
      state.loading = false;
    }
  });

  it('renders a failed check as a translated key, never raw upstream text', () => {
    state.errorKey = 'governance.alerts.checkFailed';
    try {
      expect(render().html()).toContain('governance.alerts.checkFailed');
    } finally {
      state.errorKey = null;
    }
  });
});
