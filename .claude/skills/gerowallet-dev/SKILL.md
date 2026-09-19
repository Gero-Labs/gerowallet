---
name: gerowallet-dev
description: Use when building a feature, fixing a bug, reviewing code, or getting a PR merged in the Gero Wallet browser extension repo (Gero-Labs/gerowallet) - including Vue/Vuetify UI work, stores and IndexedDB, Chrome messaging and the MV3 background worker, Cardano/Bitcoin/Midnight chain code, transaction signing, i18n, the design ratchet, or a blocked commit or red required check.
---

# Developing on Gero Wallet

A Manifest V3 Chrome extension: Vue 2.7 + Vuetify 2.7 + TypeScript, four independent Vite bundles, three blockchains, keys held in the background service worker.

## Start here: three facts that reverse your instincts

**1. The two commands the PR checklist tells you to run are not gates and never pass.**
`npm run typecheck` exits 2 with ~173 pre-existing errors after a build (~213 on a pristine clone, before `src/auto-imports.d.ts` is generated - that file is gitignored, so the extra ~40 are unresolved `ref`/`computed`). Most of the rest are unresolvable `.vue` modules. `vue-tsc` has no Vue 2.7 + TS 5.8 build. `npm run lint` exits 1 with 390 errors, all legacy `@typescript-eslint/no-explicit-any`. Never compare absolute counts between runs, and never read either as a verdict on your change. The PR template still asks for both; CONTRIBUTING.md has been corrected. Do not chase those errors and do not "fix" unrelated files.

**2. What actually blocks you is the pre-commit hook and four required checks.**
The hook (yorkie, from `package.json` `gitHooks`, not husky) runs on every commit:
`node scripts/precommit-lint.mjs && node scripts/design/audit.mjs && node scripts/design/contrast.mjs`.
Required on `development`: `Production bundle (SFC parse)`, `npm ci (lock in sync)`, `ESLint flat config loads`, `Ledger tests and extension bundles`. Plus 1 approving review, branch up to date, and all review threads resolved.

**3. CI runs roughly a quarter of the repo's 245 spec files, and the covered quarter is not where you are working.**
`npm test` is never invoked in CI. `dev-bundle-gate.yml` runs 6 named specs; `midnight-ledger-verify.yml` runs two whole directories - `src/chains/midnight` (31 files) and `src/services/crossDevice` (19) - plus 6 named specs. So ~62 of 245 run, and everything outside those paths merges green no matter what it breaks. The inverse also holds: **Midnight and crossDevice changes are genuinely gated**, so a red required check there is real. Full suite: 245 files / 2871 tests, ~40s and green on an idle machine. Timing-sensitive specs flake under parallel load, so re-run a failing file alone before calling it a regression.

## Before writing code

- **Search for it first.** Most "add X" tasks are already half-built. Transactions already has a CSV export; `dashboard.hideBalances` already exists; four near-identical `export` i18n keys already exist. Grep the module, the i18n values, and `git log --oneline -- <path>` before designing anything.
- **Trust code over docs.** README.md and ARCHITECTURE.md are broadly good; CLAUDE.md is authoritative on intent but carries stale specifics (dependency versions, `src/popup` as a live entry, WASM in `public/`, "two gates" for CIP-113, the `minFee` formula). `package.json` is the only truth for versions. See `references/doc-drift.md`.
- **Ask which chain.** Cardano, Bitcoin and Midnight are three separate code paths on the same screens. A fix verified on one is not a fix. See `references/chains.md`.

## The verification ladder

Run cheap to expensive, and stop lying to yourself about what each one proves.

| Command | Time | What it actually proves |
|---|---|---|
| `npx eslint <files you changed>` | ~2s | The pre-commit lint gate will pass. Repo-wide lint is meaningless. |
| `npm run design:check` | ~2s | The design ratchet and 56 WCAG checks pass. Also a required-check step. |
| `npx vitest run <paths>` | seconds | Only what you point it at. Re-run a failing file alone before calling it a regression. |
| `npm run build:web -- --mode production` | ~90s | Every SFC parses and the bundle resolves. This is the real buildability gate, and what CI runs. |
| `npm run dev` + load `extension/` in Chrome | minutes | The only thing that proves runtime behaviour. Nothing else does. |

Never run `npm run build` to check your work: four parallel Vite builds at 6GB each, ~24GB peak, it OOMs laptops and runners.

## Non-negotiables

- **The design ratchet has zero headroom.** 12 of 15 metrics sit at exactly their budget today (`hexOccurrences 779/779`, `hexDistinct 287/287`, `fontSizeDistinct 75/75`, `clickableDivs 106/106`, `formatFnForks 15/15`, ...). One new hex literal, radius, font-size, `transition: all`, clickable `<div>`, `outline: none` or forked formatter blocks your commit and the required CI check. (`!important`, `backdrop-filter` and infinite animations still have a little headroom - run the audit rather than assuming either way.) Scope matters: **style metrics scan `src/**/*.{vue,scss,css}` only**, so a `#1122`-style PR reference in a comment counts as a hex colour there (write `PR 1122`) but cannot trip it in a `.ts` file. `formatFnForks` scans a different set, `src/**/*.{ts,vue}`, so a TypeScript-only diff can still break the ratchet by forking a formatter. See `references/design-system.md`.
- **Never `git commit --no-verify`.** The single hook entry chains all three gates, so skipping lint silently skips the ratchet and the contrast check too. You will find out in CI instead.
- **Every new i18n key goes in `us.ts` and `de.ts` in the same commit.** Nothing checks this outside the `copilot.*` namespace. A missing German key silently renders English, and a key missing from both renders the raw key text to the user. Warnings are deliberately silenced. See `references/i18n.md`.
- **After touching `src/chrome/`, reload the extension at `chrome://extensions`.** `npm run dev` does rebuild the background bundle on save, but an MV3 service worker keeps running the old one until you reload.
- **Never log key material, mnemonics, addresses or transaction contents.** `debugLog()` compiles to a no-op unless `VITE_DEBUG_STORES=true`; use it, and strip ad-hoc `console.log` before committing.
- **Fix ESLint in every file you touch**, including pre-existing `any` in that file. That is what the staged-blob hook enforces, and it is the house rule.

## Where to go next

| Task | Read |
|---|---|
| Set up, build, run, load the extension | `references/dev-loop.md` |
| Understand contexts, messaging, the background worker | `references/architecture.md` |
| Add or change a screen, route, nav item, feature flag | `references/add-a-feature.md` |
| Stores, `chrome.storage`, Dexie schemas, per-wallet config | `references/state-and-data.md` |
| Vue/Vuetify components, tokens, the ratchet, copy | `references/design-system.md` |
| Cardano vs Bitcoin vs Midnight | `references/chains.md` |
| Transactions, signing, CIP-30, crypto, what reviewers block on | `references/security.md` |
| Wording, keys, translation parity | `references/i18n.md` |
| Tests: what exists, what runs, what is flaky | `references/testing.md` |
| A bug you cannot reproduce or locate | `references/debugging.md` |
| Commit, PR, required checks, review, merge | `references/shipping.md` |
| Where CLAUDE.md and ARCHITECTURE.md are out of date | `references/doc-drift.md` |

## Red flags

Each of these thoughts has cost someone a day in this repo.

| Thought | Reality |
|---|---|
| "typecheck is red, I broke something" | It is red on a clean tree, ~173 errors, none of them yours. |
| "lint is red, I broke something" | 390 pre-existing `any` errors. Lint only your own files. |
| "CI is green, so it works" | CI runs no full build, no full test suite, and never opens the extension. |
| "I'll `--no-verify` past this hook" | You just skipped the design ratchet and WCAG gate too. CI catches it, later and louder. |
| "The ratchet failed but my diff has no colours" | In a `.vue`/`.scss`/`.css` file, a `#` plus 3-8 hex digits counts, comments included. In a `.ts` file, the only metric that can fire is a forked formatter. |
| "I added the English string, German can follow" | Nothing enforces it. It ships, and a German user sees English or a raw key. |
| "It works after I reload the page" | Background changes need an extension reload. UI-only changes do not. Know which you made. |
| "It works on my wallet" | Which chain? Cardano, Bitcoin and Midnight take different code paths on the same screen. |
| "The service worker has my state" | MV3 kills it constantly. Derive from `chrome.storage` or IndexedDB, never from background memory. |
| "I'll add a regression test" | Confirm it can fail. Under happy-dom, `getContextType()` returns `'content'`, so store broadcast paths no-op and the test passes on broken code. |
| "This screen is one component" | It probably branches per chain, and the side panel has its own router and its own components. |
