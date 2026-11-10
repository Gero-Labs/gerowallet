# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gero Wallet - Development Guide

## Overview
Cardano blockchain wallet Chrome extension (Manifest V3). Multi-chain light wallet with portfolio, staking, governance, DeFi, multi-sig, and SPO dashboard.

## Tech Stack
- **Frontend**: Vue.js 3.5 + TypeScript + Vuetify 4.2
- **Build**: Vite 7.3 (4 configs: main, background, content, inject)
- **State**: Custom Vue reactive stores (not Vuex)
- **DB**: Dexie (version in package-lock.json) (IndexedDB) with versioned schemas
- **Cardano**: `@cardano-sdk/core` (version in package-lock.json) (preferred for new features)
- **Hardware Wallets**: Ledger, Trezor, Keystone
- **Real-time**: Gero Sync — push-based WebSocket sync (`VITE_SYNC_WS_URL`)
- **Crypto**: Local chain SDK WASM, versioned password-secret encryption, and a separate PRF path

## Project Structure
```
src/
  chrome/          # Extension: background.ts, walletBg.ts, messaging.ts, cardanoJsSdkCbor.ts
  modules/         # Feature modules (Vue components): dashboard, staking, governance, swap, pool-operator, etc.
  stores/          # Vue reactive stores: walletStore, geroStore, networkStore, poolOperatorStore, etc.
  services/        # Business logic: sync, websocket (Gero Sync), walletManager, storeMessaging
  db/              # Database: gero-db.ts (app-level), wallet-db.ts (per-wallet)
  api/             # Data clients: Gero/Nexus plus direct Esplora, Koios and Midnight providers
  shared/          # Reusable: utils/, composables/, components/
  options/         # Extension options page entry
  popup/           # Active approval views rendered by the options router
  sidepanel/       # Extension side panel entry
```

## Critical Patterns

### Chrome Messaging
- **All wallet UI surfaces**: `Messaging.sendToBackgroundFromOptions()` for `MessageTypes.*`
- **dApp-facing registry**: `Messaging.sendToBackground()`; selection is by registry, not window type
- **Response format**: `{ data: { success, error?, result? }, target, sender }`
- **Background handler**: register with `app.addToOptions()`. The messaging listener keeps the channel open; call `sendResponse` exactly once on every path, including errors. The registered handler return value is ignored.

### State Management
- Stores use `broadcastFromBackground()` to sync across contexts
- **ALWAYS use in-memory state** as base for Chrome storage updates (prevents race conditions)
- Browser contexts subscribe via `storeMessaging.subscribe(STORE_NAME, handler)`
- **Never put a secret, a secret-derived hash, a key or a credential in `chrome.storage.local`**, and never let the worker trust a security-relevant value read back from it: every content script (and the Bring SDK inside ours) can read and rewrite it. Use `privateStore.ts` (extension-origin IndexedDB) or the wallet DBs; stores persisted through `StorePersister` take secrets out with `redact` and keep the authoritative copy of a field the worker relies on in `trustedFields`. The secret field lists are in `storageRedaction.ts`
- **Never put multi-MB values in `chrome.storage.local`.** Each changed value is copied old+new, on Chrome's browser UI thread, into every `storage.onChanged` listener: the worker, every dashboard, and the Bring SDK in the content script of every frame of every tab. Whole-store rewrites froze all Chrome windows, other profiles included. `walletStore`/`networkStore`/`midnightStore` persist through `StorePersister` (`src/utils/storePersistence.ts`): a small record in `chrome.storage.local` plus bulk fields (transactions, UTxOs, tokens, collections, assets, …) in the `gero-store-cache` IndexedDB, written only when that field changed

### Database
- **App-level** (`gero-db.ts`): `GeroWalletDatabase` — wallets list, config, provider
- **Per-wallet** (`wallet-db.ts`): `wallet-{id}` — transactions, addresses, config, etc.
- **Always apply schema on EVERY open**, not just creation (prevents "No Table" errors)

### Cardano SDK
```typescript
import { Cardano, Serialization } from '@cardano-sdk/core';
// Use modern SDK for new features. Conversion: cardanoJsSdkCbor.ts
```

### Transaction Fee Calculation (Conway Era)
- `cardanoJsSdkCbor.ts`: `BrowserTxConstruction.minFee()` sizes unsigned transactions with unique dummy witnesses via the SDK, then adds `80 * minFeeCoefficient`. Already witnessed transactions use the SDK calculation directly
- `builder.ts`: Always create change output for certificate/withdrawal-only transactions
- `resolver.ts`: Recognizes Conway certificate types (Unregistration, Registration, StakeRegistrationDelegation)

## Commands
```bash
npm run dev              # Dev (all contexts)
npm run build            # Production build
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm test -- --maxWorkers=2 # Full unit suite
npm run design:check      # Design and contrast gates
```

See [MAINTENANCE.md](MAINTENANCE.md) for diagnostic baselines and the
[release runbook](spikes/vue3-migration/RELEASE-READINESS.md) for qualified
packaging. Legacy `pack:*` utilities do not perform release qualification.
Releases run through `.github/workflows/chrome-web-store.yml`: its first job calls
`ci-cd.yml` to build and test the commit, the full gerowallet-e2e-tests isolated suites
run against that ZIP, and once the environment approves it tags `v<version>` and uploads
that exact ZIP (`.github/runbooks/chrome-web-store.md`). `ci-cd.yml` alone never tags.

## Key Rules

### ESLint
- **Fix ESLint issues in every file you touch** — resolve any existing or newly introduced ESLint errors/warnings before moving on

### i18n
- **Always use `$t()` for user-facing text** — never hardcode strings
- Translation files: `src/plugins/i18n/us.ts` (English), `de.ts` (German), `es.ts` (Spanish: neutral Latin American, tú, Lace terminology)
- **When adding keys to `us.ts`, always add the corresponding German in `de.ts` and Spanish in `es.ts`**. `src/plugins/i18n.parity.spec.ts` fails on any missing key, placeholder or plural drift
- **Before creating a new i18n key, search for an existing key with the same text** (e.g., `errors.insufficientBalance` already exists — reuse it instead of creating `perpetuals.insufficientBalance`)

### Vuetify
- `v-select`, `v-autocomplete`, `v-combobox`: **Always use `attach` prop** (prevents dropdown positioning issues on scroll)

### Vue Event Handlers
- **CRITICAL**: `@click="handler"` passes Event as first arg, overriding defaults. Use `@click="handler()"` when function has default params.

### Security
- Write stored password secrets through `sealTextSecret` / `sealKeySecret` in
  `secretWriters.ts`. They select field-specific current formats or purpose-bound
  `gpw2` when enabled. Preserve legacy readers; PRF encryption is separate.
- Background script isolation for sensitive operations
- Never log sensitive data
- Use `debugLog()` for dev logging

### Extension Context Detection
- Use `typeof chrome !== 'undefined' && !!chrome.runtime?.id`
- Do NOT use `import.meta.env.DEV` for URL selection (baked in at build time)

## Store Broadcasting Pattern
```typescript
function broadcastFromBackground(updates: Partial<StoreType>) {
  if (context === 'background') {
    const serialized = JSON.parse(JSON.stringify(updates, (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return Array.from(value);
      return value;
    }));
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serialized);
    // Persists only the touched fields, from in-memory state (NOT chrome.storage.local.get()).
    // Small fields go to chrome.storage.local[STORE_NAME]; `bulkFields` go to IndexedDB.
    persister.markDirty(Object.keys(updates));
  }
}
```

## Gero Sync Real-time Service
- Push-based WebSocket sync (replaced Ably): `src/services/websocket.service.ts` + `src/services/sync.service.ts`
- Connect via `VITE_SYNC_WS_URL`; the server pushes tip/updates (no client polling)
- **Reconnect + re-subscribe on wallet switch** (subscribe to the new wallet's addresses / stake key)
- **Non-blocking connection** — don't block wallet login waiting for sync
- Use async-mutex for sync/tip processing
- Message contract invariants: `SYNC_CHECK_OK` / `CATCH_UP_COMPLETE`

## CIP-113 Programmable Tokens (Stage 1 — read-only)
- **Config**: `src/utils/cip113Deployments.ts` — one `readonly string[]` of `programmable_logic_base` script hashes per network, with bootstrap tx, uplc.link verification and source commit recorded beside each. Reviewed protocol constants, NOT env config: a wrong hash badges someone else's UTxOs as the user's. Empty = unsupported, fails closed. The deployments are permanent: CIP-113 is not re-bootstrapped, contract changes ship as **upgrades** of the existing deployments (a hard rule on mainnet, preferred on preprod/preview). If a hash ever does change anyway, mainnet **retains** the superseded hash next to its replacement until its holdings drain (removing it would hide every user's holdings and leave that lovelace looking spendable to max-send and swap sizing); on preprod/preview the earlier bootstraps were **removed**, so UTxOs still at an old script classify as `foreign` (not shown, not refused, lovelace left inside the stake-level total). `networks.ts` re-validates the hex shape.
- **Two build-time gates, both required**: `CIP113_ALLOWED_NETWORKS` (same file, checked first; currently mainnet + preprod + preview) AND the deployment list above. CIP-113 is live wherever both pass, i.e. on all three networks. A network failing either ⇒ `programmableBaseScriptHashes()` is empty ⇒ no partition, no refusal index, and `subscriptionCredentials()` keeps the server-side allowlist — i.e. exactly pre-CIP-113 behaviour.
- **Discovery**: these UTxOs sit at the shared PLB *script* address carrying the wallet's own stake credential. gero-sync's SUBSCRIBE `credentials` array is a **strict allowlist of payment key hashes** and can never match a script hash — so when a network has PLB hashes configured, `walletBg.subscriptionCredentials()` sends `[]` and the server resolves everything under the subscribed stake address. The allowlist is only a filter over that stake-anchored set (verified on mainnet 2026-10-07), so `[]` loses no UTxO: own-payment-key addresses outside the stake address (enterprise, other stake part) were never synced in either mode. It does lose the `addresses` echo: with `[]` gero-sync names only addresses with on-chain history, none for a never-used wallet, so `walletBg.loadCachedKeys()` derives the keys locally when no row is cached (otherwise a fresh wallet has no receive address, DRep ID or stake key to sign with). **Payment-key owners**: a dApp may put one of the wallet's PAYMENT keys in the owner slot instead (Minswap V3 does). That address belongs to a different reward address, so the stake anchor never returns it; the SUBSCRIBE names those addresses in `programmableAddresses` (`walletBg.programmableSubscriptionAddresses()`: PLB hash × payment key, external/internal interleaved, capped at `PROGRAMMABLE_SUBSCRIPTION_ADDRESS_CAP` = 100, the same cap gero-sync applies) and gero-sync merges their UTxOs into the one full set. `websocket.service` sends the field for Cardano only and only when non-empty.
- **Partition**: `classifyUtxoAddress()` (`src/chrome/serialization.ts`) → `spendable` | `programmable` | `programmable-other` | `foreign`. Spendable checks run first, so programmable UTxOs never enter coin selection or the balance total.
- **Never signable for a dApp**: `refusalForProgrammableInputs()` in `background.ts` preflights CIP-30 and CIP-45 `signTx`, WalletConnect, cross-device relay and the `TREZOR` handler; `walletBg.signTx` re-checks. Ledger, Keystone and Trezor over WebUSB sign in a page, so `txToLedger`, `createKeystoneSignRequest` and `dispatchTrezor` first ask the worker (`assertCip113SignAllowed()`, `CIP113_SIGN_PREFLIGHT`) and sign nothing without an answer. The `txId#index` refusal index lives in the existing per-wallet `config` row — no schema bump. The preflight also refuses a transaction that withdraws the network's PLG (`CIP113_GLOBAL_*`) with one of the wallet's keys as a required signer (`cip113Guard.ts`), which covers a programmable UTxO not synced yet.
- **Gero's own Send (preprod and preview)**: `CIP113_PREPARE_TRANSFER` (extension pages only) takes token, amount and recipient; the worker chooses the inputs (`cip113SelectInputs.ts`: one owner, fewest UTxOs), has Nexus build (`POST /api/tx/build/cip113-transfer`), checks the CBOR against the intent (`cip113VerifyTransfer.ts`: exact inputs, the three zero withdrawals, a reviewed logic template re-applied via `cip113Uplc.ts`, the owner as only required signer, outputs, fee/ADA/collateral/validity caps), and grants a one-shot allowance for that tx id (`cip113Allowance.ts`, in memory, 5 min). Only `walletBg.signTx` consumes it; the hardware refusal (`hardwareSignRefusal()`: the preflight and the `TREZOR` handler) honours it without consuming it, and the dApp refusals never read it. Hardware signers ask the device for the owner's key only: required signers map by key hash (Keystone, Trezor, Ledger), and the stake key is asked for only for the wallet's own reward withdrawal or certificate, never for the three script withdrawals. Hardware Send is gated by `CIP113_SEND_HARDWARE_WALLET_TYPES` (`cip113Deployments.ts`, `isCip113SendHardware()`): empty until each device has signed a real preprod transfer; the worker's prepare and the Send button both read it, so empty means software only. Send needs `CIP113_SEND_ALLOWED_NETWORKS` plus a `CIP113_TRANSFER_*` hash; the templates in `cip113TransferLogic.ts` are the same list as Nexus's and need review on both sides. UI: `canSendProgrammable()` (`programmableTokenDisplay.ts`: `isCip113Enabled`, a password, PassKey or Google-MPC Cardano wallet or a listed hardware wallet, those networks, a registered token) shows Send in `TokenDetailPanel` and the side-panel token sheet; both host `ProgrammableSendFlow.vue`, which runs `useCip113Send` (PREPARE → VERIFY_SPENDING_PASSWORD → SIGN_TX → SUBMIT_TX `{txCbor, witnessHex}`, the CBOR never re-encoded). A hardware wallet signs in the page instead of SIGN_TX through `useHardwareTxSigner` (shared with the swap signer: Ledger, Trezor, Keystone QR via `KeystoneSignDialog`); the page then fetches Nexus's witness for sponsored collateral (`summary.sponsoredCollateralRef`, which SIGN_TX adds in the worker for software wallets) and submits the same way. A device refusal carrying `CIP113_SIGN_REFUSAL_MESSAGE` means the allowance expired: build again.
- **Balance**: `account.controlled_amount` is a stake-level total, so it includes the lovelace at PLB addresses the stake key owns. `walletStore.setAccount()` subtracts `programmableLockedLovelace` (that stake-owned share only) from it (carrying the provider figure in `controlled_amount_total` so repeated application is idempotent); the `account` DB row keeps the unadjusted total. Lovelace under a payment-key owner is in `programmableLockedLovelaceOutsideStake`: never in that total, so never subtracted; the locked-ADA row shows both (`totalProgrammableLockedLovelace()`).
- **Display**: `walletStore.programmableTokens` → `useHoldingsValuation()` (locked *tokens* priced at 0, locked ADA at the native rate, `isProgrammable`, distinct `rowKey` so a dual-held unit doesn't collide), rendered with a lock badge and the `programmableTokens.badge` chip.
- **Registry check (issue 1267)**: anyone can pay any token to the PLB address, so the badge needs the policy in the deployment's CIP-113 registry. `CIP113_REGISTRY_*` (`cip113Deployments.ts`, same review bar as the PLB hashes) are the registry node policies: each registered policy has a node NFT under that policy named after the policy id, and nodes are never removed. The background reads them through gero-backend's Nexus proxy (`GET /api/nexus/api/policy/{id}/assets`, `cip113-registry-api.ts`) and caches the list per network in `chrome.storage.local.cip113Registry` (`src/chrome/cip113Registry.ts`: a held policy the copy never asked about is asked about at once, an unlisted one after 10 min, otherwise every 6 h; 1 min back-off after a failed read). `setProgrammableAssets` stamps `cip113Registered` on each token. Fails closed: unread or unlisted ⇒ no chip or lock icon, `verified: false`, no verified-filter exemption (`isCip113BadgeRow()`). The token stays in `programmableTokens`, so it is still locked, unpriced, refused and subtracted from the balance.
- **CIP-68**: label-100 reference tokens are filtered out of the display; `cip68Label()` in `resolver.ts` strips the label prefix so names don't render as truncated hex.

## Legacy listing rescue (phase 0)
- **What**: owner-signed cancels that return NFTs and ADA stuck at a closed marketplace's two Plutus V2 contracts (`legacy_v3`, `legacy_v2`), Cardano mainnet only. Script hashes, reference scripts and cancel redeemers are pinned in `src/utils/legacyMarketScripts.ts`: cancel only, one contract per transaction (never mixed), per-version caps `LEGACY_CANCEL_MAX_BY_CONTRACT` (v3 10, v2 6) under `LEGACY_CANCEL_MAX` = 10.
- **Discovery**: `useLegacyListings` → Nexus `POST /api/legacy-listings/by-owner` through the gero-backend proxy (`legacy-listings-api.ts`) with the wallet's own payment and change key hashes, never the stake key. Nexus answers from an hourly index of the contracts and re-checks every row is unspent at query time.
- **Cancel**: `LEGACY_LISTING_PREPARE_CANCEL` (extension pages only) takes only refs. The worker (`legacyCancelPrepare.ts`) looks them up again under the wallet's own key hashes (a ref no longer returned is `LISTING_NOT_FOUND`, one under another owner `NOT_OWNED`), refuses mixed or oversized requests, picks fee inputs at key addresses, has Nexus build (`POST /api/tx/build/legacy-listing-cancel`), and `verifyLegacyCancel()` (`legacyCancelVerify.ts`) checks the exact shape: those inputs plus the wallet's own, exactly the reference scripts, one cancel redeemer per legacy input, the owners as only required signers, every output and the collateral return at one of the wallet's own keys, nothing else in the body, fee at most 2 ADA, collateral at most 5 ADA. The page (`useLegacyRescue` over `usePreparedTxFlow`) signs and submits the exact CBOR; no signing allowance is needed (no programmable input is spent).
- **Collateral**: Nexus lends pool collateral (`sponsoredCollateralRef`) only when the pool would cosign the result (`LegacyCancelBuilder.poolCanCosign`: it refuses when a witness datum is non-canonical), so most datum-hash listings need the wallet's own collateral (`NO_COLLATERAL`). A lent UTxO is accepted only as collateral and co-signed as for CIP-113 Send.
- **Hardware**: gated by `LEGACY_RESCUE_HARDWARE_WALLET_TYPES` (empty, so software wallets only); the worker's prepare and the dialog both read it.
- **UI**: behind `isNftMarketEnabled`: Portfolio's `LegacyListingsCard` + `LegacyCancelDialog`, a "Needs you" row in the notifications inbox and the dashboard bell. Copy says "closed marketplace", never its name.

## Gero NFT market (phase 1)
- **What**: Gero's own marketplace on A.D. Labs' listing contract (public repo Gero-Labs/gero-market-contracts: its rules doc is the authority on every on-chain rule, its test vectors on the output tag). PUBLIC listings only: List, Edit price, Unlist, Buy, and "Move to Gero" from the legacy rescue. A listing with a `buyer` (a later phase) is hidden by Browse and refused by Nexus, the worker and `verifyBuy` (`PRIVATE_LISTING`).
- **Deployments**: `src/utils/nftMarketDeployments.ts`. Reviewed protocol constants, NOT env config, at the same bar as the CIP-113 PLB hashes: the script hash decides which UTxOs are "the user's listings", the reference script and fee address decide what a built buy or cancel may spend and pay, and the contract does not check its own parameters. Keep `sourceCommit` in step. Preprod holds v1; **mainnet is EMPTY** until the audit closes. `networks.ts` re-validates each entry (a fee address by its network's prefix, charset and length) and drops one that fails. A superseded deployment stays until its listings drain. Empty = unsupported, fails closed.
- **Gates**: `NFT_MARKET_ALLOWED_NETWORKS` (mainnet + preprod) AND a non-empty deployment list, so mainnet stays dark while preprod works; `isNftMarketEnabled` is a third, UI-only gate (the signing guard, the `listed` partition and the dApp preview ignore it). Gero's OWN actions are software-only: `NFT_MARKET_HARDWARE_WALLET_TYPES` is EMPTY until each device has signed a real preprod list, cancel and buy, and `canUseNftMarketWallet()` (never a watch wallet) is the one predicate behind the worker's prepare handlers and the pages, so no button is shown that the worker would refuse. A dApp-built transaction on a hardware wallet still goes through the previewed pass; its owner has no Unlist for a dApp-made listing and is told to unlist from that app.
- **Limits** (same file; held before signing, whatever Nexus built): `MIN_LIST_PRICE`, `MAX_LIST_PRICE`, `MIN_SELLER_SHARE`, `MAX_ROYALTIES`, `ROYALTY_RATE_CAP` (above it the seller confirms), `MAX_LISTING_DEPOSIT`, `NFT_MARKET_MAX_FEE_LOVELACE`, `NFT_MARKET_MAX_COLLATERAL_LOVELACE`, `NFT_MARKET_MAX_VALIDITY_SLOTS` (both bounds required).
- **Contract facts**:
  - The contract checks a listing only when it is SPENT, and ignores trailing outputs and overpayment. A list with a wrong owner, seller, price or royalties is accepted on chain and loses the NFT or its proceeds at the first sale, and only the wallet's verifier bounds what else a buy pays. So `decodeListingDatum()` is STRICT: anything but an exact Gero listing is never the user's or bought.
  - The output tag is `blake2b_256(d8799f 5820 <txid> <CBOR uint index> ff)`, an INDEFINITE-length constructor built by hand (`listingTagPreimage()`): a generic PlutusData encoder writes a definite one, which hashes differently and fails every purchase.
  - Redeemers are the opposite on purpose: DEFINITE-length, because the pool cosign oracle refuses indefinite CBOR outside byte strings and would fail a sponsored-collateral buy after the user signed. Nexus's builder owns it.
  - A reprice is an owner cancel plus a new listing, and the contract checks nothing about the new output, so the royalty rule is the wallet's: a reprice carries the royalties a NEW listing at the new price would (decided 2026-11-08), never the old datum's lovelace (which let a seller list low and raise the price, and overpaid after a cut). `prepareReprice` reads the listed NFT's own policy terms and runs the list's `chooseRoyalties` at the new price against the listing's own deployment (same drops, cap, `confirmRoyaltyAboveCap`, seller share), sends them to Nexus (`royalties` in the reprice request, held to a new listing's checks there), and `verifyReprice` holds the datum to exactly those. The deposit is a new listing's for the new datum (Nexus `GeroNewListing.deposit`: min-UTxO at the widest price, so the price alone never moves it); the difference to the old one is paid from, or returned to, the wallet, and the verifier bounds it as a list's (`0 < deposit <= MAX_LISTING_DEPOSIT`). Edit price previews with the collection's current terms (`previewNewListing` at the listing's deployment) and the review says when the deposit moves (`nftMarket.reprice.depositUp/Down`).
- **Discovery and balance**: a listing sits at the script with the seller's STAKE key, so gero-sync returns it as if it were the user's money (as for CIP-113, `subscriptionCredentials()` sends `[]` where a deployment exists). `applyUtxos` keeps `listed` UTxOs out of `walletStore.utxos`, and only what `verifyOwnListing()` proves reaches `walletStore.listedListings`: a strict datum with `owner` a payment key AND `seller_address` an address of the wallet (a one-sided one is a fake "your listing"), one NFT. Pages read it through `reviveOwnListings()` (bigints are decimal strings after a broadcast). The locked deposit is `totalListedLockedLovelace()`, DERIVED from it, never stored beside it: it is inside the provider's `controlled_amount`, so `spendableControlledAmount()` takes it off next to the CIP-113 share. Listed NFTs are merged into collections for DISPLAY only, so never sendable.
- **Signing guard**: `findMarketTouch()` names `creates-listing:<ix>` (an output at any deployed listing script, whatever its stake part: anyone can list anything there) and `spends-listing:<ref>` (an input that is one of the wallet's own verified listings). `WalletBg.signTx` refuses a hit unless `hasMarketAuthorization()` holds for its exact tx id and every hit, and uses it up before signing; it never reads the flag. State is in worker memory (`marketAllowance.ts`); the refusal text is `NFT_MARKET_SIGN_REFUSAL_MESSAGE` (`chrome/config.ts`).
  - The ALLOWANCE: granted by a prepare handler for the hits in the VERIFIED transaction, one slot, 5 minutes, one signature (a buy touches no own listing and grants none).
  - The dApp PASS (dApps are previewed, not refused) opens only at the dApp signing entries (`openDappMarketPass()`: CIP-30 `signTx` after its whitelist and CIP-113 checks, WalletConnect, and `CIP45_INVOKE`, whose approval is always shown), bound to the id and hits of the PARSED CBOR, held 10 minutes, dropped when the request is answered.
  - So the approval preview is the ONLY protection for a dApp-built market transaction: `buildTxApprovalSummary()` warns when a created listing pays someone else, names a foreign buyer, has too many or too large royalties, a share below `MIN_SELLER_SHARE`, more than the one NFT or too large a deposit, would never be tracked by Gero, or is a reprice that CHANGES the NFT's royalties. `requiresMarketAck` (also when a spent own listing's NFT leaves the wallet: `nftLeavesWallet`) is BLOCKING: the `market*` fields of `ApprovalContext` are required, every side-panel signer returns early on `signTxBlocked`, and the popup requires the decode-failed acknowledgement for a null summary.
  - Hardware signers ask the worker first (`assertCip113SignAllowed()`; `hardwareSignRefusal()` reads both without consuming). The refusal says "took too long" only where something expired (Gero's own flows, the dApp approval screens: `friendlyDappTxError`); any other screen, such as a plain Send to a listing script, says the transaction can only be signed from the market screens (`nftMarket.error.signFromMarket`).
- **Verify rules** (`verifyListing.ts`, `verifyBuy.ts`, `verifyMigrate.ts`: pure, fail closed; each header comment has the full list): every Nexus-built transaction is re-verified against the request and the wallet's own keys, never Nexus's word. The non-obvious invariants:
  - **list**: the datum EQUALS the worker-computed intent (owner the payment key holding the NFT, seller the receive address, the computed royalties exactly, no buyer, share >= `MIN_SELLER_SHARE`) at the NEWEST deployment under the account's own STAKE key.
  - **reprice**: the old listing's address, owner, seller and buyer; the new price and EXACTLY the royalties computed for it (the old amounts are refused); a deposit within a list's bounds.
  - **buy**: checked against a second, hash-proven read of the listing (`fetchListingUtxoProven()`), because a datum Nexus invents can be a SUPERSET of the real one (a higher price, an extra royalty) and the contract accepts it, so the buy succeeds unbounded by the collateral. At most `MAX_ROYALTIES` royalties: an output below min-UTxO is raised at the BUYER's expense, to a hostile listing's own payees. Min-UTxO is one rule (`minUtxo.ts`): `(160 + size) x coinsPerUtxoByte` over the CANONICAL re-encoding (a padded datum would inflate it), the parameter capped at 4310. Outflow is exactly price + fee + top-ups.
  - **every kind**: no mint, certificate, withdrawal, vote, donation or metadata; fee and collateral at risk under the caps above. **migrate** (mainnet only) is the legacy cancel's checks plus the list rules.
  - **Errors**: Nexus text is never shown. `marketPrepare.ts` answers a fixed `error` and passes a Nexus `errorCode` only if Nexus raises it for the market (`NFT_MARKET_NEXUS_ERROR_CODES`); any other, such as a code the page uses for signing, is `BUILD_FAILED`. `describeNftMarketFailure()` maps codes to a kind and an `nftMarket.error.*` key: unknown is the general retry, a refusal offers no retry, a submit that may have gone through never does.
- **API rows**: Nexus rows are validated (`nft-market-api.ts`, `nftMarketValidation.ts`); an unreadable row is dropped and counted, never shown half.
- **SIGN_TX** takes only `txCbor` (`signTxRequest.ts`), so the id and the guards describe the same parsed bytes.
- **Messages** (`NFT_MARKET_PREPARE_*`, extension pages only): the page sends only the thing and a price (above the royalty cap also `confirmRoyaltyAboveCap: true`, a reprice too); the worker picks addresses, keys, owner, inputs and royalties from the LOGGED wallet's record, never the request, has Nexus build and verifies the exact CBOR, and the page signs and submits those bytes untouched. `NOTIFY_WATCH_LISTINGS` (sale alert) trusts nothing in its request: a ref must be a listing the worker verified or one of the logged wallet's own, and it is never fatal.
- **Collateral**: a lent pool UTxO is accepted only as collateral, never an input; the pool owns its return, so nothing checks it. Migrate, like the phase 0 legacy cancel, cannot lend one when its witness set needs a non-canonical datum (a legacy datum-hash listing's), which the cosign oracle would refuse after the user signed: Nexus answers `NO_COLLATERAL` and the user needs their own 5 ADA UTxO.
- **UI**:
  - **Kill switch**: `nftMarketAvailable()` gates List, Edit price, Buy and Move to Gero (ONE legacy listing of ONE NFT, mainnet only); `nftMarketBrowseAvailable()` (any wallet type) gates Browse. With the flag OFF existing listings stay visible and Unlist stays reachable (`nftMarketCanUnlist()`): hiding locked assets with no way out is worse than a partial kill switch. The worker never reads the flag.
  - **Browse** opens from a held collection's dialog (For sale), or for any collection by its policy ID: global search on a pasted policy ID or NFT unit, or `/?nft=<policy>` (`nftMarketBrowsePolicy()`; the dialog then shows the listings only). It (`listingBuyability.ts`) hides what it can tell the worker would refuse: private rows and rows that contradict their datum or carry more than `MAX_ROYALTIES`. It does not repeat every worker check (share and price signs, reviewed script), so `verifyBuy` can still refuse. Own listings show "Your listing" and no Buy; a row naming the account on ONE side only shows neither the chip nor Buy.
  - **Lookalike**: every listing shows its policy ID whole, and a collection named like a top-200 one under another policy ID gets a warning (`lookalike.ts`).
  - **Activity tags** (`geroMarketActions()`) come only from what a stored record carries: `sold` needs the tag of a spent input plus a fee-address output (a forged tag costs the minimum fee) and no wallet-funded input; `bought` needs that output and a wallet-funded input; `cancelled` needs the wallet to fund or sign the transaction and NO fee-address output.
  - **i18n**: `nftMarket.*` (not `market.*`), the dApp preview `signTx.listing*` / `signTx.marketRisk*`, sale alerts `notify.category.nft` / `notify.type.nft_sold.*`. German is "Sie", except push copy (`push.ts`), which follows that file's "du".

## Multi-account (accounts #0..N, issue 1307)
- **One account = one wallet record.** `wallet.publicKey` is always the account-level xpub (on Midnight, the account's addresses JSON); `wallet.accountIndex` (non-indexed, absent on every pre-existing record = account 0) is the index it was derived at. Read it only through `resolveAccountIndex()` (`src/shared/utils/walletAccount.ts`), which throws for an invalid index and for an index other than 0 on watch, legacy Google and Bitcoin hardware wallets (their signing still derives account 0). Compare account keys with `isSameWalletKey()` (`src/db/walletIdentity.ts`), never `===`.
- **The background decides the account, never a request.** `WalletBg.accountIndex` comes from the record; `signTx`/`signData` take no account argument, and `request.data.accountIndex` sent by pages is ignored. `deriveSigningAccountKey()` refuses an account key whose public half is not the record's xpub, so a mismatched record fails before signing. The two in-page PassKey signData paths (`DappSignData.vue`, `DAppOverlay.vue`) use the same helper.
- **Hardware signers take the account from the key set they send paths from** (`accountIndexFromKeys()`): `WalletBg.resolvePathsForMissingAddresses` writes the record's account into every path, and Ledger/Trezor/Keystone send those. Never hardcode `0'` (or `accountIndex: 0`) in a CIP-1852 signing path.
- **Re-pairing a device no longer duplicates it:** `createNewHardwareWallet` rejects an existing `(chain, network, xpub)` with `DuplicateWalletError`.
- **Groups (Cardano hardware, recovery-phrase, PassKey and Google wallets; Bitcoin and Midnight recovery-phrase and PassKey wallets):** an account other than #0 carries `parentWalletId` = its account-#0 record. Read groups only through the helpers in `walletAccount.ts` (`parentWallet`, `childAccounts`, `accountGroup`, `walletDisplayName`, `conflictingWalletNames`), which ignore a stale or mismatched parent instead of grouping unrelated wallets. The wallet library lists added accounts inside their wallet's row; deleting the head wallet deletes its accounts too (`AdvancedSettingsTab`).
- **Pairing several accounts:** behind the UI-only flag `isMultiAccountEnabled`, the pair flow gains an "accounts" step (`StepAccounts.vue`): each device exports accounts in one interaction (`ledger.initLedgerAccounts`, Trezor `getAccountXpubs` via `initTrezor` + `accountIndices`, Keystone `getKeystoneAccountsUR`/`parseKeystoneAccounts`), `discoverAccounts()` probes each stake address over REST (never gero-sync, whose one socket belongs to the logged wallet), and "Scan more" re-asks for account 0 so `mergeScannedAccounts()` can refuse another device. Indices from a page are validated with `assertAccountIndices()` before any device call; a device key is accepted only for the exact account path asked (`accountXpub()`).
- **Secrets live only on account #0.** An added software account's record has its xpub, index and `encryptionMethod`, and none of `GROUP_SECRET_FIELDS` (root key, recovery phrase, PRF blobs, PassKey credential, MPC shares). At login `walletManager.resolveGroupSecrets()` → `withGroupSecrets()` copies them from the parent it reads from the DB (never from the request; a missing or mismatched parent gives none), and sets `secretsWalletId` on `WalletBg` and `loggedWallet`. **Anything bound to a wallet id uses `secretsWalletId(wallet)` / `secretsWallet(record, wallets)`, never `wallet.id`:** PassKey PRF salt and HKDF info (`evaluateWalletPrf`, every `decrypt*WithPrf` of the wallet's own key/phrase/password), key-format migrations, `mpcSessionCache`/`mpcLoginShareCache` (so a switch within a group keeps the Google session: `logout(false, keepMpcSessionOf)`), `UNLOCK_MPC_WALLET`, and a Midnight wallet's imported cNIGHT sources (`sourceSecretsRecord()` in `useCardanoStakeEnumeration.ts`; `useDustSources` signs and checks the seed at the source's `accountIndex`). An account's own extra secrets (SPO cold key, Strike key) stay under its own id and are rotated with the parent's password (`prepareSpendingPasswordRotation(…, accountIds)`).
- **Security settings are account #0's.** Every reader of `unlockMethod`, `autoLockMinutes`, PIN/pattern/lock-password hashes, 2FA and PassKey toggles opens the secrets record's DB (background stale-lock clear, `checkAutoLock`, `verifyUnlockCredentials`, `LockScreen`, `UnlockWalletDialog`, `WalletsListLogin` gate, drawer lock button, `PassKeyPasswordField`, `PassKeyAuth`). `lastActivityTimestamp` stays per account. An added account's Security tab shows one "Managed by …" row (opens account #0) instead of the editors; it gets no `backup` row.
- **dApp connect prompts offer the wallet's accounts (issue 1331).** The Cardano and Bitcoin `enable` and Midnight `connect` prompts (side panel and popup) list the logged wallet's group (`ConnectAccountPicker`, `useConnectAccount`); with more than one account the answer is `{ accountId }`, otherwise `true`. The background reads it with `readConnectApproval()` and connects through `connectApprovedAccount()` (`connectApproval.ts`): only an account of the group the prompt was shown for, logged in first through the same `loginWallet()` as `LOGIN` (nothing is unlocked again inside a group), and only that account is connected. Connections stay per account. The side-panel wallet-switch guard lets through only a connect approval naming the account now active (`approvalNamesActiveAccount`), so a dApp's duplicate `enable()` calls resolve after the switch.
- **Wallet values in the wallet list (issue 1332).** The welcome page and side-panel wallet list show each Cardano mainnet wallet's value, tokens and NFTs included, and for a wallet with added accounts their total plus a breakdown (account #0 first). Values are the portfolio server's newest hourly snapshot (`marketApi.getWalletHistory(stake, '1H', false)`, `src/services/walletLibrary/walletValues.ts`), read over REST for every wallet, never Gero Sync. `useWalletValues` asks at most two at a time, shows the last-known value from `localStorage` (`gero.walletListValues.v1`) and asks again after `VALUE_FRESH_MS`; a wallet still being indexed (202) is asked again after its hint. No total until every account is valued. The app-wide `walletListBalances` config row (gero-db, on unless `false`, Settings → Advanced) and the logged wallet's `hideBalances` turn it all off; turning the setting off clears the cache. Testnet, Bitcoin and Midnight wallets show no value.
- **Creating software accounts:** `createAccountWallet(parentId, {name, publicKey, accountIndex})` / `GeroStore.addAccounts()`. Restore (flag on) is `seed → accounts → security → restoreConfirm`, accounts derived in the page from the typed phrase (`deriveAccountXpubsFromMnemonic`); a phrase whose account #0 is stored goes `accounts → joinAccounts` and asks for nothing. Create (flag on, Cardano, Bitcoin and Midnight, password or PassKey) asks how many accounts on the Security step (1 to `MAX_ACCOUNTS_PER_EXPORT`); above 1, `StepCreateConfirm` generates the phrase in the page, derives accounts #0..N-1 before writing anything, passes `generatedMnemonic: true` so gero-db keeps the backup reminder (a phrase handed to `createNewWallet` otherwise counts as restored), and adds #1..N-1 under #0 only if #0 matches the stored key. "Add account" on a software wallet opens `StepAddAccount` (`?addAccount=<id>`): password and Google wallets get the xpub from `DERIVE_ACCOUNT_XPUB` (`chrome/addAccountKeys.ts`, background only; only the public key leaves, the root key must derive the wallet's own account-#0 xpub), a PassKey wallet decrypts and derives in the page (the documented PRF exception) and wipes the key.
- **Bitcoin accounts (recovery phrase and PassKey only).** A Bitcoin record stores the account xpub at `m/purpose'/coinType'/N'` (base58, compared case-sensitively) and its `addressType`. Its stored "root key" is the bare 32-byte master key with no chain code, so accounts are derived from the **recovery phrase** only (`deriveAccountXpubsFromMnemonic(…, {chain: Bitcoin, network, addressType})` → `deriveBitcoinAccountXpubs`; `bitcoinAccountPath()` for display). `WalletBg` signs PSBTs and messages at `this.accountIndex`, and `assertBitcoinAccount()` refuses an added account whose phrase does not derive its xpub there. Discovery probes each account's first `BITCOIN_PROBE_ADDRESSES` receive addresses (`discoverBitcoinAccounts`). Bitcoin hardware stays account 0 (`resolveAccountIndex`/`canAddAccounts` refuse it): its signers still send account-0 paths.
- **Midnight accounts (recovery phrase and PassKey only, issue 1330).** A Midnight record's `publicKey` is account N's addresses JSON (`deriveMidnightAccountPublicKey`, serialized as `createNewWallet` stores account #0), its Cardano twin (`cardanoXpub`, …) at the same account N; it is identified by its unshielded address. Accounts come from the **recovery phrase** only (`deriveAccountXpubsFromMnemonic(…, {chain: Midnight, network})`): in the page at restore/create and with the PassKey, in the background (`DERIVE_ACCOUNT_XPUB`) with the spending password. `WalletBg.deriveMidnightAccountKeys()` is the only signing derivation: at `this.accountIndex`, refusing an added account whose phrase does not derive its unshielded address; the DUST registration twin signer checks the record's `cardanoXpub` (`deriveSigningAccountKey`), and a fee wallet (sponsor) reaches `deriveSponsorDustSeed` through `withGroupSecrets` with the same check. `UPDATE_MIDNIGHT_PUBLIC_KEY` never moves a record to another account (`canReplaceWalletKey`). A Cardano account's own cNIGHT DUST destination is the same account N on Midnight. Midnight accounts are never probed (`discoverMidnightAccounts` → `'unchecked'`): only #0 is pre-selected. Midnight state is keyed by unshielded address, zswap seed or wallet id, so accounts never share it; a switch between them clears it as any wallet switch does.

## Submit API (per-wallet custom Cardano submit endpoint)
- Settings → Advanced lets a Cardano wallet send its signed transactions to a user-chosen endpoint (POST `application/cbor`, 30 s timeout, `redirect: 'error'`); rows `submitApi` (public) and `submitApiAuth` (header value) live in the per-wallet `config` table, no schema bump.
- `src/chrome/submitRouter.ts` is the single choke point (`submitCardanoTx`): every Cardano submit goes through it, each caller passing its own 2.7.2 call as `defaultSubmit`. The router re-validates the stored row on every submit and checks the returned hash against the local tx id.
- The secret row `submitApiAuth` is filtered by `PRIVATE_CONFIG_KEYS` (`walletLoader.ts`), so it never reaches `walletStore`, broadcasts or `chrome.storage.local`. Only the background reads it (`submitApiStore.ts`).
- Fail closed: an invalid, null or unreadable setting never falls back to Gero's path. Fallback happens only when the user opted in and the endpoint itself failed (never on a 400).
- The extension CSP is static and also governs the MV3 worker, so a user-chosen endpoint needs `https:` and `http:` in `connect-src` (`scripts/manifest.ts`). The router is the only code that sends to a user-chosen URL.
- Spec: `docs/superpowers/specs/2026-10-08-submit-api-design.md` (docs/ is gitignored).

## PRF (PassKey) Wallets
- Core encryption via WebAuthn PRF extension (hardware-backed)
- Credential stored in wallet record (`wallet.webAuthnCredentialId`), NOT config table
- Pure PRF: no spending password, PassKey for all operations
- Side panel: use popup window for WebAuthn (`?mode=privateKey#/passkey-auth`)
- **Never deregister PassKey from PRF wallet** (permanent lockout)
- Always backup mnemonic for PRF wallets

## Broadcast announcements
- **What**: one signed message from Gero to every wallet (a network or service issue, a new feature, a blog post). gero-sync stores and relays it; the wallet shows only what verifies against keys pinned in the build. The wallet holds no secret, so knowing how delivery works gives nobody a way in. Design: `docs/superpowers/specs/2026-11-10-broadcast-announcements-design.md` (docs/ is gitignored).
- **Keys**: `src/utils/announcementKeys.ts`. Reviewed protocol constants, NOT env config, at the same bar as the CIP-113 PLB hashes: a wrong key lets someone else speak as Gero inside every wallet. Two tiers by list (`ANNOUNCEMENT_EDITORIAL_KEYS`, never on a server; `ANNOUNCEMENT_FEED_KEYS`, blog headlines only). Empty = nothing verifies and nothing is fetched or shown, fails closed. Never pin a key from a test or from `vectors.json` (the RFC 8032 test keys; `announcementKeys.spec.ts` refuses them).
- **Verify** (`src/services/announcements/`, pure): `announcementVerify.ts` checks Ed25519 over `"gero-announcement-v1\n" || payloadBytes` (strict RFC 8032, `zip215: false`, to agree with the server's JDK) BEFORE parsing; `announcementRules.ts` is a port of gero-sync's `AnnouncementRules.java` with the same fixed check order. `__fixtures__/vectors.json` is copied unchanged from gero-sync and run by `announcementVerify.spec.ts`: a changed verdict is a contract change on every client. Lengths are UTF-16 units.
- **Background only**: `announcementEngine.ts` fetches `GET {VITE_ANNOUNCEMENTS_API_URL}/feed?platform=extension` (public, the same for everyone, no wallet or device id, `credentials: 'omit'`) and images by SHA-256 (`announcementFeed.ts` keeps one only when the bytes hash to the signed fingerprint and are a real PNG, JPEG or WebP). Triggers: worker start (at most every 15 min), the Gero Sync `ANNOUNCEMENTS` frame (a version number; random 0-30 s wait), an announcement push, a page asking. No polling. A failed feed changes no stored item and never blocks login or sync; after one the feed is left alone (30 s, doubling to 30 min) whatever asks. The body is read in pieces and dropped past the size limit (never `arrayBuffer()`: a compressed body can unpack to anything), and nothing the server chose is sent back to it (no ETag, no conditional request: that would be a per-client token). Images of a feed-tier headline are never fetched.
- **Storage**: private store only (`announcements`, `announcementState`, `announcementPrefs`, image bytes under `announceMedia:<sha256>`). Never `chrome.storage.local`: a page that could write there could put its own text in the bell as Gero's. Written through `notifyStorage` (for its change signal) but READ with `getPrivate`, never `readNotifyKey`: that path adopts a value found in `chrome.storage.local` the first time a key is read, which for a key that never lived there is a planted one.
- **Trusted snapshot**: what is stored is shown only while THIS build verified it (`trustedSnapshot()` against `verificationFingerprint(version, keys)`). No key pinned, a key removed or re-tiered, or a new version: nothing stored is shown until the feed has been read and verified again. The worker (snackbar, push lookup) and the pages both read through it.
- **Audience** is inside the signed bytes. Documents for other platforms are dropped at store time; network and minimum version are judged when shown (`visibleAnnouncements()`), because installed wallets change while the feed does not.
- **Push** (`notifyPush.handleAnnouncementPush`): `t: announcement` carries an id and no text, and never reaches the wallet lookup (no unknown-wallet DELETE, no inbox row). Shown text is the verified announcement's, or the two fixed `PUSH_ANNOUNCEMENT_*` strings under one shared tag. The subscription is `userVisibleOnly`, so a push cannot be dropped: one the wallet knows is not for this user (kind switched off, another network or version, taken down, kill switch off) shows the generic text with `silent: true` and no snackbar (`PushLookup.quiet`); the generic text makes a sound only when the feed could not be read.
- **Registration**: `PUT /device` sends `caps: ['announcements']` (gero-sync pushes announcements only to a client that says so) ONLY from a build with a key pinned, because a build that can verify nothing could only show the generic text; and `announcementsOff` (`product`, `news`; never `service`).
- **Messages** (extension pages only, in `EXTENSION_PAGE_ONLY_METHODS`): `ANNOUNCEMENTS_REFRESH`, `ANNOUNCEMENT_READ`, `ANNOUNCEMENT_DISMISS_BANNER`, `ANNOUNCEMENTS_SET_PREFS`. None carries content; the worker re-validates every argument.
- **Pages** (`src/stores/announcementsStore.ts` mirrors the private-store keys; components in `src/shared/components/announcements/`): the bell (`NotifyInbox`: a critical service notice first in "Needs you", the rest under "From Gero"), the snackbar, the dashboard banner (service + critical only, one at most), the dialog (`AnnouncementDialog`, hosted by `ContentLayout`) and the side panel's sheet (`AnnouncementSheet`), and Settings → Notifications (`AnnouncementSettings`). Opened through `announcementsStore.open(id)` or `?announcement=<id>`.
- **Rendering is still untrusted**: the body goes through `renderMarkdown` (escape first) with `linkAllowed: bodyLinkAllowed`, so a link off Gero's sites keeps its text and loses its anchor. Images are lines of their own, `![alt](media:<sha256>)`, lifted out by `splitBody()` and drawn by `AnnouncementImage` from the stored bytes (PNG, JPEG or WebP only); they never pass through `v-html`.
- **The action**: `actionRoute` is a KEY looked up in `ANNOUNCEMENT_ROUTES` (`announcementView.ts`), never a path; an unknown key is no action. No key may lead to a send, sign, swap-confirm or dApp-connect flow, and adding one is a reviewed change. `actionUrl` is checked against `ALLOWED_URL` again at the click (`openGeroUrl`).
- **Headlines (feed tier)** are signed by the one key a server holds, so they get the least: text from an allowlist of characters only (`FEED_TEXT` in `announcementRules.ts`, the same pattern as the server's; without it a fullwidth dot or a zero-width space carries a domain or an address past the other checks), a push that shows the title and the fixed `PUSH_ANNOUNCEMENT_BLOG` line and never the summary, no image, no dialog from the bell (the row opens gerowallet.io), and the provenance line "Posted automatically from the Gero blog" instead of "Signed by Gero" (`AnnouncementSigned`).
- **Snackbar text**: for a `NOTIFY_PRESENT` with an `announcementId` the page ignores the message's title and body and shows its own stored copy (`announcementsStore.find`), so a forged message can at most re-show a real announcement.

## Feature Notifications
- `src/shared/composables/useFeatureNotifications.ts` — hierarchical badge system
- Define features with `{ id, version, path }` in `FEATURE_DEFINITIONS`
- `isFeatureNew(id)`, `markFeatureAsSeen(id)`, `hasNewFeaturesInPath(path)`

## Feature Flags
- Self-hosted flag service (gero-sync): `src/services/featureFlag.service.ts` + `src/stores/featureFlagsStore.ts`
- Backend URL: `VITE_FLAGS_BASE_URL` (see `.env.*`)
- A failed first fetch is retried (issue 1195): 5s doubling to 60s, for as long as the page is open, waiting for `online` while offline. Until then every flag is its fallback; `featureFlagService.onReady()` tells the store when the flags arrive, and only then does it mirror them to `chrome.storage.local.featureFlags` (never the fallbacks, which would overwrite the background's last known values)
- Flags: `isSwapEnabled`, `isGeroCardEnabled`, `isBlogEnabled`, `isHelpCenterEnabled` (dashboard discovery and Blog redirect only; public Help and welcome access remain available while off or loading), `isGoMiningEnabled`, `isPoolOperatorEnabled`, `isPhysicalCardOrderingEnabled`, `isBitcoinEnabled` (master visibility gate for the Bitcoin chain: onboarding tile + BTC route guards + BTC nav items), `isSubmitApiEnabled` (UI-only gate for Settings → Advanced → Submit API; the background router honours a saved endpoint whatever the flag says), `isCip113Enabled` (UI-only gate for Gero's own Send of a CIP-113 token; display and the signing refusals stay on the build-time network gates), `isCardholderDetailsEnabled` (default ON kill switch for the Gero Card "Complete your cardholder details" step; only an explicit `false` turns it off, and then a missing-details refusal shows the Zione-support notice), `isAnnouncementsEnabled` (default ON kill switch for broadcast announcements; only an explicit `false` hides them. The pages hide everything; the worker reads it from the flag mirror in the private store and, while it is off, offers no snackbar and gives a push no announcement text, but keeps fetching and verifying), `isNftMarketEnabled` (UI-only gate for the legacy listing rescue (the Portfolio card, the inbox row and the bell) and for the Gero NFT market's List, Edit price, Buy, Browse and Move to Gero; NOT Unlist or the visibility of the user's own listings, and never the worker's prepare handlers, the signing guard, the `listed` partition or the dApp preview)
- Route gating: `isRouteUnderMaintenance()` in router.ts
- Nav hiding: check flag in NavigationDrawer.vue menu items

## Background Polling
- **Sync (Gero Sync tip push)**: Event-driven in `walletManager.service.ts`. The two-minute value is a mutex acquisition timeout, not a locked-state polling throttle.
- **Risk scores**: Every 12 hours (via Nexus)
- **Fiat rates (USD→EUR)**: Fetched on demand by `useCurrencyConverter.ts` via `/api/price/fiatRates`. No background polling.
- **Price data**: Provided by the market data API (`market-api.ts`, via backend), NOT by background alarms. No third-party price/mcap polling in the background.

## Performance
- Keep login independent of sync connection establishment. Record measured timings and the tested scenario before making latency claims.
- Use `Promise.all()` for parallel async, `setTimeout` for non-critical deferrals
- Use existing module-specific `debugLog()` calls with synthetic data; no universal timing-prefix convention is established.

## Common Issues
- **WASM loading**: Dependencies supply WASM; Vite plugins emit local assets and adapt worker loading. Check emitted paths and CSP.
- **Chrome messaging timeout**: The listener keeps registered channels open; ensure every handler calls `sendResponse` exactly once on all paths.
- **"No Table" error**: Apply schema on every DB open
- **Store race conditions**: Always use in-memory state, not `chrome.storage.local.get()`
- **Login freezing**: Make messaging init non-blocking
- **Connection state stuck**: Use immediate `chrome.storage.local.set()` for critical states
- **Sync WS drop**: reconnect in `websocket.service.ts`; re-subscribe to addresses/stake key on wallet switch
- **"window/window" error**: Don't use `define: { 'global': ... }` with `nodePolyfills` plugin
- **pbkdf2 build issues**: Virtual module plugin with `enforce: 'pre'` in background config
- **`assert` in the background**: the background build stubs `assert` (`\0virtual:assert-stub`), and `requireReturnsDefault` hands CommonJS callers the stub's function, not its namespace. Otherwise `@subsquid/scale-codec` (the Midnight address codecs) gets a namespace and the worker derives no Midnight key at all. `scripts/check-background-interop.mjs` builds a small entry with that config and runs it (CI: "Background CommonJS interop").

## Chrome Web Store: No Remotely Hosted Code
- MV3 policy rejects a package if any shipped JS/HTML could load code from a URL (`<script src="https://…">`, remote `importScripts()` / `import()`, script-CDN URLs), **even inside unused dependency code**. 2.7.2 was rejected ("Blue Argon") for `@effect/platform`'s `HttpApiScalar` docs page, which the Midnight SDK pulls in. It shipped because the UI build then ran with `treeshake: false`, which kept unused code reachable through dependency imports. Tree-shaking is back on (PR 1253) and must stay on; the stub and guard below are the second line of defence.
- `stubEffectApiDocs` (`vite.config.mts`) replaces `HttpApiScalar`/`HttpApiSwagger` in every Vite build, worker bundles included (not under the `vite` dev server, whose esbuild pre-bundle skips plugins; dev is never shipped).
- `scripts/remote-code-guard.mjs` holds the rules. Its `forbid-remote-code` plugin fails a build whose emitted JS/HTML matches one, and `npm run build`, `build:beta` and CI also run it as a CLI over all of `extension/`, which covers vendored files copied in outside Rollup. The rules catch the common literal forms (remote `<script src>`, injected `<script>` elements, static `import` / `export … from` a URL, `importScripts()` / `import()` / `new Worker()` of a URL, JavaScript CDN hosts); a URL assembled at runtime gets past them, so review new dependencies anyway.
- If a rule fires on a new dependency, stub or drop the offending module. If it fires on something that is not code (an image or data URL), narrow that rule and add the case to the spec's negatives. Don't weaken a rule just to get a build green.
- Any release zip built some other way: `node scripts/remote-code-guard.mjs extension` before uploading.

## Design System (Gero Design Language)
One token layer, four surfaces, scarce chain accent, motion as feedback, enforced by a ratchet.

### Tokens
- **Canonical source**: `src/shared/styles/tokens.css` (CSS custom properties) mirrored by `src/shared/styles/_tokens.scss` (SCSS vars, auto-injected into every SFC `<style lang="scss">` via `vite.config.mts` `additionalData`). The audit fails if the two drift.
- **Surfaces** (elevation via surface + hairline, never glow): `--g-canvas` #000, `--g-surface` #0C0E12, `--g-raised` #12151B, `--g-overlay` #1A1E26. Hairlines `--g-hairline-1/2/3`. Text tones `--g-text-1/2/3` (never use white text below 0.6 alpha — use `--g-text-3`).
- **Chain accent is the ONLY per-chain color.** `useChainAccent()` (bootstrapped once in `options/App.vue`) is the sole writer of `--g-accent` / `--g-grad-1/2` (+ legacy `--chain-*` aliases). Never hardcode chain hexes; gradients only on sanctioned slots (primary CTA, active nav indicator, chain dot, header hairline).
- **Scale tokens**: radii `--g-r-chip/control/card/sheet/pill`, spacing `--g-s-1..6`, durations `--g-dur-fast/base/slow`, z-ladder `--g-z-sticky/dock/sheet/toast`, `--g-font-ui` / `--g-font-mono`.
- **Baseline** (`src/shared/styles/baseline.css`, loaded after Vuetify): type ramp (`.t-display/.t-title/.t-heading/.t-body*/.t-caption/.t-label`), `.g-num` (tabular), `.g-mono`, `.delta-up`/`.delta-down`, sentence-case buttons, the focus ring, reduced-motion collapse. Vuetify CSS is emitted twice, so overrides that must win a tie are `html`-prefixed — see `project_vuetify_css_cascade` memory.

### Primitives
- `GButton` (four tiers) and the `.geroButton` gradient CTA. `BaseDialog` is THE modal primitive (`size` prop, tokenized surface, esc-to-close, house transition). Formatting: import from `src/shared/utils/format.ts` — do NOT fork `formatPrice`/`formatSignedChange`/etc. (the audit counts forks). Deltas use `formatSignedChange()` (glyph carries direction) + `delta-up`/`delta-down`, never a colored chip.

### Glass (surfaces)
- **Glass is the baseline.** Every surface — page cards, nested cards/rows/tiles, dialog internals — is a see-through material; a solid token (`--g-raised/--g-surface/--g-overlay`) on a surface needs a UX justification in a comment (readability/accessibility). Justified solids: menus/tooltips (`glass-popover`), controls (inputs, chips, pills, avatars, tracks, code blocks), `<table>` rows (the card carries the material), QR boxes.
- Materials live in `src/shared/styles/liquid-glass.css` (classes) and are mirrored as mixins in `src/shared/styles/_glass.scss` (auto-injected into every SFC `<style lang="scss">`): `glass-panel` = default in-page card; `glass-tier` = a card nested inside another glass surface (`g-glass-tier-hover` / `-active` for states); `glass-overlay` = dialogs/sheets; `glass-chrome` = app frame; `glass-liquid` = cards directly on imagery. Change a class and its mixin together. The legacy `liquid-glass` / `-subtle` / `-compact` names alias the PANEL material.
- Never write `backdrop-filter` in a component — use the class or `@include g-glass-<material>(<important?>)`; the `backdropFilters` ratchet counts raw occurrences.

### Gates (run before every commit; wired into the pre-commit hook)
```bash
node scripts/design/audit.mjs            # ratchet: 15 metrics vs scripts/design/budgets.json
node scripts/design/audit.mjs --write    # ratchet the budgets DOWN to current (after a net reduction)
node scripts/design/contrast.mjs         # 56 WCAG checks against the real token files
```
- The ratchet only moves down. To RAISE a budget (a token's legitimate first use, a merge): `node scripts/design/audit.mjs --rebaseline --reason="..."` and justify it in the commit message. Metrics include hex/radius/font-size/z-index distinctness, backdropFilters, uppercase, infiniteAnimations, importantCount, lowAlphaText, transitionAll, clickableDivs + outlineNone (a11y floor), and trust-surface tripwires (corruptedMdiNames, formatFnForks).
- **Working rule**: any file you touch leaves the ratchet at or below where you found it. Tokenize the values you pass; if a change is a real token first-use, rebaseline with a reason.

### Motion
Motion is feedback, not decoration. Keep spinners, ~1.4s skeleton shimmers, typing/dot indicators, and status/sync/connection pulses. Delete decorative loops (glow/breathe/float/aurora/color-shift). Durations resolve to `--g-dur-*`; prefer explicit `transition` property lists over `transition: all` (and never comma-list properties with a single trailing duration — that only animates the last one).

## External Integrations
Data layer: **Nexus** (via gero-backend) for primary Cardano data and routing.
Bitcoin also uses Esplora, and SPO uses Koios directly. Midnight data uses
Nexus/Gero Sync; proof generation can use direct Foundation/Arkhia services,
with public indexer endpoints available for development fallback. Public client
configuration varies by integration. Real-time: **Gero Sync** (WebSocket push).
Fiat on-ramp: MoonPay (Guardarian removed 2026-09). Other: ADA Handle, Bring
Cashback. Hardware: Ledger, Trezor, Keystone.

## Relevant Skills
Use these slash commands when working on this project:
- `/cardano` — Cardano transactions, staking, native tokens, UTxO model
- `/bitcoin` — Bitcoin transactions, wallets, Lightning (multi-chain support)
- `/blockchain-expert` — DeFi, smart contracts, Web3 patterns
- `/browser-extension-builder` — Chrome extension architecture, Manifest V3, content scripts, messaging
- `/i18n` — Sync and translate `us.ts`/`de.ts`/`es.ts` language files
- `/content-design` — UI copy: button labels, error messages, tooltips, empty states
- `/frontend-design` — Production-grade Vue/Vuetify UI components
- `/senior-security` — Crypto implementation, security architecture, wallet security audits
- `/simplify` — Review changed code for quality and efficiency

---
**Last Updated**: 2026-10-27
