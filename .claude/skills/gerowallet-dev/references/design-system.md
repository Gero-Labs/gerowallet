# Design system and the ratchet

One token layer, four surfaces, chain accent as the only per-chain colour, enforced by two pure-Node scripts that run in both the pre-commit hook and a required CI check.

## The ratchet has no headroom

```bash
node scripts/design/audit.mjs      # 15 metrics vs scripts/design/budgets.json
node scripts/design/contrast.mjs   # 56 WCAG checks
npm run design:check               # both, ~2s - what CI runs
```

Current state (verified): all 15 pass, and **12 of them sit at exactly their budget**:

```
hexOccurrences 779/779   hexDistinct 287/287   fontSizeDistinct 75/75
radiusDistinct 60/60     zIndexDistinct 22/22  uppercase 108/108
lowAlphaText 19/19       transitionAll 8/8     clickableDivs 106/106
outlineNone 26/26        corruptedMdiNames 0/0 formatFnForks 15/15
```

Only `backdropFilters` (83/89), `infiniteAnimations` (68/69) and `importantCount` (2025/2061) have slack.

So: **one** new hex literal, border-radius, font-size, z-index, `text-transform: uppercase`, low-alpha white text, `transition: all`, clickable `<div>`, `outline: none` or forked formatter blocks your commit *and* the `Production bundle (SFC parse)` required check.

Two different file sets, which is the source of most confusion:

- **Style metrics** (hex, font-size, radius, z-index, uppercase, backdrop-filter, animations, `!important`, low-alpha text, `transition: all`, clickable divs, `outline: none`, mdi names) walk `src/**/*.{vue,scss,css}`.
- **`formatFnForks`** walks `src/**/*.{ts,vue}` minus `src/shared/utils/format.ts`.

Both exclude `src/vendor` and `src/node_modules`. Files under `test/` are never scanned, so a real hex literal in a test costs nothing.

So a `.ts`-only diff cannot move `hexOccurrences`, and a `<script setup>` block inside a `.vue` file **is** scanned for forked formatters.

### The three ways it fails on a diff that looks innocent

1. **A PR or issue reference in a comment in a `.vue`, `.scss` or `.css` file.** The hex regex is `/#[0-9a-f]{3,8}\b/gi` with no CSS-context awareness, so `// see #1122` counts as a hex colour and usually bumps both `hexOccurrences` and `hexDistinct`. **Write `PR 1122` / `issue 1122`.** Never rebaseline for this. (In a `.ts` file it is harmless, but write it the same way out of habit - code moves between files.)
2. **Whitespace in a declaration.** `fontSizeDistinct` and friends count normalized declaration *strings*, and normalization only lowercases and collapses whitespace runs. `font-size:12px` (no space) is a different string from `font-size: 12px`. Copy the exact spelling that already exists.
3. **Merge composition.** Each branch passes its own hook while slightly under budget; after several squash-merge, `development` is over and every subsequent commit fails with nobody's diff at fault. After merging a batch, run the audit on the updated base.

### Recovery

```bash
node scripts/design/audit.mjs 2>&1 | grep OVER    # which metric did you move?
```

Then tokenize the value. If you genuinely made a net reduction:

```bash
node scripts/design/audit.mjs --write             # ratchets budgets DOWN only; refuses to raise anything
```

Raising a budget needs an explicit, justified act:

```bash
node scripts/design/audit.mjs --rebaseline --reason="a token's legitimate first use"
```

`--rebaseline` refuses without a non-empty `--reason`, and refuses when nothing is over budget. Justify it in the commit message too.

**After any `--write` or `--rebaseline`, run the plain audit again.** Those modes exit 0 even when the tokens.css / _tokens.scss sync check has failed; the desync only surfaces on the next plain run.

## Tokens

- `src/shared/styles/tokens.css` is **canonical** (101 lines of `--g-*` custom properties).
- `src/shared/styles/_tokens.scss` is a hand-maintained **mirror**, auto-`@import`ed into every SFC `<style lang="scss">` block by Vite, so `$g-*` sass vars are available without an import. Every `$g-foo` must have a `--g-foo` with an equal value, or the audit hard-fails.
- `src/shared/styles/baseline.css` loads after Vuetify: the type ramp (`.t-display/.t-title/.t-heading/.t-body*/.t-caption/.t-label`), `.g-num` (tabular), `.g-mono`, `.delta-up`/`.delta-down`, the focus ring, `.g-skeleton`, and the reduced-motion collapse.

Surfaces: `--g-canvas` #000, `--g-surface`, `--g-raised`, `--g-overlay`, with hairlines `--g-hairline-1/2/3`. Text tones `--g-text-1/2/3` - never white below 0.6 alpha, use `--g-text-3`. Scale tokens: `--g-r-chip/control/card/sheet/pill`, `--g-s-1..6`, `--g-dur-fast/base/slow`, `--g-z-sticky/dock/sheet/toast`.

`html`-prefixed selectors in `baseline.css` are load-bearing, not decoration: Vuetify's CSS is emitted twice and the second copy lands after `baseline.css`, so a tying `(0,2,0)` rule loses on source order.

## Chain accent

The chain accent is the only per-chain colour. `useChainAccent()` is the **sole writer** of `--g-accent`, `--g-grad-1/2`, `--g-on-grad` and the legacy `--chain-*` aliases. It is bootstrapped exactly once per page (`src/options/App.vue`, and the side panel via `useChainContext`); a module-level latch makes a second call a no-op. Palettes live in `src/config/themes.ts` (`chainAccents`, `chainKeyFor`).

Never hardcode a chain hex. Gradients belong only on sanctioned slots: the primary CTA, the active nav indicator, the chain dot, the header hairline.

Note `contrast.mjs` checks the legacy `apex` key, not `apexPrime`/`apexVector`, so those two are unguarded - check them by hand if you touch them.

## Primitives

- **`GButton`** - four tiers: `primary` (the one gradient CTA), `secondary` (outlined neutral), `tertiary` (text-only accent), `destructive`. Plus a `compact` height and a `--g-btn-fg` seam so consumers change the foreground without out-specifying its rules.
- **`BaseDialog`** - THE modal primitive. `size` maps to token widths (sm 420 / md 560 / lg 720 / xl 960), house `g-dialog-transition`, esc and scrim close by default. `persistent` is only for flows where dismissing loses mid-flight state.
- **`src/shared/utils/format.ts`** - the single home for `formatCompact`, `formatInt`, `formatBalance`, `formatPriceRaw`, `formatPrice`, `formatUsd`, `formatChange`, `formatSignedChange`. **Do not fork these**; `formatFnForks` is at budget, so a new local `formatPrice` blocks the commit.
  Deltas: render with `formatSignedChange()` (the glyph carries direction) and carry colour with the `delta-up` / `delta-down` classes. Do not import `changeColor()` for that - it returns hardcoded hexes that cannot follow a token change.

## Vuetify traps

- **`v-select`, `v-autocomplete`, `v-combobox` always need the `attach` prop**, or the menu detaches from its activator on scroll. Convention only - nothing enforces it.
- **`v-tooltip` always takes `content-class="custom-tooltip"`**, or it renders with Vuetify defaults.
- **Unscoped `<style>` blocks are global.** The build sets `cssCodeSplit: false`, so every unscoped block applies app-wide. A rule on a short class name like `.warning`, `.info`, `.card` or `.check` collides with Vuetify's own colour helper classes - `color="warning"` puts the bare class `warning` on the element. Use `<style scoped>` and a component-prefixed BEM name (`.ps-widget__toggle-btn`). Reach for unscoped only for a `v-html` prose recipe or a deliberate global, and namespace it.
- **`@click="handler"` passes the Event as the first argument**, clobbering default parameters. Use `@click="handler()"` when the function has defaults, or you will set a boolean to a `MouseEvent`.
- **Disabled states need `!important`** and must out-specify Vuetify, because an override flag beats an unflagged declaration at any specificity. Enabled states do not.
- **Scoped selectors cannot reach Vuetify's detached dialog root.** A `content-class` rule must live in an unscoped block, with a unique name.
- **Side panel**: a `BottomSheet` nested inside another one is trapped by `will-change: transform` + `overflow: hidden` on the parent, and Vue 2.7 has no `<Teleport>`. Use a Vuetify-detached `v-bottom-sheet` instead - `KeystoneSignSheet.vue` is the worked example.
- **`ContentLayout` is a natural-flow scroll page.** A full-height route root needs a definite `height: calc(100vh - 80px)`; `height: 100%` resolves to auto and `min-height` does not let a child's `height: 100%` resolve. The side panel's `MiniLayout` is a proper flex column, so this is a ContentLayout-only trap.

## Motion

Motion is feedback, not decoration. Keep spinners, the ~1.4s skeleton shimmer, typing indicators and status/sync pulses. Delete decorative loops (glow, breathe, float, aurora, colour-shift). Durations resolve to `--g-dur-*`. Prefer explicit `transition` property lists over `transition: all`, and never comma-list properties with one trailing duration - that animates only the last one.

## Working rule

Any file you touch leaves the ratchet at or below where you found it.
