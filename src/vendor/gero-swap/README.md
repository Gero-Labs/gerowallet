# Vendored @gero/dex-widget (<gero-swap>)

Built IIFE bundle of the Gero DEX aggregator widget. Self-registers `<gero-swap>` on load.

- Source repo: gero-dex-widget (packages/widget), main @ a01720b
- Rebuild: `pnpm --filter @gero/dex-widget build` then copy `dist/gero-swap.js` + `dist/style.css` (as `gero-swap.css`) here.
  Use Node 22 and the repo's pinned `pnpm@10.8.1`. On Windows, build from a short path: esbuild fails with `ENOENT` once its binary path passes 260 characters.
- CSP: runtime-only (no template compiler) — enforced by the widget's `verify:csp` build guard.
- Do NOT edit these files by hand; re-vendor from source.
