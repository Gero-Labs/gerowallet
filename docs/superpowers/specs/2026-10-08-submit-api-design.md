# Submit API: user-defined Cardano transaction submit endpoint

- **Status:** design approved in chat 2026-10-08, pending written-spec review
- **Target release:** 2.7.3 (code ships dark behind `isSubmitApiEnabled`)
- **Repos:** `Gero-Labs/gerowallet` (main work), `nexus` (one endpoint change, see section 10)

## 1. Goal

Let a user send their wallet's Cardano transactions through their own submit endpoint instead of Gero's backend, configured from **Settings → Advanced**.

Two kinds of users, one feature:

- **Sovereignty / privacy users** (SPOs, power users) run their own node. When they set an endpoint, their transactions must never reach Gero's submit path. A failure is an error, not a silent reroute.
- **Reliability users** want a second route. They can opt into "fall back to Gero if my endpoint fails".

**Success criteria**

1. With an endpoint set, every Cardano submit from that wallet goes to it, from in-wallet flows and from dApps alike.
2. With fallback off, no transaction from that wallet reaches Gero's submit path.
3. With nothing set, behaviour is identical to 2.7.2. The default path is the same code with the same arguments.
4. Failures say whether the user's endpoint or the network rejected the transaction.

## 2. Decisions

| Topic | Decision |
|---|---|
| Purpose / fallback | Both kinds of user are served: a per-wallet "fall back to Gero" toggle, **default off** |
| Chains | **Cardano only**. Bitcoin (Esplora) and Midnight (Nexus relay that also proves) are out of scope |
| Coverage | **Every Cardano submit**: in-wallet flows, CIP-30, WalletConnect, CIP-45 |
| Configurable fields | URL + one optional auth header (name and value) |
| Scope | **Per wallet**, stored in the wallet's own `config` table |
| Wire format | One format for every provider: `POST`, raw CBOR bytes, `Content-Type: application/cbor` |
| Providers named in UI | Nexus, cardano-submit-api, Blockfrost, Koios (in that order) |
| Nexus | The **Nexus server** gains an `application/cbor` variant of its submit endpoint, so the wallet keeps one format |
| Architecture | Approach A: one background submit router that every Cardano submit path calls |
| Feature flag | `isSubmitApiEnabled`, ships dark, gates the **UI only** |

## 3. Non-goals

- Bitcoin broadcast and Midnight submit endpoints.
- Transactions that Nexus or Strike builds or submits on the user's behalf: swaps (the gero-swap widget, and the agent SwapCard through the Nexus aggregator), DUST registration and Strike perps. They reach Gero's services whatever this setting says, so the setting makes no promise about them.
- Provider presets or a provider picker. A Nexus URL is entered like any other.
- Custom endpoints for reads (UTxOs, history, protocol parameters). Only submission changes.
- The Midnight wallet's cNIGHT registration submit (`WalletBg` around line 3108). It submits a Cardano tx from a Midnight wallet, which has no Cardano submit setting, so it stays on the default path.
- The side panel. It has no Advanced settings surface. The full-page Settings dialog is the only entry point.
- Encrypting the auth header value under the spending password (see section 9).

## 4. Architecture

### 4.1 Submit router

New module `src/chrome/submitRouter.ts`, background worker only.

```ts
type SubmitOutcome =
  | { ok: true; via: 'custom' | 'default'; body: string }
  | { ok: false; via: 'custom' | 'default'; status?: number; body?: unknown;
      reason?: 'endpointPrefix' | 'hashMismatch' | 'unexpectedResponse' | 'outcomeUnknown' | 'invalidConfig'
             | 'storageUnavailable' };

submitCardanoTx(input: {
  cbor: string;                              // signed tx, hex
  walletId: number;
  network: string;                           // wallet network, for the Nexus guard
  defaultSubmit: () => Promise<SubmitOutcome>; // the caller's existing call, adapted
}): Promise<SubmitOutcome>
```

The router reads the wallet's submit API config from the wallet DB at call time, so a dying MV3 worker loses nothing. The rules are in section 6.

The **default branch** is the caller's existing call, passed in as `defaultSubmit`, with today's arguments:

- in-wallet path: `Api.submitTx(cbor)` (`src/api/api.ts`; Preview goes to Nexus, mainnet and preprod go to gero-backend). An axios adapter turns its string result or `error.response` into a `SubmitOutcome`.
- dApp paths: `serialization.submitTx(cbor, chain, network)` (gero-backend, `provider=KOIOS`). A fetch adapter turns its `Response` into a `SubmitOutcome`.

The two defaults are never merged. Each caller keeps its own, and the adapters pass status and body through untouched, so an unset config produces exactly the status and body each caller sees in 2.7.2. `status` and `body` feed the existing `describeSubmitFailure(status, body)` and `dappSubmitError(status, body)` helpers unchanged. `reason` marks the router's own outcomes (custom-endpoint prefix, hash mismatch, unparseable 2xx, unknown outcome, invalid saved config, unreadable wallet DB) so callers can pick the matching message.

### 4.2 Call sites

| Path | Today | After |
|---|---|---|
| In-wallet: send, staking, governance, collateral, pool operator, RealFi, Strike, agent cards; software, Ledger, Trezor, Keystone, PRF and MPC signing | `SUBMIT_TX` → `WalletBg.submitTx` → `this.api.submitTx` | `WalletBg.submitTx` → router (default = `this.api.submitTx`) |
| CIP-30 `submitTx` (`background.ts` around line 1665) | `serialization.submitTx` | router (default = `serialization.submitTx`) |
| WalletConnect `cardano_submitTx` (around line 4829) | `serialization.submitTx` | router |
| CIP-45 `submitTx` (around line 5145) | `serialization.submitTx` | router |
| Midnight cNIGHT registration (`walletBg.ts` around line 3108) | `serialization.submitTx` | unchanged |

Callers keep everything they do today after a successful submit: recording the pending transaction, building CIP-30 error objects, the body-hash integrity guard in `SUBMIT_TX`. The router only replaces the network call. It returns a `SubmitOutcome`, which callers map onto their existing error shapes (`describeSubmitFailure`, `dappSubmitError`, `unexpectedSubmitResponseError`).

## 5. Data model

Two rows in the per-wallet `config` table. No Dexie schema bump.

### 5.1 `submitApi` (public)

```ts
interface SubmitApiConfig {
  version: 1;
  url: string;                 // validated, see section 8
  headerName: string | null;   // null when no auth header
  hasAuth: boolean;            // true when a submitApiAuth row exists
  fallbackToDefault: boolean;  // default false
}
```

The row is absent when the wallet uses the default path. Like every other config row, it flows through `ConfigLoader` into `walletStore.config.submitApi`, so the UI reads it reactively.

### 5.2 `submitApiAuth` (secret)

The header value as a plain string. Absent when there is no auth header.

- `ConfigLoader` (`src/db/loaders/walletLoader.ts`) gains a `PRIVATE_CONFIG_KEYS` set and skips those rows. Without that, the value would reach `walletStore.config`, be broadcast to every context, and be persisted into `chrome.storage.local`, where `storage.onChanged` listeners in content scripts can see it.
- `ConfigLoader` is the only reader that dumps the whole per-wallet config table (verified 2026-10-08). Every other reader queries named keys. There is no wallet DB export.
- Only the background reads this row: the router at submit time, and the test handler.
- Deleting the wallet deletes its DB, and both rows with it.

### 5.3 Writes

All writes go through the background. Extension pages never write these rows directly.

- `MessageTypes.SET_SUBMIT_API` (`addToOptions`): `{ url, headerName, headerValue?: string | null, fallbackToDefault }`.
  - `headerValue` omitted: keep the stored value.
  - `null`: delete it.
  - a string: replace it.
  - The handler validates with the shared module (section 8), then writes both rows in one Dexie `rw` transaction for the **logged-in wallet's id**. The id is never taken from the request.
- `MessageTypes.CLEAR_SUBMIT_API` (`addToOptions`): deletes both rows.
- `MessageTypes.TEST_SUBMIT_API` (`addToOptions`): see section 7.

`addToOptions` handlers are reachable only from the extension's own pages (`messaging.ts`: the options channel is default-deny), so a dApp cannot read or change the setting.

## 6. Router behaviour

### 6.1 Custom request

```
POST <url>
Content-Type: application/cbor
<headerName>: <headerValue>        (only when configured)
body: raw CBOR bytes (hex decoded)
```

- `redirect: 'error'`. On a cross-origin redirect fetch drops `Authorization` but keeps custom headers such as `project_id` and `X-Api-Key`, so following a redirect could hand the key to another host. A real submit API never redirects.
- `credentials: 'omit'`.
- Timeout 30 s (`AbortSignal.timeout`).
- The response text is redacted (the header value becomes `***`) and then capped at 512 characters plus an ellipsis, so a hostile endpoint cannot flood error messages.

### 6.2 Success

- Any 2xx status counts. cardano-submit-api answers 202.
- Body: a JSON-quoted string or a bare hash. Trim it, strip surrounding quotes, and require 64 hex characters.
- **Compare it to the tx ID computed locally** from the CBOR (`Serialization.Transaction.fromCbor(...).getId()`). If they differ, fail with "Your submit endpoint returned a different transaction ID. The outcome is unknown, check your transaction history." The caller does not record a pending transaction. This keeps a broken or hostile endpoint from planting a fake entry in history.
- A 2xx with an unparseable body goes through the existing `unexpectedSubmitResponseError` path.
- The parse, the 64-hex check and the local comparison apply to the **custom** branch only. A default-branch success body is passed through unchanged, and each caller keeps validating it exactly as it does today.

### 6.3 Failure classes (custom endpoint)

| Result | Meaning | Fallback eligible |
|---|---|---|
| 400 | The node rejected the transaction. Report the node's reason via `describeSubmitFailure` | **No**. Gero would reject the same tx, and resending only leaks it |
| 401, 403 | Auth refused (wrong key, or a Nexus key whose `allowed_paths` lacks the submit route) | Yes |
| 404, 405 | Wrong path | Yes |
| 425, 429 | Mempool full, or rate limited | Yes |
| 5xx | Endpoint error | Yes |
| Network error, timeout, blocked redirect | Endpoint unreachable | Yes |

### 6.4 Fallback off (default)

The failure goes back to the caller with a "Your submit endpoint: " prefix, so the user can tell their endpoint failed rather than Gero. A timeout or lost response keeps the existing honest wording: the outcome is unknown, check history before resending.

### 6.5 Fallback on

An eligible failure resubmits through the default branch and returns `via: 'default'`.

Edge case: after a custom **transport failure (timeout, network error, reset, blocked redirect), HTTP 408 or any 5xx** the transaction may already be in the mempool, so the fallback can come back 400 (inputs already spent). The router reports that 400 as "outcome unknown, check your transaction history", not as a rejection; after a 401, 403, 404, 405, 415, 425 or 429 the endpoint refused the request before any node saw it, so the fallback outcome is returned unchanged.

### 6.6 Last result

After every submit from a wallet **with a custom endpoint configured**, the router writes `{ at, via, error? }` under `submitApiLastResult:<walletId>` in `chrome.storage.session`. Wallets on the default path write nothing.

- `error` is the short user-facing reason. It never includes the URL path or query, or the header value.
- `chrome.storage.session` is readable by extension pages but not by content scripts (default access level), and it is cleared when the browser restarts.
- The Settings row shows it (section 9). No signing dialog changes.

### 6.7 Invalid saved config

The router re-validates the stored `submitApi` row on every submit. If the row fails validation (corrupted or tampered), the submit **fails closed** with "Your Submit API setting is invalid. Fix it in Settings → Advanced." It never silently uses the default path, because that would break the privacy promise. A `submitApi` row that exists but holds `null` is such a row, not an absent one.

If the wallet DB cannot be read at all, the submit fails with `storageUnavailable`: "Could not read this wallet's Submit API setting. Nothing was sent." It is not reported as a possibly-sent transaction, because nothing left the wallet.

### 6.8 Feature flag

The router honours a saved config **whatever `isSubmitApiEnabled` says**. If turning the flag off remotely made the router ignore saved configs, privacy users' transactions would go to Gero without their consent.

## 7. Test endpoint

`TEST_SUBMIT_API` takes the form's **unsaved** values: `{ url, headerName, headerValue? }`. When `headerValue` is omitted it uses the stored secret, read in the background. The values are validated exactly as for a save.

The background posts a single `0x00` byte as `application/cbor`, with a 10 s timeout and `redirect: 'error'`. No real transaction ever leaves.

| Response | Result shown |
|---|---|
| 400 | Reachable, looks like a submit API ✓ |
| 2xx | Warning: the endpoint accepted invalid bytes, so it is probably not a submit API |
| 401, 403 | Authentication failed |
| 404, 405 | Wrong path |
| 5xx | The endpoint answered with a server error |
| Network error, timeout, redirect | Unreachable |

The test runs in the background, in the same place as real submits. The extension CSP is static and its `connect-src` also governs the MV3 service worker; `host_permissions` does not bypass it. A user-chosen endpoint can be any host, and a CSP cannot be extended at runtime, so `connect-src` has to carry the scheme sources `https:` and `http:` (the explicit entries stay, to document intent). The router is the only code that sends to a user-chosen URL, and only to the saved, validated endpoint. `connect-src` is not remote code, so the remote-code guard is unaffected.

## 8. Validation

One pure module, `src/shared/utils/submitApiConfig.ts`. The UI uses it for inline errors, and the background re-runs it as the authority: on save, on test, and on every submit.

- **URL:** parses with `new URL`; `http:` or `https:` only; no username or password; at most 2048 characters; any fragment is dropped.
- **Nexus network guard:** if the URL path ends in `/api/transactions/submit`, the query must contain `network=cardano-<wallet network>` (`cardano-mainnet`, `cardano-preprod` or `cardano-preview`). Error: "Add ?network=cardano-mainnet to the URL". Nexus otherwise resolves its own default network, and a preprod wallet would hit mainnet and fail with a confusing "inputs not found". The check is on the path, not the host, so self-hosted Nexus is covered too.
- **Header name:** an RFC 7230 token (`^[!#$%&'*+.^_\`|~0-9A-Za-z-]+$`) of at most 64 characters. Names fetch drops or that would break the request are rejected: `host`, `content-type`, `content-length`, `cookie`, `origin`, `referer`, `connection`, `transfer-encoding`, `keep-alive`, `upgrade`, `te`, `trailer`, `expect`.
- **Header value:** no CR, LF or NUL; at most 4096 characters; required when a header name is set.
- **Plain http:** an `http:` URL whose host is not local (loopback, RFC 1918 private ranges, link-local, `.local`):
  - shows a warning without an auth header: "Not encrypted: anyone on the network path can see your transactions."
  - is **rejected** with an auth header: the key would cross the internet in cleartext.
  - Local hosts are allowed over http, so SPOs can reach a submit API on their LAN.

## 9. UI

### 9.1 Settings → Advanced row (`AdvancedSettingsTab.vue`)

Shown only for `Blockchain.CARDANO` wallets, after "Re-sync wallet". Visible when `isSubmitApiEnabled` is on **or** the wallet already has a `submitApi` row, so a user can always see and clear an active setting.

- Title **Submit API**. Helper: "Send this wallet's transactions through your own endpoint."
- Right side: status text **Default** or **Custom**, plus a **Configure** button.
- With a custom endpoint, a caption shows the last result: "Last submit: sent via your endpoint, 10:32" or "Fell back to Gero, 10:35 (503)".
- A "new" dot through `FEATURE_DEFINITIONS`: `{ id: 'settings.advanced.submitApi', version: '2.7.3', path: ['settings', 'advanced', 'submitApi'] }`, marked seen when the dialog opens, and also when the Advanced tab was visited before Settings closed (Bitcoin, Midnight and Apex wallets never show the row, so the dot would otherwise stay). Same pattern as auto-withdraw.

### 9.2 `SubmitApiDialog.vue` (on `BaseDialog`)

1. **Submit URL.** Placeholder `https://nexus.gerowallet.io/api/transactions/submit?network=cardano-mainnet`. Caption: "Works with Nexus, cardano-submit-api, Blockfrost and Koios submit URLs." Network line: "Must point at Cardano Mainnet", taken from the wallet's network. Under it: "Put API keys in the header fields, not in the URL." (the URL is stored in the public, broadcast row).
2. **Header name** (optional). Placeholder `X-Api-Key`.
3. **Header value** (optional). Password-type field. A saved value is never sent back to the page: the field reads "Saved" with **Replace** and **Remove**.
4. **Fall back to Gero if my endpoint fails** toggle, default off. Caption: "If on, a failed submit is retried through Gero's servers. Leave off if Gero must never submit your transactions."
5. Plain-http warning or block, per section 8.
6. Actions:
   - **Test**, with an inline result line and icon.
   - **Reset to default**, with a confirm. Sends `CLEAR_SUBMIT_API`.
   - **Save**, disabled until the form is valid.

### 9.3 Rules

- All copy through `$t()` under `settings.submitApi.*`, added to `us.ts`, `de.ts` and `es.ts` in the same commit. Reuse existing keys (`common.save`, `common.cancel`, …) before adding new ones. No em dashes in UI copy.
- `v-select` / `v-autocomplete` take `attach` (none are planned).
- Existing type ramp, tokens and glass classes only: no new hex, radius, font-size, `transition: all`, clickable `<div>` or `outline: none`, so the design ratchet stays at budget. `GButton` tiers for actions.

## 10. Nexus server change (separate PR, `nexus` repo)

`CardanoTransactionsController` (`/api/transactions`) today has:

```java
@PostMapping("/submit")
public ResponseEntity<String> submitTransaction(
        @RequestParam(value = "network", required = false) Network network,
        @RequestBody String txBytesHex)
```

Add a sibling mapping:

```java
@PostMapping(value = "/submit", consumes = "application/cbor")
public ResponseEntity<String> submitTransactionCbor(
        @RequestParam(value = "network", required = false) Network network,
        @RequestBody byte[] txBytes)
```

- Same size limit and network resolution as the hex path, and the same `cardanoTransactionFacade.submitTransaction(txBytes, network)`. It returns the tx hash exactly like today.
- The existing hex `String` mapping stays. The wallet's Preview default path still posts `text/plain` hex.
- Invalid CBOR (the wallet's test probe `0x00`) returns 400.
- Tests cover both content types, plus checking that an `application/cbor` request reaches the byte variant rather than being read as a string.
- OpenAPI annotations document the new content type.
- API keys: users need a Nexus key for the wallet's network whose `allowed_paths` includes `/api/transactions/submit`. No Nexus change is needed for that.

**Ordering:** the wallet PR can merge first, because the flag is dark. The Nexus change must be **deployed** before `isSubmitApiEnabled` is turned on.

## 11. Security

- **Entry points:** `SET_SUBMIT_API`, `CLEAR_SUBMIT_API` and `TEST_SUBMIT_API` are `addToOptions` only and act on the logged-in wallet.
- **Secret handling:** the header value never reaches `walletStore`, broadcasts, `chrome.storage.local`, the page (the field is write-only), logs, or error strings.
- **Logging:** `debugLog()` only, and only the endpoint **origin**. Paths and queries can carry API keys (some providers accept `?api_key=`). No `console.*` with config values.
- **At rest:** the header value is stored in plain text in the wallet's IndexedDB, like SPO agent tokens. It cannot be sealed under the spending password because a dApp `submitTx` arrives without one.
- **dApp isolation:** no CIP-30, CIP-45 or WalletConnect method exposes or changes the setting.
- **Accepted risk:** a hostile or broken endpoint sees signed transactions (public once on chain anyway) and the user's IP address. It cannot alter a signed transaction. It can swallow one while returning the correct hash. The transaction then stays pending in history until the user removes it with the existing "remove pending transaction" action. This is documented in the help text.
- **No new dependencies.** The remote-code guard is unaffected.

## 12. Testing

### Unit (vitest)

- `src/shared/utils/submitApiConfig.spec.ts`: the validation matrix. URL schemes, credentials in the URL, length, the Nexus network guard (missing, wrong, right, self-hosted path), header-name tokens and the forbidden list, CR/LF/NUL in values, local-host detection (loopback v4/v6, RFC 1918, link-local, `.local`, public), and plain http with and without auth.
- `src/chrome/submitRouter.spec.ts`, with mocked `fetch`:
  - unset config calls the default function with identical arguments
  - custom success (202 with a quoted body, 200 with a bare body)
  - hash mismatch
  - every failure class × fallback on/off
  - a transport failure, 408 or 5xx followed by a fallback 400 gives "unknown"; a 401, 403, 404, 405, 415, 425 or 429 followed by a fallback 400 passes the 400 through unchanged
  - a fallback that fails or throws leaves the endpoint failure as the last result (`via: 'custom'`)
  - an endpoint body of 5,000 characters comes back capped at 512 plus an ellipsis
  - a `submitApi` row holding `null` fails closed; an unreadable wallet DB gives `storageUnavailable` and sends nothing
  - redirect blocked
  - header sent exactly once with the right name
  - the header value never appears in any thrown error or last-result entry
  - flag off still honours the config
  - an invalid stored row fails closed
- `ConfigLoader`: `submitApiAuth` never reaches `WalletStore.setConfig`.
- Background handlers: the logged-in wallet's id is used, and validation runs on the server side.
- Remember the skill's warning: under happy-dom `getContextType()` returns `'content'`, so store broadcast paths are no-ops. Confirm each regression test fails on broken code.

### CI wiring

Add the new spec files to the named list in `.github/workflows/dev-bundle-gate.yml`. CI runs only named specs, so unnamed ones never gate anything.

### Gates

`src/plugins/i18n.parity.spec.ts`, `npm run design:check`, `npm run build:web -- --mode production`, ESLint on every touched file.

### Manual (mainnet, since Cardano hardware wallets are mainnet-only)

- Endpoints: own cardano-submit-api, Blockfrost (`project_id`), Koios, Nexus (`X-Api-Key`, after the Nexus deploy).
- Flows: in-wallet send, CIP-30 dApp submit, WalletConnect, one Ledger or Trezor send.
- Fallback on and off against an unreachable URL. The Test button against each of the six response classes.
- Reset to default restores 2.7.2 behaviour.

## 13. Rollout

1. Wallet PR to `development` with `isSubmitApiEnabled` default off.
2. Nexus PR merged and deployed.
3. QA on a 2.7.3 build with the flag flipped for testers.
4. Version bump and tag at release time (no release branch). Flip `isSubmitApiEnabled` on.
