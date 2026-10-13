# Visual parity with the Vue 2 wallet

This pass restores the existing Gero design system in the Vue 3 / Vuetify 4
migration. Use the Vue 2 development source at
`50e0bcfe6ca8a6bace23f2a0010bad6d278b2d1a` as the code reference and the
production 2.7.2 wallet as the live visual reference. This is not a redesign.

## Design contract

Keep the existing palette, chain accents, typography, glass materials, spacing
tokens, and component-specific dimensions. Native Vuetify defaults must not add
surfaces to icons, enlarge controls, or override explicit Gero utility classes.
Retain accessible text contrast when a native filled control chooses its
foreground color.

The shared compatibility rules live in
`src/shared/styles/vuetify-compat.css`. Load `vuetify-layers.css` before component
styles in both entry pages so native components, compatibility defaults, and
explicit utility classes have a stable cascade. Keep this stylesheet external;
the extension CSP does not permit a data URL stylesheet.

## Corrections

The changes address shared defaults and removed Vuetify 2 markup contracts:

- Restore transparent icon avatars and text icon buttons. Preserve explicit
  avatar fills, filled actions, and component-specific sizes.
- Restore tab typography, selected indicators, and layout without applying
  the shared button casing and radius to native tabs.
- Restore browser reset spacing, legacy type helpers, padded grids, card text,
  compact list text, and table dimensions. Explicit utilities and dimensions
  continue to override shared defaults.
- Apply Gero typography and colors to teleported menus and dialogs. Restore
  the full dialog backdrop blur without changing its glass material.
- Update native navigation slots, field selectors, notification badges, toast
  sizing, pagination, switches, player controls, and Mini Mode transitions.
- Fix blank profile names caused by the removed Vue 2 model contract, blank
  token detail panes caused by obsolete tab values, and empty initial steps
  caused by string versus numeric step values.
- Scale raw token images to their avatar dimensions, preserve quick-action
  icon colors, and fit the complete public-key QR inside its existing box.
- Restore the plain-button reset used by wallet-library rows and category
  controls, and keep navigation inside the centered 1,785-pixel dashboard.
- Paint field focus on the existing rounded boundary, including borderless
  searches, while preserving error colors and keyboard focus for plain inputs.
- Populate Quick Send details on the first lazy-mounted Summary step. Require
  the current transaction to be rendered before authentication, and discard
  obsolete risk-scan responses after transaction or wallet-context changes.
- Restore stepper connector alignment and content insets, and add an 8-pixel
  gap below the Send and Midnight Send indicators.

## Reproducible checks

Run the isolated browser fixture with the repository's installed dependencies:

```sh
node test/visual-parity/browser.cjs
node test/visual-parity/focus-browser.cjs
node test/visual-parity/layout-browser.cjs
```

The fixture uses the actual Vuetify plugin, Gero styles, fonts, icons, and
native components. It starts a loopback Vite server and a fresh headless browser,
blocks external requests, and never reads a wallet profile. Set
`VISUAL_PARITY_OUTPUT` to retain its report and screenshots in a chosen folder.
`CHROME_EXECUTABLE` and `PLAYWRIGHT_MODULE` are optional environment overrides
for an already installed browser and Playwright package in the general control
fixture. The source-field fixture checks the actual Global Search and recipient
templates at desktop and narrow widths. The layout fixture checks the dashboard
shell across eleven widths, mobile drawer behavior, and independent scrolling.

The Quick Send runtime suites use native lazy stepper windows and synthetic
transactions. They cover first entry, replacement builds, returning to review,
late risk responses, and review invalidation on wallet, network, or lock changes.
The shared signing suite separately checks pending authorization cancellation.

Use Node 24.19.0 for the migration development server. Its generated entry pages
resolve stylesheet links through the Vite server, and the native Vuetify
dependencies are prebundled on startup. Keep this Node version local to the
migration shell when also working on a Vue 2 checkout.

Also run the native component regression tests, lint every changed source file,
and run `npm run design:check`. Build the real options and side panel entry
points with `npm run build:web -- --mode production`, then run the extension
entry point browser smoke check against that artifact.

Do not rebuild while judging an already open wallet page. Its loaded JavaScript
can retain old scoped style identifiers after the stylesheet is replaced.
Reload the wallet tab and close and reopen Mini Mode after a build.

## Visual evidence and limits

The live walkthrough has covered the dashboard, all seven settings tabs,
Buy/Sell choices, initial Send and Receive flows, token and NFT selection,
collectibles and NFT detail, market and token detail, transaction history and
detail, UTxOs, staking, governance, card and cashback screens, media, help,
and initial swap and perpetual screens. Mini Mode checks include home,
staking, and governance.

Those observations span intermediate builds. They do not constitute final
approval of every screen on the final artifact. Recheck the rebuilt wallet,
including full-width settings tabs, icon backgrounds, notifications, dialogs,
and compact layouts. Keep screenshots of real wallet data out of the repository.

Synthetic native Vue 2 / Vuetify 2 and Vue 3 / Vuetify 4 comparisons provide
measured evidence for shared dimensions and styling. They supplement, rather
than replace, checks of the populated wallet.

No signing, submission, purchase, credential entry, or security-setting change
is part of visual verification. Existing release gates for physical hardware,
PassKey devices, populated NFT wallets, and upgrading an existing 2.7.2 profile
remain in the release-readiness handoff.
