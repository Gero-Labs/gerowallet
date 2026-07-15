# Vendored @gero/dex-widget (<gero-swap>)

Built IIFE bundle of the Gero DEX aggregator widget. Self-registers `<gero-swap>` on load.

- Source repo: gero-dex-widget (packages/widget), main @ e4637e5
- Rebuild: `pnpm --filter @gero/dex-widget build` then copy `dist/gero-swap.js` + `dist/style.css` here.
- CSP: runtime-only (no template compiler) — enforced by the widget's `verify:csp` build guard.
- Do NOT edit these files by hand; re-vendor from source.
