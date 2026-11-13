# Dependency advisory triage, November 13, 2026

Issue [#1314](https://github.com/Gero-Labs/gerowallet/issues/1314). Base:
`development` at `b2b04add`. Audit command: `npm audit --json` against this
branch's lockfile. Counts are affected dependency nodes, not unique advisories
or demonstrated exploits, and registry results change over time.

| | low | moderate | high | critical | total |
| --- | --- | --- | --- | --- | --- |
| October 18 baseline (`1a4d50ac`) | 19 | 31 | 23 | 0 | 73 |
| `development` today, before this change | 19 | 51 | 12 | 2 | 84 |
| After this change | 18 | 42 | 8 | 0 | 68 |

No `npm audit fix --force`, no `--legacy-peer-deps`. `npm audit fix` was run
without `--force`, so it only moved transitive packages within their declared
ranges.

## Fixed in this change

| Package | Was | Now | Advisory | Exposure | Change |
| --- | --- | --- | --- | --- | --- |
| `bitcoinjs-lib` | 6.1.7 | 6.1.10 | [GHSA-8vv3-6qpc-gpw6](https://github.com/advisories/GHSA-8vv3-6qpc-gpw6): Merkle node duplication validates a forged tx list (critical, `>=6.0.0 <6.1.8`) | Runtime, BTC wallet and Babylon staking. Gero builds and signs PSBTs; no source path calls `Block` Merkle-root checks, so the vulnerable code is not known to be reached. Fixed regardless because it is a patch release. | Pinned 6.1.10 plus an `overrides` entry, because `@babylonlabs-io/btc-staking-ts@2.8.6` pins its peer to exactly 6.1.7. |
| `highcharts` | 11.4.8 | 11.4.9 | [GHSA-35rr-xwfh-x789](https://github.com/advisories/GHSA-35rr-xwfh-x789), [GHSA-5793-x2q3-c3q7](https://github.com/advisories/GHSA-5793-x2q3-c3q7), [GHSA-mw4f-gj5x-6xr4](https://github.com/advisories/GHSA-mw4f-gj5x-6xr4), [GHSA-rmqc-xvr3-v46c](https://github.com/advisories/GHSA-rmqc-xvr3-v46c): `javascript:` URLs, prototype write, style-key handlers (high, `<11.4.9`) | Runtime rendering. Chart options are built in code from numeric series, so these are not known to be reached; fixed because it is a patch release. | `^11.4.9` |
| `follow-redirects` (via `axios`) | 1.16.0 | 1.16.3 | [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c), [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p), [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8): credential headers can follow cross-origin redirects (high) | Runtime HTTP client. Requests go to Gero's own API, but auth headers on a redirect are a real exposure class. | Lockfile only |
| `vitest`, `@vitest/ui`, `@vitest/mocker` | 4.1.11 | 4.1.12 | [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8), [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp): mock-registration code injection; Windows mocker path traversal (moderate) | Dev only: the Vitest UI server on a developer machine. | Exact pins bumped together (Vitest/UI must match). |
| `happy-dom` | 20.14.3 | 21.0.4 | [GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79), [GHSA-c8p4-j97h-3vg8](https://github.com/advisories/GHSA-c8p4-j97h-3vg8), [GHSA-5fpq-26gf-qwcr](https://github.com/advisories/GHSA-5fpq-26gf-qwcr): import-alias code execution, SSRF, cookie scope forgery (high; one fixed only in 21.0.4) | Dev only: test DOM. Tests feed it fixture HTML, not untrusted pages. | Major bump; the full suite passes on 21. |
| `deepmerge` | 4.3.1 | removed | [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4): prototype poisoning in `mergeObject()` (low) | Direct devDependency with no importer anywhere and no dependent package. npm's proposed "fix" was a downgrade to 4.1.2. | Removed |
| `yorkie` 2.0.0 → `cross-spawn` <6.0.6, `execa` | `yorkie` | `simple-git-hooks` 2.14.0 | [GHSA-3xgq-45jj-v275](https://github.com/advisories/GHSA-3xgq-45jj-v275): `cross-spawn` ReDoS (high) | Dev only: git-hook installer. `yorkie` is unmaintained and has no fixed release. | Replaced by `simple-git-hooks` (no dependencies), installed by the `prepare` script, with the same pre-commit command. Follow-up PR; audit then 65 nodes (5 high). |
| `showdown` | 2.1.0 | removed | [GHSA-22g5-r2x5-97cx](https://github.com/advisories/GHSA-22g5-r2x5-97cx), [GHSA-cr32-g25g-vxjj](https://github.com/advisories/GHSA-cr32-g25g-vxjj) (XSS), [GHSA-rmmh-p597-ppvv](https://github.com/advisories/GHSA-rmmh-p597-ppvv) (ReDoS) (moderate, no fixed release) | Runtime: rendered Gero's own GitHub release notes in `ChangeLogDialog.vue`, already DOMPurify-sanitized before `v-html`. | Removed. The dialog uses the wallet's own `renderMarkdown` (escape first, then a markdown subset; already used for governance metadata and announcements), so raw HTML in a release body is shown as text and nothing is left to sanitize. The unused `sanitizeMarkdownHtml` went with it. Follow-up PR; audit then 64 nodes (5 high). |
| `archiver` 7.0.1 → `archiver-utils`, `zip-stream`, `glob`, `minimatch` | `archiver` | removed | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (moderate) | Dev/build only. A direct dependency with no importer anywhere; the `pack:zip` scripts use `@ffflorian/jszip-cli`, and `crx` brings its own `archiver` 3, which is not affected. | Removed. Follow-up PR; audit then 60 nodes (5 high). |
| `unplugin-vue-components` 0.28.0 → `minimatch` | 0.28.0 | 32.1.0 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (moderate) | Build only: resolves component imports at build time. | Exact pin bumped. Its breaking changes (ESM only, Node >= 20.19, no Vue 2, `@nuxt/kit` 4, `unplugin` 3) do not touch `vite.config.mts`. The regenerated `src/components.d.ts` lists the same components and gains only header comments. Same follow-up PR. |
| `@cardano-sdk/web-extension` 0.39.46 → `@cardano-sdk/wallet`, `pouchdb`, `@cardano-sdk/hardware-trezor` → `@trezor/connect` 9.4.0 | `@cardano-sdk/web-extension` | removed | `uuid` [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) via `pouchdb` (moderate), plus a second copy of the Trezor Connect 9 tree above | A direct dependency nothing imports (#1433). `src` imports neither `hardware-trezor` nor `wallet`, and the only reference left was an unused type declaration, which is also removed. | Removed. `@cardano-sdk/crypto`, `util`, `key-management` and `input-selection`, which `src` imports, are now declared at the versions already resolved. The lockfile only drops 132 packages; nothing that stays changes version. Audit then 51 nodes (5 high). |
| `toml` ×6 ([GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j), [GHSA-h895-cgqg-jf52](https://github.com/advisories/GHSA-h895-cgqg-jf52) and 4 DoS) (high); `stream-json` ×3, `uuid` in `jayson` (moderate) | `@trezor/connect-web` / `-webextension` 9.7 → `@trezor/blockchain-link` → Stellar, Solana and Ripple SDKs | `@trezor/connect-webextension` 10.0.1; `@trezor/connect-web` removed | Trezor's blockchain-link backends for chains Gero does not use; no source imported them. | Shipped with the extension, never reached. | Migrated to Trezor Connect 10, a thin client: Trezor Suite (desktop over `ws://127.0.0.1:21335`, or Suite Web through `externally_connectable`) runs the core, so the client no longer bundles any chain backend. One module (`trezor.ts`) now serves the worker and the pages; `trezorWeb.ts` is gone. Pairing reads `xpub`, failures are read from `error`, `manifest.appName` is set. The shipped tree (`npm audit --omit=dev`) goes from 43 nodes (5 high) to 34 (0 high). Follow-up PR; the real-device run is #1518. |
| `brace-expansion`, `fflate`, `ip-address`, `pbkdf2`, `postcss-selector-parser`, `qs`, `glob` (under `@ffflorian/jszip-cli`) | various | patched | DoS and SSRF-classifier advisories | Mostly build tooling. `ip-address` (via `@cardano-sdk/core` / `socks`) and `pbkdf2` (via `crypto-browserify`) are in runtime bundles. | Lockfile only, within existing ranges |

## Deferred, with reasons

| Advisory (package) | Path | Exposure | Why not now | Next step |
| --- | --- | --- | --- | --- |
| `axios` (prototype pollution, high) in `@stellar/stellar-sdk` → `@trezor/network-stellar`, `@trezor/blockchain-link` | `@trezor/connect-core` 10.0.1, a devDependency | Tests only: the Trezor witness and PSBT specs check Gero's requests against Connect's own transforms (`gatherWitnessPaths`, `validateTrezorInputs`/`Outputs`). Nothing in the extension imports it. | Connect 10 moved those transforms from `@trezor/connect` into `@trezor/connect-core`, which carries every chain backend. Dropping it would leave the specs restating Trezor's rules instead of running them. | Take the next `connect-core` release that moves off the affected Stellar SDK. |
| `@effect/platform` [GHSA-chp3-j5qr-2vfr](https://github.com/advisories/GHSA-chp3-j5qr-2vfr) cookie attribute injection (moderate) | Pre-v9 `@midnightntwrk/wallet-sdk-*` packages | `makeCookie()` is server-side cookie building; the extension sets no cookies through Effect. | The fix is Midnight SDK majors that must move with the five v9 ledger consumers on one WASM instance (#1452, #1476). | Fold into the Midnight ledger 9 consolidation. |
| `uuid` [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) buffer bounds check (moderate) | Keystone `bc-ur-registry-*`, `vite-plugin-top-level-await` | Only affects `v3`/`v5`/`v6` called with a caller-supplied `buf`. These callers use `v4` for request ids. | Keystone has no fixed release, and `vite-plugin-top-level-await`'s only "fix" is a downgrade. | Track Keystone SDK. The `pouchdb` path went away with #1433 (unused `@cardano-sdk/web-extension` removed). |
| `elliptic` [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84) risky primitive (low, no fix) | `@stricahq/bip32ed25519` via `cardano-verify-datasignature`; Keystone (`hdkey`) | No fixed `elliptic` exists. Gero's Cardano signing does not go through `elliptic`; the datasignature path verifies only. | No upstream fix. | Review when upstream ships one. |
| `glob` [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), `minimatch` [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), `js-beautify`, `editorconfig` (moderate) | `@vue/test-utils` 2.5.1 → `js-beautify` | Test tooling: formats the HTML of mounted components in specs, over the repository's own files. | 2.5.1 is the latest release; npm's proposed fix is a downgrade to 2.4.11. | Take the next `@vue/test-utils` release that moves off the affected `js-beautify`. |
| `crypto-browserify`, `node-stdlib-browser`, `vite-plugin-node-polyfills` (low, via `elliptic`) | Node polyfills in the bundle | Same `elliptic` advisory as above. | npm's proposed fix is a downgrade of `vite-plugin-node-polyfills` to 0.2.0. | None until `elliptic` ships a fix. |

## Verification

- `npm ci` passes with npm 11.0.0 and 11.1.0 on the regenerated lockfile.
  npm 11.0.0 crashes (`Cannot read properties of null (reading 'edgesOut')`)
  when re-resolving the Vitest 4.1.12 peer set from scratch; installing from
  the lockfile is not affected.
- Full Vitest suite: 10,936 passed, 3 skipped. The 10 failures match
  `development` on a Windows CRLF checkout: source-text specs reading CRLF
  files, plus one load-sensitive timing spec (`renderMarkdown` "stays linear")
  that passes 3/3 on its own.
- `npm run build` (four production bundles and prepare) passes;
  `remote-code-guard` OK; `check-bundle-tdz` 0 new; `check-secret-envelope-readers` OK.
- Not covered: a Babylon BTC staking or BTC send on signet/testnet with
  `bitcoinjs-lib` 6.1.10 (a patch release, but Babylon pins 6.1.7), and a
  check that the Highcharts charts render the same.
