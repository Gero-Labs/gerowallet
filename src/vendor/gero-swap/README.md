# Vendored @gero/dex-widget (<gero-swap>)

Built IIFE bundle of the Gero DEX aggregator widget. Self-registers `<gero-swap>` on load.

- Source repo: gero-dex-widget (packages/widget), branch `vendor/gerowallet-2.8.0-two-hop` at `9aadc24` = `vendor/gerowallet-2.8.0-i18n` at `8391d4a` plus two-hop swaps. `8391d4a` is English/German/Spanish via the `locale` attribute, on `1af3fbe` (Vuetify scope stopped on unmount, so no `resize` listener leaks per mount), on `11cd09157d1106d63b550039ea331d9a7480cec3` ([theme isolation fix](https://github.com/Gero-Labs/gero-dex-widget/pull/19)), based on `af575a2`. Main's widget PRs #18 to #30 are deliberately not in this bundle: they are features for Nexus partners, not for the wallet. The same two fixes are on main in [gero-dex-widget#32](https://github.com/Gero-Labs/gero-dex-widget/pull/32).
- Files, byte for byte from the build (check with `openssl dgst -sha384 -binary <file> | openssl base64 -A`):
  - `gero-swap.js`: 892741 bytes, `sha384-dIPm6NHIeV/ssRoKvPWbIDUBfp41ZVYUc0YZ/UYw16tUSn88/MOImlSgW0jTl/1M`
  - `gero-swap.css` (`dist/style.css`): 626752 bytes, `sha384-AyP1kV8DitXWK7ZZJupjCFfc+hUAWAqIeupIRp/0Q3a4GC4CVKcY4aNCh0rdTxf0`
- Two-hop swaps (a pair with no pool of its own, swapped as one Minswap V2 order through ADA):
  - On by default when the widget uses its own History, which is how the wallet embeds it. `max-hops="1"` turns it off. With `history-mode="host"` it is offered only with an explicit `max-hops="2"`, and never with `history-mode="off"`.
  - Market orders only. There is no automatic refund: an order that cannot meet its minimum waits on chain until the owner cancels it from History.
  - Offered only when the server marks the two-hop route through ADA `verified: true`.
  - The wallet's signer accepts the two-hop order's Minswap V2 routing step (`src/shared/utils/orderRecipients.ts`).
  - This line does NOT include main's auto slippage, swap following, stale-quote re-fetch, network parameter, dapp-mode token list, discount removal, overlay keyboard changes, host-signer changes or box-sizing CSS fixes.
- Language: the wallet passes `locale` = `us` | `de` | `es` (`GeroSwapEmbed.vue`); the widget maps `us` to English.
- Rebuild: `pnpm --filter @gero/dex-widget build` then copy `dist/gero-swap.js` + `dist/style.css` (as `gero-swap.css`) here.
  Use Node 22 or 24 and the repo's pinned `pnpm@10.8.1`. On Windows, build from a short path: esbuild fails with `ENOENT` once its binary path passes 260 characters.
- CSP: runtime-only (no template compiler), enforced by the widget's `verify:csp` build guard.
- Theme isolation: the widget owns `gero-swap-theme-stylesheet` and scopes its runtime theme CSS to `gero-swap`. Run `node test/visual-parity/theme-isolation-browser.cjs` to verify it preserves the wallet's theme across mounts and chain changes.
- Do NOT edit these files by hand; re-vendor from source.
