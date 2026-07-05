# Smart-Money / "Track Profitable Wallets" — Final Phased Architecture for Gero

This design folds in the feasibility, PnL-correctness, and no-advice/privacy critiques. The single biggest change versus the draft: **there is no trustworthy "profitable wallet" ranking on today's data, and "smart money" framing is itself an implicit recommendation.** What ships first is a deliberately narrow, neutral, manipulation-aware **large-on-chain-moves** feed. Profit/track-record of third-party wallets is cut from the user-facing product entirely.

**Branch note:** all client-side seams below (`detectors.ts`, `narrator.ts`, `preferences.ts`, `noAdvice.spec.ts`, etc.) exist on **`feat/copilot-agent`**, NOT on the currently checked-out `feat/2.7-release-prep`. This feature must be built on / merged from `feat/copilot-agent`; none of these files exist on the release branch. The `docs/plans/2026-06-26-gero-copilot-agent-design.md` "design spec" referenced in the brief is not present in the tree; the §6 no-advice constraint is grounded not in that doc but in **executable code**: `src/services/copilot/noAdvice.spec.ts` (forbidden-token regex scan) + `src/services/copilot/narrator.ts` `NARRATION_TEXT_KEYS`. All "no-advice" guarantees below cite that code, not the phantom doc.

---

## 0. The hard truths this design is built around

1. **DEX swap data carries NO wallet identity.** `SwapHistory` (`src/api/market-api.ts:195-208`) is `{ txHash, type, priceAda, volumeAda, dex, blockTime }` — no `address`/`stakeAddress`/`buyer`/`seller`. The only client-side attribution that exists is `RecentTrades.vue:124-128` self-joining `txHash` against the *logged-in user's own* tx ids. **The client cannot build a candidate wallet universe from market endpoints.** Attribution is structurally a backend job.

2. **Per-wallet PnL is Blockfrost-bound, 200-tx-capped, and computed live per request — NOT a cheap internal query.** `docs/plans/market-api-backend-requirements.md:116`: "WalletService.getPnl() fetches up to 200 transactions from Blockfrost on every request and computes FIFO cost basis in real-time. This causes timeouts (frontend uses 60s timeout as a band-aid)." The "Background job that updates P&L" is listed as an **unbuilt option** (`:119`), not an existing capability. Fanning `getWalletPnl` across a candidate set is a **server-side rate-limit bomb** — the same class of failure as the 429 we hit on 17 parallel client calls. The draft's claim that the backend "already computes per-arbitrary-stake PnL over a yaci-store index" is **wrong**: yaci-store indexes *blocks*; PnL is a Blockfrost per-request call layered on top.

3. **Per-wallet realized PnL is currently unreliable enough to flip sign.** `docs/plans/2026-03-11-pnl-calculation-bug-analysis.md:21-38`: FIFO reported **+24,911 ADA gain on a position actually in the red**, because `lookupPriceAtTime()` returns null (→ cost defaults to 0) for acquisitions before slot ~173.7M (Dec 2025), so ~99% of lots are fabricated zero-cost. Realized PnL = proceeds − lot cost; a fabricated-0 lot inflates "realized gain" by the **same mechanism** that produced the phantom gain. The "actual ADA in/out" the draft leaned on **does not exist yet** — it is precisely the output of the **unshipped** `dex_events` acquisition-classification work (`docs/plans/2026-03-12-pnl-acquisition-classification.md`, Priority: Critical, still a plan). **Therefore realized PnL is NOT a safer/earlier tier than ROI.**

4. **The `costBasisComplete` flag is necessary-but-insufficient.** It is set by the same backend that returns `costBasisComplete: true` on the phantom-gain wallet (707 txs, "no truncation"). It reports completeness of **processing**, not correctness of **cost basis**. A wallet whose lots are 99% zero-cost-from-missing-price can still report `costBasisComplete: true, unknownQuantity: 0`. Gating on it alone is unsafe.

5. **"Smart money" is itself an implicit recommendation.** It is industry shorthand for "people who are right / whose trades you should follow." Surfacing a stream framed as "smart money" / "profitable wallets" / "notable traders" communicates suitability regardless of the disclaimer, and the regex scan cannot catch connotation or ranking-as-recommendation. **The user-facing product must not use those terms.**

These force the design: **backend-owned attribution + ranking**, **neutral large-moves observation only**, **no third-party profit/track-record surfaced ever**, **client is a thin renderer**, **manipulation/sybil/batcher defenses are first-class**, and **validation gates per phase**.

---

## 1. DEFINITION — what we actually surface

We **do not** ship a profit leaderboard, and we **do not** call anything "smart money," "profitable," "notable," "top trader," or "best" in any rendered payload, label, or i18n key.

What we surface is **large, observable on-chain moves**, tiered by how much we can honestly say:

| Tier | What it surfaces | Reliability | Requires |
|---|---|---|---|
| **T-base — Token-level anomaly (NO wallet identity)** | "Unusual swap activity in TOKEN" from already-returned aggregate fields: `txnCount24h`, `makerCount24h`, `volume24h` spikes | **High** — pure aggregate, no identity, ungameable as a *wallet* signal | Nothing new (fields exist in market-api today) |
| **T0 — Large single move, size-banded, anti-manipulation filtered** | "A large wallet moved ~X ADA into TOKEN" — size + direction only, no quality/track-record, no stable cross-event handle | **Medium** — observable, but requires attribution + sybil/wash/batcher exclusion to not be a pump megaphone | Backend swap→stake attribution + exclusion filters |
| **T1 / T2 — third-party realized PnL / ROI / win-rate** | **CUT.** Not deferred — removed from the user-facing feed. | n/a (sign-flips today; and "a winning wallet just sold" is a copy-trade signal regardless of disclaimer) | n/a |

**Why T1 is cut, not deferred:** even with a trustworthy number, attaching a wallet's *past success* to its *current move* ("a wallet with a realized gain just exited TOKEN") is a copy-trading signal dressed as observation — it tells the user "a winning wallet is moving," which is exactly the suitability slide the no-advice constraint forbids. Realized-PnL gating belongs **only to the user's OWN portfolio P&L card**, never to third-party wallets.

**Honesty predicate (applies to any number we ever show on the user's OWN wallet, and is the bar that would have to be met before *any* third-party number — which we are not shipping):** a realized figure may be surfaced only when, for every disposed lot of the token, `acquisitionType === SWAP` with a non-null `actualCostPerUnit` derived from the swap event (not a price lookup), AND zero lots had cost defaulted from a null price (`priceLookupFallbackCount === 0`). The existing `costBasisComplete`/`unknownQuantity` flags are necessary-but-insufficient and must be treated as such. This predicate requires **both** the `dex_events` classification **and** the historical-price backfill to land. Net effect: **the only honest third-party tier today is T0 (large moves), and the only ungameable-by-a-single-wallet tier today is T-base (token anomalies).**

---

## 2. CANDIDATE SOURCING — assembling the wallet universe

Client-side sourcing is impossible (Truth #1). Attribution is a backend job, and it belongs in the **ranker service, not gero-sync**.

**Producer is cardano-market-data, NOT gero-sync.** The draft routed attribution through `gero-sync BlockTransactionListener` — this is wrong on two counts:
- gero-sync only matches block stake addresses against its **per-pod in-memory registry of *subscribed* WebSocket clients** (`docs/superpowers/plans/2026-04-07-gero-sync.md:7`; `StakeAddressRegistry.getAllStakeAddresses` returns only *registered* addresses). It has **no mechanism** to attribute/persist swaps for the **unsubscribed general trader population** a leaderboard needs. That is a fundamentally new code path, not "emit one more row."
- The acquisition-classification doc already places swap→address attribution in **cardano-market-data's `dex_events` table** (`docs/plans/2026-03-12-pnl-acquisition-classification.md`), co-located with the yaci-store whole-chain index and the ranker.

So: **gero-sync stays strictly for its existing subscribed-wallet push role. The producer of attribution rows is the cardano-market-data yaci-store / `dex_events` pipeline.**

**Critical data-availability UNKNOWN on `dex_events`:** the acquisition doc itself hedges existence and shape — "The `dex_events` table (or equivalent)" (`:41`) and "If the `dex_events` table doesn't store the recipient wallet address directly, you may need to join against the transaction outputs to find which address received the tokens" (`:277`), and notes batched batcher txs may be ambiguous (`:228`). **Recipient-address coverage in `dex_events` is UNCONFIRMED** and may require a non-trivial UTxO-outputs join (or be unreconstructable for batched multi-order txs). This is a hard gate (Section 9 Q-DEX) before any T0 work is scoped, and an absolute gate before any future realized number.

**Universe definition (backend job, T0):** the set of stake addresses that produced ≥ N swaps with ≥ X ADA cumulative volume over window W on top-volume tokens (seed the token set from existing `getTopByVolume`, `market-api.ts:231`). Bound by activity, not by scanning everyone. **Both sides of each swap must be attributed** (token-recipient stake AND ADA-source identity) so the job can detect self-trades and exclude script/batcher counterparties (see §3).

**Whether `/api/dex/tokens/{policy}/{name}/top-traders` exists is an OPEN, BLOCKING question — not an MVP unblocker.** The draft treated it as existing and identity-bearing. The only source (`docs/2.7/market-data-parity-report.md`) says the opposite: line 41 grades it "In Gero? **No**" (a *gap-analysis* row about the upstream cardano-market-data **website**, not proof of a Nexus-exposed endpoint), line 107 *recommends adding* `getTopTraders` to `market-api.ts` (i.e. it is NOT wired), and the report **nowhere** confirms its payload carries a stake/payment address vs. an aggregate count. Verified: `market-api.ts` has no such method (only `getTokenSwaps` at `:370`, anonymous `SwapHistory`) and no `/api/dex/swaps/recent` method either. So this is **not** a backend-light path; see Phase gating in §8.

---

## 3. SCORING + RANKING (and anti-manipulation, which is first-class)

All scoring is **backend-side** (Truths #1–#2 + rate-limit reality). The client never scores or ranks, and **never renders a rank**.

**Forbidden mechanism:** the job MUST NOT fan `getWalletPnl` across the candidate set (Truth #2 — Blockfrost rate-limit bomb). T0 metrics must be computable **purely from the indexed swap/`dex_events` aggregation in Postgres, with zero Blockfrost calls per wallet.** If no such whole-chain swap-by-stake aggregation exists in Postgres today, that is **net-new ETL, not a query** (Section 9 Q-AGG).

**T0 candidate metric (the only third-party metric we compute):** per (stake, token) over window W, `netPositionDeltaAda` from **classified swap legs** (buys minus sells, routing intermediates excluded — see §6 net-delta note). Size + recency only. **This is explicitly NOT a profitability or skill signal** and must never be labeled as one.

**Anti-manipulation is part of the ranking job, not an afterthought** (net-accumulation alone ranks wash-traders, insiders, sybils, and batchers — and would turn the feed into a free pump-marketing megaphone, the exact MiCA/market-manipulation risk):

- **Wash / self-trade exclusion:** drop swaps where buyer-side and seller-side resolve to the same stake address or a known related-address cluster. Requires both-sides attribution (§2).
- **Sybil / stake-key-splitting collapse:** apply a common-input-ownership / co-spend / mutual-funding heuristic to collapse obvious sybil rings before ranking; at minimum flag wallets that consistently co-spend or fund each other. One stake key ≠ one independent trader.
- **Known-entity exclusion list:** CEX deposit/withdrawal clusters, DEX batcher/script addresses, treasury multisigs are **never** labeled "wallets/traders." A batcher's throughput would otherwise dominate any size ranking. **Script addresses with no stake credential are dropped, not bucketed.**
- **Liquidity / holder floor:** exclude tokens below a liquidity and holder-count floor so an illiquid-pool wash can't post a giant headline number.
- **Sustained-history requirement:** require N distinct active days over ≥ M months so a single fresh whale buy cannot top the list (kills recency-only gaming).
- **LP / routing contamination filter:** LP-token mints, multi-hop routing (ADA→MIN→GERO), and order-cancellation refunds all look like inbound flows (`acquisition doc :234-244`); count only classified DEX-buy legs, never liquidity deposits or routing artifacts.

If none of these are feasible pre-`dex_events`, the honest fallback is **T-base only** (token-level anomaly, no wallet identity at all) — see §8 Phase 1.

**Cadence:** the ranked set recomputes every **15–30 min** (matching the unbuilt Caffeine/background-job note, `market-api-backend-requirements.md:115-120`), served from cache. The "fresh moves" stream is **a NEW cached GET endpoint polled by the client on its existing feed-refresh tick** — NOT "per block," and NOT a WebSocket. **There is no market-wide WebSocket / `onTip` topic today**: gero-sync's `onTip`/WS is the *subscribed-wallet* push channel, not a general market firehose; adding a market-moves WS is separate, larger backend work, explicitly out of MVP scope.

**Dedup + ranking-epoch coherence:** dedup candidates by stake address (after sybil collapse) before ranking. Because the ranked set recomputes on a different cadence than moves are detected, **snapshot the ranked set at move-detection time and embed the ranking epoch in the feed dedupe key** (`largeMove:{unit}:{sizeBand}:{rankEpoch}:{bucket}`) so a move is narrated against the ranking that actually qualified it — no stale-label races, no duplicate narrations across bucket boundaries. Note `{walletId}` is deliberately **absent** from the rendered dedupe key (§7).

---

## 4. WHERE IT RUNS — client/backend split + new endpoints

| Concern | Where | Status |
|---|---|---|
| Whole-chain block/swap index (yaci-store) | cardano-market-data | **Exists** (`market-api-backend-requirements.md:9`) |
| Per-wallet PnL | cardano-market-data `WalletService.getPnl` | **Exists but Blockfrost-bound, 200-tx cap, per-request, NOT scalable to a candidate set** (`market-api-backend-requirements.md:116`) — **must NOT be fanned across candidates** |
| Whole-chain swap-by-stake aggregation (no Blockfrost) | cardano-market-data Postgres | **UNCONFIRMED — likely net-new ETL** (Q-AGG) |
| Swap → stake attribution rows (both sides), `dex_events` | cardano-market-data yaci-store / `dex_events` | **Needs work; recipient-address coverage UNCONFIRMED** (Q-DEX) |
| Anti-wash / sybil / batcher exclusion | cardano-market-data ranking job | **Needs work (net-new)** |
| Rank candidate wallets (T0 size only) | cardano-market-data scheduled job, cached | **Needs work** (precedent `:115-120`) |
| Detect fresh large moves (recent swaps ∩ ranked set) | same job | **Needs work** (inputs exist: global swap stream) |
| Token-level anomaly (T-base) | cardano-market-data, from existing aggregate fields | **Light — fields exist** (`txnCount24h`/`makerCount24h`/`volume24h`) |
| Auth + expose endpoints | Nexus proxy (device-JWT) | **Exists, BUT per-route allow-listed** (see caveat below) |
| Consume endpoints, narrate, dedupe, render | client copilot pipeline (`feat/copilot-agent`) | **Needs work (additive)** |

**Why backend, not client:** the client hit **429s on 17 parallel price calls**; a single wallet PnL needs a **60s timeout** (`getWalletPnl`, `market-api.ts:305`). Centralized detection is the only way "cost scales with distinct notable events, not tokens × users."

**Nexus proxy is per-route allow-listed — not zero-config.** `market-api.ts` documents that the Nexus proxy does **not** forward several endpoints: `getSparklines` (`:287` "The Nexus proxy does not forward /sparklines") and `getSnekFunTokens` (`:298`) both **bypass Nexus and hit the public market backend directly**. New `/smart-money/*` routes therefore require an **explicit Nexus forwarding allow-list entry**; otherwise they fall back to the unauthenticated public backend, changing the auth/rate-limit story. Confirm before assuming device-auth coverage (Section 9 Q-NEXUS).

### NEW endpoints the client consumes (proposed; no such route exists today)

Add under the Nexus market namespace (`/api/market/...`), as methods on `src/api/market-api.ts`. **Internal job name is irrelevant; no rendered payload field may contain `smart`, `profitable`, `top trader`, `best`, or `rank`.** (Route path uses a neutral segment, e.g. `/api/market/large-moves/...`.)

**(A) Ranked large-move candidates — `GET /api/market/large-moves/top?window=30d&limit=50`** (internal ranking input; the client does NOT render rank or a stable handle)
```jsonc
[{
  "sizeBand": "large" | "whale",          // size band ONLY — no quality, no track record
  "window": "30d",
  "netPositionDeltaAda": 412000,          // T0 size, net of routing legs
  "tradeCount": 37,
  "activeDays": 41,                        // sustained-history evidence (anti-recency-gaming)
  "unit": "policy.assetname",
  "ticker": "SNEK"
  // NO rank, NO label asserting standing, NO walletId in client-rendered output,
  // NO realizedPnlAda, NO ROI, NO win-rate, NO confidence:"realized"
}]
```

**(B) Fresh large moves — `GET /api/market/large-moves/recent?sinceSlot=…&limit=50`** (polled on the client's existing feed tick; NOT a WebSocket)
```jsonc
[{
  "sizeBand": "large" | "whale",
  "side": "accumulate" | "distribute",    // NOT "buy"/"sell" (§5/§6 word-ban)
  "unit": "policy.assetname",
  "ticker": "SNEK",
  "netDeltaAda": 52000,                    // NET position delta, routing legs excluded, bucketed (~)
  "dex": "Minswap",
  "blockTime": "2026-06-28T…",
  "slot": 178900000,
  "rankEpoch": "2026-06-28T18:00Z"         // for stale-label-safe dedupe (server-side)
  // NO txHash, NO explorer deep-link (de-anonymization vector — §7)
  // NO walletId in the rendered payload (re-identification vector — §7)
}]
```

This is the global swap stream **filtered to the ranked set, sybil/wash/batcher-excluded** — the join the client cannot do. **No per-wallet drill-down on third-party wallets is exposed.** The existing `getWalletPnl`/`getWalletHoldings` (`market-api.ts:305-318`) remain for the **user's OWN** wallet only.

**(C) Token-level anomaly (T-base, identity-free) — `GET /api/market/token-activity/anomalies?window=24h`** computed from existing `txnCount24h`/`makerCount24h`/`volume24h`. This is the genuinely shippable-without-identity slice.

---

## 5. FEED INTEGRATION — additive, nothing existing breaks (`feat/copilot-agent`)

Pipeline is a pure 4-stage flow: **detect → narrate → reduce(dedupe/cap) → render**.

**(1) New FeedEvent kinds — `detectors.ts`.** Widen the union from `'priceUp' | 'priceDown'` (`detectors.ts:15-23`) to add `'largeMoveAccumulate' | 'largeMoveDistribute' | 'tokenActivitySpike'`. **Leave `detectPriceMoves` byte-for-byte unchanged** so `detectors.spec.ts` stays green. Add separate pure detectors `detectLargeMoves(...)` and `detectTokenActivitySpikes(...)`. Discriminated union on `kind`; price fields (`held`, `window`, `pct`) stay optional. Dedupe key follows the existing `kind:scope:unit:bucket` pattern (`detectors.ts:49`) extended with the ranking epoch: `largeMoveAccumulate:{unit}:{sizeBand}:{rankEpoch}:{bucket}` (no `walletId`).

**(2) Narrator key family — `narrator.ts`.** Branch in `narrate()` (`:38-47`) on `event.kind`. **CRITICAL:** every new key MUST be added to `NARRATION_TEXT_KEYS` (`narrator.ts:17-30`) — that array is what the no-advice scan iterates today. Forgetting to register a key makes it silently dodge the scan. To make this **structural rather than process**, see (8) below.

**(3) i18n (EN + DE, both, scanned). NO em dashes / en dashes anywhere** (standing user rule). Strings must pass `noAdvice.spec.ts` forbidden regexes (which ban standalone `\bbuy\b`/`\bsell\b`, `should`, `will`, `recommend`, `\d+x`, `moon`, `dump`, `target`, urgency, and German equivalents). Phrase actions without buy/sell and without quality claims:

EN:
```
'copilot.feed.largeMoveAccumulate':       'a large wallet moved {netDeltaAda} ADA into {ticker} ({window}).'
'copilot.feed.largeMoveDistribute':       'a large wallet moved {netDeltaAda} ADA out of {ticker} ({window}).'
'copilot.feed.chill.largeMoveAccumulate': 'fyi, a large wallet added some {ticker} (about {netDeltaAda} ADA).'
'copilot.feed.chill.largeMoveDistribute': 'fyi, a large wallet trimmed {ticker} (about {netDeltaAda} ADA).'
'copilot.feed.spicy.largeMoveAccumulate': 'ok, a large wallet put about {netDeltaAda} ADA into {ticker}. noted.'
'copilot.feed.spicy.largeMoveDistribute': 'a large wallet pulled about {netDeltaAda} ADA out of {ticker}. just an observation.'
'copilot.feed.tokenActivitySpike':        'unusual swap activity in {ticker} right now ({makerCount24h} wallets, {volume24h} ADA).'
```
DE (drafted and to be scanned against `DE_FORBIDDEN`; uses `aufgestockt`/`reduziert`, **avoids** banned `rein`/`raus`/`einsteigen`/`aussteigen`):
```
'copilot.feed.largeMoveAccumulate':       'eine grosse Wallet hat {netDeltaAda} ADA in {ticker} bewegt ({window}).'
'copilot.feed.largeMoveDistribute':       'eine grosse Wallet hat {netDeltaAda} ADA aus {ticker} bewegt ({window}).'
'copilot.feed.chill.largeMoveAccumulate': 'fyi, eine grosse Wallet hat {ticker} aufgestockt (ca. {netDeltaAda} ADA).'
'copilot.feed.chill.largeMoveDistribute': 'fyi, eine grosse Wallet hat {ticker} reduziert (ca. {netDeltaAda} ADA).'
'copilot.feed.spicy.largeMoveAccumulate': 'ok, eine grosse Wallet hat ca. {netDeltaAda} ADA in {ticker} bewegt. notiert.'
'copilot.feed.spicy.largeMoveDistribute': 'eine grosse Wallet hat ca. {netDeltaAda} ADA aus {ticker} bewegt. nur eine Beobachtung.'
'copilot.feed.tokenActivitySpike':        'auffaellige Swap-Aktivitaet bei {ticker} gerade ({makerCount24h} Wallets, {volume24h} ADA).'
```
Params are verifiable facts only — size band, net ADA (bucketed), ticker, window, aggregate counts. **No quality, no track record, no ROI, no "winning wallet."**

**(4) Category wiring — `preferences.ts`.** `whales` already exists in `CopilotCategoryFlags` (`preferences.ts:9-15`, `whales: boolean; // coming soon - no detector yet`), defaults `false` (`:53`), round-trips in `normalizePrefs` (`:72-77`). i18n already present: `copilot.category.whales` = "Whales", `whalesDesc` = "Big and labeled-wallet moves" (`us.ts:729`). **Keep the neutral "Whales" / "Big moves" naming — do NOT rename to "smart money."** Activation = flip default + let the settings toggle enable it once backend ships. (Recommend tightening `whalesDesc` to "Big on-chain wallet moves" to drop "labeled," which implies standing.)

**(5) `refBuilder.ts` — untouched.** It builds per-user `TokenRef[]` for the *price* path; coming-soon categories "have no source and no detector yet" (`refBuilder.ts:4-6`). Large-move/anomaly events come from the backend stream, not user holdings — they bypass the per-token-ref path by design.

**(6) Engine wiring — `feedEngine.ts` + `useCopilotFeed.ts`.** Don't touch price-hardwired `buildFeedItems` (`feedEngine.ts:15-30`). Add siblings `buildLargeMoveItems(...)` and `buildTokenAnomalyItems(...)` producing the same `FeedItem` shape (`feedReducer.ts:2-8`) → dedupe/cap is automatic (`addFeedItems`, `:16-21`) — **zero reducer changes**. In `useCopilotFeed.refresh()` (`:70-82`), when `prefs.categories.whales` is on, call the new endpoints and `store.merge([...priceItems, ...largeMoveItems, ...anomalyItems])`. **Gating lives here**, keeping pure detectors flag-free.

**(7) Render — `FeedPage.vue:24-29` untouched.** Already kind-agnostic: `$t(item.textKey, item.params)`. Standing disclaimer `copilot.feed.disclaimer` = "Observations, not financial advice. DYOR." already renders above the list (`FeedPage.vue:19`).

**(8) Close the no-advice registry hole — STRUCTURAL, shipped with this feature.** Today `noAdvice.spec.ts` iterates the hardcoded `NARRATION_TEXT_KEYS` array only, so an emit-without-register slips through unscanned — unacceptable for the highest-risk surface in the product. Change the test to derive the scanned set **from the i18n files**: scan **every** key matching `/^copilot\.feed\.(?!disclaimer|subtitle)/` in **both** `us.ts` and `de.ts` against the forbidden lists, AND assert every such key is present in `NARRATION_TEXT_KEYS` (catches emit-without-register from the other side). Invariant becomes "any `copilot.feed.*` string is scanned," not "any registered string is scanned." Additionally extend the forbidden lists for this feature's new vocabulary: add EN `/\bfollow\b/i`, `/copy/i`, `/smart money/i`, `/whale alert/i`, `/top trader/i`, `/profitable/i` and DE `/folg/i`, `/kopier/i`, `/nachkauf/i`.

**Tests:** the i18n-namespace scan (8) auto-covers the new keys EN+DE; add `detectLargeMoves`/`detectTokenActivitySpikes` cases to `detectors.spec.ts` (threshold + epoch-stable dedupe key).

---

## 6. NO-ADVICE FRAMING (the hard constraint, resolved)

"Follow this trader to profit" is made **structurally unrepresentable**, and the framing is fixed at the vocabulary and data-shape level — not just the regex:

1. **No "smart money" / "profitable" / "notable" / "top trader" / "best" in ANY user-facing surface.** Category stays the neutral "Whales / Big on-chain moves." Internal job names are free; **no rendered payload field, label, or i18n key may contain those terms** — now enforced by the extended forbidden list in (8).
2. **No rank, no standing label, rendered.** `rank` is an internal ranking input only. The feed renders a **size band** ("a large wallet", "a whale-sized wallet"), never "top-volume X wallet," never "#1," never a quality claim.
3. **No third-party track record, number or descriptor.** "A wallet with a realized gain just sold" is cut — it is a copy-trade signal even with the number omitted. Realized PnL is surfaced **only on the user's own portfolio card**.
4. **Word-level bans honored + extended:** no `buy`/`sell`/`should`/`will`/`Nx`/`target`/`moon`/`follow`/`copy`/`smart money`/`whale alert`. Neutral verbs only ("moved into", "trimmed", "pulled out of"), neutral sides `accumulate`/`distribute`.
5. **Verifiable past facts only, and materially honest:** the surfaced number is the **net position delta** (routing legs excluded), **bucketed** ("~400k ADA"), above a liquidity-relative floor — not a single swap's gross `volumeAda` (which multi-hop routing inflates and a wash trader can post cheaply in an illiquid pool). A technically-on-chain but materially misleading headline number violates the "verifiable facts" principle even though it passes the regex.
6. **Allowed example:** "A large wallet moved ~52,000 ADA into SNEK (30d)." **Forbidden:** anything titled/framed as "most profitable wallets to follow," "copy this trader," "smart money is buying," or a per-wallet track record.

The MiCA/CFTC risk register (PMF proposal §10, risk #2) already mandates objective-data-only framing; the anti-manipulation filters in §3 are what prevent the feed from becoming a market-manipulation amplifier.

---

## 7. PRIVACY / ETHICS (resolved — pseudonymity is not anonymity)

- **Public on-chain data only.** Stake activity is public ledger data; no off-chain PII, no doxxing.
- **No stable per-wallet identifier in the rendered feed.** Each move is "a large wallet" with a **size band only** — no `walletId`, no username, no cross-event linkage a user can pin to a single entity. **Stable handle + per-move stream = a de-facto copy-trading / surveillance product**, regardless of disclaimer, so it is removed from the rendered payload. Any linkage needed for server-side dedup stays **server-side only** (keyed on `rankEpoch` + unit + size band, not a client-visible wallet id). If a per-entity dedup id is ever truly required client-side, it must be a **random per-feature opaque id mapped server-side, rotated**, never a hash of the address.
- **A hash of a stake address is NOT anonymizing.** The active-DEX-trader address space is small and public, so a hash is enumerable/reversible. We therefore do not ship even a hashed handle as a privacy guarantee; we ship **no persistent handle at all**.
- **No `txHash` / explorer deep-link in third-party move payloads.** One click from "a large wallet moved 52,000 ADA into SNEK" + `txHash` resolves on any explorer to the full address, holdings, and entire trade history — re-enabling the exact targeting/harassment/profiling §7 aims to prevent. Verifiability, if needed, is provided by an **aggregate methodology page** ("how we detect large moves"), not a per-event link to a specific wallet's tx.
- **No tracking the user's OWN wallet into this universe.** The job ranks the public trader population; the user's own wallet stays on the existing gero-sync per-user push path (`2026-04-07-gero-sync.md:7`), separate.
- **Infrastructure addresses are excluded, not surfaced.** CEX/batcher/treasury/script addresses are filtered out by §3 (this is also the privacy-correct outcome: we do not "report on" a multisig treasury as if it were a person).
- **Opt-in by category.** `whales` defaults off (`preferences.ts:53`); the user explicitly enables it.

---

## 8. PHASING / MVP / EFFORT

**Phase 0 — Client scaffolding behind the existing flag (Quick).** No backend dependency. On `feat/copilot-agent`: add detector stubs (`detectLargeMoves`, `detectTokenActivitySpikes`), narration keys (EN+DE), the **structural noAdvice i18n-namespace scan + extended forbidden list** (8), `buildLargeMoveItems`/`buildTokenAnomalyItems`, `useCopilotFeed` merge — all gated by `categories.whales` (already `false`). Ships dark; green on `noAdvice.spec.ts`/`detectors.spec.ts`. **Effort: Quick.**

**Phase 1 — Token-level anomaly MVP, NO wallet identity (Short, backend-light, genuinely unblocked).** Ship endpoint (C) `token-activity/anomalies` from the **already-returned** `txnCount24h`/`makerCount24h`/`volume24h` fields, rendered via `tokenActivitySpike`. This is the smallest honest shippable slice and needs **no attribution, no PnL, no identity** — so it is immune to the `top-traders`/`dex_events` unknowns. **Effort: Short.**
> The draft's "use the existing `top-traders` endpoint" MVP is **deleted**: it is BLOCKED on two unverified facts — (a) is `top-traders` exposed through the Nexus device-auth proxy at all (today it is a website-only row), and (b) does its payload carry a stake/payment identity or only aggregate counts. Both are hard gates (Q-TT). If (b) is "counts only," that path is impossible. Phase 1 above deliberately needs none of it.

**Phase 2 — T0 large-move attribution + ranking job + anti-manipulation (Medium-to-Large, backend).** cardano-market-data builds: whole-chain swap-by-stake aggregation in Postgres (net-new ETL if absent, Q-AGG), both-sides `dex_events` attribution (recipient coverage confirmed first, Q-DEX), the wash/sybil/batcher/liquidity/sustained-history filters (§3), rank by T0 size, serve (A)+(B) (cached, 15–30 min; moves polled on client tick). Nexus forwarding allow-list entries added (Q-NEXUS). Client flips `whales` on. **Still no profit numbers, no rank rendered, no handle, no txHash.** **Effort: Medium-to-Large** (the anti-manipulation + both-sides attribution are the bulk; client already wired in Phase 0). If Q-DEX/Q-AGG come back negative, Phase 2 stays blocked and the product remains at Phase 1 (T-base) honestly.

**Phase 3 — third-party realized PnL: NOT PLANNED (removed).** Cut for both correctness (sign-flips on today's data; depends on unshipped `dex_events` classification + historical-price backfill + unconfirmed recipient coverage) and no-advice grounds (a wallet's past success attached to a current move is a copy-trade signal). Realized/ROI/win-rate stays confined to the **user's own** portfolio card. T2 leaderboards are out of scope indefinitely.

---

## 9. VALIDATION GATES (exit criteria per phase — nothing ships without these)

Given the verified +24,911 ADA phantom-gain history, no ranked/attributed surface ships without ground-truth checks:

- **G-base (Phase 1):** anomaly thresholds tuned on historical token data so spikes aren't constant noise; identity-free by construction (no wallet validation needed).
- **G-wash (Phase 2):** construct a self-funding 2-wallet ring on testnet/replay; assert the ranking job excludes it.
- **G-sybil (Phase 2):** split one entity across 3 stake keys; assert the cluster heuristic collapses them to one (or drops them).
- **G-batcher (Phase 2):** assert known batcher/CEX/script addresses never appear as "wallets."
- **G-net (Phase 2):** assert the surfaced number equals net position delta with routing legs excluded (not gross single-swap volume) on a known multi-hop tx.
- **G-coherence (Phase 2):** assert a move detected near a ranking-epoch boundary narrates against the epoch that qualified it (no stale-label race).
- **G-noadvice (all phases, CI):** the structural i18n-namespace scan (every `copilot.feed.*` key in EN+DE) plus extended forbidden list is green; assert no rendered payload field carries `smart`/`profitable`/`top trader`/`rank`/`walletId`/`txHash`.
- **G-golden (gate for ANY realized number, i.e. the user's own card and any hypothetical future third-party tier):** hand-reconstruct true cost basis for 5–10 stake addresses including the bug-doc fixture (`stake1u86ndjr…` with its known-wrong +24,911 output); ship nothing until that wallet reports correctly AND `priceLookupFallbackCount === 0`.

---

## 10. BACKEND ASKS (precise, gating)

For the **cardano-market-data / Nexus** team:

- **Q-AGG (gates Phase 2):** Does a whole-chain **swap-by-stake aggregation exist in Postgres that does NOT call Blockfrost**? `getPnl` is per-request Blockfrost (200-tx cap) and must NOT be fanned across candidates. If absent, confirm this is **net-new ETL**, not a query.
- **Q-DEX (gates Phase 2, and absolute gate for any realized number):** Does `dex_events` store the **recipient stake/payment address** directly, or must we join transaction outputs? Confirm coverage and behavior for **batched batcher txs** (may be ambiguous/unreconstructable per acquisition doc `:228,277`). Does it (or can it) attribute **both sides** of a swap (token recipient AND ADA source) for wash detection?
- **Q-TT (gates the deleted top-traders path; informational):** Is `/api/dex/tokens/{policy}/{name}/top-traders` (a) reachable via `VITE_NEXUS_URL` device-auth proxy at all (today a website-only row, parity report `:41,107`), and (b) does its payload carry a per-trader stake/payment identity or only aggregate counts? YES/NO on both. (If NO, Phase 1 already routes around it.)
- **Q-NEXUS (gates Phase 2 exposure):** New `/api/market/large-moves/*` and `/token-activity/anomalies` routes require **explicit Nexus forwarding allow-list entries** (per the `sparklines`/`snekfun` bypass at `market-api.ts:287,298`). Confirm forwarding + device-auth coverage; without it routes hit the unauthenticated public backend.
- **Q-LABELS:** Owns the **known-entity exclusion list** (CEX/batcher/treasury/script) and the **sybil-cluster heuristic**? No labeling source exists in the wallet repo. The job needs these to avoid ranking infrastructure/sybils as "wallets."
- **Q-JOB:** Where does the ranking cron live (inside cardano-market-data vs sibling worker reading its DB)? Reuse the proposed PnL background-job + Caffeine-cache pattern (`market-api-backend-requirements.md:115-120`). Cadence 15–30 min; moves served from cache, **no WebSocket** (a market-wide WS does not exist and is out of scope).
- **Q-FLAGS (`costBasisComplete` semantics):** Confirm `costBasisComplete`/`unknownQuantity` semantics — they currently report processing completeness, not cost-basis correctness (true on the phantom-gain wallet). The honest predicate for any realized number is `priceLookupFallbackCount === 0` AND all disposed lots `acquisitionType === SWAP` with swap-derived cost. Expose such a field.

For the **gero-sync** team:

- **Q-SYNC:** Confirm gero-sync stays **strictly** the subscribed-wallet push channel. Candidate attribution is **NOT** routed through `BlockTransactionListener` (its registry covers only subscribed clients, `2026-04-07-gero-sync.md:7`); it lives in cardano-market-data `dex_events`. Confirm no cross-service write is expected of gero-sync.

---

### Summary

Ship a **neutral "large on-chain moves" feed**, not a "smart money / profitable wallet" tracker. The honest, genuinely-unblocked MVP is **token-level anomalies with no wallet identity** (Phase 1, from fields that already exist). Wallet-attributed large moves (Phase 2) are **size-and-direction only**, computed **entirely backend-side from an indexed swap aggregation (never by fanning Blockfrost PnL)**, with **wash/sybil/batcher/liquidity/sustained-history filters as first-class requirements**, and rendered with **no rank, no stable handle, no txHash, no track record**. Third-party realized PnL/ROI is **cut, not deferred** — on correctness grounds (today's PnL sign-flips; the `costBasisComplete` flag is insufficient) and no-advice grounds (a winning wallet's move is a copy-trade signal). The no-advice guarantee is made **structural** (i18n-namespace scan + extended forbidden vocabulary), privacy is protected by **emitting no persistent wallet identifier and no txHash**, and every phase has explicit **validation gates** anchored on the known phantom-gain fixture. Precise backend gates: Q-AGG (Blockfrost-free aggregation), Q-DEX (recipient + both-sides attribution), Q-NEXUS (proxy allow-list), plus entity/label ownership and cron placement.