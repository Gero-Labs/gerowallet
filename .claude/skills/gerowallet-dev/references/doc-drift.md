# Where the repo's own docs are wrong

README.md and ARCHITECTURE.md are broadly reliable on structure and intent. CLAUDE.md is authoritative on *conventions and intent* and is what the AI reviewer reads first, but it carries stale specifics. These are the drifts that have actually cost people time. Verify against code; `package.json` is the only truth for versions.

## CONTRIBUTING.md and the PR template

| Says | Reality |
|---|---|
| "Ensure all tests pass: `npm run typecheck` / `npm run lint`" (PR template; CONTRIBUTING.md carried the same line until it was corrected) | Both are systemically red on a clean tree: ~173 tsc errors and 390 lint errors when last measured. Neither is a gate, and the tsc count drifts - never compare absolute numbers. See the verification ladder in SKILL.md |

## CLAUDE.md

| Says | Reality |
|---|---|
| `@cardano-sdk/core v0.46.9`, `Dexie 4.0.7` | `^0.47.0` and `^4.4.6`. Read `package.json` |
| "Popup context: `Messaging.sendToBackground()`" | Routing is by the `sender` string, not by window. Every wallet UI surface, popup included, uses `sendToBackgroundFromOptions` for `MessageTypes.*` |
| "Chrome messaging timeout: use `return true` for async handlers" | The handler's return value is discarded; `listen()` already returns `true`. What matters is calling `sendResponse` on every path |
| "WASM loading: files must be in `public/`" | Zero `.wasm` files in the repo and no `public/` dir. All WASM ships inside npm packages |
| `popup/  # Extension popup entry` | `src/popup/{index.html,main.ts,Popup.vue}` is dead code - not a Vite input, no `action.default_popup`. The live popup views are `src/popup/modules/views/*.vue`, routed by the **options** router |
| "`minFee()` adds witness overhead (witnessCount x 110 bytes x minFeeCoefficient)" | No such arithmetic exists. It inserts N dummy witnesses, lets the SDK size the CBOR, and adds a flat `80 * minFeeCoefficient` margin |
| CIP-113 "two gates, both required" | Three. `CIP113_ALLOWED_NETWORKS` (Preview only) is checked first, before the hash list and the flag |
| "Data layer: Nexus - blockchain data all brokered server-side, the client carries no third-party data keys" | True for Cardano. `BitcoinApi` calls Esplora directly (including broadcast), Midnight uses direct Foundation/Arkhia URLs, and `src/api/spo-api.ts` calls Koios directly |
| "`api/` - data clients routed through gero-backend/Nexus: ... spo-api" | `spo-api.ts` has a hardcoded per-network Koios URL map and no env var |
| "Sync throttled to every 2 min when locked" | No locked-state throttle exists. The only `2 * 60_000` is a mutex acquisition timeout |
| Route gating via `isRouteUnderMaintenance()` | Correct, but incomplete: that check is skipped until flags initialize, so a dark feature also needs the live flag ANDed into `routeNetworkGuards` |
| "When adding keys to `us.ts`, always add corresponding German in `de.ts`" | Correct rule, but nothing enforces it - no spec, no script, no CI, no lint rule |
| "Gates wired into the pre-commit hook" | Correct, but it is **yorkie** via `package.json` `gitHooks`, not husky. There is no `.husky/` directory, and `.git/hooks/pre-commit` is a generated shim |

## ARCHITECTURE.md

| Says | Reality |
|---|---|
| "Content Scripts (`src/chrome/content/`)" and "Inject Scripts (`src/chrome/inject/`)" | Single files: `src/chrome/content.ts` and `src/chrome/inject.ts` (plus `injectMidnight.ts` and `webpage.ts`) |
| "Private keys never leave the background context" | Two documented exceptions: PRF/passkey wallets decrypt in the UI context and send key bytes to the background, and Ledger/Keystone sign entirely in document context |
| Console prefixes `⏱️ PERF:`, `🔐 Auth:`, `📡 API:`, `💾 DB:`, `🔄 Sync:` | All five appear **zero times** in `src/`. Real tags: `[PRF]`, `[Keystone]`, `[DApp]`, `[TREZOR]`, `[LEDGER]`, `[ROUTER]`, `🌙`, `🔵 [webpage.ts]`, `❌`, `✅`. There is also no `performance.now()` timing convention |

## README.md

| Says | Reality |
|---|---|
| `npm run test:e2e` under Testing | Playwright is not a dependency and there is no config. The E2E suite is a separate repo |
| Its Testing section | It is about manually using the Preprod testnet, not unit tests. Testing is undocumented in both README.md and CLAUDE.md |

## Not a drift, but surprising

- `.env.example` does not exist and is not coming back (it carried `MANIFEST_KEY`). `.gitignore` keeps a `!.env.example` negation for a file that is not committed. Enumerate variables with `grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u`.
- `.prettierrc` exists, but prettier is not a dependency, has no script, and appears nowhere in CI. Do not run it - a reformat diff collides with the design ratchet's per-file metrics. Match the surrounding style; `.editorconfig` is the practical guide.
- `ci-cd.yml` is legacy: its `publish` job would fail today (it reads a `src/manifest.json` that does not exist, requires `semver` which is not a dependency, and uses the removed `::set-output`). PR validation comes entirely from the four `ubuntu-latest` workflows.

## If you find another one

Fix the doc in the same PR when it is a one-line correction, or open an issue. A stale line in CLAUDE.md is worse than no line, because the AI reviewer is told to read it first.
