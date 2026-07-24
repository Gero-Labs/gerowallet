# DUST Duplicate-Registration Guard + Consolidation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make duplicate cNIGHT->DUST registrations impossible to create from Gero and give users a way to detect and consolidate existing duplicates in-wallet.

**Architecture:** The Midnight pairing rule (Foundation-confirmed 2026-07-24) is exactly ONE live registration UTxO per stake credential; more than one invalidates the whole set (indexer reports `registered:false`, indistinguishable from unregistered). Today nothing server-side prevents a second registration and no API surfaces the duplicate state. Fix: (1) Nexus gains a `GET dust/registrations` endpoint listing live registration UTxOs per stake credential (composing three existing pieces: validator address resolver, address-UTxO pagination, datum ownership decode) and a build-time guard that refuses registration with a typed `ALREADY_REGISTERED` error when any live registration exists; (2) the wallet consumes the list, turns count>1 into a real consolidation state (instead of the current `Invalid`->Register loop), and offers per-replicate Remove using the existing targeted deregistration builder (which already accepts an explicit outpoint and needs no changes).

**Tech Stack:** Nexus: Java 21 / Spring Boot (`src/main/java/io/gerowallet/...`), JUnit 5 + Mockito. Wallet: Vue 2.7 + TS, i18n us/de.

**Reference case (mainnet, real):** stake `stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5` has 4 live registration UTxOs (b8dad0c2…#0 dust 73baac…, a9b8aa38…#0, a16dcea8…#0, 527e9a33…#0 all dust 733f7e…). Official portal API for cross-checking: `GET https://midnight-dust-mainnet.nethermind.io/api/dust/registrations/{stakeBech32}` returns `{success, data:[{txHash, outputIndex, validatorAddress, stakeKeyHash, dustPKH, inlineDatum, amount[]}]}`.

**Repos:** nexus at `D:\GeroRepos\gitRepos\nexus` (branch from `origin/development` in a fresh worktree; local checkout is stale). Wallet: this worktree `D:\GeroRepos\gitRepos\gerowallet\.claude\worktrees\midnight-mainnet-dust-04df33` (reset branch onto `origin/development` first; prior commits are already squash-merged via PR #817).

---

### Task 6: Nexus - registrations list endpoint + ALREADY_REGISTERED guard

**Files (all under `src/main/java/io/gerowallet/` on a fresh worktree off origin/development):**
- Modify: `controller/midnight/MidnightDustController.java`
- Modify: `service/midnight/dust/MidnightDustRegistrationTxBuilder.java`
- Create: `model/midnight/dust/DustRegistrationUtxoDto.java` (+ a list response wrapper if the controller convention wants one)
- Create/extend a service method to enumerate live registrations (either in the tx-builder class or a small new `MidnightDustRegistrationLookupService` - follow whichever placement matches existing wiring; prefer a separate service so the controller does not depend on the tx builder for reads)
- Test: mirror the existing dust builder/controller test classes (find them via `git grep -l "MidnightDust" origin/development -- src/test`)

**Contract (wallet-facing):**
- `GET /dust/registrations?cardanoRewardAddress=stake1...` on the existing midnight dust controller path (same auth/network-path pattern as `dust/status`; accept `stake_test1...` on testnets; validate with the same reward-address regex as the status endpoint).
- 200 response body:
```json
{ "registrations": [ { "tx_hash": "...", "output_index": 0, "dust_address_hex": "733f7e...", "lovelace": "1353340" } ] }
```
  Empty list when none. Order: as-enumerated is fine; the wallet picks primary client-side.
- `POST dust/build-registration-tx` gains a pre-assembly guard: when >=1 live registration UTxO exists for the stake credential, respond **409** with a body the wallet can branch on:
```json
{ "error": "already_registered", "registrations": [ { "tx_hash": "...", "output_index": 0, "dust_address_hex": "..." } ] }
```
  Follow the controller's existing error-shape conventions for the envelope; the load-bearing parts are the 409 status, a stable machine-readable `already_registered` marker, and the outpoints list.

**Implementation notes (verified against origin/development):**
- Enumeration = `MidnightDustValidatorAddressResolver.enterpriseAddressFor(network)` + `addressFacade.getUtxosByAddress(validatorAddress, page, UTXO_PAGE_SIZE, cardanoNetwork)` pagination (same pattern as `fetchUtxos` in the registration builder) + filter: UTxO holds the mapping NFT (policy = validator script hash, empty asset name) AND inline datum `c_wallet` vkh == the caller's stake key hash (reuse the datum decode already in `verifyDatumOwnership`).
- The guard goes in `MidnightDustRegistrationTxBuilder.build(...)` right after `resolveStakeKeyHash(...)`/`enterpriseAddressFor(...)`, before `assembler.assemble(...)`.
- Deregistration/update builders need NO changes (already outpoint-targeted via `BuildDustManageTxRequest.registration_utxo_tx_hash/_output_index`).
- The validator address is shared by all registrants: keep the page size bounded and stop early only after full scan (do not assume ordering). Mainnet count is currently small; no caching needed now.

**Steps:**
- [ ] Fresh worktree `git worktree add ../nexus-dust-guard -b feat/dust-duplicate-guard origin/development` (remove a stale worktree of the same name first if present).
- [ ] Write failing unit tests: (a) lookup service returns exactly the caller's live registrations from a mocked address facade (mixed datums, spent filtered by provider, NFT-less UTxO ignored); (b) build-registration throws the typed already-registered error when lookup is non-empty; (c) controller GET maps to DTOs and validates the reward address.
- [ ] Implement lookup service + DTO + controller GET + builder guard.
- [ ] `mvn -Dtest=<the new + existing dust tests> test` green, then full `mvn test` for the midnight package if runtime allows.
- [ ] Commit (explicit paths, branch verified in same call), push, PR to `development` titled `feat(midnight): dust registrations lookup + duplicate-registration guard`. Body: pairing rule, the 4-duplicate incident, the two contracts above. Standard trailers.
- [ ] Merge when green; nexus auto-deploys. Verify live: `GET .../dust/registrations?cardanoRewardAddress=stake1u86ndjr6...` (device JWT) returns the 4 known outpoints (or 3/1 if consolidation already happened).

### Task 7: Wallet - replicate detection + consolidation

**Files (this worktree, after `git fetch origin && git reset --hard origin/development` on the session branch - all prior commits are already merged):**
- Modify: `src/api/midnight-api.ts` (new `getDustRegistrations`, typed; plus typed 409 handling for `buildDustRegistrationTx`)
- Modify: `src/shared/composables/useCnightDustRegistration.ts`
- Modify: `src/modules/dashboard/dialogs/CnightDustRegistrationDialog.vue`
- Modify: `src/modules/dashboard/dialogs/DustRegistrationDialog.vue` (only its `Invalid` branch routing, if it renders for cNIGHT state)
- Modify: `src/plugins/i18n/us.ts`, `src/plugins/i18n/de.ts`

**Behavior contract:**
- `refreshStatus` additionally fetches `getDustRegistrations(stakeAddress)`. Derived state:
  - count 0 -> as today (Unregistered/Pending per existing logic)
  - count 1 && indexer `registered:false` -> Pending (relay in progress), never Register
  - count > 1 -> new `Duplicated` state: Register CTA hidden, consolidation panel shown
- Consolidation panel (in `CnightDustRegistrationDialog.vue`): banner copy "Multiple registrations found. DUST generation is paused until the duplicates are removed." + list of registrations; primary = the one whose `dust_address_hex` equals this wallet's own dust address hex (fallback: first); every other row gets a Remove button calling a new `deregisterOutpoint(txHash, outputIndex)` (parameterized variant of the existing `deregister()`, same sign/submit path). After each removal, refresh; when one remains, state returns to Pending/Registered naturally.
- If `buildDustRegistrationTx` ever returns the 409 `already_registered`, surface the same consolidation panel instead of a raw error toast.
- The existing `Invalid` branches must stop routing to the Register CTA.
- i18n: new keys in BOTH us.ts and de.ts (banner, remove button, primary/replicate labels, paused explainer). Reuse existing keys where exact text matches.

**Steps:**
- [ ] Reset branch onto origin/development (worktree is clean; all commits merged).
- [ ] Implement api + composable + dialog + i18n per contract. Keep the cross-wallet `useDustSources` path unchanged (the server guard covers it; rendering its 409 nicely is enough if trivial).
- [ ] Gates: `npx eslint` on touched files, `node scripts/design/audit.mjs` (any new styles tokenized; ratchet not raised), `npm run build`.
- [ ] Commit, push, PR to `development` titled `feat(midnight): detect + consolidate duplicate DUST registrations`. Merge when green.

### Verification (folds into the standing Task 5 smoke test)
- [ ] With the user's stake still duplicated: wallet shows the Duplicated panel listing 4 rows with the `733f7e…` primary; Remove works on one replicate on-chain. (If the user already consolidated via the portal, verify count==1 renders Pending/Registered and the guard blocks a second registration with the 409 path.)
- [ ] `dustGenerationStatus` flips `registered:true` within the relay window once exactly one remains.
