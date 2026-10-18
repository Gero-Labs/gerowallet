# Dev loop: build, run, reload

## One-time setup

Use Node 24.19.0 and npm 11.1.0, matching the release workflow. Keep the Node
selection local to this shell when maintaining an older Vue 2 checkout too.

```bash
git clone https://github.com/Gero-Labs/gerowallet.git && cd gerowallet
npm ci               # use the committed lockfile; installs the yorkie hook
touch .env.development
```

There is no committed `.env.example`. Create local configuration explicitly. Three variables are all you need to boot against a local backend:

```bash
printf 'VITE_BACKEND_URL=http://localhost:8081\nVITE_NEXUS_URL=http://localhost:8081/api/nexus\nVITE_SYNC_WS_URL=ws://localhost:8081/sync\n' > .env.development
```

`VITE_NEXUS_URL` points at `<backend>/api/nexus`, not at Nexus directly - the backend injects the API key. Integration-specific settings may also be needed; `VITE_*` values are public client configuration. To see everything the code can read: `grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u`.

Those three point at a **backend you still have to run**, or the extension boots with no data - correct layout, empty wallet, every call failing. Use the current backend deployment/setup instructions; `curl http://localhost:8081/health` is the check. Decide up front which rung of the verification ladder you actually need:

| You need | You need a backend? |
|---|---|
| A ratchet-clean SFC, a bundle that builds, a spec to pass | No |
| The page to render and route | No |
| Balances, transactions, sync, prices, feature flags - i.e. any real click-through | Yes |

Enable `VITE_DEBUG_STORES=true` only for a scoped local debugging session with
synthetic data. Store logs can contain wallet records and authentication
metadata. Release packaging pins this flag off. See `debugging.md`.

Verify the hook installed:

```bash
head -2 "$(git rev-parse --git-common-dir)/hooks/pre-commit"   # prints "#yorkie 2.0.0"
```

## Running it

```bash
npm run dev
```

Then `chrome://extensions` -> Developer mode -> Load unpacked -> select `extension/`.

`extension/` is a build artifact and is gitignored; it does not exist in a fresh clone until you build.

`npm run dev` fans out (`run-p dev:*`) into five processes:

| Script | What it does |
|---|---|
| `dev:prepare` | Writes `extension/manifest.json`, stubs the two HTML entries to point at the dev server, copies static assets and `extension/vendor` |
| `dev:web` | Vite **dev server** on `:3303`. Writes nothing to `extension/`; the UI hot-reloads over HTTP |
| `dev:background` | `vite build --watch` -> `extension/background/` |
| `dev:content` | `vite build --watch` -> `extension/content/` |
| `dev:inject` | `vite build --watch` -> `extension/content/inject.js` |

So: **UI edits hot-reload. Background, content and inject edits rebuild automatically but need a manual extension reload in `chrome://extensions` to take effect** - an MV3 service worker keeps executing the bundle it started with.

If you only need the background rebuilt (faster than restarting everything): `npm run dev:background`.

## Four bundles, four configs

| Config | Entry | Output |
|---|---|---|
| `vite.config.mts` | `src/options/index.html`, `src/sidepanel/index.html` | `extension/` root |
| `vite.config.background.mts` | `src/chrome/background.ts` | `extension/background/` |
| `vite.config.content.mts` | `src/chrome/content.ts` | `extension/content/` |
| `vite.config.inject.mts` | `src/chrome/inject.ts` | `extension/content/inject.js` |

All four set `emptyOutDir: false` so they do not wipe each other. Changing `src/chrome/` does not rebuild the UI, and vice versa.

`isDev` comes from `NODE_ENV` (`scripts/utils.ts:7`), **not** from Vite's `--mode`. `--mode` only selects which `.env.<mode>` file is read. `build:beta` sets `NODE_ENV=production`, so it produces a production-shaped build.

## Traps

**Port 3303 is `strictPort: true`.** If it is taken, Vite fails instead of drifting - deliberate, because `base` is pinned to that port. Use `PORT=3404 npm run dev`.

**Do not start a second `npm run dev` while one is running.** `npm run clear` runs first and rimrafs the output the running server produced, then the new one dies on the strict port. For the same reason, starting `npm run dev` while Chrome has `extension/` loaded leaves a broken extension until all four builds finish - wait for them to settle, then reload.

**`npm run clear` is not a clean slate.** It removes eight named paths only. `extension/public`, `extension/vendor`, `extension/options` and `extension/_metadata` survive, so a deleted asset can keep shipping. For reproducible packaging, build in a fresh disposable checkout instead of reusing an output directory with unknown contents.

**The manifest is generated, never hand-edited.** `scripts/manifest.ts` is the source; `scripts/prepare.ts` shells out to it. The dev watcher watches a path that does not exist (`src/manifest.ts`), so after editing `scripts/manifest.ts` you must re-run `npx esno ./scripts/manifest.ts` or restart `npm run dev` - otherwise the change silently does nothing.

**Dev and production manifests differ.** `buildCSP(isDev)` puts `http://localhost:*` in `script-src`/`font-src` only in dev. Pointing a production-built `extension/` at a dev server gives you silent CSP blocks and a blank page.

**Working in a git worktree?** `envDir` is the checkout root and `.env*` is
ignored. Create the public configuration required for that checkout explicitly;
do not assume another checkout's settings apply. Use its own normal `npm ci`
for reproducible dependency checks. Shared `node_modules` does not establish a
clean lockfile installation. The stash stack is shared across worktrees.

**A background build that fails with `check-bundle-tdz: FAIL`** naming a module you never touched: the background is a single IIFE with no code splitting, so module evaluation order is a correctness constraint. The guard (`scripts/check-bundle-tdz.mjs`, baseline in `scripts/bundle-tdz-baseline.json`) catches the class of bug that once threw `Cannot access 'midnightSync_service' before initialization` and broke login. Fix by making the offending dynamic import static.

Before you believe such a failure, check your install. The guard's keys are computed from bundled **dependency** code, so a `node_modules` that has drifted from `package-lock.json` - a dependency directory shared with another checkout is one possible cause - changes the module set, the emitted order and Rollup's `$N` suffixes, and reports offenders as fixed and introduced that no commit caused. `npm ci` and rebuild first; compare against what the `Ledger tests and extension bundles` check built.

**`components.d.ts` regenerates on every build** and is tracked. The live file is `src/components.d.ts` (Vite's root is `src/`); the copy at the repo root is stale. Never hand-edit either. Build before comparing Vue-aware diagnostics so auto-import declarations also exist. Check `git status` before committing so a stale regeneration does not ride along.

**WASM is not in the repo.** WASM dependencies are emitted by the build, not maintained as source binaries. Every WASM binary ships inside an npm package and is emitted by `vite-plugin-wasm` next to the bundle that consumes it. If WASM breaks in the background, look at the `service-worker-fixes` plugin in `vite.config.background.mts`, which rewrites `document.currentScript` and `document.baseURI` so the emitted `new URL(...)` resolves inside a service worker.

## Packaging

```bash
npm run build          # four production builds run sequentially, then prepare and remote-code guard
node scripts/check-secret-envelope-readers.mjs
node scripts/check-bundle-tdz.mjs
```

The production build honors the caller's `NODE_OPTIONS`; the release workflow
uses a 4 GB old-space limit. Build in an isolated checkout or output directory
while another checkout serves the user's development extension.

Use the reviewed [release and recovery procedure](../../../../spikes/vue3-migration/RELEASE-READINESS.md)
for release packaging. It verifies version, channel identity, CSP, local WASM,
and hashes before archiving outside `extension/`. The manual workflow defaults
to a dry run; store submission requires separate release authorization. Legacy
`pack:*` commands alone do not perform these qualification gates.
