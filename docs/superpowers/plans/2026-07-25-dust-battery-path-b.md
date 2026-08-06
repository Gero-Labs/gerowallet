# Path-B-Aware DUST Battery + Truthful Registration State

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Midnight dashboard DUST battery show the truth for cNIGHT-backed (Path-B) generation, and stop showing a phantom "Registration pending" for registrations that never landed.

**Architecture:** DUST reaches a wallet two ways. Path A: native NIGHT UTxOs on Midnight — this is all the dashboard battery understands today (`dust/account-state`, computed by the Nexus sidecar purely from `midnight_unshielded_utxos`). Path B: cNIGHT held on Cardano, paired to a Midnight dust address through the mapping validator — the Midnight indexer tracks its capacity/rate, and Nexus already exposes those numbers via `dust/status` (`current_capacity`, `max_capacity`, `generation_rate`, `night_balance`). No new Nexus endpoint is required. The wallet already derives its same-seed Cardano twin stake plus every imported Cardano record (`useDustSources.enumerate()`), so the battery can batch-query `dust/status/batch` for those stakes, keep the rows whose `dust_address` equals this wallet's dust address, and ADD that to Path A. Two blocking wallet bugs must be fixed first: `dust/status` responses are never snake_case-converted (so every hyphenated field is `undefined`), and the live-poll precedence treats a successful all-zero Path-A poll as authoritative forever.

**Tech Stack:** Vue 2.7 + TypeScript composition API, i18n us/de, existing Nexus endpoints only.

**Repo/branch:** wallet worktree `D:\GeroRepos\gitRepos\gerowallet\.claude\worktrees\midnight-mainnet-dust-04df33`. Start by `git fetch origin && git reset --hard origin/development` on branch `claude/midnight-mainnet-dust-04df33` (PRs #817/#818 are already merged into development). All three tasks land as sequential commits on that one branch and ship as ONE PR.

**Ground truth for verification (real mainnet, verified 2026-07-25):**
- Stake `stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5` has exactly 1 live registration (`527e9a33…#0`) pointing at dust address `mn_dust1wvlhuqzu0a2kqnchn33cf2qgsldzw0tl7083zwgzlufmaawr05u56etug5q` (hex `733f7e00…d394d`), wallet **Primal Spectre**. Indexer: `valid:true`, nightBalance `1076061710`, generationRate `8895802156570`, currentCapacity ≈ `3957.0887e15`, maxCapacity ≈ `5380.3085e15`. Its battery currently shows 0.0000 DUST / 0.0% / rate "—" / CTA "Register for DUST generation". After the fix it must show real charge (~73%) and a rate.
- Wallet **Frost Core** (dust `mn_dust1ww0kpuu…`, hex `739f60f3…f55417`) has NO on-chain registration yet shows "REGISTRATION PENDING" from a stale localStorage record. After the fix that pill must clear.

**Confirmed root causes (file:line verified):**
1. `src/api/midnight-api.ts:529-539` (`getDustStatus`) and `:562-577` (`getDustStatusBatch`) return `data` unconverted while typed camelCase; Nexus serializes snake_case (`cardano_reward_address`, `dust_address`, `night_balance`, `generation_rate`, `max_capacity`, `current_capacity`, `registration_utxo_tx_hash`, `registration_utxo_output_index`). Only `registered` happens to match. Consequences: `useDustSources.ts:207` stake matching never matches (all statuses null); `useCnightDustRegistration.ts:637-642` `registrationOutpoint()` always throws, so **`deregister()` and `migrateDustAddressToOwn()` are broken today**.
2. `MidnightDustRegistrationStatusDto.registrationStatus` (`midnight-api.ts:63`) does not exist in Nexus's DTO at all — a wallet-side fiction; `useCnightDustRegistration.ts:315` always reads `undefined`.
3. `useMidnightDustLive.ts:118` `polled()` means "a poll has ever succeeded", so a successful `{0,0,0,'Unregistered'}` Path-A response outranks everything forever.
4. `MidnightDustGauge.vue:108-116` computes pending from `getDustPendingForDestination(dust)`, which only TTL-prunes (24h) and never reconciles against chain. `reconcileDustPending` is reachable only from `useDustSources.loadStatuses()` (dialog-open) and `useCnightDustRegistration.refreshStatus()` (Cardano wallets only) — never from a Midnight dashboard.

---

### Task A: Fix the dust/status wire format (blocking prerequisite)

**Files:**
- Modify: `src/api/midnight-api.ts` (interface at :58-71, `getDustStatus` :529-539, `getDustStatusBatch` :562-577)
- Modify: `src/shared/composables/useCnightDustRegistration.ts` (the `registrationStatus` computed's use of the phantom field, ~:315)

- [ ] **Step 1: Add the wire type + converter, mirroring `convertRegistrationUtxo` (`midnight-api.ts:96`)**

Add next to the existing DTO:

```ts
/** Wire shape of Nexus's `DustRegistrationStatusDto` (snake_case JSON). */
interface MidnightDustRegistrationStatusWire {
  cardano_reward_address: string;
  dust_address: string | null;
  registered: boolean;
  night_balance?: string;
  generation_rate?: string;
  max_capacity?: string;
  current_capacity?: string;
  registration_utxo_tx_hash?: string | null;
  registration_utxo_output_index?: number | null;
}

function convertDustStatus(w: MidnightDustRegistrationStatusWire): MidnightDustRegistrationStatusDto {
  return {
    cardanoRewardAddress: w.cardano_reward_address,
    dustAddress: w.dust_address ?? null,
    registered: w.registered,
    nightBalance: w.night_balance,
    generationRate: w.generation_rate,
    maxCapacity: w.max_capacity,
    currentCapacity: w.current_capacity,
    registrationUtxoTxHash: w.registration_utxo_tx_hash ?? null,
    registrationUtxoOutputIndex: w.registration_utxo_output_index ?? null,
  };
}
```

- [ ] **Step 2: Delete the phantom `registrationStatus` field from `MidnightDustRegistrationStatusDto`** (`:62-63`). Nexus never sends it. Fix the one consumer at `useCnightDustRegistration.ts:~315`: that computed must no longer read `status.value?.registrationStatus`; derive from `status.value?.registered` (true → `'Registered'`) while keeping the existing `registrations.length` precedence rules intact (>1 → `'Duplicated'`, ===1 → `'Pending'` unless `registered`). Do not otherwise change the precedence order shipped in PR #818.

- [ ] **Step 3: Use the converter in both calls**

`getDustStatus`: type the axios call `<MidnightDustRegistrationStatusWire>` and `return convertDustStatus(data)`.
`getDustStatusBatch`: type it `<MidnightDustRegistrationStatusWire[]>` and `return (data ?? []).map(convertDustStatus)`.

- [ ] **Step 4: Verify the knock-on repairs by reading the call sites**

Confirm (no code change expected): `useDustSources.ts:~207` now matches rows by `cardanoRewardAddress`; `useCnightDustRegistration.ts:637-642` `registrationOutpoint()` now resolves, unbreaking `deregister()` and `migrateDustAddressToOwn()`. Note in the commit body that the migrate/deregister-by-status path was broken before this fix.

- [ ] **Step 5: Gates + commit**

```bash
npx eslint src/api/midnight-api.ts src/shared/composables/useCnightDustRegistration.ts
node scripts/design/audit.mjs
npm run build
```
Commit `fix(midnight): convert dust/status wire format (unbreaks migrate + statuses)` with a body naming the three repaired consumers. Do not push yet (or push; the PR opens in Task C).

### Task B: Path-B-aware battery

**Files:**
- Create: `src/shared/composables/useDustPathB.ts`
- Modify: `src/shared/composables/useMidnightDustLive.ts`
- Modify: `src/modules/dashboard/components/MidnightDustGauge.vue`
- Modify: `src/sidepanel/components/MiniDustGauge.vue`

- [ ] **Step 1: New composable `useDustPathB.ts`**

Responsibility: "how much DUST is being generated INTO this Midnight wallet's dust address from cNIGHT on Cardano." Module-scoped singleton with refcounted polling like `useMidnightDustLive` (60s interval is plenty; capacity moves slowly and the underlying scan is cached ~60s server-side).

Behavior:
1. Requires `midnightStore.addresses?.dust`; no-op without it.
2. Stake list: reuse the SAME derivation `useDustSources` uses — the same-seed twin from `midnightStore.addresses.cardanoStakeAddress` plus every `geroStore.wallets` record with `chain === Blockchain.CARDANO && network === current` (derive its stake address from the record's public xpub exactly as `useDustSources.enumerate()` does). Extract that enumeration into a shared helper if it can be done without behavior change; otherwise duplicate minimally and leave a comment pointing at the original. NO auth gesture may be required (the twin comes from persisted public data).
3. Call `api.getDustStatusBatch(stakes)` (chunk at 50).
4. Keep only rows where `row.dustAddress` equals this wallet's dust address (case-insensitive bech32 compare) AND `row.registered === true`.
5. **Per-stake duplicate rule:** a stake with more than one live registration is invalid at the protocol level. `dust/status` already reflects that (`registered:false` when duplicated), so filtering on `registered === true` is sufficient — do NOT additionally call `dust/registrations` per stake here. Add a comment recording that reasoning.
6. Expose summed BigInts: `pathBBalance` (Σ `currentCapacity`), `pathBCap` (Σ `maxCapacity`), `pathBRate` (Σ `generationRate`), `pathBNight` (Σ `nightBalance`), plus `pathBRegistered` (any kept row), `pathBStakes` (the kept rows' stake addresses, for Task C), and `pathBAsOfMs`.
7. All fields are optional strings on the DTO: parse with a `toBig(v?: string)` helper defaulting to `0n`; never throw on a missing field.

- [ ] **Step 2: Fix precedence and sum both paths in `useMidnightDustLive.ts`**

Two changes:
(a) `polled()` (:118) currently means "any poll succeeded". Change the Path-A fallback so a successful all-zero response does not permanently outrank `midnightStore.dustState`: treat the poll as authoritative only when it carries a non-zero result or a registered status, otherwise fall back to the store value as today. Keep it simple and comment the rule.
(b) Consume `useDustPathB()` and return SUMS, not a switch:
- `dustBalance` = Path-A live-extrapolated balance + `pathBBalance` extrapolated by `pathBRate` over `(now - pathBAsOfMs)`, each clamped to its own cap before summing (Path A clamps to `dustCap` Path-A, Path B to `pathBCap`).
- `dustGenerating` = Path-A rate + `pathBRate`; `dustCap` = Path-A cap + `pathBCap`; `nightRegistered` = Path-A + `pathBNight`.
- `registrationStatus`: return `'Registered'` when Path-A is registered OR `pathBRegistered`; otherwise the existing Path-A value.
Keep the existing 1s tick for smooth extrapolation. Do not change the exported names or the refcount lifecycle — `MidnightDustGauge`, `MiniDustGauge`, and `MidnightPortfolioChart` consume them as-is.

- [ ] **Step 3: Gauges**

`MidnightDustGauge.vue` and `MiniDustGauge.vue` should need no math changes once step 2 sums correctly (`isRegistered` derives from the summed status, `pct` from summed balance/cap, rate and time-to-full from summed rate). Verify each displayed value and fix only what is still Path-A-gated. `timeToFullLabel` (:142-156) must work off the summed rate/cap.

- [ ] **Step 4: Gates + commit** (same three gates). Commit `feat(midnight): show cNIGHT-backed DUST generation in the battery`.

### Task C: Kill the phantom pending

**Files:**
- Modify: `src/shared/composables/useDustPending.ts`
- Modify: `src/modules/dashboard/components/MidnightDustGauge.vue`
- Modify: `src/sidepanel/components/MiniDustGauge.vue`
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts` (only if copy changes)

- [ ] **Step 1: Add a destination-keyed reconcile in `useDustPending.ts`**

Add `reconcileDustPendingForDestination(dustAddress: string, txExists: (txHash: string) => Promise<boolean>): Promise<void>` that runs over EVERY record whose `dustAddress` matches, applying the existing grace-window logic per record, and additionally drops a record when the tx exists but the chain shows no live registration pointing at this dust address (the caller supplies that signal — see step 2). Keep the existing `reconcileDustPending` untouched for its current callers.

- [ ] **Step 2: Suppress the pill on chain truth in both gauges**

`isPending` must additionally require that Path B does NOT already report a live registration to this dust address (that is `Registered`, not pending). Call the new destination reconcile from the same hooks that currently call `refreshPending` (`onMounted` + `watch(registrationStatus)`), passing `api.cardanoTxExists` and the Path-B signal from `useDustPathB` (`pathBRegistered` / `pathBStakes`). Concretely, a record whose stake now appears in `pathBStakes` is resolved, not pending, and must be cleared.

- [ ] **Step 3: Shorten the TTL**

`TTL_MS` (`useDustPending.ts:17`) is 24h with no reconciliation. The relay window is ~2.5h (occasionally several hours on mainnet). Set it to 6h and comment the reasoning — long enough to cover a normal relay, short enough that an unreconciled failure does not linger for a day. Keep the grace-window constant as-is.

- [ ] **Step 4: Gates, commit, open the PR**

Commit `fix(midnight): clear stale DUST pending against chain truth`. Then push and open ONE PR to `development` covering all three commits, titled `fix(midnight): truthful DUST battery for cNIGHT-backed generation`, body explaining: the Path-A/Path-B split, the wire-format bug and what it silently broke (migrate/deregister/statuses), the phantom-pending reconcile, and the two named verification cases (Primal Spectre must charge ~73%, Frost Core's pill must clear). Do NOT merge; the controller merges after review.

### Verification (folds into the standing smoke test)
- [ ] Rebuild (`npm run build`) and reload the extension. Primal Spectre's battery shows a real charge (~73%), a non-"—" generation rate, and no Register CTA. Frost Core no longer shows REGISTRATION PENDING.
- [ ] A wallet with neither path still reads 0.0% with the Register CTA (no false positives).
- [ ] Open the cNIGHT dialog on a Cardano wallet and confirm statuses populate (the wire fix) and that migrate/deregister no longer throw "Registration UTxO not known yet".

## Out of scope (YAGNI)
- Nexus reverse lookup by dust address (`dust/by-dust-address`). Only needed to see registrations from stakes NOT present in this extension; the twin + imported-wallet enumeration covers the real cases. Note it in the PR body as a known limitation.
- Changing `dust/account-state` — correctly Path-A-scoped.
- Unifying the three different `registrationStatus` meanings beyond what Task A requires.
