# Adding or changing a screen

## The shape of a feature

A feature is a folder under `src/modules/<feature>/`: a page SFC at the root, plus `components/`, `dialogs/`, `composables/`, `views/` as needed. Reference implementation: `src/modules/pool-operator/`.

**Project components are not auto-imported.** `unplugin-vue-components` is configured with `VuetifyResolver()` only and no `dirs`, so only Vuetify components auto-register. Import every project component explicitly - `PoolOperator.vue` imports all eleven of its children by hand. A forgotten import renders an unknown custom element with no build error.

Vue composition helpers (`ref`, `computed`, `watch`, `toRefs`, ...) and the `browser` global **are** auto-imported, which is exactly why plain `tsc` cannot resolve them.

## Registering a page: three edits in `src/modules/navigation/router.ts`

```ts
// 1. a lazyPage factory near the top
const PoolOperator = lazyPage(() => import('@/modules/pool-operator/PoolOperator.vue'));

// 2. the route
{
  path: '/pool-operator',
  name: 'poolOperator',
  component: PoolOperator,
  meta: { layout: ContentLayout, requiresAuth: true },
},

// 3. gating - see below
```

`meta.layout` is the layout mechanism: `App.vue` renders `<component :is="$route.meta['layout'] || 'div'">`. A route without it renders bare, with no nav drawer.

## Gating is dual, and you usually need both halves

Two independent guards run in `beforeEach`:

- **`routeNetworkGuards`** - chain/network capability, from `src/utils/networks.ts`. Runs unconditionally whenever a wallet is logged in; redirects to `/`.
- **`isRouteUnderMaintenance(to.name)`** - the feature flag. Runs **only** `if (featureFlagsStore.state.isInitialized)`.

Because the maintenance check is skipped until flags resolve, **a dark feature gated only there is reachable by typing `#/your-route` on a cold refresh**. The house pattern is to AND the live flag into the network guard too:

```ts
poolOperator: (c, n) => networks.resolveStakingSupport(c, n) && featureFlagsStore.isPoolOperatorEnabled(),
```

Return the live flag value, never a hard `false`, so the flag service can turn the feature on without a release.

## The nav item must mirror the guard textually

Add an entry to the `items` computed in `src/modules/navigation/components/NavigationDrawer.vue`. Its `enabled` expression is expected to be **textually identical** to the router guard for the same route; the codebase states this invariant twice in comments.

- Drawer entry but no router guard -> the page is reachable by URL with an unsupported wallet.
- Router guard but no drawer condition -> the row appears and bounces the user back to `/`.

Governance is the exception worth copying: its rows live in `src/modules/navigation/components/governanceNav.ts` and its condition is a shared computed, precisely so the two cannot disagree.

## Adding a feature flag: five edits, all in `src/stores/featureFlagsStore.ts`

Keyed by the same string in all five places:

1. the `FeatureFlags` interface field
2. the `Vue.observable` default
3. a line in `loadFlags()`
4. a line in `subscribeToFlagChanges()`
5. a field in `reset()`

Missing (3) means the flag never loads and is stuck at its compile-time default. Missing (4) means it loads once and ignores every live change. Neither produces a compile error. `isTrezorWebUsbEnabled` is currently a live example of the failure mode.

## Adding a chain/network capability

In `src/utils/networks.ts`: add the field to the `NetworkInfo` interface, set a value on **every** network entry, and add a `resolveXSupport(chain, network)` helper.

The array ends `] as NetworkInfo[]`, and a type assertion disables both excess-property and missing-property checking. A typo'd field name compiles and sits dead forever - `zkFoldSupport` is doing exactly that on two Midnight entries today.

## The side panel is a separate app

`src/sidepanel/router.ts` is an independent 46-line route table over `src/sidepanel/pages/`, with its own guards and no `meta.layout` / `requiresAuth` machinery. Adding a page to the options router does not add it to the side panel. The side panel also has its own component set under `src/sidepanel/components/`.

## The "new" badges

Two unrelated mechanisms, and **neither is nav-only** - a new control on an existing screen is expected to announce itself the same way:

- `new: true` - a hardcoded literal on a nav item, renders a NEW chip.
- `notificationDot` / `NotificationDot` - the dismissable dot, driven by `src/shared/composables/useFeatureNotifications.ts`. On a nav row it is `hasNewFeaturesInPath([...])`; on a control it wraps the control itself. The worked example is the UTxOs tab in `src/modules/transactions/Transactions.vue`: the tab icon is wrapped in `<NotificationDot :show="isFeatureNew('transactions.utxos')" ...>` and the tab's click handler calls `markFeatureAsSeen('transactions.utxos')`.

Skip it and the feature ships invisible to existing users - not a build failure, but a review comment and a follow-up PR.

For the dot, `feature.version` in `FEATURE_DEFINITIONS` must equal `package.json`'s `version` **exactly** - `isFeatureNew` short-circuits otherwise. Right now every defined feature is dead on arrival because the newest entries say `2.7.0` while `package.json` is at `2.7.1`. Bump the definition in the same commit as the version bump.

## Handing the user a file, and which surface you are on

Before adding a control that downloads something, pin down where it renders. The two routers are disjoint: `/transactions` exists only in `src/modules/navigation/router.ts` (the options app), while `src/sidepanel/router.ts` is a separate table (`/`, `/staking`, `/market`, `/perps`, `/vaults`, `/activity`, `/feed`). Adding a button to an options-page screen does **not** put it in the side panel, and a component shared by both needs checking in both.

That distinction is load-bearing for downloads: an anchor-click blob download behaves differently across extension surfaces, and the existing export helper revokes its object URL immediately after `a.click()` on an anchor never added to the DOM. If you copy it, verify in the surface you actually ship to - the failure mode is the dialog closing with no file and no console error.

Serializing user data to a file is also a security surface: rows carry attacker-influenced strings (asset names, ADA Handles, metadata). See `security.md` before copying the existing CSV writer.

## API clients

Not uniform, despite what CLAUDE.md says. Copy the right shape:

- `src/api/blockchain-api.ts` - `baseURL: import.meta.env['VITE_BACKEND_URL']`. **This is the pattern to copy.**
- `src/api/governance-api.ts` - `VITE_NEXUS_URL`, with bigJson transform and network-slug mapping.
- `src/api/spo-api.ts` - calls Koios **directly** from the browser with a hardcoded per-network URL map. A documented exception, not a template.

## Checklist for a new screen

- [ ] Module folder under `src/modules/<feature>/`, children imported explicitly
- [ ] `lazyPage` factory + route + `meta: { layout, requiresAuth }` in `router.ts`
- [ ] `routeNetworkGuards` entry (capability AND live flag, if dark)
- [ ] `isRouteUnderMaintenance` case, if flagged
- [ ] `NavigationDrawer.vue` item with a textually identical `enabled`
- [ ] Feature flag added in all five places, if flagged
- [ ] Capability field on every network entry + resolver, if chain-gated
- [ ] i18n keys in **both** `us.ts` and `de.ts` (see `i18n.md`)
- [ ] Checked on Cardano, Bitcoin and Midnight, or explicitly scoped to one (see `chains.md`)
- [ ] Side panel considered - separate router, separate components
- [ ] `npm run design:check` and `npx eslint <your files>` clean
- [ ] `npm run build:web -- --mode production` passes
- [ ] Actually clicked in a loaded extension
