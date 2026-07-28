# Midnight Mainnet DUST Generation Enablement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable in-wallet Midnight DUST generation on mainnet with the same end-to-end behavior that works on preprod today (wallet + Nexus + gero-sync).

**Architecture:** The 2026-07-24 three-repo audit found all code paths are already network-generic and mainnet-parameterized. Enablement is (1) one env flag in gero-sync's k8s manifests (the hard blocker: without it there is no mainnet NIGHT balance sync, no V16 UTxO feed into Nexus, and the wallet's dust gauge reads zeros), (2) widening Nexus's `DUST_SNAPSHOT_NETWORKS` so first mainnet DUST spend does not cold-replay ~40 min, and (3) small wallet copy fixes (wrong network label on preprod; "~2.5h" relay copy that mainnet's slower Foundation relay does not honor). Each repo change is an independent PR into that repo's `development` branch; merge auto-deploys (CI/CD restored 2026-07-08; repo manifests are the source of truth, kubectl is read-only diagnosis).

**Tech Stack:** k8s deployment YAML (gero-sync, nexus), Vue 2.7 + TypeScript + i18n (gerowallet).

**Repos and working copies:**

| Repo | Path | Base branch | Note |
|---|---|---|---|
| gero-sync | `D:\GeroRepos\gitRepos\gero-sync` | `origin/development` | local checkout is 7 commits behind; use a fresh worktree |
| nexus | `D:\GeroRepos\gitRepos\nexus` | `origin/development` | local checkout sits on stale `feat/midnight-network-selector` (185 behind); do NOT branch from it; use a fresh worktree |
| gerowallet | `D:\GeroRepos\gitRepos\gerowallet\.claude\worktrees\midnight-mainnet-dust-04df33` | `development` | this worktree, branch `claude/midnight-mainnet-dust-04df33` |

**Standing rules for every task:**
- Stage explicit paths only; never `git add -A`.
- Verify the branch in the SAME shell call as the commit (concurrent sessions can switch shared checkouts).
- PR flow: open PR, monitor the auto Claude code review, merge when green (standing authority), monitor CI/CD, verify rollout.
- kubectl is read-only diagnosis only; never mutate cluster state by hand.

**Background facts (verified 2026-07-24, see memory `midnight-mainnet-dust-readiness`):**
- Mainnet uses the same `cnight_generates_dust` validator mechanism as preprod; hash `73e4aea31b5b51d9b0ca386196fc6a4c422f74c5aea011e4b8bdf4e5`, cNIGHT unit `0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa` + `4e49474854` ("NIGHT"). Nexus already pins both and boots with `MIDNIGHT_MAINNET_ENABLED=true`.
- `https://indexer.mainnet.midnight.network/api/v4/graphql` is live, at tip, and serves the same `dustGenerationStatus` query as preprod.
- Mainnet pairing relay (Foundation-operated) can take well beyond the nominal ~2.5h; then up to ~12h for DUST to start accruing. Past ~12h unpaired = escalate to Midnight with the reg txid, not a wallet defect.

---

### Task 1: gero-sync - enable the midnight-mainnet network (hard blocker)

**Files:**
- Modify: `k8s/prod/deployment.yml` (Midnight env block, near lines 104-113)
- Modify: `k8s/dev/deployment.yml` (Midnight env block, near lines 147-158)

- [ ] **Step 1: Create a fresh worktree off origin/development**

```bash
cd /d/GeroRepos/gitRepos/gero-sync
git fetch origin
git worktree add ../gero-sync-mainnet-dust -b feat/midnight-mainnet-enable origin/development
cd ../gero-sync-mainnet-dust
```

Expected: new worktree at `D:\GeroRepos\gitRepos\gero-sync-mainnet-dust` on branch `feat/midnight-mainnet-enable`.

- [ ] **Step 2: Confirm the current state (flag absent, preprod present)**

```bash
grep -n "MIDNIGHT_.*_ENABLED" k8s/prod/deployment.yml k8s/dev/deployment.yml
```

Expected: `MIDNIGHT_ENABLED`, `MIDNIGHT_PREVIEW_ENABLED`, `MIDNIGHT_PREPROD_ENABLED` in both files; NO `MIDNIGHT_MAINNET_ENABLED` anywhere. (`application.yml` line ~150 defaults `midnight-mainnet.enabled` to `${MIDNIGHT_MAINNET_ENABLED:false}` with public Foundation indexer URLs baked in, so the env flag is the only thing needed.)

- [ ] **Step 3: Add the flag to BOTH manifests**

In each file, directly after the `MIDNIGHT_PREPROD_ENABLED` env entry, insert (match the file's existing indentation and comment style):

```yaml
        # Midnight mainnet: public Foundation indexer (defaults in application.yml),
        # same posture as preprod per the 2026-07-06 infra decision.
        - name: MIDNIGHT_MAINNET_ENABLED
          value: "true"
```

No other change. The mainnet indexer/RPC URLs come from `application.yml` defaults (`https://indexer.mainnet.midnight.network`, `wss://indexer.mainnet.midnight.network`, `https://rpc.mainnet.midnight.network`); no URL overrides and no new secret are needed (`NEXUS_INTERNAL_KEY` is shared across networks).

- [ ] **Step 4: Verify the edit**

```bash
grep -n -A1 "MIDNIGHT_MAINNET_ENABLED" k8s/prod/deployment.yml k8s/dev/deployment.yml
```

Expected: both files show the new entry with `value: "true"`.

- [ ] **Step 5: Commit and open the PR**

```bash
git status && git branch --show-current && git add k8s/prod/deployment.yml k8s/dev/deployment.yml && git commit -m "feat(midnight): enable midnight-mainnet network

Turns on the midnight-mainnet entry already declared in application.yml
(public Foundation indexer, same posture as preprod). Unlocks mainnet
NIGHT balance sync, the apply-event feed into Nexus V16, and dust
account-state for mainnet wallets.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/midnight-mainnet-enable
gh pr create --base development --title "feat(midnight): enable midnight-mainnet network" --body "Adds MIDNIGHT_MAINNET_ENABLED=true to dev+prod manifests. Code is already network-generic; midnight-mainnet is declared in application.yml with Foundation indexer defaults (verified live at tip 2026-07-24). No new secrets (shared NEXUS_INTERNAL_KEY). Nexus prod already accepts midnight-mainnet on /internal/midnight/**.

Part of the mainnet DUST enablement (plan: gerowallet docs/superpowers/plans/2026-07-24-midnight-mainnet-dust-enable.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 6: Monitor the auto Claude review, merge when green, monitor CI/CD**

```bash
gh pr checks --watch
gh pr merge --squash
```

Then watch the deploy workflow (`gh run list --limit 3`) until the rollout completes.

### Task 2: Verify gero-sync mainnet rollout (read-only)

**Files:** none (cluster diagnosis only)

- [ ] **Step 1: Confirm the pod picked up the flag and connected**

```bash
kubectl -n gero get pods | grep -i sync
kubectl -n gero logs deploy/gero-sync --since=15m | grep -i "midnight-mainnet"
```

Expected: registry/startup log lines registering `midnight-mainnet` and a block-subscriber WS connection to `wss://indexer.mainnet.midnight.network`. If the deployment name differs, find it with `kubectl -n gero get deploy`.

- [ ] **Step 2: Confirm the wallet-facing path**

Open a built extension with a Midnight MAINNET wallet (production onboarding default). Verify:
- SUBSCRIBE with `network=midnight-mainnet` no longer idles: NIGHT balance appears/updates.
- gero-sync logs show `applyEvent` forwarding to `/internal/midnight/utxos/midnight-mainnet/apply-event` with 2xx responses (grep the same logs for `apply-event`).

Expected: no 4xx from Nexus (Nexus prod already runs `MIDNIGHT_MAINNET_ENABLED=true`; its controllers have no network allowlist).

- [ ] **Step 3: Backfill check (conditional)**

Because mainnet was never enabled, wallets should have no stored `lastMidnightTxId` cursor for mainnet and the first subscribe replays full per-address history, populating Nexus V16. If a previously-created mainnet wallet shows a wrong/empty NIGHT balance after several minutes, clear its Midnight sync cursor (wallet reset-cache path) and re-login to force a full replay. Do NOT write speculative migration code for this unless it actually reproduces.

### Task 3: nexus - widen the DUST snapshot service to mainnet (spend-UX)

**Files:**
- Modify: `k8s/prod/deployment.yml` (env `DUST_SNAPSHOT_NETWORKS`, near line 280)

- [ ] **Step 1: Fresh worktree off origin/development (local checkout is stale; do not reuse it)**

```bash
cd /d/GeroRepos/gitRepos/nexus
git fetch origin
git worktree add ../nexus-mainnet-dust -b feat/dust-snapshot-mainnet origin/development
cd ../nexus-mainnet-dust
```

- [ ] **Step 2: Pre-check preprod runner health and pod memory headroom (read-only)**

The snapshot runner holds a ~300k-event buffer per network; the deploy comment says to widen only after confirming memory headroom.

```bash
grep -n -B2 -A2 "DUST_SNAPSHOT_NETWORKS" k8s/prod/deployment.yml
kubectl -n gero top pods | grep -i nexus
```

Expected: current value `"midnight-preprod"`; nexus pods well below their memory limit (compare against the `resources.limits.memory` in the same manifest). Record the numbers in the PR description. If headroom is thin (>70 percent of limit), raise the memory limit in the same PR and say so.

- [ ] **Step 3: Edit the env value**

```yaml
        - name: DUST_SNAPSHOT_NETWORKS
          value: "midnight-preprod,midnight-mainnet"
```

Keep the existing explanatory comment above it; update its wording if it says "preprod-only for the initial rollout".

- [ ] **Step 4: Commit and open the PR**

```bash
git status && git branch --show-current && git add k8s/prod/deployment.yml && git commit -m "feat(midnight): widen dust snapshot service to midnight-mainnet

Leader-elected global dust-ledger sync now also runs for mainnet so
mainnet wallets bootstrap DustLocalState from /dust/state-snapshot
instead of a ~40-minute cold replay on first DUST spend.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/dust-snapshot-mainnet
gh pr create --base development --title "feat(midnight): widen dust snapshot service to midnight-mainnet" --body "Adds midnight-mainnet to DUST_SNAPSHOT_NETWORKS (preprod stays). Leader election is already per-network (midnight_dust_leader keyed by network, V66), snapshot ring is per-network, and the route's VALID_NETWORKS already includes midnight-mainnet - config-only. Pre-change pod memory: <fill in from Step 2>.

Part of the mainnet DUST enablement (plan: gerowallet docs/superpowers/plans/2026-07-24-midnight-mainnet-dust-enable.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 5: Merge when green, then verify the mainnet runner (read-only)**

After rollout, find the sidecar container port in `k8s/prod/deployment.yml` (`containerPort` of the sidecar container), then:

```bash
kubectl -n gero port-forward deploy/nexus <sidecarPort>:<sidecarPort> &
curl -s localhost:<sidecarPort>/dust/state-snapshot/status
```

Expected: status JSON now lists a `midnight-mainnet` runner (backfilling, then synced) alongside `midnight-preprod`; exactly one leader per network. Watch `kubectl -n gero top pods` during the mainnet backfill; if memory approaches the limit, raise the limit in a follow-up PR (do not kubectl-edit).

### Task 4: gerowallet - network label fix + honest mainnet relay copy

**Files:**
- Modify: `src/modules/dashboard/dialogs/DustRegistrationDialog.vue:287`
- Modify: `src/plugins/i18n/us.ts` (keys at lines ~4262, 4381, 4395, 4406, 4411, 4413)
- Modify: `src/plugins/i18n/de.ts` (same keys, lines ~4159, 4279, 4293, 4304, 4309, 4311)

Work in this worktree on branch `claude/midnight-mainnet-dust-04df33`.

- [ ] **Step 1: Fix the hardcoded network label**

`DustRegistrationDialog.vue:287` currently labels every non-mainnet network "Preview" (wrong on preprod). The `Network` enum values are display-ready strings (`'Mainnet' | 'Preview' | 'Preprod' | 'Testnet'`, `src/models/types.ts:120-125`) and `Network` is already imported (used on line 284).

Replace:

```ts
const networkLabel = computed(() => (isMainnet.value ? 'Mainnet' : 'Preview'));
```

with:

```ts
const networkLabel = computed(() => loggedWallet.value?.network ?? Network.MAINNET);
```

Leave `nightCurrency`/`dustCurrency` alone (tNIGHT/tDUST is correct for both testnets).

- [ ] **Step 2: Update the six Path-B relay-copy keys in `us.ts`**

Mainnet's Foundation pairing relay verifiably exceeds the promised ~2.5h. Replace the values (keys unchanged, do not touch `midnight.registrationStep3`, which is the Path-A step list):

```ts
'midnight.statusPendingHelp': 'Awaiting relay. Usually ~2.5h, but can take several hours on Mainnet. DUST will start generating once accepted.',
'midnight.cnightTimingNote': 'Registration is free apart from the Cardano network fee. The mapping usually reaches Midnight in about 2.5 hours (sometimes several hours on Mainnet), then allow up to 12 hours for DUST to start accruing.',
'midnight.cnightMigrateInfo': 'Points the existing registration at this wallet\'s own Midnight DUST address. Takes effect after the relay, usually within a few hours.',
'midnight.dustRelayEstimate': 'Relay to Midnight (a few hours)',
'midnight.dustLinePending': 'DUST registration pending · a few hours',
'midnight.dustRegistrationPending': 'Pending · a few hours',
```

- [ ] **Step 3: Mirror in `de.ts`**

```ts
'midnight.statusPendingHelp': 'Warte auf Relay. Meist ~2,5h, im Mainnet teils mehrere Stunden. DUST beginnt mit der Generierung nach Annahme.',
'midnight.cnightTimingNote': 'Die Registrierung ist bis auf die Cardano-Netzwerkgebühr kostenlos. Die Übertragung nach Midnight dauert meist etwa 2,5 Stunden (im Mainnet teils mehrere Stunden), danach bis zu 12 Stunden bis DUST anfällt.',
'midnight.cnightMigrateInfo': 'Richtet die bestehende Registrierung auf die eigene Midnight-DUST-Adresse dieser Wallet. Wird nach der Übertragung wirksam, meist innerhalb weniger Stunden.',
'midnight.dustRelayEstimate': 'Relay zu Midnight (einige Stunden)',
'midnight.dustLinePending': 'DUST-Registrierung ausstehend · einige Stunden',
'midnight.dustRegistrationPending': 'Ausstehend · einige Stunden',
```

- [ ] **Step 4: Gates**

```bash
npx eslint src/modules/dashboard/dialogs/DustRegistrationDialog.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
node scripts/design/audit.mjs
npm run build
```

Expected: no new ESLint issues in touched files; the design ratchet stays at or below current budgets (no styles touched); build succeeds. (`npm run typecheck` is chronically red; judge by delta only.)

- [ ] **Step 5: Commit and open the PR**

```bash
git status && git branch --show-current && git add src/modules/dashboard/dialogs/DustRegistrationDialog.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts docs/superpowers/plans/2026-07-24-midnight-mainnet-dust-enable.md && git commit -m "fix(midnight): correct DUST dialog network label + mainnet relay copy

- networkLabel showed 'Preview' for every non-mainnet network (wrong on preprod)
- soften the ~2.5h relay promise: mainnet's Foundation pairing relay
  verifiably takes several hours (observed 2026-07-14)
- us + de locales

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin claude/midnight-mainnet-dust-04df33
gh pr create --base development --title "fix(midnight): DUST dialog network label + mainnet relay copy" --body "Wallet-side polish for mainnet DUST enablement (backend flags land via gero-sync/nexus PRs; plan in docs/superpowers/plans/2026-07-24-midnight-mainnet-dust-enable.md). No functional gating changes: the wallet is already fully mainnet-parameterized.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Then monitor the auto review and merge when green.

### Task 5: End-to-end mainnet smoke test

**Files:** none

- [ ] **Step 1: Protocol-side pairing check (no auth needed)**

Using the stake address of the known 2026-07-14 mainnet registration (or any newly registered one):

```bash
curl -s -X POST https://indexer.mainnet.midnight.network/api/v4/graphql -H 'Content-Type: application/json' -d '{"query":"query($a:[String!]!){dustGenerationStatus(cardanoRewardAddresses:$a){registered dustAddress nightBalance generationRate currentCapacity maxCapacity}}","variables":{"a":["<stake1...>"]}}'
```

Expected: `registered: true` with a nonzero `generationRate` for a paired registration backed by cNIGHT.

- [ ] **Step 2: In-wallet Path B (cNIGHT) verification**

In the built extension with a mainnet Midnight wallet: the cNIGHT/dust status line reads Registered (Nexus `dust/status` proxies the same indexer query); the DUST gauge shows balance/rate from `dust/account-state` (this requires Task 1 live, since the sidecar math reads the V16 ledger).

- [ ] **Step 3: In-wallet Path A (native NIGHT) verification (conditional on holding NIGHT on Midnight mainnet)**

Run "Register for DUST" (`dust/build-night-registration` -> sign -> `dust/submit-night-registration`). Success criteria: build no longer fails with "No NIGHT UTxOs available" (V16 fed by Task 1), submit lands on-chain, and DUST starts accruing. If proving fails here, the suspect is the SDK-internal S3 proving key material vs the mainnet runtime (not repo-configurable); capture the sidecar error and raise it with the Midnight team alongside the still-unconfirmed mainnet ledger/node/SDK version matrix (`docs/midnight/midnight-team-issues.md` item 4).

- [ ] **Step 4: DUST spend bootstrap (after Task 3)**

Clear the persisted dust wallet state (`midnight_wallet_state_*_dust_*` in chrome.storage.local; the reset-cache button does NOT clear it), then start a DUST-consuming action. Expected: `GET /dust/state-snapshot?network=midnight-mainnet` returns 200 with a ring entry and the wallet syncs only the tail (minutes, not ~40 min).

- [ ] **Step 5: Record the outcome**

Update memory `midnight-mainnet-dust-readiness` with results (pairing latency observed, snapshot backfill duration, memory footprint). If any external blocker surfaced (relay backlog, proving-key mismatch), add it to `docs/midnight/midnight-team-issues.md`.

---

## Explicitly out of scope (YAGNI)

- Onboarding changes: production Midnight already defaults to mainnet; nothing to change to "enable" it.
- Wallet migration code for stale mainnet sync cursors (Task 2 Step 3 checks; only build it if it reproduces).
- Preview widening of `DUST_SNAPSHOT_NETWORKS` (preview has no portal/testing need right now).
- `midnight.registrationStep3` copy (Path-A step list; its 432-block claim needs its own verification before editing).
- Any change to validator hashes, cNIGHT units, or endpoints: all verified correct in all three repos.
