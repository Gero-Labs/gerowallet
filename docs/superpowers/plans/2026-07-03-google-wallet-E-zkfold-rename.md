# Plan E — zkFold → zkSmartWallet Rename & Decouple (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all `zkFold`-branded identifiers/files/env-vars to a neutral `zkSmartWallet` name, retaining the code as decoupled reference, with zero behavior change.

**Architecture:** Pure refactor. No logic changes. Safety net = TypeScript typecheck + existing test suite + production build + a grep gate proving no brand identifiers remain (real `*.zkfold.io` URL literals are exempt and get a "legacy, unused" comment). The zkFold integration is already disabled on all networks and its UI is orphaned, so this is low-risk.

**Tech Stack:** TypeScript, Vite (4 configs), Vitest 3.2.4.

## Global Constraints
- Do not delete the legacy code — rename + retain as reference (per project decision 2026-07-03).
- Do not alter real endpoint URL literals matching `zkfold.io` — comment them `// legacy zkFold hosted endpoint — unused, retained for reference`.
- Neutral name mapping (case-preserving):
  - `zkFold` → `zkSmartWallet`
  - `ZKFOLD` → `ZK_SMART_WALLET` (env-var style)
  - file paths: `zkFoldApi` → `zkSmartWalletApi`, `zkfold-db` → `zk-smart-wallet-db`, `services/zkFold/` → `services/zkSmartWallet/`, `zkFoldStore` → `zkSmartWalletStore`
- ESLint: fix any lint issue in every file touched (repo rule).
- Run background rebuild after changing `src/chrome/` files (`npm run dev:background`) — relevant because `src/chrome/background.ts` is touched.

**Affected files (from grep, 142 occurrences / 12 files + env):**
`src/api/zkFoldApi.ts`, `src/chrome/background.ts`, `src/db/gero-db.ts`, `src/db/zkfold-db.ts`, `src/modules/welcome/components/GoogleLogIn/GoogleLogIn.vue`, `src/services/walletManager.service.ts`, `src/services/zkFold/{backend,prover,session}.ts`, `src/services/zkFold/utils/json.utils.ts`, `src/stores/zkFoldStore.ts`, `src/utils/networks.ts`, and `.env.example` (+ any local `.env.*`).

---

### Task 1: Record the baseline (NOT required green)

> **Correction (2026-07-04):** this repo is NOT green on typecheck/lint even on `development` — ~141 pre-existing `vue-tsc` errors, ~1123 pre-existing `no-explicit-any` lint errors, and 1 unrelated failing test (`crossDeviceTrust.spec.ts`), all branch-independent. The gate is therefore **baseline-relative: the rename must introduce NO NEW failures**, not achieve green. Lint scope is touched-files-only per CLAUDE.md. The hard functional gate is **`npm run build` succeeds** + **test results unchanged** + **grep-gate zero**.

**Files:** none (verification only). Note: `npm run typecheck`/`vue-tsc` needs the generated `src/auto-imports.d.ts` (gitignored) — run `npm run build` once first if it is missing.

**Interfaces:**
- Produces: recorded baseline counts so any post-rename delta is attributable to the rename.

- [ ] **Step 1: Record typecheck baseline**

Run: `npm run typecheck 2>&1 | grep -c "error TS"` (record the count, e.g. ~141). Do NOT attempt to fix pre-existing errors.

- [ ] **Step 2: Record test baseline**

Run: `npx vitest run 2>&1 | tail -5` (record e.g. `326 passed, 1 failed` and the failing file name — expected `crossDeviceTrust.spec.ts`, unrelated).

- [ ] **Step 3: Record lint + build + zkFold baselines**

Run: `npm run lint 2>&1 | tail -2` (record the problem count).
Run: `npm run build 2>&1 | tail -3` (record: must succeed — this is the hard baseline gate).
Run: `grep -rniI "zkfold" src/ | wc -l` (record, e.g. `142`).

---

### Task 2: Rename the files (git mv) — no content change yet

**Files:**
- Rename: `src/api/zkFoldApi.ts` → `src/api/zkSmartWalletApi.ts`
- Rename: `src/db/zkfold-db.ts` → `src/db/zk-smart-wallet-db.ts`
- Rename: `src/stores/zkFoldStore.ts` → `src/stores/zkSmartWalletStore.ts`
- Rename: `src/services/zkFold/` → `src/services/zkSmartWallet/` (directory, with `backend.ts`, `prover.ts`, `session.ts`, `utils/json.utils.ts`)

**Interfaces:**
- Produces: new file paths that Task 3 will update imports to point at.

- [ ] **Step 1: Move files with git (preserves history)**

```bash
git mv src/api/zkFoldApi.ts src/api/zkSmartWalletApi.ts
git mv src/db/zkfold-db.ts src/db/zk-smart-wallet-db.ts
git mv src/stores/zkFoldStore.ts src/stores/zkSmartWalletStore.ts
git mv src/services/zkFold src/services/zkSmartWallet
```

- [ ] **Step 2: Verify typecheck now FAILS on broken imports (expected)**

Run: `npm run typecheck`
Expected: FAIL with "Cannot find module './zkFoldApi'" / "src/services/zkFold/..." style errors. This confirms the imports Task 3 must fix. Do not commit yet.

---

### Task 3: Rewrite identifiers + imports + env var names

**Files (modify):** all 12 affected files + `.env.example` (and any local `.env.*`).

**Interfaces:**
- Consumes: renamed paths from Task 2.
- Produces: a codebase where the only remaining `zkfold` matches are exempt `*.zkfold.io` URL literals.

- [ ] **Step 1: Apply the case-preserving identifier rename across `src/`**

```bash
# camelCase brand identifier -> neutral
grep -rlI "zkFold" src/ | xargs sed -i '' 's/zkFold/zkSmartWallet/g'
# UPPER (env vars / constants) -> neutral, EXCEPT inside URL literals (handled next)
grep -rlI "ZKFOLD" src/ | xargs sed -i '' 's/ZKFOLD/ZK_SMART_WALLET/g'
# lowercase file-path imports that sed above missed (e.g. './zkfold-db')
grep -rlI "zkfold-db" src/ | xargs sed -i '' 's/zkfold-db/zk-smart-wallet-db/g'
```
(macOS `sed -i ''`. Note `import.meta.env.VITE_ZKFOLD_*` becomes `VITE_ZK_SMART_WALLET_*` via the ZKFOLD rule.)

- [ ] **Step 2: Restore + comment the real endpoint URL literals**

Any string literal containing `zkfold.io` (e.g. defaults `https://wallet-api.zkfold.io`, `https://wallet-prover.zkfold.io`) must keep its original host. Find them:

Run: `grep -rniI "zksmartwallet.io\|zkfold.io" src/`

For each hit that is a URL literal, ensure the host reads `zkfold.io` (revert if the sed altered it) and add on the line above:
```ts
// legacy zkFold hosted endpoint — unused, retained for reference
```

- [ ] **Step 3: Rename the env vars in `.env.example` (and local `.env.*`)**

Change these keys (values unchanged):
```
VITE_ZKFOLD_API_URL      -> VITE_ZK_SMART_WALLET_API_URL
VITE_ZKFOLD_PROVER_URL   -> VITE_ZK_SMART_WALLET_PROVER_URL
VITE_ZKFOLD_API_KEY      -> VITE_ZK_SMART_WALLET_API_KEY
```
And update the section comment `# ZKFOLD INTEGRATION (Google Wallet ZK Proofs)` → `# LEGACY ZK SMART WALLET INTEGRATION (unused — retained for reference)`.

```bash
sed -i '' 's/VITE_ZKFOLD_/VITE_ZK_SMART_WALLET_/g' .env.example
```
Apply the same to any local `.env.development` / `.env.production` if present (do NOT commit local env files if gitignored).

- [ ] **Step 4: Fix any `git mv`-ed intra-directory imports the sed didn't cover**

Run: `npm run typecheck`
Fix each remaining module-resolution error by pointing the import at the new path (`zkFoldApi` → `zkSmartWalletApi`, `services/zkFold` → `services/zkSmartWallet`, `zkfold-db` → `zk-smart-wallet-db`, `zkFoldStore` → `zkSmartWalletStore`). Repeat until typecheck is clean.
Expected end state: `npm run typecheck` exit 0.

---

### Task 4: Verify (baseline-relative), build, and gate on the grep

**Files:** none (verification) + any lint fixes in touched files.

- [ ] **Step 1: Lint — no NEW errors in touched files**

Run: `npm run lint 2>&1 | tail -2`
Expected: problem count **not greater** than the Task 1 baseline. Any increase must be in a file the rename touched → fix it (CLAUDE.md: fix lint in files you touch). Do NOT fix pre-existing errors in untouched files.

- [ ] **Step 2: Test results unchanged**

Run: `npx vitest run 2>&1 | tail -5`
Expected: **identical** to the Task 1 baseline (same passed count, same single pre-existing `crossDeviceTrust.spec.ts` failure, no NEW failures).

- [ ] **Step 3: Production build succeeds (HARD GATE)**

Run: `npm run build`
Expected: exit 0, build succeeds for all 4 configs (matches the pre-rename baseline — build was green before the rename).

- [ ] **Step 3b: Typecheck introduced no new errors**

Run: `npm run typecheck 2>&1 | grep -c "error TS"`
Expected: **≤** the Task 1 baseline count, and no new error referencing a renamed symbol/path (`zkSmartWallet*`, `zk-smart-wallet-db`, `services/zkSmartWallet`). A broken import from the rename would show here.

- [ ] **Step 4: Grep gate — only commented legacy literals may remain**

Retained legacy literals that MUST keep their real value — both the `*.zkfold.io` hosts AND the `/zkfold/...` HTTP wire paths (`prover.ts`, `backend.ts`) that are endpoint contracts — each carry a same-line marker comment `// legacy zkFold hosted endpoint — unused, retained for reference`. Renaming a wire path or host is a behavior change and is forbidden. The gate excludes lines carrying that marker:

Run: `grep -rniI "zkfold" src/ | grep -viI "legacy zkFold hosted endpoint"`
Expected: **zero** lines.

Run: `grep -rniI "zkfold" src/ | grep -iI "legacy zkFold hosted endpoint" | wc -l`
Expected: small non-zero (the retained host + path literals, each commented).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(google-wallet): rename zkFold -> zkSmartWallet, decouple as reference

Renames all zkFold-branded identifiers/files/env vars off the company brand
to the neutral zkSmartWallet name, retaining the (disabled, orphaned) ZK
smart-wallet code as reference for the incoming self-hosted MPC Google wallet.
No behavior change: typecheck, full vitest suite, and production build all pass.
Real *.zkfold.io endpoint literals kept + commented as legacy/unused.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review
- **Spec coverage:** implements spec §5.1 "Rename + retain (DECISION)". ✅
- **Placeholder scan:** none — every step has exact commands/paths.
- **Behavior-change risk:** none intended; enforced by unchanged test count (Task 4 Step 2) + build (Step 3).
- **Exemption handled:** real `zkfold.io` URLs explicitly preserved + commented (Task 3 Step 2, Task 4 Step 4).
