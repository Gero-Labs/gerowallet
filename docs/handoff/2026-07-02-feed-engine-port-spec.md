# Copilot Feed Engine - Port Spec v1 (self-contained)

**Purpose:** the single stable source for porting the proactive feed's pure engine to another client (iOS Swift first). Everything the extension does is inlined here verbatim, so you do NOT chase `src/services/copilot/*` or `us.ts`/`de.ts` line numbers that keep moving. This resolves the fidelity caveat in the iOS P2 port (the chill/spicy price variants, the German strings, the exact no-advice regex list, and the dedupe rules were previously pointer-only).

**Versioning:** v1, extracted from `feat/copilot-agent` as of the token-activity-spike feature (commit `73cc0def`) plus the hardened no-advice scan. If the extension changes any value here, this doc's version bumps and the change is called out; treat a mismatch between your port and this doc as a deliberate protocol change, not a bug to silently fix.

**No I/O in the engine:** detectors, the narrator, the reducer, and the no-advice scan are pure (no clock, no randomness, no network). Given identical inputs, both clients MUST produce identical events, keys, and strings. The only impurity is the caller supplying `now` and the market data.

---

## 1. Detectors

### 1a. Price moves (held + watched tokens)

Input per token: `{ unit, ticker, held: bool, priceChange24h: number|null, priceChange7d: number|null }`.
Thresholds come from the vibe (section 4). Logic:

- Consider the 24h and 7d windows. A window is a candidate only if its threshold is set AND its change is non-null.
- Keep windows whose `abs(change) >= threshold`.
- If none clear, emit nothing for this token.
- Otherwise pick the window with the LARGEST `abs(change)` (ties: 24h before 7d by array order). Emit exactly ONE event per token.
- Event: `kind = change >= 0 ? "priceUp" : "priceDown"`, `window = "24h"|"7d"`, `pct = round(abs(change))`.
- Dedupe key: `"{kind}:{window}:{unit}:{bucket}"` (bucket in section 3). Example: `priceUp:24h:<unit>:2026-07-02`.

### 1b. Token activity spike (identity-free, the "Big moves" category)

Input per token: `{ unit, ticker, volume24h: number|null, volume7d: number|null }`. Options (live values): `spikeMultiple = 4`, `minVolume24h = 50000` (ADA), `limit = 5`.

- Skip tokens with `volume24h == null` or `volume7d == null` (no baseline).
- Skip if `volume24h < minVolume24h`.
- `dailyAvg = volume7d / 7`; skip if `dailyAvg <= 0`.
- `mult = volume24h / dailyAvg`; skip if `mult < spikeMultiple`.
- Event: `kind = "tokenActivitySpike"`, `mult = round(mult)`.
- Dedupe key: `"tokenActivitySpike:{unit}:{bucket}"`.
- After collecting, sort by `mult` descending and keep the top `limit` (5).

This is aggregate, identity-free (no wallet), and uses only fields the bulk price list already carries.

---

## 2. Vibe -> thresholds (the sensitivity dial)

| vibe | pct24h | pct7d |
|---|---|---|
| chill | 25 | 40 |
| normal | 15 | 25 |
| spicy | 8 | 15 |

Unknown/missing vibe falls back to `normal`. Vibe changes sensitivity AND narration tone (section 5), never adds advice.

---

## 3. Time bucket + dedupe + cap (the reducer)

- **Bucket:** the day string `YYYY-MM-DD` from the caller's `now` (UTC), i.e. `ISO8601(now).prefix(10)`. It keeps a given move stable within a day so the same move does not re-post.
- **FeedItem shape:** `{ id, key, ts, textKey, params }` where `id == key` (the dedupe key), `ts` = caller `now` in ms, `textKey` = the i18n key (section 5), `params` = `{ticker, pct, window}` for price or `{ticker, mult}` for spike.
- **Reducer** (`addFeedItems(state, incoming, max)`), pure, `max = 50`:
  - `fresh = incoming` filtered to keys NOT in `state.seen`.
  - `items = fresh.sortedBy(ts desc) ++ state.items`, then take the first `max`.
  - `seen = (state.seen ++ fresh.keys)`, then keep the LAST `max`.
  - State is `{ items (newest-first), seen (oldest-first, capped) }`.

So dedupe is by `key` against a rolling seen-set capped at 50; items are newest-first, capped at 50.

---

## 4. Narrator

`textKey` derivation from an event + vibe:
- `prefix = vibe == "normal" ? "" : vibe + "."`.
- Price: `scope = held ? "held" : "watched"`; `dir = kind == "priceUp" ? "Up" : "Down"`; `textKey = "copilot.feed." + prefix + scope + "Price" + dir`.
- Spike: `textKey = "copilot.feed." + prefix + "tokenActivitySpike"`.

So `normal` uses the unprefixed keys; `chill`/`spicy` prefix them. Params are substituted into the template (`{ticker}`, `{pct}`, `{window}`, `{mult}`).

### 4a. English templates (verbatim)

```
copilot.feed.heldPriceUp        = "{ticker} is up {pct}% ({window}). just a heads up, it is in your bags."
copilot.feed.heldPriceDown      = "{ticker} is down {pct}% ({window}) - one of your bags moved."
copilot.feed.watchedPriceUp     = "{ticker} (on your watchlist) is up {pct}% ({window})."
copilot.feed.watchedPriceDown   = "{ticker} (on your watchlist) is down {pct}% ({window})."

copilot.feed.chill.heldPriceUp        = "{ticker} is up {pct}% ({window}). it is in your bags."
copilot.feed.chill.heldPriceDown      = "{ticker} is down {pct}% ({window}). one of your bags."
copilot.feed.chill.watchedPriceUp     = "{ticker} (watchlist) is up {pct}% ({window})."
copilot.feed.chill.watchedPriceDown   = "{ticker} (watchlist) is down {pct}% ({window})."
copilot.feed.spicy.heldPriceUp        = "ok, {ticker} is up {pct}% ({window}). one of your bags is having a moment."
copilot.feed.spicy.heldPriceDown      = "oof, {ticker} is down {pct}% ({window}). one of your bags felt that."
copilot.feed.spicy.watchedPriceUp     = "{ticker} (watchlist) is up {pct}% ({window}), that is a real move."
copilot.feed.spicy.watchedPriceDown   = "{ticker} (watchlist) is down {pct}% ({window}), big swing."

copilot.feed.tokenActivitySpike        = "unusual trading volume in {ticker} right now, about {mult} times its weekly average."
copilot.feed.chill.tokenActivitySpike  = "fyi, {ticker} is trading more than usual, about {mult} times its weekly average."
copilot.feed.spicy.tokenActivitySpike  = "ok, {ticker} volume is spiking, about {mult} times its weekly average. noted."
```

### 4b. German templates (verbatim; spelled-out umlauts oe/ae/ue/ss)

```
copilot.feed.heldPriceUp        = "{ticker} ist {pct}% gestiegen ({window}) - liegt in deinem Wallet."
copilot.feed.heldPriceDown      = "{ticker} ist {pct}% gefallen ({window}) - eine deiner Positionen hat sich bewegt."
copilot.feed.watchedPriceUp     = "{ticker} (auf deiner Watchlist) ist {pct}% gestiegen ({window})."
copilot.feed.watchedPriceDown   = "{ticker} (auf deiner Watchlist) ist {pct}% gefallen ({window})."

copilot.feed.chill.heldPriceUp        = "{ticker} ist {pct}% gestiegen ({window}). liegt in deinem Wallet."
copilot.feed.chill.heldPriceDown      = "{ticker} ist {pct}% gefallen ({window}). eine deiner Positionen."
copilot.feed.chill.watchedPriceUp     = "{ticker} (Watchlist) ist {pct}% gestiegen ({window})."
copilot.feed.chill.watchedPriceDown   = "{ticker} (Watchlist) ist {pct}% gefallen ({window})."
copilot.feed.spicy.heldPriceUp        = "ok, {ticker} ist {pct}% gestiegen ({window}). eine deiner Positionen hat gerade einen Lauf."
copilot.feed.spicy.heldPriceDown      = "autsch, {ticker} ist {pct}% gefallen ({window}). eine deiner Positionen hat das gespuert."
copilot.feed.spicy.watchedPriceUp     = "{ticker} (Watchlist) ist {pct}% gestiegen ({window}), echte Bewegung."
copilot.feed.spicy.watchedPriceDown   = "{ticker} (Watchlist) ist {pct}% gefallen ({window}), grosser Ausschlag."

copilot.feed.tokenActivitySpike        = "auffaellig hohes Handelsvolumen bei {ticker} gerade, etwa {mult} mal so hoch wie der Wochendurchschnitt."
copilot.feed.chill.tokenActivitySpike  = "fyi, {ticker} wird gerade mehr gehandelt als sonst, etwa {mult} mal der Wochenschnitt."
copilot.feed.spicy.tokenActivitySpike  = "ok, das Volumen von {ticker} zieht an, etwa {mult} mal der Wochenschnitt. notiert."
```

### 4c. Feed chrome (not narration; reuse or localize as UI)

```
EN: copilot.feed.disclaimer = "Observations, not financial advice. DYOR."
    copilot.feed.empty      = "Nothing notable yet. Pull to refresh."
DE: copilot.feed.disclaimer = "Beobachtungen, keine Finanzberatung. DYOR."
    copilot.feed.empty      = "Noch nichts Bemerkenswertes. Zum Aktualisieren ziehen."
```

---

## 5. No-advice scan (the test gate)

Rule: scan EVERY string the narrator can emit (all templates in 4a + 4b, both languages) against the forbidden lists below. Any match is a build failure. The chrome strings in 4c are intentionally excluded (the disclaimer references "advice" in order to negate it). This is the exact list the extension's `noAdvice.spec.ts` enforces. Patterns are JS regex, all case-insensitive (`i`); translate faithfully to NSRegularExpression. `['’]?` means an optional straight-or-curly apostrophe. `\b` is a word boundary. `\d+x` catches "5x" style.

**EN forbidden:**
```
\bbuy\b  \bsell\b  \bhold\b  \bape\b  \bexit\b  get in  get out
\bshould\b  shouldn['’]?t  \bwill\b  won['’]?t  \bmoon\b  \bdump\b
\bpump\b  \brug\b  \bzero\b  \b\d+x\b  \btarget\b  good for (you|your)
\bsuitable\b  right for you  recommend  \bhurry\b  last chance
don['’]?t miss  now!
\bfollow\b  \bcopy\b  smart money  whale alert  top trader  \bprofitable\b
```

**DE forbidden:**
```
kaufen  \bkauf\b  verkaufen  verkauf  halten  sollst  solltest
wirst  \braus\b  aussteig  einsteig  \brein\b  \bmond\b  \bnull\b
\bziel\b  \bpump\b  \bdump\b  geeignet  passt zu deinem  empfehl
jetzt zugreifen  beeil  letzte chance  verpass
folg  kopier  nachkauf
```

Self-tests worth keeping (yours already do this): the scanner MUST catch "should buy now!", "5x", "smart money", "Empfehlung"; and MUST NOT overfire on legitimate words like "holders" (contains "hold" but is not word-bounded... note `\bhold\b` is bounded, so "holders" is safe) or plain observations.

---

## 6. Category labeling

The category that carries the spike + (future) big-move events is labeled neutrally: EN "Big moves", DE "Grosse Bewegungen". NEVER "smart money", "profitable", "top trader". This is a hard rule (design: `docs/plans/2026-06-29-smart-money-large-moves-design.md`), and the no-advice scan enforces the vocabulary.

---

## 7. Out of scope for this doc (still moving / later)

- Wallet-attributed big moves (Phase 2, needs backend `dex_events` attribution). The identity-free spike above is all that ships now.
- The feed onboarding wizard + vibe/category settings UI and the preferences store (that is UI + persistence, not the pure engine).
- Locales beyond EN/DE (they fall back to EN).

If you need a value that is not inlined here, ask rather than reading extension source; the source moves, this doc is the contract.
