# Documentation sources and drift prevention

The October 18, 2026 cleanup reconciles the contributor docs with development
`1a4d50ac`. [MAINTENANCE.md](../../../../MAINTENANCE.md) holds the dated diagnostic
ledger, dependency policy, owners, and reproducible commands. Verify changes
against source and fix guidance in the same PR rather than adding a second
contradictory description here.

## Authoritative sources

Use these sources when updating a claim:

| Claim | Source |
| --- | --- |
| Runtime versions and scripts | `package.json`, `package-lock.json` |
| Web entry points, worker format, WASM | Four `vite.config*.mts` files; `scripts/manifest.ts` |
| Active approval windows | `src/modules/navigation/router.ts`, `src/popup/modules/views/` |
| Messaging registries and async replies | `src/chrome/messaging.ts`, `senderTrust.ts` |
| Fee sizing | `BrowserTxConstruction.minFee()` in `src/chrome/cardanoJsSdkCbor.ts` |
| Software, PRF, and hardware boundaries | Signing implementations and `references/security.md` |
| Network routes | `src/api/bitcoin-api.ts`, `spo-api.ts`, chain providers and `src/env.ts` |
| Sync and mutex timeout | `websocket.service.ts`, `sync.service.ts`, `walletManager.service.ts` |
| Required checks | GitHub branch protection plus `.github/workflows/` |
| Release behavior | `ci-cd.yml`, artifact/reader/remote-code/TDZ guards, release runbook |

## Reproduction limits

The root Playwright package supplies a Node module, not a browser installation
or a configured `playwright test` suite. Use the real extension Node harnesses
or the separately configured E2E repository. Record exact source/artifact and
harness identities. See [testing](testing.md).

There is no committed `.env.example`. Create configuration explicitly from
the README; enumerate source references with
`rg -o --no-filename 'VITE_[A-Z0-9_]+' src scripts`. `VITE_*` values are exposed
to the client. `MANIFEST_KEY` is a public identity key, not a private signing
credential; synthetic build identity does not establish the store ID.

There is no `format` or `preflight` npm script and no Prettier dependency.
Follow `.editorconfig` and surrounding style; do not broadly reformat the repo.

## Updating evidence

Keep historical pilot and candidate JSON records immutable. Label them by
their original source and date, and link new dated evidence from the current
implementation ledger. Do not change an old count to make it look current.
The release dry run does not publish, and green CI does not prove physical
devices, supported-profile recovery, beta observation, or store acceptance.
