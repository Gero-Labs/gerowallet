# Bring Cashback Portal Migration — Design

**Date:** 2026-07-02
**Status:** Approved (design)
**Reference:** https://github.com/Bring-Web3-LTD/cashbackPortal/blob/main/README.md

## Goal

Replace the wallet's custom-built cashback screens with the Bring-hosted
**Cashback Portal** embedded as an `<iframe>`, wired through the README's
`postMessage` contract. Bring's portal then owns retailer discovery, rewards,
and claims; the wallet only provides wallet address, session token, and message
signing.

## Current state (what we're replacing)

All cashback screens are custom Vue UI backed by `/api/bring/*` on gero-backend:

- `src/modules/cashback/Cashback.vue` — options-page grid (retailers, categories, search).
- `src/sidepanel/pages/CashbackPage.vue` — sidepanel deals list.
- `src/modules/cashback/dialogs/RetailerDialog.vue` — retailer terms + activate.
- `src/modules/cashback/dialogs/ViewRewardsDialog.vue` — rewards + claim (claimInit → signData → claimSubmit).
- `src/modules/cashback/dialogs/HowItWorksDialog.vue` — static text.
- `src/modules/dashboard/components/CashbackCard.vue` — dashboard widget (reward totals + carousel).
- `src/stores/bringStore.ts` — `bringCache` observable, populated from `cashback-api.cache()`.
- `src/api/cashback-api.ts` — `checkAvailability`, `categoriesSearch`, `retailers`, `activate`, `claimInit`, `claimSubmit`, `cache`.

**Unrelated, keep as-is:** `@bringweb3/chrome-extension-kit` (content-script
popup on retailer sites) — `src/chrome/content.ts`, `src/chrome/background.ts`,
`AdvancedSettingsTab.vue`. Not touched by this migration.

## Architecture

New shared component **`src/modules/cashback/CashbackPortal.vue`** hosts the
iframe and owns the entire bridge. Both screen entry points render it:

- `CashbackPage.vue` (sidepanel) → keep header/back chrome, body = `<CashbackPortal>`.
- `Cashback.vue` (options) → body = `<CashbackPortal>`.

`CashbackPortal.vue` is a single-purpose unit: given the current wallet address
and theme, it loads the portal and brokers messages. It depends on
`cashback-api.portal()`, the wallet store (address + theme), and the background
`signData` messaging.

## Backend contract (gero-backend — separate repo, out of scope to implement here)

New proxy endpoint, mirroring the existing `/api/bring/*` + Nexus proxy pattern
(API key stays server-side; never shipped in the extension):

```
POST {VITE_BACKEND_URL}/api/bring/portal
body: { walletAddress: string | null, theme: 'dark' | 'light' }
→ 200 { portalUrl: string, token: string }
```

The endpoint injects `x-api-key` and calls Bring's
`POST https://api.bringweb3.io/v1/extension/check/portal`, returning `portalUrl`
(token embedded in the URL per README) and `token` (for `SESSION_UPDATE`).

Frontend adds `cashback-api.portal(walletAddress, theme)` calling this endpoint.

**Dependency:** the frontend cannot function end-to-end until this endpoint
exists. The frontend is built defensively (loading + error states) so a missing
endpoint degrades to an error panel, not a crash.

## postMessage bridge (CashbackPortal.vue)

**Outbound (wallet → portal)** — always target the explicit `portalOrigin`
(derived from `new URL(portalUrl).origin`), never `'*'`:

- Initial load: set `iframe.src = portalUrl` (token embedded; no postMessage needed).
- Re-sync on wallet-switch / theme-change: `portal()` again → `postMessage({ to:'bringweb3', action:'SESSION_UPDATE', token }, portalOrigin)`.
- `SIGNATURE { signature, key, message }` after a successful sign.
- `ABORT_SIGN_MESSAGE` on user rejection or signing failure.

**Inbound (portal → wallet)** — a `window` `message` listener guarded by
`event.origin === portalOrigin && event.data?.from === 'bringweb3' && event.data.action`:

- `LOGIN` → wallet is already logged in in-app; re-bootstrap for the current
  address and send `SESSION_UPDATE`. If the wallet is locked, trigger the
  existing unlock flow first, then bootstrap.
- `SIGN_MESSAGE { messageToSign }` → `Messaging.sendToBackground(signData, messageToSign)`
  → on success `SIGNATURE { signature, key, message: messageToSign }`; on
  error/reject `ABORT_SIGN_MESSAGE`.
- `POPUP_CLOSED` → informational, ignore.

Listener is added on mount and removed on unmount.

## Wallet wiring

- `walletAddress`: the same cashback/base address currently passed to
  `cache()` (from `walletStore.loggedWallet`). `null` when no wallet / locked.
- Signing: existing background `signData` (CIP-8) returns `{ signature, key }`,
  which maps directly onto the portal's `SIGNATURE` payload. No new signing code.
- Theme: `'dark'` (wallet is dark-themed; wire to the app theme if a light mode exists).

## UI / routing / deletions

- **Add:** `CashbackPortal.vue`; `cashback-api.portal()`.
- **Rewrite:** `CashbackPage.vue`, `Cashback.vue` → thin hosts of `CashbackPortal`.
- **Delete:** `RetailerDialog.vue`, `ViewRewardsDialog.vue`, `HowItWorksDialog.vue`;
  `bringStore.ts`; the now-unused `cashback-api` methods (`checkAvailability`,
  `categoriesSearch`, `retailers`, `activate`, `claimInit`, `claimSubmit`,
  `cache`) and their i18n keys where no longer referenced.
- **CashbackCard.vue:** becomes a static CTA teaser that navigates to the
  cashback screen. Drops live reward numbers (portal owns that data). Keeps the
  visual/promo treatment.
- Remove dangling imports/store subscriptions for `bringStore`.

## Config / CSP / security

- `scripts/manifest.ts`: add the portal origin (e.g. `https://portal.bringweb3.io`)
  to `frame-src`. Regenerate `extension/manifest.json`.
- No new `connect-src` (bootstrap targets our backend, already allowed).
- No new extension env var (Bring key is backend-side).
- Security invariants: explicit `portalOrigin` on every `postMessage`; validate
  `event.origin` + `from:'bringweb3'` on every inbound message; `iframe.src`
  only ever set from the backend-returned `portalUrl` (trusted; no
  user-controlled URL → no SSRF/redirect injection).

## Error handling

- `portal()` failure (incl. missing backend endpoint) → error panel with retry,
  not a blank iframe or crash.
- Signing rejection/failure → `ABORT_SIGN_MESSAGE` so the portal can recover.
- Wallet locked at `LOGIN` → unlock flow, then bootstrap; if unlock cancelled,
  do nothing (portal stays in connect state).

## Testing

Repo has no component-test harness. Verification:

- `npm run typecheck` + `npm run lint` clean on touched files.
- Bridge logic: extract the message-handling into a pure/testable function where
  practical and add an origin-guard check (reject wrong origin, reject non-bring
  `from`); verify via the welcome-preview-harness pattern (headless render with a
  mocked iframe + synthetic `message` events) since the full app needs crypto.
- Manual: load the cashback screen with the backend endpoint (or a stub) and
  confirm load, session update on wallet switch, and a sign round-trip.

## Risks / open questions

1. **Backend endpoint** `/api/bring/portal` must be built (separate repo). Blocks
   end-to-end until then.
2. **Portal origin + token shape** — confirm the real `portalUrl` origin (for CSP
   + `postMessage` target) and that the token is query-embedded, against a live
   bootstrap response.
3. **Irreversible deletions** — removing the custom claim flow assumes the portal
   fully covers activation + claims. Confirm before merge.
4. **Options vs sidepanel sizing** — the iframe must fill each host responsively
   (`width/height:100%`, no body horizontal scroll).
