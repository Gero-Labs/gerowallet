# Midnight non-NIGHT token support — design

**Date:** 2026-08-24
**Status:** Approved, ready for implementation planning
**Base:** `feat/midnight-tokens`, worktree off `origin/development` @ `e0af42bc`
**Repos touched:** `gerowallet`, `nexus` (Java + sidecar). `gero-sync` needs **no** changes.

> All line citations below were verified against this base on 2026-08-24. The
> `gerowallet-open` checkout's local `development` is a rewritten-history lineage
> (same subjects, different hashes) ~2 weeks behind origin; do not plan against it.

---

## 1. Problem

A mainnet user holding 5 USDM (token color `8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b`,
6 decimals, unshielded raw balance `5000000`) at `mn_addr12pwxhsg2uv706sdjxkt4wct95makknh9camu0f4wxn7fja77jqfsevmpxm`
sees nothing in Gero.

This is not a bug in that wallet or that address. **Gero has no support for non-NIGHT Midnight
tokens at all.** The address is a valid mainnet bech32m unshielded address (bare `mn_addr1…`, no
network segment — correct for mainnet). The tokens are on-chain and reach our backend.

The wallet then fails them in two different ways at once: nothing in the UI ever renders a non-NIGHT
color, and the sync layer's two ingest paths disagree about whether to keep one (§2). Either failure
alone is enough to make the balance invisible, which is why the user sees nothing.

Called in advance by our own audit — `docs/midnight/2026-07-05-midnight-ecosystem-audit.md`:

> MIP-0011 (Proposed): native shielded token standard (OpenZeppelin) — our tokenType plumbing is
> ready; asset registry/display is new work.

## 2. Verified current state

Every row below was read from source, not inferred.

| Layer | State | Evidence |
|---|---|---|
| gero-sync | **Already forwards** all unshielded outputs verbatim, `tokenType` included. No filter. | `MidnightUnshieldedTxSubscriber.java:64-70` (GraphQL selection), `:385-387` (pass-through) |
| Nexus UTxO ledger | **Already persists** every color. `token_type` column, no filter. | `entity/midnight/MidnightUnshieldedUtxo.java:67` |
| Nexus Java build DTO | **Already permissive** — `@NotBlank String token`, no enum, no `"NIGHT"` constraint. | `model/midnight/transaction/BuildUnshieldedTxRequest.java:37` |
| Sidecar | **Drops non-NIGHT at three points** (see §6) | `routes/buildUnshielded.ts:96`, `sdk/utxoLedgerClient.ts:120`, `sdk/unshieldedTransfer.ts` (`nightUtxos` filter) |
| Wallet sync — **delta** path | **Drops non-NIGHT.** Live receives never reach the store. | `midnight-sync.service.ts:390` → `isNightOutput()` at `:526` |
| Wallet sync — **snapshot** path | **Admits every color.** `parseUtxos` has no token filter (its only `.filter` is a null-guard); `setUtxos(parsed)` stores all of them. Only the `night` sum is filtered. | `midnight-sync.service.ts:420-428`, `parseUtxos` `:566-584` |
| Wallet store | No per-color balance field; `MidnightBalances` is five NIGHT/DUST scalars | `midnightTypes.ts:35-46` |
| Wallet UI | Holdings table is a hardcoded single-element array | `MidnightHoldingsTable.vue:217` |
| DApp connector | Returns at most one key | `background.ts:5305-5312` |
| Token metadata | **Does not exist** for Midnight anywhere | zero hits across `nexus` and `gerowallet` |

Key asymmetry: **the backend is already carrying USDM.** Only the wallet throws it away.

### The two sync paths disagree — and that changes the diagnosis

An earlier draft of this spec said the wallet uniformly discards non-native tokens. That is wrong,
and the correction matters:

- A **CATCH_UP snapshot** seeds `midnightStore.utxos` with every color, USDM included.
- The **per-transaction delta path** then drops non-native creations while still processing
  non-native *removals* (the removal loop has no token filter, by design — `:393-401`).

Net effect: the stored UTxO set is seeded by a snapshot and then **decays monotonically toward zero
over a live session** — spends are subtracted, receives are never added back until the next full
snapshot.

Precision, so this is not overstated: today that decay is **not user-visible**, because nothing
renders a non-NIGHT color — no `.vue` reads `tokenType`, and `midnightTokenBalances()` has no
production caller yet. The corruption is real but latent. It matters because the UTxO set is the
source of truth the display layer (Task 3) is about to start reading, so it must be correct *before*
anything depends on it, not after.

Two consequences for planning:

1. The reported USDM may **already be in the store right now**, invisible only because nothing renders
   it. Display (P1 Task 3) may therefore surface it without any sync change at all.
2. `background.ts:5300-5302` asserts *"`midnightStore.utxos` only ever carries NIGHT-type outputs
   today"*. That comment is **stale** — it was true of the delta path only. Any code trusting it is
   already wrong.

## 3. Fixed constraints

1. **Metadata is hand-curated.** There is no queryable Midnight token-metadata source; the USDM
   blob came from the issuer. Any design assuming an automatic registry is wrong.
2. **Reuse Cardano's machinery.** Do not build a parallel Midnight metadata subsystem.
3. **Show unverified tokens by default on Midnight** (per-chain default; Cardano's hide-by-default
   is unchanged). Midnight mainnet has near-zero airdrop spam, and with manual curation a
   hide-by-default would keep USDM invisible until someone curates it — reproducing the very bug
   being fixed. The filter still exists; only the default differs.

## 4. Two inherited policies

Both were settled on the Cardano side by **PR #1005** (`e0af42bc`, issue 1003), which is already in
this base. Adopted here rather than re-litigated:

1. **Never cache "no metadata" permanently.** `syncAssets` retries metadata-less rows on a 24h TTL,
   stamped `metadataFetchedAt`, with rows that already carry metadata treated as permanent
   (`sync.service.ts:762-772`, `:781`). Unstamped legacy rows qualify immediately.
2. **Never hide a holding silently.** Rows withheld by a trust filter are surfaced with a count and
   a one-click "show all". From the PR: the verified filter is now *"mainnet-only and never
   silently hides holdings"*.

Policy 1 matters **more** on Midnight than Cardano: the Cardano registry catches up on its own,
whereas Midnight's list is manual, so every token starts in the metadata-less window and stays
there until curated.

## 5. P1 — Ingest & display (`gerowallet` + one Nexus resolver)

### Reuse map

Nothing new is introduced. No new store, endpoint, table, component, or row type.

| Need | Reuses | New |
|---|---|---|
| Metadata fetch | `Api.getAssetsInfo()` → `POST /api/assets/info?chain=…&network=…&provider=…` (`api.ts:89-92`). Already chain-parameterized; `this.chain` already resolves to `"MIDNIGHT"` (`api.ts:11`) | Nexus-side resolver branch for `chain=MIDNIGHT` |
| Metadata cache + TTL | `assets` Dexie table (`db/schema.ts:33`) + the #1005 retry logic (`sync.service.ts:762-772`) | — |
| Fetch orchestration | `syncService.syncAssets()` (`sync.service.ts:~759`) | one call site in the Midnight sync path |
| Per-color balances | `midnightStore.utxos` — **already carries `tokenType` per UTxO** (`MidnightUnshieldedUtxo.tokenType`) | one pure selector |
| Display | `MidnightHoldingRow` + the `rows` computed (`MidnightHoldingsTable.vue:217`) | additional rows |
| Connector | `background.ts:5305-5312` | emit all colors, not one |

`useHoldingsValuation` is **not** a candidate — it rules itself out at `useHoldingsValuation.ts:42-43`:
*"this valuation only runs for Cardano-family chains (Midnight/Bitcoin render their own views)."*

### Changes

1. Remove the `isNightOutput` gate on **adds** (`midnight-sync.service.ts:390`). This does not
   "let tokens in" for the first time — the snapshot path already does — it makes the delta path
   agree with the snapshot path and stops the live-session decay described in §2.
2. Keep `nightUnshielded` NIGHT-only. Non-native colors are **derived** from the existing UTxO set,
   not stored as new state.
3. Call the existing `syncAssets` machinery from the Midnight sync path, keyed by token color.
4. Extra rows in `MidnightHoldingsTable`.
5. Connector returns every color.
6. Receive: unshielded address already accepts every color — copy change only, no new screen.

### Why removing the ingest gate is safe for `nightUnshielded`

Both balance paths **already** filter to native NIGHT independently of the ingest gate:

- the delta path's `isNight()` check before `balanceDelta` (`midnightStore.ts:~956`), and
- the CATCH_UP snapshot re-sum's `tt === '' || /^0+$/.test(tt)` (`midnight-sync.service.ts:~425`).

So non-native UTxOs entering the set cannot move `nightUnshielded`. This is load-bearing, because
that field has been zeroed by regression twice — both recorded in code comments: the empty-snapshot
bug (`midnight-sync.service.ts:412-419`, *"0 tNIGHT but history/graph still show"*) and the
DUST-registration remove/add ordering bug (`midnightStore.ts:961-973`). Task 2 asserts this
explicitly rather than trusting it.

## 6. P2 — Send (`gerowallet` + `nexus` sidecar)

Seven gates. Six are mechanical; gate 7 is the one that fails silently.

| # | Location | Change |
|---|---|---|
| 1 | `midnight-api.ts:299` — `token: 'NIGHT'` literal type | widen to token color |
| 2 | `MidnightSendDialog.vue:884`, `MidnightSendSheet.vue:534`, `DAppOverlay.vue:2696` | pass selected color |
| 3 | Java `BuildUnshieldedTxRequest.Output` | **no change — already `@NotBlank String token`** |
| 4 | `sidecar/routes/buildUnshielded.ts:96` — `if (o.token !== 'NIGHT') reject` | drop |
| 5 | `sidecar/sdk/utxoLedgerClient.ts:120` — `if (!isNightTokenType(...)) continue` | drop |
| 6 | `sidecar/sdk/unshieldedTransfer.ts` — `nightUtxos` filter `/^0+$/.test(u.type)` | select per color |
| 7 | `sidecar/sdk/unshieldedTransfer.ts` — offer section + segment id | **see below** |

### Gate 7: CORRECTED — the "segment 0 trap" does not exist

**An earlier version of this spec was wrong here, and the error was load-bearing:**
it claimed a token-only send belongs in the guaranteed offer at segment **0**, called
that a fund-losing trap, and made an acceptance test mandatory on that basis.

That was derived from `GUARANTEED_SEGMENT = 0` in the SDK's `Transacting.js`. But that
constant selects which *offer slot* to splice signatures into during `addSignatures` —
it is **not** the argument to `signatureData()`.

Verified against current nexus (`origin/development` @ `e612d5dc`):

- `sidecar/src/sdk/segments.ts:86-89` derives the segment id from the intent's key in
  `tx.intents` — `intent.signatureData(segmentId)` — not from which slot holds the offer.
  A single-intent transfer is segment 1 either way.
- `sidecar/src/sdk/unshieldedTransfer.ts:171-189` already branches: shield-swap puts the
  offer in `guaranteedUnshieldedOffer`, everything else in `fallibleUnshieldedOffer`, and
  **both** sign `signatureData(1)`. The swap path runs in production.
- That code's own comment records the empirical basis: *"intents keep their segment id (1)
  regardless of slot, and signature splicing already handles both slots"* — with a live
  preprod observation (Custom(138) BalanceCheckOverspend, 2026-07-13) behind the
  slot choice.
- The wallet signs via `signUnshieldedSegments` (`midnightTxBuilder.ts:486`), which
  delegates to the SDK's `UnshieldedWallet`; slot selection is the SDK's concern.

**So signing needs no change for token sends.**

### The real open question: which slot

What remains genuinely undecided is the *slot*, not the segment. The SDK's `makeTransfer`
picks `guaranteed` when a transfer has no NIGHT output, and the swap path needs
`guaranteed` because the ledger balance-checks per segment. Whether a pure token transfer
(no NIGHT output, no shielded half) must also sit in `guaranteed` is **not established by
reading** — the swap rationale does not obviously transfer, since there is no
guaranteed-segment counterparty to balance against.

This is empirical. Resolve it with a preprod token transfer before mainnet, and expect
`Custom(138) BalanceCheckOverspend` as the failure signature if the slot is wrong. Do not
guess it from the SDK source; that is exactly how the previous error was made.

### Coin selection

`selectInputs` keeps its greedy largest-first algorithm, but runs **once per token color**, with a
change output **per color**. A single offer can carry mixed colors: `UtxoSpend.type` and
`UtxoOutput.type` are per-entry (`ledger-v8.d.ts:1818`, *"The token type of this UTXO"*), and
`UnshieldedOffer.new(inputs, outputs, signatures)` takes flat arrays (`ledger-v8.d.ts:2079`).

### Mandatory acceptance test — revised

The original test asserted `guaranteedUnshieldedOffer` + `signatureData(0)`. Both halves were
wrong (see Gate 7). Replace with:

A **preprod token transfer, end to end**, asserting it submits and the recipient's balance moves.
That is the only thing that settles the slot question, and it is cheap next to the cost of being
wrong on mainnet. A unit test over the builder cannot answer it — the constraint lives in the
ledger's per-segment balance check, not in our code.

### Product dead-end to surface honestly

Fees are paid in DUST; DUST is generated only by registered NIGHT. **A user holding USDM and zero
NIGHT cannot send USDM.** This is the chain's design, not a fixable bug. It requires an explicit
error ("You need NIGHT to pay Midnight fees") — an insufficient-funds message pointing at USDM
would be actively misleading.

## 7. P3 — History (`gerowallet`)

- Widen `MidnightTransaction.token` from the `'NIGHT' | 'DUST'` union (`midnightTypes.ts:152`).
- Remove three NIGHT-only filters in `buildTransaction`: net-amount sum
  (`midnight-sync.service.ts:559-562`), counterparty selection (`:527`), hardcoded `token: 'NIGHT'`
  (`:508`).
- Widen `currencySymbol()` (`MidnightTransactionsCard.vue:84`).
- A mixed-color tx emits one row per color.

Read-only and independent of P2; can land in either order.

## 8. P4 — Valuation (`nexus` + `gerowallet`)

`useNightFiat` is already the right shape — a CoinGecko fetch with a 5-minute module-scope cache,
pinned to one id (`NIGHT_COINGECKO_ID = 'midnight-3'`, `useNightFiat.ts:18`).

- Generalize it to take the id as a parameter.
- Carry an **optional `coingeckoId`** in the curated Nexus metadata.
- No id → no price → render `—`, exactly as testnet tNIGHT already does.

**No hardcoded $1 for stablecoins.** A curated "verified" flag is not a price oracle; one bad list
entry would misvalue a portfolio. An unpriced stablecoin shows a dash.

`api.coingecko.com` is already in the manifest `connect-src` — no manifest change.

## 9. Build order

```
1. P1  Ingest & display
2. P3  History
3. P2  Send
4. P4  Valuation
```

P2 is late deliberately: it is the only phase that can lose money, and it benefits from P1 having
proven the color plumbing end-to-end.

## 10. Risks & dependencies

| Risk | Mitigation |
|---|---|
| ~~P1 blocked on the metadata-TTL fix~~ | **Resolved.** PR #1005 (`e0af42bc`) is in this base: `metadataFetchedAt` + `ASSET_METADATA_RETRY_TTL_MS` at `sync.service.ts:762-772`. No port needed. |
| **Wrong segment signed on non-NIGHT sends** (§6 gate 7) | Mandatory acceptance test before P2 ships |
| **`nightUnshielded` regression** — twice-broken field | Both balance paths already filter to native; Task 2 asserts it explicitly (§5) |
| **P2 pickers are only half-reusable.** `TokenSelector.vue:311` and `SelectTokenDialog.vue:128` assume Cardano (`token.policy_id === ''`, lovelace→ADA, DexHunter pricing) | Shell reusable; pricing/`policy_id` branches need a chain guard. Budget for it — not free reuse |
| USDM holder with no NIGHT cannot transact | Explicit error copy (§6) |
| Planning against the stale local lineage | This spec and all plans live on `feat/midnight-tokens`, cut from `origin/development` |

## 11. Out of scope

- Shielded (Zswap) custom tokens. This spec covers **unshielded** colors only. Shielded balances
  remain a single scalar (`background.ts:5333-5336` documents the existing limitation).
- Automatic token discovery / a permissionless registry. Curation stays manual until a queryable
  Midnight metadata source exists.
- Cardano's hide-by-default trust filter. Unchanged.

## 12. Provenance

Findings verified against source on 2026-08-24: `gerowallet@feat/midnight-tokens` (off
`origin/development` `e0af42bc`), `nexus`, `gero-sync`, and the installed
`@midnight-ntwrk/ledger-v8` + `@midnight-ntwrk/wallet-sdk-unshielded-wallet` typings/dist. SDK
behaviour claims are cited to the SDK's own compiled source, not to comments about it.
