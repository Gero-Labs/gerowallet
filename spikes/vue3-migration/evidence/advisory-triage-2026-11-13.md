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
| `brace-expansion`, `fflate`, `ip-address`, `pbkdf2`, `postcss-selector-parser`, `qs`, `glob` (under `@ffflorian/jszip-cli`) | various | patched | DoS and SSRF-classifier advisories | Mostly build tooling. `ip-address` (via `@cardano-sdk/core` / `socks`) and `pbkdf2` (via `crypto-browserify`) are in runtime bundles. | Lockfile only, within existing ranges |

## Deferred, with reasons

| Advisory (package) | Path | Exposure | Why not now | Next step |
| --- | --- | --- | --- | --- |
| `toml` ×6 ([GHSA-v5mp-jgw5-2x6j](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j), [GHSA-h895-cgqg-jf52](https://github.com/advisories/GHSA-h895-cgqg-jf52) and 4 DoS) (high); `stream-json` ×3, `uuid` in `jayson` (moderate); `elliptic` (low) | `@trezor/connect-web` 9.7.3 → `@trezor/blockchain-link` → Stellar, Solana and Ripple SDKs | Trezor's blockchain-link backends for chains Gero does not use. No source imports `toml`, `stream-json` or the Stellar SDK. The parsers would only see data from a Stellar `stellar.toml` or a Solana RPC that Gero never contacts. | The fix is `@trezor/connect-web` 10, a major version that changes the device transport. It needs the Trezor device run in #1518. | Upgrade Trezor Connect to 10 with a real-device signing pass. |
| `showdown` [GHSA-22g5-r2x5-97cx](https://github.com/advisories/GHSA-22g5-r2x5-97cx), [GHSA-cr32-g25g-vxjj](https://github.com/advisories/GHSA-cr32-g25g-vxjj) (XSS), [GHSA-rmmh-p597-ppvv](https://github.com/advisories/GHSA-rmmh-p597-ppvv) (ReDoS) (moderate, no fix) | Direct, `ChangeLogDialog.vue` | Renders Gero's own GitHub release notes. Every result goes through `sanitizeMarkdownHtml()` (DOMPurify) before `v-html`, which strips the injected script and handler attributes. ReDoS needs a crafted release note from Gero's own repository. | No patched showdown exists. | Replace showdown with a maintained renderer (e.g. `marked`), keeping DOMPurify. Low urgency. |
| `@effect/platform` [GHSA-chp3-j5qr-2vfr](https://github.com/advisories/GHSA-chp3-j5qr-2vfr) cookie attribute injection (moderate) | Pre-v9 `@midnightntwrk/wallet-sdk-*` packages | `makeCookie()` is server-side cookie building; the extension sets no cookies through Effect. | The fix is Midnight SDK majors that must move with the five v9 ledger consumers on one WASM instance (#1452, #1476). | Fold into the Midnight ledger 9 consolidation. |
| `uuid` [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) buffer bounds check (moderate) | Keystone `bc-ur-registry-*`, `pouchdb` via `@cardano-sdk/wallet`, `vite-plugin-top-level-await` | Only affects `v3`/`v5`/`v6` called with a caller-supplied `buf`. These callers use `v4` for request ids. | Keystone has no fixed release; the cardano-sdk "fix" is a downgrade to 0.6.0. | Track Keystone SDK. The cardano-sdk path goes away with #1433 (remove unused `@cardano-sdk/web-extension`). |
| `elliptic` [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84) risky primitive (low, no fix) | `@stricahq/bip32ed25519` via `cardano-verify-datasignature`; Trezor, Ripple | No fixed `elliptic` exists. Gero's Cardano signing does not go through `elliptic`; the datasignature path verifies only. | No upstream fix. | Review when upstream ships one. |
| `cross-spawn` [GHSA-3xgq-45jj-v275](https://github.com/advisories/GHSA-3xgq-45jj-v275) ReDoS, `execa` (high) | `yorkie` 2.0.0 git-hook installer | Dev only: runs at install time and on local commits with fixed arguments. | `yorkie` is unmaintained and has no fixed release. | Replace `yorkie` with `simple-git-hooks` or `husky` (keep the `gitHooks.pre-commit` command). |
| `glob` [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), `minimatch` [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), `js-beautify`, `editorconfig` (moderate) | `archiver` 7, `unplugin-vue-components`, `@vue/test-utils` | Build and test tooling over the repository's own files. | Each fix is a major version of the parent (`archiver` 8, `unplugin-vue-components` 32) or a downgrade (`@vue/test-utils`). | Review with the Vite/plugin batch. |
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
