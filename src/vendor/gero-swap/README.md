# Vendored @gero/dex-widget (<gero-swap>)

Built IIFE bundle of the Gero DEX aggregator widget. Self-registers `<gero-swap>` on load.

- Source repo: gero-dex-widget (packages/widget), branch `vendor/gerowallet-2.8.0-i18n` at `8391d4a` (English/German/Spanish via the `locale` attribute) on `1af3fbe` (Vuetify scope stopped on unmount, so no `resize` listener leaks per mount), on `11cd09157d1106d63b550039ea331d9a7480cec3` ([theme isolation fix](https://github.com/Gero-Labs/gero-dex-widget/pull/19)), based on `af575a2`. Main's widget PRs #18–#30 are deliberately not in this bundle; the same two fixes are on main in [gero-dex-widget#32](https://github.com/Gero-Labs/gero-dex-widget/pull/32).
- Language: the wallet passes `locale` = `us` | `de` | `es` (`GeroSwapEmbed.vue`); the widget maps `us` to English.
- Rebuild: `pnpm --filter @gero/dex-widget build` then copy `dist/gero-swap.js` + `dist/style.css` (as `gero-swap.css`) here.
  Use Node 22 or 24 and the repo's pinned `pnpm@10.8.1` (this bundle used Node 24.19.0). On Windows, build from a short path: esbuild fails with `ENOENT` once its binary path passes 260 characters.
- CSP: runtime-only (no template compiler) — enforced by the widget's `verify:csp` build guard.
- Theme isolation: the widget owns `gero-swap-theme-stylesheet` and scopes its runtime theme CSS to `gero-swap`. Run `node test/visual-parity/theme-isolation-browser.cjs` to verify it preserves the wallet's theme across mounts and chain changes.
- Do NOT edit these files by hand; re-vendor from source.
