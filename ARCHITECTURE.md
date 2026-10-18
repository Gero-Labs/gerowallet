# Gero Wallet architecture

This guide describes development at `1a4d50ac` on October 18, 2026, after the
Vue 3 migration and its follow-up fixes. See [maintenance](MAINTENANCE.md) for
measured debt and [release readiness](spikes/vue3-migration/RELEASE-READINESS.md)
for qualification that remains open.

## Runtime and build boundaries

The host uses Vue 3, Vuetify 4, Router 4, I18n 11, and Vite 7. Read
[package.json](package.json) and its lockfile for exact versions. Options API
components remain supported; new components use Composition API. There is no
host Vue 2 compatibility runtime.

Four Vite configurations produce the extension; manifest preparation is a
separate step. Production builds run sequentially to bound memory use.

| Configuration | Source | Output |
| --- | --- | --- |
| [Web](vite.config.mts) | `src/options/index.html`, `src/sidepanel/index.html` | Dashboard/approval SPA and Mini-Gero |
| [Background](vite.config.background.mts) | `src/chrome/background.ts` | Classic MV3 worker IIFE |
| [Content](vite.config.content.mts) | `src/chrome/content.ts` | Isolated-world bridge |
| [Inject](vite.config.inject.mts) | `src/chrome/inject.ts` | Page-world connector bundle |

[scripts/manifest.ts](scripts/manifest.ts) defines permissions, CSP, entry
paths, and channel identity. [scripts/prepare.ts](scripts/prepare.ts) writes
the generated manifest and copies static and vendored assets.

The obsolete `src/popup/main.ts`, `Popup.vue`, and `index.html` bootstrap was
removed. Active [approval views](src/popup/modules/views) remain registered in
the [options router](src/modules/navigation/router.ts). A Chrome popup window
hosts that SPA; it is not a third web entry or `action.default_popup`.
Mini-Gero has its own [sidepanel sources](src/sidepanel).

WASM comes from installed dependencies and is emitted locally by the build
plugins. Background loading must work without DOM globals. Do not add a CDN
fallback; run the remote-code and artifact guards on the complete output.

## Messaging and trust

The page-world connector communicates through
[content.ts](src/chrome/content.ts) to
[messaging.ts](src/chrome/messaging.ts). Browser-supplied sender metadata is
distinct from untrusted page-provided fields.

| Caller and registry | Send method | Registration |
| --- | --- | --- |
| Dashboard, approval window, sidepanel | `sendToBackgroundFromOptions()` | `addToOptions(MessageTypes.X, handler)` |
| dApp-facing connector methods | `sendToBackground()` | `add(METHOD.x, handler)` |

The distinction is the registry, not the window shape. The messaging listener
keeps a registered asynchronous handler's channel open. Returning `true` inside
that handler does not send a response: call `sendResponse` exactly once on
success, failure, and early exits. Check transport errors before reading
`response.data`; handler errors and transport errors differ.

Sensitive internal methods use [senderTrust.ts](src/chrome/senderTrust.ts) to
check an extension-page sender. For dApp methods, preserve the relay's
browser-derived origin and check wallet permission and current approval scope
in the background. Never treat an origin inside the request payload as proof
of authorization.

Approvals must remain fresh after validation, authentication, and device
round trips. Recheck wallet, network, request identity, cancellation, and expiry
before signing or submitting. Single-flight guards prevent double submission.
See the [signing guide](.claude/skills/gerowallet-dev/references/security.md).

## State and worker lifetime

[Stores](src/stores) use Vue reactivity rather than Vuex. Background stores
broadcast through [storeMessagingBg.ts](src/chrome/storeMessagingBg.ts);
documents subscribe through
[storeMessaging.service.ts](src/services/storeMessaging.service.ts).
Serialize reactive proxies at Chrome messaging and database boundaries.

MV3 can stop the worker between requests. Durable state lives in storage;
an in-memory wallet instance can be absent during startup or after locking.
Handlers must tolerate that state. A warm-worker test does not prove restart
behavior. See [production messaging tests](src/stores/productionMessaging.integration.spec.ts)
and [real store browser smoke](scripts/migration-browser/store-sync-smoke.cjs).

[StorePersister](src/utils/storePersistence.ts) splits persistence between a
small `chrome.storage.local` record and bulk fields in the `gero-store-cache`
IndexedDB. Do not rewrite multi-megabyte store snapshots for small changes;
storage events copy values into listening contexts.

The database layer has two scopes:

- [gero-db.ts](src/db/gero-db.ts): application wallet list and shared settings.
- [wallet-db.ts](src/db/wallet-db.ts): wallet-specific transactions, addresses,
  configuration, and other chain data.

Apply versioned schemas on every database open. Keep schema and secret-format
changes separate from framework work and supply upgrade/recovery evidence
when they change. The Vue migration did not require a schema bump.

## Chain data and synchronization

Cardano data and transaction construction primarily use the Gero backend and
Nexus proxy. This is not a universal network boundary:

- [bitcoin-api.ts](src/api/bitcoin-api.ts) uses Esplora directly.
- [spo-api.ts](src/api/spo-api.ts) calls per-network Koios endpoints.
- [Midnight](src/chains/midnight) data uses Nexus/Gero Sync. Proof generation
  can use direct Foundation/Arkhia services; public indexer endpoints also
  support development fallback. See `midnightConfig.ts` for per-network routes.
- Feature flags, market data, on-ramp, and provider integrations have their
  own configuration and availability requirements.

Read [src/env.ts](src/env.ts) and the relevant API module for configuration.
Values exposed through `VITE_*` are client-visible; backend credentials do not
belong there.

[websocket.service.ts](src/services/websocket.service.ts) and
[sync.service.ts](src/services/sync.service.ts) implement Gero Sync. Keep
wallet/address subscriptions current across wallet switches and reconnects;
handle sync, rollback, and resync messages. Connection establishment must not
block login. The two-minute value in the wallet manager is a mutex acquisition
timeout, not a locked-wallet polling interval. There is no current Ably service.

## Transactions and key handling

Many Cardano flows request unsigned transactions from Nexus. The local
[builder](src/shared/utils/builder.ts) uses
[cardanoJsSdkCbor.ts](src/chrome/cardanoJsSdkCbor.ts). For an unsigned transaction,
`BrowserTxConstruction.minFee()` inserts unique dummy vkey witnesses for the
estimated signature count (analysis or conservative fallback), lets the SDK size the serialized transaction, and adds an
`80 * minFeeCoefficient` margin. Existing witnesses use the SDK fee calculation
directly. There is no fixed 110-byte-per-witness formula. Preserve change
outputs in certificate/withdrawal-only flows.

Signing boundaries depend on the wallet:

- Password-based software wallets decrypt and sign in the worker.
- PassKey/PRF wallets perform WebAuthn and decrypt key material in a trusted
  extension document before sending the needed bytes to the worker. Plaintext
  key material therefore can enter the trusted UI context.
- Ledger and Keystone use document-side device/QR communication. Private
  signing keys remain on the hardware device; physical qualification is still
  needed for the candidate.
- Cross-device recovery and other signers have their own lifecycles. Review
  the implementation and supported chain before changing key handling.

Never log key material, mnemonic phrases, passwords, or private wallet data.
Keep existing secret readers when changing writers. The
[reader guard](scripts/check-secret-envelope-readers.mjs) and frozen fixtures
cover legacy, `gpw1`, and purpose-bound `gpw2` compatibility; PRF encryption is
a separate path. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Vue component contracts

Use `modelValue`/`update:modelValue`, native Vuetify activator props, and
`await form.validate()` followed by its `{ valid }` result. Recheck approval
scope after asynchronous work. Route caching must honor activation,
deactivation, and late store hydration.

Translations live in `src/plugins/i18n/{us,de,es}.ts`. Add keys in every locale;
the parity suite verifies keys, placeholders, and plurals. I18n's production
build is runtime-only with precompiled messages, compatible with extension CSP.

Use [design tokens](src/shared/styles/tokens.css), their SCSS mirror, shared
controls, and the design/contrast checks. Theme changes must preserve the
custom-element boundary in
[GeroSwapEmbed.vue](src/modules/swap/components/GeroSwapEmbed.vue): the vendored
widget owns its internals, while the host owns approval and signing.

## Verification and maintenance

[CONTRIBUTING.md](CONTRIBUTING.md) gives the verification ladder;
[MAINTENANCE.md](MAINTENANCE.md) records diagnostics, ownership, dependency
policy, and reproduction commands. Required PR checks run selected suites.
Packaging runs the full suite and validates its retained artifact. Neither
alone proves hardware, live-provider, upgrade/recovery, or rollout acceptance.

Use existing module-specific `debugLog()` calls with synthetic data. Record
actual timings, environment, and scenario when making performance claims;
this guide does not promise a universal login latency.
