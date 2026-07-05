# Implementation Plan: Copilot Feed Onboarding + Tuning

**Plan file**: `docs/plans/2026-06-28-copilot-feed-onboarding-tuning.md`
**Format basis**: `docs/plans/2026-06-26-copilot-plan-2-proactive-feed.md`
**Branch**: continue on `feat/copilot-agent`

## Guiding principles (locked)

- **No financial advice, ever.** Vibe (chill/normal/spicy) changes TONE only. No buy/sell/hold/should/will/moon/dump/ape/exit/get-in/get-out/target/Nx/pump/rug/suitability tokens in any narration string, including spicy. Enforced by a dedicated no-advice test scoped to NARRATION KEYS ONLY (Task 11) — disclaimer/subtitle copy is intentionally allowed to reference the forbidden concepts in order to negate them, so it is excluded from the scan (see Task 11 scoping decision).
- **No background polling.** Detection stays on-demand: `onMounted` refresh (gated on `onboardingDone`) + manual refresh button + vibe-change re-read on next refresh. No timers introduced beyond the existing 300ms storage write-debounce.
- **i18n**: every user-facing string via `$t()`; new keys added to BOTH `us.ts` and `de.ts`; reuse `copilot.feed.disclaimer`, `copilot.feed.empty`, `copilot.feedTitle`, existing 4 price templates as the `normal` family. German uses spelled-out umlauts (`oe/ae/ue/ss`).
- **Pure-TS = TDD** (failing test → run → minimal impl → run → commit). `.vue` / store / chrome-glue = `npm run typecheck` + `npm run build` + manual checks.
- **Both surfaces** (sidepanel + options/dashboard) are satisfied because `FeedPage.vue` is the shared route component for both (`src/sidepanel/router.ts:14`, `src/modules/navigation/router.ts:129-137`). New wizard/sheet/settings components MUST be surface-agnostic. New components live under `src/sidepanel/components/copilot/` (the existing convention already has the dashboard importing `@/sidepanel/...`; we keep that single established pattern). Two cross-surface portability hazards are explicitly handled in this plan: (a) the sidepanel must gain a BottomNav Feed entry or it is unreachable (Task 0), and (b) the StrikeOnboarding glass CSS depends on `--chain-primary` which is sidepanel-only — every new component MUST supply a literal fallback `var(--chain-primary, #5b8def)` (Tasks 7-9) and Task 12 QA verifies dashboard accent visibility.

---

## Data model (locked shapes)

```ts
// src/services/copilot/preferences.ts
export type CopilotVibe = 'chill' | 'normal' | 'spicy';

export interface CopilotCategoryFlags {
  bags: boolean;        // default true  — gates held refs (walletStore.tokens)
  watchlist: boolean;   // default true  — gates watched refs (useWatchlist)
  whales: boolean;      // default false — coming soon, no detector
  launches: boolean;    // default false — coming soon, no detector
  governance: boolean;  // default false — coming soon, no detector
}

export interface CopilotPrefs {
  vibe: CopilotVibe;
  categories: CopilotCategoryFlags;
  onboardingDone: boolean;
}
```

`PriceThresholds` is `{ pct24h?: number; pct7d?: number }` (`detectors.ts:10-13`), already consumed per-window by `detectPriceMoves` (`detectors.ts:38-43`). No detector signature changes.

**Vibe → thresholds (actual numbers):**
| Vibe | pct24h | pct7d | meaning |
|---|---|---|---|
| chill | 25 | 40 | big moves only (fewer items) |
| normal | 15 | 25 | == today's hardcoded const (`useCopilotFeed.ts:11`) |
| spicy | 8 | 15 | small moves (more items) |

---

## TASK LIST

### Task 0 — Sidepanel BottomNav Feed entry (reachability prerequisite) [build + manual]

**Why first:** The sidepanel currently has NO way to reach `/feed` — `src/sidepanel/components/BottomNav.vue` contains no feed/copilot entry (grep `feed|Feed|copilot` → no matches), even though `MiniLayout.vue:38` lists `'/feed': 5` in tabOrder. The dashboard is reachable (`NavigationDrawer.vue:329` link `/copilot-feed`); the sidepanel is reachable only by typing the URL. Onboarding "shows once" is meaningless on a surface the user cannot open, so this is a prerequisite, not a follow-up.

**Files (modify):**
- `src/sidepanel/components/BottomNav.vue`

Add a Feed tab: icon `mdi-bell-outline` (matches the dashboard `NavigationDrawer` affordance), route `/feed`, label via `$t('copilot.feedTitle')` (existing key). Place it consistent with `MiniLayout.vue:38` tabOrder position (`'/feed': 5`). Follow the existing BottomNav item shape exactly (read the component first; mirror its `to`/`:active`/icon/label structure and any active-state styling).

**Verify:** `npm run build`; manual: sidepanel dock shows the Feed tab and tapping it routes to `FeedPage`. **Commit**: `feat(copilot): sidepanel BottomNav feed entry`.

---

### Task 1 — Pure preferences module (vibe→thresholds, defaults, normalize) [TDD]

**Files (create):**
- `src/services/copilot/preferences.ts`
- `src/services/copilot/preferences.spec.ts`

**Public API:**
```ts
export const VIBE_THRESHOLDS: Record<CopilotVibe, PriceThresholds>;
export function thresholdsForVibe(vibe: string | undefined): PriceThresholds; // unknown → normal
export function defaultPrefs(): CopilotPrefs;
export function normalizePrefs(raw: unknown): CopilotPrefs; // clamp unknown/missing → defaults
```

**TDD steps:**
1. Write `preferences.spec.ts` asserting:
   - `thresholdsForVibe('chill')` → `{ pct24h: 25, pct7d: 40 }`; `'normal'` → `{ pct24h: 15, pct7d: 25 }`; `'spicy'` → `{ pct24h: 8, pct7d: 15 }`.
   - `thresholdsForVibe(undefined)` and `thresholdsForVibe('garbage')` → equals `normal` thresholds.
   - `defaultPrefs()` returns `{ vibe:'normal', categories:{bags:true,watchlist:true,whales:false,launches:false,governance:false}, onboardingDone:false }`.
   - `normalizePrefs(undefined)` deep-equals `defaultPrefs()`.
   - `normalizePrefs({ vibe:'spicy', categories:{ bags:false }, onboardingDone:true, junk:1 })` → vibe `spicy`, `bags:false`, all other categories defaulted, `junk` dropped.
   - `normalizePrefs({ vibe:'loud' })` → vibe falls back to `normal`.
   - Coming-soon flags can never be forced on if absent: `normalizePrefs({})` keeps whales/launches/governance `false`.
2. `npm run test -- preferences` → red.
3. Implement minimal `preferences.ts`.
4. `npm run test -- preferences` → green.
5. **Commit**: `feat(copilot): pure prefs model + vibe->thresholds map`.

**Why pure:** single source of sensitivity truth; replaces the const at `useCopilotFeed.ts:11`.

---

### Task 2 — Pure ref-builder with category filtering [TDD]

Extract the ref-building logic out of the composable (currently `defaultGetRefs`, `useCopilotFeed.ts:43-60`) into a pure, testable function so category gating is unit-covered (today it's only verifiable via build).

**Files (create):**
- `src/services/copilot/refBuilder.ts`
- `src/services/copilot/refBuilder.spec.ts`

**Public API:**
```ts
import type { TokenRef } from './marketSnapshot';
import type { CopilotCategoryFlags } from './preferences';

interface WalletTokenLike { unit?: string; name?: string; metadata?: { ticker?: string; name?: string } | null; }

export function buildRefs(
  tokens: Record<string, WalletTokenLike>,
  watchlistUnits: string[],
  categories: CopilotCategoryFlags,
): TokenRef[];
```

Logic mirrors the existing loops exactly (ticker resolution `t.metadata?.ticker || t.name || t.metadata?.name || unit.slice(0,6)`; `lovelace` excluded; `seen` dedupe set shared across both loops; held loop pushes `held:true`, watch loop pushes `held:false`, watch ticker = `unit.slice(0,6)`), but each loop gated:
```ts
if (categories.bags) { /* held loop */ }
if (categories.watchlist) { /* watch loop */ }
```
Coming-soon categories never enter `buildRefs` (no source, no detector) — correct by construction.

**TDD steps:**
1. Write `refBuilder.spec.ts`:
   - both on → held refs + watched refs, `lovelace` excluded, dedupe across loops (a unit held AND watchlisted appears once, as `held:true`).
   - `bags:false` → zero `held:true` refs, watched refs intact.
   - `watchlist:false` → zero `held:false` refs, held refs intact.
   - both off → `[]`.
   - ticker resolution precedence (metadata.ticker > name > metadata.name > unit prefix).
2. `npm run test -- refBuilder` → red.
3. Implement.
4. Green.
5. **Commit**: `feat(copilot): pure ref-builder with category gating`.

---

### Task 3 — Vibe-toned narrator + single-source narration key constant [TDD, extends existing spec]

**Files (modify):**
- `src/services/copilot/narrator.ts`
- `src/services/copilot/narrator.spec.ts`
- `src/services/copilot/feedEngine.ts` (thread `vibe` to `narrate`)

**Single source of truth for narration keys.** Export a const array from `narrator.ts` so the narrator, the no-advice scan (Task 11), and the parity/coverage scan (Task 11) all consume ONE list (prevents key-prefix typos surfacing as raw keys at runtime):
```ts
export const NARRATION_TEXT_KEYS = [
  'copilot.feed.heldPriceUp', 'copilot.feed.heldPriceDown',
  'copilot.feed.watchedPriceUp', 'copilot.feed.watchedPriceDown',
  'copilot.feed.chill.heldPriceUp', 'copilot.feed.chill.heldPriceDown',
  'copilot.feed.chill.watchedPriceUp', 'copilot.feed.chill.watchedPriceDown',
  'copilot.feed.spicy.heldPriceUp', 'copilot.feed.spicy.heldPriceDown',
  'copilot.feed.spicy.watchedPriceUp', 'copilot.feed.spicy.watchedPriceDown',
] as const;
```

**Signature change:**
```ts
export function narrate(event: FeedEvent, vibe: CopilotVibe = 'normal'): NarratedItem
```
textKey derivation:
```ts
const dir = event.kind === 'priceUp' ? 'Up' : 'Down';
const scope = event.held ? 'held' : 'watched';
const prefix = vibe === 'normal' ? '' : `${vibe}.`;
textKey = `copilot.feed.${prefix}${scope}Price${dir}`;
```
So `normal` keeps the EXISTING 4 keys (`copilot.feed.heldPriceUp` etc.) — the current `narrator.spec.ts` assertions at lines 11-24 stay green unchanged. `chill`/`spicy` produce `copilot.feed.chill.heldPriceUp` … (8 new keys).

**`feedEngine.ts` — append `vibe` as the LAST positional param** (after the injectable `fetchSnapshots`) so the EXISTING green `feedEngine.spec.ts` calls (`buildFeedItems(refs, { pct24h: 15 }, 'day-1', 1000, fetchSnapshots)` at lines 17 and 31) keep binding `fetchSnapshots` correctly and do NOT land the mock fetch in the vibe slot:
```ts
export async function buildFeedItems(
  refs, thresholds, bucket, now,
  fetchSnapshots = defaultFetch,
  vibe: CopilotVibe = 'normal',
): Promise<FeedItem[]>
```
Call `narrate(e, vibe)` at line 24.

**TDD steps:**
1. Extend `narrator.spec.ts`: keep the 2 existing tests; add — default vibe (omitted) still emits `copilot.feed.heldPriceUp`; `narrate(ev, 'normal')` identical to omitted; `narrate(ev({held:true,kind:'priceUp'}),'spicy')` → `copilot.feed.spicy.heldPriceUp`; `narrate(ev({held:false,kind:'priceDown'}),'chill')` → `copilot.feed.chill.watchedPriceDown`; params unchanged across all vibes (ticker/pct/window). Add an assertion that `NARRATION_TEXT_KEYS` contains exactly the 12 derivable keys (every vibe × scope × dir).
2. **Rewrite (not extend)** `feedEngine.spec.ts` lines 17 and 31 to keep passing `fetchSnapshots` as the 5th arg (unchanged, still valid under the LAST-param design); add one new test passing a 6th `vibe` arg and asserting the prefixed textKey flows through `narrate`. Confirm via grep that `useCopilotFeed.ts` and `feedEngine.spec.ts` are the ONLY callers of `buildFeedItems` before editing.
3. `npm run test -- narrator feedEngine` → red.
4. Implement narrator + feedEngine.
5. Green.
6. **Commit**: `feat(copilot): vibe-toned narration keys + NARRATION_TEXT_KEYS const (normal = existing)`.

**No-advice note:** narrator only SELECTS a key; the observational guarantee lives in the i18n strings (Task 11) and is enforced by Task 11's scan over `NARRATION_TEXT_KEYS`.

---

### Task 4 — Persisted prefs store (chrome.storage, both surfaces) [build-verified]

**Files (create):**
- `src/stores/copilotPrefsStore.ts`

Mirror `copilotFeedStore.ts:5-45` EXACTLY (plain `Vue.observable` + `hasChromeStorage` guard + load-on-init `if (saved)` + 300ms debounced `persist()`). Distinct `STORE_KEY = 'copilotPrefsStore'`. **No** `storeMessaging`/broadcast (prefs are UI-mutated only; copilot stores deliberately skip broadcast).

```ts
import Vue from 'vue';
import { defaultPrefs, normalizePrefs, type CopilotPrefs, type CopilotVibe } from '@/services/copilot/preferences';

const STORE_KEY = 'copilotPrefsStore';
export const copilotPrefsState = Vue.observable<CopilotPrefs>(defaultPrefs());
// hasChromeStorage guard + load: copilotPrefsState <- normalizePrefs(res[STORE_KEY]) when saved
// persist(): chrome.storage.local.set({ [STORE_KEY]: { ...copilotPrefsState } }), 300ms debounce

export const copilotPrefsStore = {
  state: copilotPrefsState,
  get vibe() { return copilotPrefsState.vibe; },
  get categories() { return copilotPrefsState.categories; },
  get onboardingDone() { return copilotPrefsState.onboardingDone; },
  setVibe(v: CopilotVibe) { copilotPrefsState.vibe = v; persist(); },
  setCategory(k: keyof CopilotPrefs['categories'], on: boolean) {
    copilotPrefsState.categories = { ...copilotPrefsState.categories, [k]: on }; // reassign for Vue2 reactivity
    persist();
  },
  completeOnboarding() { copilotPrefsState.onboardingDone = true; persist(); },
  resetOnboarding() { copilotPrefsState.onboardingDone = false; persist(); }, // user-facing "re-run setup" (Task 9)
  reset() { Object.assign(copilotPrefsState, defaultPrefs()); persist(); },
};
```

**Optional cross-surface live sync** (nice-to-have, off the critical path): a `chrome.storage.onChanged` listener guarded by `hasChromeStorage`. If included, it MUST ignore self-echoes (this tab's own writes re-fire `onChanged`) to avoid redundant normalize/assign churn — track a `writing` flag set around `persist()` or compare `newValue` to the current serialized state before assigning:
```ts
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local' || !c[STORE_KEY]?.newValue) return;
  const incoming = JSON.stringify(c[STORE_KEY].newValue);
  if (incoming === JSON.stringify({ ...copilotPrefsState })) return; // ignore our own echo
  Object.assign(copilotPrefsState, normalizePrefs(c[STORE_KEY].newValue));
});
```
Dropping this listener for v1 is acceptable; it is not required for onboarding correctness.

**Verify:** `npm run typecheck`. **Commit**: `feat(copilot): persisted prefs store (chrome.storage, no broadcast)`.

---

### Task 5 — Settings composable wrapping the store [TDD]

**Files (create):**
- `src/sidepanel/composables/useCopilotFeedSettings.ts`
- `src/sidepanel/composables/useCopilotFeedSettings.spec.ts`

Factory-with-deps mirroring `createCopilotFeed` (`useCopilotFeed.ts:62-84`) so tests inject a fake store (copy `fakeStore` idiom from `useCopilotFeed.spec.ts:6-18`).

```ts
interface PrefsStoreLike {
  vibe: CopilotVibe;
  categories: CopilotCategoryFlags;
  onboardingDone: boolean;
  setVibe(v: CopilotVibe): void;
  setCategory(k: keyof CopilotCategoryFlags, on: boolean): void;
  completeOnboarding(): void;
  resetOnboarding(): void;
  reset(): void;
}
export function createCopilotFeedSettings(deps?: { store?: PrefsStoreLike }) {
  // exposes: onboarded (getter), vibe, categories, setVibe, setCategory,
  //          completeOnboarding, resetOnboarding (re-run setup), reset (defaults),
  //          and a derived thresholds() => thresholdsForVibe(store.vibe)
}
export const copilotFeedSettings = createCopilotFeedSettings();
```

**TDD steps:**
1. Spec: `setVibe('spicy')` updates store + `thresholds()` returns spicy numbers; `setCategory('bags',false)` flips flag; `completeOnboarding()` sets onboarded true; `resetOnboarding()` sets onboarded false; `onboarded` reflects injected store.
2. Red → implement → green.
3. **Commit**: `feat(copilot): feed-settings composable (testable, deps-injected)`.

---

### Task 6 — Thread prefs into useCopilotFeed [build + spec-verified]

**Files (modify):**
- `src/sidepanel/composables/useCopilotFeed.ts`
- `src/sidepanel/composables/useCopilotFeed.spec.ts`

Changes:
1. Delete the const at line 11. Import `thresholdsForVibe` (Task 1), `buildRefs` (Task 2), `copilotPrefsStore` (Task 4).
2. Replace `defaultGetRefs` body to delegate to the pure builder:
   ```ts
   function defaultGetRefs(): TokenRef[] {
     const tokens = (walletStore.tokens || {}) as Record<string, WalletToken>;
     const { watchlist } = useWatchlist();
     return buildRefs(tokens, watchlist.value, copilotPrefsStore.categories);
   }
   ```
3. Extend `CopilotFeedDeps` with optional `prefs?: { vibe: CopilotVibe }` (default `copilotPrefsStore`). Update the `build` dep type to match the FINAL `buildFeedItems` order from Task 3 (vibe is the LAST param, after fetch): `(refs, thresholds, bucket, now, fetchSnapshots?, vibe?) => Promise<FeedItem[]>`. The default `build` closure must call `buildFeedItems(refs, th, bucket, now, undefined, vibe)` (pass `undefined` for fetch so `defaultFetch` is used, then vibe) — do NOT couple the assertion to a fragile positional index.
4. In `refresh()` (line 68-79) replace line 74:
   ```ts
   const vibe = prefs.vibe;
   const items = await build(getRefs(), thresholdsForVibe(vibe), bucket, now, undefined, vibe);
   ```
5. Keep `refresh()` on-demand only (no timer added).

**Spec updates** (`useCopilotFeed.spec.ts`): the existing 2 tests still pass (build is mocked); add a test injecting `prefs:{vibe:'spicy'}` and asserting `build` was called with the spicy thresholds `{pct24h:8,pct7d:15}` and `'spicy'` as the vibe arg. Assert by reading the named/last argument the mock received rather than a brittle index where possible. Inject a fake prefs store.

**Empty-feed behavior (both categories off):** `buildRefs` returns `[]`; `refresh()` still calls `build([], …)`; `buildFeedItems` early-returns `[]` for empty refs (`feedEngine.ts:20`). This is safe and intentional — the user sees the empty state. No code change needed; verified in Task 12.

**Verify:** `npm run test -- useCopilotFeed` green, `npm run typecheck`. **Commit**: `feat(copilot): wire vibe+category prefs into feed refresh`.

---

### Task 7 — FeedSettingsForm (shared inner controls) [build + manual]

**Files (create):**
- `src/sidepanel/components/copilot/FeedSettingsForm.vue`

The reusable body for BOTH the wizard "what to watch" step AND the re-tune sheet (single source of toggle/vibe UI). Props/emits keep it controlled so it works in either host. **Explicit prop contract** (note `vibeOnly`, required for wizard step 0 to hide categories):
```ts
defineProps<{
  vibe: CopilotVibe;
  categories: CopilotCategoryFlags;
  showVibe?: boolean;     // render the vibe chips
  vibeOnly?: boolean;     // when true, render ONLY vibe (hide categories + coming-soon)
}>()
defineEmits<{ (e:'update:vibe', v:CopilotVibe):void; (e:'update:category', k:keyof CopilotCategoryFlags, on:boolean):void }>()
```
Contents:
- **Vibe** (when `showVibe`): three selectable chips (`v-chip-group` with `column`, or hand-rolled chips) chill/normal/spicy with `$t('copilot.vibe.*')` label + `*Desc`; the `copilot.vibe.subtitle` "changes tone only" line.
- **Active categories** (hidden when `vibeOnly`): `v-switch` for `bags` (`copilot.category.bags`/`Desc`) and `watchlist` (`copilot.category.watchlist`/`Desc`). If `watchlistCount === 0` (from `useWatchlist`), show `copilot.category.watchlistEmpty` helper text (still toggleable).
- **Coming soon** section (hidden when `vibeOnly`; `copilot.category.comingSoon`): whales/launches/governance rendered as DISABLED rows (`disabled` switch, off, with a "coming soon" badge). Never settable on. No detector exists — never promise data.
- Any `v-select`/`v-autocomplete` (if used instead of chips) MUST have `attach`. Prefer chips to avoid dropdown-positioning issues entirely.
- **`--chain-primary` fallback:** any accent color (selected chip background/border) MUST use a literal fallback, e.g. `color-mix(in srgb, var(--chain-primary, #5b8def) 12%, transparent)`, so the component renders correctly on the dashboard surface where `--chain-primary` is never set (`useChainContext` is sidepanel-only).

**Verify:** `npm run build`. **Commit**: `feat(copilot): shared FeedSettingsForm (vibe + categories + coming-soon, vibeOnly mode)`.

---

### Task 8 — Stepped card wizard [build + manual]

**Files (create):**
- `src/sidepanel/components/copilot/FeedOnboarding.vue`

Hand-rolled 3-step card (NOT `v-stepper`/`CustomStepper` — wrong aesthetic). Copy the glass-card CSS from `StrikeOnboarding.vue:234-396`: `.onboarding-wrap`, `.onboarding-card` (glass gradient + `radial-gradient(... var(--chain-primary) 8% ...)`, `backdrop-filter: blur(32px) saturate(1.6)`, `border-radius:16px`), `.onboarding-icon-ring`/`.onboarding-icon` (68px ring), `.onboarding-title` (16px/700), `.onboarding-desc` (12px/opacity .5), `.connect-btn` (`<v-btn block depressed>`, height 42px, radius 10px, `color-mix(... var(--chain-primary) 12% ...)` bg, `text-transform:none`, weight 700).

**`--chain-primary` fallback (REQUIRED).** On the dashboard surface `--chain-primary` is undefined (`useChainContext.ts:64` sets it, and that composable is imported only under `src/sidepanel/`; FeedPage on `/copilot-feed` renders via ContentLayout where it never runs). `color-mix()` with an undefined custom property yields an invalid value → invisible CTA / missing accent / invisible active dot. EVERY use of `var(--chain-primary)` in this component (card accent radial-gradient, `.connect-btn` background, active progress-dot color) MUST carry a literal fallback: `var(--chain-primary, #5b8def)`. Task 12 includes a dashboard visual check for CTA/accent/dot visibility.

**State (hand-rolled, no v-stepper):**
```ts
const step = ref<0|1|2>(0); // 0=vibe, 1=what to watch, 2=done
function next(){ if(step.value<2) step.value++; }
function back(){ if(step.value>0) step.value--; }
```
**Progress dots** (USER DECISION — do NOT exist in StrikeOnboarding):
```html
<div class="wizard-dots">
  <span v-for="i in 3" :key="i" class="wizard-dot" :class="{ 'wizard-dot--active': step === i-1 }"
        :aria-label="$t('copilot.onboarding.stepDots', { current: step+1, total: 3 })" />
</div>
```
Active dot `var(--chain-primary, #5b8def)`, inactive `rgba(255,255,255,0.25)`.

**Persistent disclaimer footer (REQUIRED on EVERY step).** Section 6 requires every agent surface to carry the "not financial advice. DYOR." line, and the Skip exit path (steps 0/1) must not bypass it. Render `{{ $t('copilot.feed.disclaimer') }}` in the card shell OUTSIDE the per-step `v-if`, so it shows on steps 0, 1, and 2:
```html
<div class="onboarding-card">
  <!-- per-step content (v-if step===0 / 1 / 2) -->
  <div class="wizard-dots">…</div>
  <p class="wizard-disclaimer">{{ $t('copilot.feed.disclaimer') }}</p>
</div>
```

**Steps:**
- Step 0 (Vibe): title `copilot.onboarding.stepVibe` + `copilot.vibe.title`/`subtitle`; `<FeedSettingsForm :showVibe="true" :vibeOnly="true" :vibe="settings.vibe" :categories="settings.categories" @update:vibe="settings.setVibe" />` (vibeOnly hides categories). CTA `copilot.onboarding.next`.
- Step 1 (What to watch): title `copilot.onboarding.stepWatch`; `<FeedSettingsForm :showVibe="false" :vibe="settings.vibe" :categories="settings.categories" @update:category="settings.setCategory" />` (bags/watchlist switches + disabled coming-soon previews). Back (`copilot.onboarding.back`) + Next.
- Step 2 (Done): `copilot.onboarding.doneTitle`/`doneSubtitle`; CTA `copilot.onboarding.finish` → `emit('done')`.
- A `copilot.onboarding.skip` text-button on steps 0/1 also emits `done` (skip = accept defaults + mark onboarded). The persistent disclaimer footer guarantees Skip never bypasses the advice notice.

`@done` handler in parent calls `copilotFeedSettings.completeOnboarding()`. All copy via `$t()`.

**Verify:** `npm run build`; manual: load sidepanel with `onboardingDone:false`, walk 3 steps, dots advance, disclaimer visible on every step, finish marks onboarded. **Commit**: `feat(copilot): stepped card onboarding wizard (Strike aesthetic + dots + persistent disclaimer)`.

---

### Task 9 — Re-tune settings sheet (responsive container) [build + manual]

**Files (create):**
- `src/sidepanel/components/copilot/FeedSettingsSheet.vue`

**Responsive container decision (up front, not deferred).** `BottomSheet`'s overlay is `position:fixed` full-viewport at `height:80%` (`BottomSheet.vue:231-241`) — correct in the narrow sidepanel, a genuine UX defect on the full-width dashboard tab (it is the ONLY gear/settings path on the dashboard; `ContentLayout` has no feed gear and `MiniHeader`'s `@settings` is sidepanel-only and intentionally not reused). Render responsively:
- **Narrow / sidepanel** (`$vuetify.breakpoint.smAndDown`): `BottomSheet` (contract: `value`/`@input`/`@close`, `:title`, `:height`, default slot = body — verified `BottomSheet.vue:30-47`). `BottomSheet` imports only `vue` (`:28`) → portable to the dashboard tree.
- **Wide / dashboard** (`$vuetify.breakpoint.mdAndUp`): centered `v-dialog` (`max-width:480`, scrollable body). Any `v-select`/`v-autocomplete` inside MUST use `attach`.

Body (shared between both containers):
```html
<p class="grey--text">{{ $t('copilot.settings.subtitle') }}</p>
<FeedSettingsForm :vibe="settings.vibe" :categories="settings.categories" :showVibe="true"
                  @update:vibe="settings.setVibe" @update:category="settings.setCategory" />
<v-btn text @click="onReRunSetup">{{ $t('copilot.settings.rerun') }}</v-btn>  <!-- resetOnboarding() + close -->
<v-btn text @click="settings.reset">{{ $t('copilot.settings.reset') }}</v-btn>
<p class="grey--text">{{ $t('copilot.settings.disclaimer') }}</p>
```
`settings = copilotFeedSettings` (Task 5). `v-model` via `value`/`input`. `onReRunSetup()` calls `settings.resetOnboarding()` then emits `input:false` (closes the sheet) so the FeedPage branch (Task 10) re-renders the wizard — this is the concrete, user-facing "re-open onboarding" path. Changes persist immediately (store debounces); the next `feed.refresh()` (manual or remount) re-reads the new vibe/categories — no poller. Apply the `--chain-primary` literal fallback to any accent in this component too.

**Verify:** `npm run build`; manual: gear opens a correctly-sized, scrollable sheet in sidepanel AND a centered dialog on the dashboard. **Commit**: `feat(copilot): responsive re-tune feed settings sheet (+ re-run setup)`.

---

### Task 10 — FeedPage three-way branch + gear (BOTH surfaces) [build + manual]

**Files (modify):**
- `src/sidepanel/pages/FeedPage.vue`

Because this single component is the route target for sidepanel (`/feed`) AND dashboard (`/copilot-feed`), this one change serves both surfaces — NO router changes, NO `useMiniNavigation`/`MiniLayout` changes (wizard/sheet are in-page state, not routes).

Template:
```html
<div class="feed-page">
  <FeedOnboarding v-if="!settings.onboarded" @done="settings.completeOnboarding" />
  <template v-else>
    <header class="feed-page__head">
      <h2 ...>{{ $t('copilot.feedTitle') }}</h2>
      <div class="feed-page__actions">
        <v-btn icon small @click="settingsOpen = true"><v-icon small color="white">mdi-cog-outline</v-icon></v-btn>
        <v-btn icon small :disabled="feed.busy.value" @click="feed.refresh()"><v-icon small color="white">mdi-refresh</v-icon></v-btn>
      </div>
    </header>
    <p class="feed-page__disclaimer ...">{{ $t('copilot.feed.disclaimer') }}</p>
    <!-- existing empty/list (lines 19-27) unchanged; empty state + gear + disclaimer remain visible when categories produce zero refs -->
  </template>
  <FeedSettingsSheet v-model="settingsOpen" />
</div>
```
`setup()`:
```ts
const settingsOpen = ref(false);
const settings = copilotFeedSettings;        // Task 5 singleton
onMounted(() => { if (settings.onboarded) feed.refresh(); }); // gate refresh on onboarded — no fetch during wizard
```
Use `mdi-cog-outline` (matches existing settings affordance). Do NOT reuse `MiniHeader`'s `@settings` emit (global wallet settings; absent on dashboard). The feed gear lives in the feed header so it works on both surfaces. After the wizard's `@done`, `completeOnboarding()` flips `settings.onboarded` → the `v-else` branch mounts → `onMounted` already ran, so trigger the first `feed.refresh()` from the `@done` handler too (or watch `settings.onboarded` and refresh on transition to true) so the freshly onboarded user sees items without a manual refresh.

**Verify:** `npm run build`; manual sidepanel + manual dashboard (`/copilot-feed`): fresh state shows wizard; after finish shows feed + gear + refresh; gear opens sheet (bottom sheet on sidepanel, dialog on dashboard); "re-run setup" returns to wizard; vibe change then refresh changes item volume/tone; both categories off → empty state still shows gear + disclaimer. **Commit**: `feat(copilot): FeedPage wizard/feed/settings branch + gear (both surfaces)`.

---

### Task 11 — i18n keys + no-advice assertion test [TDD for the test; build for the strings]

**Files (modify):**
- `src/plugins/i18n/us.ts` (add after the `copilot.feed.*` block, ~line 699)
- `src/plugins/i18n/de.ts` (add after ~line 807; ALSO backfill two pre-existing missing keys — see below)

**Files (create):**
- `src/services/copilot/noAdvice.spec.ts`

**Pre-existing de.ts gap to backfill (REQUIRED).** `de.ts` is already missing two of the four "normal" narration keys: only `copilot.feed.heldPriceUp` (`de.ts:804`) and `copilot.feed.watchedPriceDown` (`de.ts:807`) exist; **`copilot.feed.heldPriceDown` and `copilot.feed.watchedPriceUp` are absent**, so German users already see raw keys for down-held and up-watched moves. Add both (alongside the new chill/spicy keys) so the `normal` family is complete in both files before the parity assertion can pass:
```
'copilot.feed.heldPriceDown': '{ticker} ist {pct}% gefallen ({window}). liegt in deinem Wallet.',
'copilot.feed.watchedPriceUp': '{ticker} (Watchlist) ist {pct}% gestiegen ({window}).',
```
(Confirm the exact existing EN wording for these two and match tone; the above mirror the existing held/watched patterns.)

**Reuse (no new keys):** `copilot.feedTitle`, `copilot.feed.disclaimer`, `copilot.feed.empty`, `copilot.feed.refresh`, `copilot.feed.clear`, `copilot.feed.{held,watched}Price{Up,Down}` (the `normal` family), `navigation.copilotFeed`.

**No-advice scan SCOPING DECISION (read before writing the test).** The rule governs what the AGENT SAYS — i.e. narration. Disclaimer/subtitle copy INTENTIONALLY references "buy/sell/advice" in order to negate it, so scanning that copy would force a false RED. Therefore:
- The forbidden-token scan runs ONLY over `NARRATION_TEXT_KEYS` (Task 3 const): the 4 normal + 8 vibe price templates, in BOTH `us` and `de`.
- Onboarding/vibe/category/settings copy is NOT token-scanned. It is covered only by the parity assertion (EN↔DE presence). To keep narration clean without negation tricks, narration strings never reference buy/sell at all (see strings below); disclaimers are free to.

**Canonical forbidden-pattern lists** (derived from design-doc section 6 line 73), applied to `NARRATION_TEXT_KEYS` values, case-insensitive, word-boundary where sensible:
- **EN**: `\bbuy\b, \bsell\b, \bhold\b, \bape\b, \bexit\b, get in, get out, \bshould\b, shouldn't, \bwill\b, won't, \bmoon\b, \bdump\b, \bpump\b, \brug\b, \bzero\b, \b\d+x\b, \btarget\b, good for (you|your), suitable, right for you, recommend, hurry, last chance, don't miss, now!`
- **DE**: `kaufen, \bkauf\b, verkaufen, verkauf, halten, sollst, solltest, wirst, \braus\b, aussteig, einsteig, \brein\b, \bmond\b, \bnull\b, \bziel\b, pump, dump, geeignet, passt zu deinem, empfehl, jetzt zugreifen, beeil, letzte chance, verpass`

**New keys — us.ts (verbatim observational strings):**
```
// wizard shell
'copilot.onboarding.title': 'Set up your Feed',
'copilot.onboarding.subtitle': 'Gero gives you a heads up when your tokens move. No advice, just observations.',
'copilot.onboarding.next': 'Next',
'copilot.onboarding.back': 'Back',
'copilot.onboarding.skip': 'Skip',
'copilot.onboarding.finish': 'Done',
'copilot.onboarding.stepVibe': 'Vibe',
'copilot.onboarding.stepWatch': 'What to watch',
'copilot.onboarding.stepDone': 'All set',
'copilot.onboarding.stepDots': 'Step {current} of {total}',
'copilot.onboarding.doneTitle': 'You are all set',
'copilot.onboarding.doneSubtitle': 'Open the Feed any time. You can re-tune this later in Feed settings.',
// vibe
'copilot.vibe.title': 'Pick a vibe',
'copilot.vibe.subtitle': 'This changes the tone only. Gero reports what happened, it never tells you what to do.',
'copilot.vibe.chill': 'Chill',
'copilot.vibe.chillDesc': 'Quiet and factual. Only the bigger moves, plainly stated.',
'copilot.vibe.normal': 'Normal',
'copilot.vibe.normalDesc': 'A friendly heads up when your tokens move.',
'copilot.vibe.spicy': 'Spicy',
'copilot.vibe.spicyDesc': 'More personality and reactions. Same facts, louder voice.',
// categories
'copilot.category.title': 'What to watch',
'copilot.category.subtitle': 'Right now Gero watches price moves on these. More is coming.',
'copilot.category.bags': 'My bags',
'copilot.category.bagsDesc': 'Tokens in your wallet.',
'copilot.category.watchlist': 'Watchlist',
'copilot.category.watchlistDesc': 'Tokens you added to your watchlist.',
'copilot.category.watchlistEmpty': 'Your watchlist is empty. Add tokens from the market to watch them here.',
'copilot.category.comingSoon': 'Coming soon',
'copilot.category.whales': 'Whales',
'copilot.category.whalesDesc': 'Big and labeled-wallet moves.',
'copilot.category.launches': 'Launches',
'copilot.category.launchesDesc': 'New pools and token launches.',
'copilot.category.governance': 'Governance',
'copilot.category.governanceDesc': 'Proposals and voting activity.',
// settings sheet
'copilot.settings.title': 'Feed settings',
'copilot.settings.subtitle': 'Tune what Gero watches and how it talks. No advice, ever.',
'copilot.settings.rerun': 'Re-run setup',
'copilot.settings.reset': 'Reset to defaults',
'copilot.settings.disclaimer': 'Observations, not financial advice. DYOR.',
// vibe-toned narration (chill + spicy; normal reuses existing 4 keys)
'copilot.feed.chill.heldPriceUp': '{ticker} is up {pct}% ({window}). it is in your bags.',
'copilot.feed.chill.heldPriceDown': '{ticker} is down {pct}% ({window}). one of your bags.',
'copilot.feed.chill.watchedPriceUp': '{ticker} (watchlist) is up {pct}% ({window}).',
'copilot.feed.chill.watchedPriceDown': '{ticker} (watchlist) is down {pct}% ({window}).',
'copilot.feed.spicy.heldPriceUp': 'ok, {ticker} is up {pct}% ({window}). one of your bags is having a moment.',
'copilot.feed.spicy.heldPriceDown': 'oof, {ticker} is down {pct}% ({window}). one of your bags felt that.',
'copilot.feed.spicy.watchedPriceUp': '{ticker} (watchlist) is up {pct}% ({window}), that is a real move.',
'copilot.feed.spicy.watchedPriceDown': '{ticker} (watchlist) is down {pct}% ({window}), big swing.',
```

**New keys — de.ts (spelled-out umlauts):**
```
'copilot.onboarding.title': 'Richte deinen Feed ein',
'copilot.onboarding.subtitle': 'Gero gibt dir Bescheid, wenn sich deine Token bewegen. Keine Beratung, nur Beobachtungen.',
'copilot.onboarding.next': 'Weiter',
'copilot.onboarding.back': 'Zurueck',
'copilot.onboarding.skip': 'Ueberspringen',
'copilot.onboarding.finish': 'Fertig',
'copilot.onboarding.stepVibe': 'Vibe',
'copilot.onboarding.stepWatch': 'Was beobachten',
'copilot.onboarding.stepDone': 'Fertig',
'copilot.onboarding.stepDots': 'Schritt {current} von {total}',
'copilot.onboarding.doneTitle': 'Alles bereit',
'copilot.onboarding.doneSubtitle': 'Oeffne den Feed jederzeit. Du kannst das spaeter in den Feed-Einstellungen anpassen.',
'copilot.vibe.title': 'Waehle einen Vibe',
'copilot.vibe.subtitle': 'Das aendert nur den Ton. Gero berichtet nur, was passiert ist - keine Handlungsempfehlungen.',
'copilot.vibe.chill': 'Ruhig',
'copilot.vibe.chillDesc': 'Leise und sachlich. Nur die groesseren Bewegungen, klar benannt.',
'copilot.vibe.normal': 'Normal',
'copilot.vibe.normalDesc': 'Ein freundlicher Hinweis, wenn sich deine Token bewegen.',
'copilot.vibe.spicy': 'Spicy',
'copilot.vibe.spicyDesc': 'Mehr Persoenlichkeit und Reaktionen. Gleiche Fakten, lautere Stimme.',
'copilot.category.title': 'Was beobachten',
'copilot.category.subtitle': 'Aktuell beobachtet Gero Preisbewegungen bei diesen. Mehr folgt.',
'copilot.category.bags': 'Meine Bestaende',
'copilot.category.bagsDesc': 'Token in deinem Wallet.',
'copilot.category.watchlist': 'Watchlist',
'copilot.category.watchlistDesc': 'Token, die du deiner Watchlist hinzugefuegt hast.',
'copilot.category.watchlistEmpty': 'Deine Watchlist ist leer. Fuege Token aus dem Markt hinzu, um sie hier zu sehen.',
'copilot.category.comingSoon': 'Bald verfuegbar',
'copilot.category.whales': 'Whales',
'copilot.category.whalesDesc': 'Grosse und markierte Wallet-Bewegungen.',
'copilot.category.launches': 'Launches',
'copilot.category.launchesDesc': 'Neue Pools und Token-Launches.',
'copilot.category.governance': 'Governance',
'copilot.category.governanceDesc': 'Vorschlaege und Abstimmungen.',
'copilot.settings.title': 'Feed-Einstellungen',
'copilot.settings.subtitle': 'Stelle ein, was Gero beobachtet und wie es spricht. Niemals Beratung.',
'copilot.settings.rerun': 'Einrichtung erneut starten',
'copilot.settings.reset': 'Auf Standard zuruecksetzen',
'copilot.settings.disclaimer': 'Beobachtungen, keine Finanzberatung. DYOR.',
'copilot.feed.chill.heldPriceUp': '{ticker} ist {pct}% gestiegen ({window}). liegt in deinem Wallet.',
'copilot.feed.chill.heldPriceDown': '{ticker} ist {pct}% gefallen ({window}). eine deiner Positionen.',
'copilot.feed.chill.watchedPriceUp': '{ticker} (Watchlist) ist {pct}% gestiegen ({window}).',
'copilot.feed.chill.watchedPriceDown': '{ticker} (Watchlist) ist {pct}% gefallen ({window}).',
'copilot.feed.spicy.heldPriceUp': 'ok, {ticker} ist {pct}% gestiegen ({window}). eine deiner Positionen hat gerade einen Lauf.',
'copilot.feed.spicy.heldPriceDown': 'autsch, {ticker} ist {pct}% gefallen ({window}). eine deiner Positionen hat das gespuert.',
'copilot.feed.spicy.watchedPriceUp': '{ticker} (Watchlist) ist {pct}% gestiegen ({window}), echte Bewegung.',
'copilot.feed.spicy.watchedPriceDown': '{ticker} (Watchlist) ist {pct}% gefallen ({window}), grosser Ausschlag.',
```

**No-advice + parity + coverage test** (`noAdvice.spec.ts`, TDD):
1. Import `us` and `de` message objects (and `NARRATION_TEXT_KEYS` from `narrator.ts`).
2. **Forbidden-token scan (narration only):** for every key in `NARRATION_TEXT_KEYS`, assert the `us` value matches NONE of the EN forbidden patterns and the `de` value matches NONE of the DE forbidden patterns (lists above). This scan does NOT touch onboarding/vibe/category/settings copy (scoping decision above).
3. **Narrator-key coverage:** assert EVERY key in `NARRATION_TEXT_KEYS` exists (non-empty string) in BOTH `us` and `de` — guarantees no narrator-emitted key falls back to a raw string at runtime (catches the two pre-existing de.ts gaps + any prefix typo).
4. **Parity for new copilot copy:** assert every newly added `copilot.onboarding.*`, `copilot.vibe.*`, `copilot.category.*`, `copilot.settings.*` key present in `us` is also present in `de` and vice-versa (prevents missing-translation drift).
5. Write test → red (strings not added / de.ts gaps present) → add all strings + backfill the two de.ts keys → green.
6. **Commit**: `feat(copilot): i18n (vibe tones + wizard/settings) + no-advice/coverage/parity guard test`.

---

### Task 12 — Full build + typecheck + manual both-surface QA [verification gate]

**Steps:**
1. `npm run test` (all copilot specs green: preferences, refBuilder, narrator, feedEngine, useCopilotFeed, useCopilotFeedSettings, noAdvice).
2. `npm run typecheck` (judge by delta — chronically red per project memory; gate on no NEW copilot errors).
3. `npm run build` (must pass — the gate for `.vue`/store/i18n glue).
4. `npm run lint` on every touched file; fix introduced warnings (CLAUDE.md rule).
5. **Manual sidepanel**: dock shows Feed tab (Task 0) → fresh wallet → wizard shows → 3 steps + dots, disclaimer on every step incl. Skip path → finish → feed + gear + refresh; freshly-onboarded user sees items without manual refresh; gear opens BOTTOM SHEET; "re-run setup" returns to wizard; set chill → fewer items, set spicy → more items + louder copy; coming-soon rows disabled and off; disable both bags+watchlist → refresh → empty state still shows gear + disclaimer.
6. **Manual dashboard** (`/copilot-feed`): same wizard/feed behavior (proves both-surface reuse); gear opens a CENTERED DIALOG correctly sized + scrollable (Task 9 responsive container); CTA button, card accent, and active progress dot are VISIBLE (verifies `--chain-primary` literal fallback on a surface where the var is unset).
7. **Commit** (if any lint/fix touched): `chore(copilot): lint + verification pass`.

---

## TASK ORDER (dependency-correct)

0. **Task 0** sidepanel BottomNav feed entry — reachability prerequisite, no code deps (can land first; makes every later manual check possible).
1. **Task 1** preferences (pure) — foundation, no deps.
2. **Task 2** refBuilder (pure) — depends on `CopilotCategoryFlags` (T1).
3. **Task 3** narrator + feedEngine + `NARRATION_TEXT_KEYS` (pure) — depends on `CopilotVibe` (T1).
4. **Task 4** prefs store — depends on preferences (T1).
5. **Task 5** settings composable — depends on store (T4) + preferences (T1).
6. **Task 6** thread into useCopilotFeed — depends on T1, T2, T3, T4.
7. **Task 7** FeedSettingsForm (incl. `vibeOnly` + `--chain-primary` fallback) — depends on T1 (types) + T5 (consumed by hosts).
8. **Task 8** FeedOnboarding wizard (persistent disclaimer + `--chain-primary` fallback) — depends on T7.
9. **Task 9** FeedSettingsSheet (responsive + re-run setup) — depends on T5, T7, BottomSheet.
10. **Task 10** FeedPage branch + gear (both surfaces) — depends on T5, T8, T9.
11. **Task 11** i18n + de.ts backfill + no-advice/coverage/parity test — depends on narrator key family + `NARRATION_TEXT_KEYS` (T3) and component key usage (T7-T10).
12. **Task 12** build + typecheck + manual QA gate.

Rationale: reachability prereq first; then pure services (TDD'd in isolation); then persistence; then composable wiring; then components bottom-up (form → wizard/sheet → page); then mount (one page serves both surfaces); then i18n+guards; then full verification.

---

## Self-Review

- **Covers all required points?** (1) prefs model + persisted `copilotPrefsStore` mirroring `copilotFeedStore`, both surfaces via shared chrome.storage → Tasks 1, 4. (2) vibe→thresholds with real numbers (chill 25/40, normal 15/25, spicy 8/15) as a pure tested fn → Task 1. (3) threading prefs through `useCopilotFeed`→`buildFeedItems`→`detectPriceMoves` + held/watched category filtering, pure seam TDD'd → Tasks 2, 3, 6. (4) vibe-toned narration via key prefix, normal = existing keys, single-source `NARRATION_TEXT_KEYS`, tested → Task 3. (5) stepped wizard, Strike aesthetic + dots, persistent disclaimer, shown when `!onboardingDone` → Task 8. (6) responsive re-tune sheet with vibe + categories + disabled coming-soon + re-run setup, opened from gear → Tasks 7, 9. (7) sidepanel reachability + FeedPage branch + gear → Tasks 0, 10. (8) dashboard reuse via shared FeedPage route + shared components, responsive container, `--chain-primary` fallback → Tasks 9, 10. (9) all i18n us.ts + de.ts incl. three vibe tones + de.ts backfill → Task 11. (10) test plan + no-advice/coverage/parity scan over `NARRATION_TEXT_KEYS` → Tasks 1-6, 11, 12. (11) correct order → Task Order section.

- **No-advice integrity:** vibe only selects a key (Task 3); narration strings are observational and never reference buy/sell (so the token scan over `NARRATION_TEXT_KEYS` passes cleanly without negation exemptions); spicy uses notability reactions only ("having a moment", "felt that", "real move", "big swing") — no buy/sell/moon/dump/target/Nx/suitability; the wizard carries the disclaimer on EVERY step incl. the Skip exit path; the feed carries it in-page; disclaimer/subtitle copy is intentionally excluded from the token scan (scoping decision, Task 11) and the EN/DE subtitles were reworded to avoid literal buy/sell/sollst so they would pass even if scanned.

- **No poller:** the only timer anywhere is the existing 300ms storage write-debounce (Task 4). `refresh()` stays on-demand, gated on `onboardingDone` in `onMounted` (Task 10) so no fetch during the wizard; freshly-onboarded refresh is a one-shot triggered from `@done`, not a timer.

- **Signature safety:** `detectPriceMoves`, `fetchSnapshots`, `addFeedItems` unchanged. `buildFeedItems` appends `vibe` as the LAST positional param (after `fetchSnapshots`) so the existing green `feedEngine.spec.ts` calls (lines 17, 31) and any other 5-arg caller keep binding `fetchSnapshots` correctly; the only non-test caller is `useCopilotFeed` (updated Task 6, default closure passes `undefined` for fetch then `vibe`), confirmed by grep in Task 3. `narrate` gains an optional `vibe='normal'` so the existing 2 narrator-spec assertions stay green.

- **Cross-surface correctness:** sidepanel reachability fixed (Task 0); `--chain-primary` literal fallback mandated in every new component (Tasks 7-9) and verified on the dashboard (Task 12.6); settings container is responsive — BottomSheet on narrow, v-dialog on wide (Task 9) — so the dashboard gear journey is verified, not deferred; FeedPage is the single shared route component (no duplication).

- **Conventions honored:** flat dotted i18n keys, single-quoted, ICU `{ticker}/{pct}/{window}`; German spelled-out umlauts; `attach` mandated on any `v-select`/`v-autocomplete` (chips preferred); ESLint on touched files; TDD for all pure modules + the no-advice test; build-verify for `.vue`/store/i18n.

**Plan file to write:** `d:\GeroRepos\gitRepos\gerowallet\docs\plans\2026-06-28-copilot-feed-onboarding-tuning.md`