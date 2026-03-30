# Mini-Gero: Chrome Side Panel Wallet

**Date**: 2026-03-12
**Branch**: `mini-gero` (based on `market-page`, merges to `development`)
**Status**: Design

---

## Overview

Mini-Gero is a native mobile-style wallet experience that runs in the Chrome side panel. It strips away the advanced market analytics and data-heavy features of the full dashboard, leaving a fast, responsive, minimalistic wallet for everyday use — sending, swapping, managing the Gero Card, staking, and interacting with dApps.

It is **not** a shrunken version of the desktop dashboard. It is a purpose-built, 400px-wide wallet designed from scratch for the side panel form factor, inspired by the best non-custodial mobile wallets (Phantom, Rabby, Uniswap, Rainbow).

### Goals

- Native mobile feel in a browser side panel
- Extremely light, fast, responsive
- Focused on getting things done: send, receive, swap, stake, manage card, use dApps
- Modern, minimalistic design (dark theme)
- Gero Card as a first-class, center-stage feature
- Leverage existing code (stores, services, APIs, background) — no rewrites

### Non-Goals

- Advanced market data (TVL, order books, market depth) — that's the full dashboard
- NFT gallery or collectible management
- Blog/news module
- Developer tools
- Multi-sig wallet management

---

## Architecture

### Approach: Separate Vue App, Shared Core

A new Vue 2.7 + Vuetify 2.7 app lives at `src/sidepanel/` with its own entry point, router, layout, and components. It imports stores, services, APIs, DB, and utilities from the existing codebase — all of which are framework-agnostic TypeScript.

**The full dashboard (`src/options/`) is not modified in any way.**

```
src/sidepanel/
  main.ts                    # Vue 2.7 app bootstrap
  App.vue                    # Root component (MiniLayout + DAppOverlay)
  router.ts                  # 5 main routes
  layouts/
    MiniLayout.vue           # Header + <router-view> + BottomNav
  pages/
    HomePage.vue             # Balance, quick actions, carousel, tokens
    StakingPage.vue          # Stakepool + DRep (segmented toggle)
    CardPage.vue             # Full Gero Card experience
    CashbackPage.vue         # Bring cashback opportunities
    ActivityPage.vue         # Transaction history
  components/
    MiniHeader.vue           # Wallet name, mini<>full toggle, settings
    BottomNav.vue            # 5-tab mobile navigation
    QuickActions.vue         # Send, Receive, Swap, Perps (circular icons)
    BalanceSection.vue       # Portfolio value + Buy/Sell ADA button
    FeaturedCarousel.vue     # Swipeable promo cards
    TokenList.vue            # User's token holdings
    BottomSheet.vue          # Reusable bottom sheet overlay
    DAppOverlay.vue          # DApp signing overlay (root-level)
    ...                      # Additional compact components
  composables/
    useMiniNavigation.ts     # Bottom nav state
    useBottomSheet.ts        # Bottom sheet open/close/animate
    useDAppOverlay.ts        # DApp message listener + overlay state
```

### Shared Code (imported, not copied)

| Layer | Source | Notes |
|-------|--------|-------|
| Stores | `src/stores/*` | walletStore, card (`src/stores/modules/card.ts`), stakingStore, governanceStore, bringStore, priceStore, etc. |
| Services | `src/services/*` | ably, sync, walletManager, storeMessaging, krakenWebSocket |
| APIs | `src/api/*` | blockchain-api, dexhunter-api, tap-tools-api, cashback-api, crypto-api, etc. |
| Database | `src/db/*` | gero-db, wallet-db, portfolio-cache |
| Background | `src/chrome/*` | messaging (use `Messaging.sendToBackgroundFromOptions()` — sidepanel is an options-like context), background communication, serialization |
| i18n | `src/plugins/i18n/*` | Translation strings (us.ts, de.ts) |
| Utilities | `src/shared/utils/*` | crypto, builder, resolver, errorHandler |
| Composables | `src/shared/composables/*` | Reusable composables where applicable |

### Build Configuration

The current `vite.config.mts` only has `options: r('src/options/index.html')` as an input. **The sidepanel must be added as a build input:**

```typescript
// vite.config.mts — rollupOptions.input
input: {
  options: r('src/options/index.html'),
  sidepanel: r('src/sidepanel/index.html'),  // ADD THIS
},
```

The existing `src/sidepanel/main.ts` is a stub that imports the full dashboard router — it must be **rewritten entirely** with mini-gero's own app bootstrap, router, and root component.

### Manifest Changes

Add the following to `extension/manifest.json` (do not replace existing `action` properties):

```json
{
  "side_panel": {
    "default_path": "sidepanel/index.html"
  }
}
```

Remove `default_popup` from `action` if present (do not set it to empty string — omit it entirely).

**Verify after build**: The Vite output at `extension/sidepanel/index.html` must match the `default_path`. Run `npm run build` and confirm the file exists at that path.

In `background.ts` initialization, set:
```typescript
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

**Note**: The existing `openSidebar()` function in `background.ts` (line ~111) sets `openPanelOnActionClick: false`. This must be fixed:
- **Remove** the `setPanelBehavior({ openPanelOnActionClick: false })` call from `openSidebar()`
- `openSidebar()` is **only** used for the mode toggle (full dashboard → open side panel). It should call `chrome.sidePanel.open({ tabId })` directly without touching `setPanelBehavior`
- `openPanelOnActionClick: true` is set **once** at background startup and never overridden

---

## Mode Toggle

Mini-gero (side panel) is the **default experience** — clicking the extension icon opens it. The full dashboard is accessible via a toggle.

- **Mini-gero header** (MiniHeader): "Full Mode" toggle button calls `chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') })` to open the full dashboard in a new tab
- **Full dashboard header** (ContentLayout): "Mini Mode" toggle button sends a message to background via `Messaging.sendToBackgroundFromOptions()`, which calls `chrome.sidePanel.open({ tabId })` on the appropriate tab. (The `chrome.sidePanel` API is only available in the background context, so the options page cannot call it directly.)

Both modes can be open simultaneously — they share the same stores/services, so wallet state is always in sync. The toggle is a convenience for switching focus, not an exclusive mode switch.

---

## Navigation

### Bottom Navigation Bar (5 tabs)

| Position | Tab | Icon | Route |
|----------|-----|------|-------|
| 1 | Home | `mdi-home` | `/` |
| 2 | Staking | `mdi-finance` | `/staking` |
| 3 (center) | Card | `mdi-credit-card` | `/card` |
| 4 | Cashback | `mdi-cash-multiple` | `/cashback` |
| 5 | Activity | `mdi-history` | `/activity` |

- Card tab has center prominence (elevated or visually distinct)
- Active tab indicated by filled icon + accent color
- Touch-friendly: minimum 44px tap targets

### Quick Actions Row (Home page only)

4 circular icon buttons: **Send**, **Receive**, **Swap**, **Perps**

Each opens a full-screen bottom sheet with the respective flow.

---

## Wallet States (Lock, Login, Onboarding)

Mini-gero must handle all wallet states before showing the main UI:

### No Wallet Exists
If no wallet is found in the database, mini-gero shows a simple screen with:
- Gero logo
- "Get Started" button → opens the full dashboard (`options/index.html`) for wallet creation/import
- Mini-gero does NOT handle wallet creation — that's a complex multi-step flow best done in the full dashboard

### Wallet Locked (Auto-Lock)
If the wallet exists but is locked (auto-lock timeout, PIN/pattern/lock password required):
- Mini-gero shows an inline unlock screen
- Supports: PIN, pattern, lock password, PassKey (PRF wallets)
- On successful unlock → loads the main UI
- "Forgot?" link → opens full dashboard for recovery options

### Wallet Selection (Multiple Wallets)
If multiple wallets exist:
- Show a wallet selector screen on first open (or after logout)
- Simple list: wallet name, icon, truncated address
- Tap to select and unlock
- The MiniHeader shows the active wallet name — tapping it opens a wallet switcher bottom sheet

### Logged In
Normal state — show the main UI (Home page with bottom nav).

### State Guard Implementation
`App.vue` handles wallet state gating **above** the `<router-view>`. It renders the appropriate state screen (no-wallet, locked, wallet selector) as a full-screen overlay, hiding the router entirely. Page components (`HomePage`, `CardPage`, etc.) can safely assume a logged-in, unlocked wallet — they are never rendered otherwise.

```
App.vue
  ├── [no wallet?]     → NoWalletScreen (full-screen, above router)
  ├── [locked?]        → LockScreen (full-screen, above router)
  ├── [no selection?]  → WalletSelector (full-screen, above router)
  └── [logged in]      → MiniLayout > router-view > pages
                         + DAppOverlay (always mounted, listens for signing)
```

State detection uses existing stores: `geroStore` (wallets list), `walletStore` (active wallet, lock state). No navigation guards needed — `App.vue` reactively shows/hides based on store state.

---

## Pages

### Home Page

Top to bottom:

1. **MiniHeader**: Wallet avatar + name (left), mini-to-full toggle + settings gear (right)
2. **Balance Section**: Total portfolio value in fiat ($X,XXX.XX), +/- change in value and percentage, prominent **Buy/Sell ADA** button
3. **Quick Actions Row**: Send, Receive, Swap, Perps (circular icons with labels)
4. **Featured Carousel**: Swipeable cards promoting Gero Card, cashback deals, announcements (dismissible)
5. **Token Holdings**: Scrollable list — token icon, name, amount, fiat value (tapping a token opens a detail bottom sheet)

### Staking Page

1. **Segmented Toggle**: "Stakepool" | "Governance"
2. **Status Card** (always visible): Current stakepool (name, ticker, ROA), current DRep (name or ID), claimable rewards with "Claim" button
3. **Stakepool View**: Search bar, sortable pool list (ticker, ROA, saturation), tap to delegate — confirmation via bottom sheet
4. **Governance View**: DRep list, tap to delegate — confirmation via bottom sheet

Reuses: `stakingStore`, `governanceStore`, delegation/voting logic from `src/shared/utils/builder.ts`

### Card Page (Center Stage)

The full Gero Card experience adapted for 400px width. Same state machine as the dashboard:

**Auth state**: Login/Register buttons. KaiserEx OAuth opens in an external window (unchanged).

**New state**: CTA to order card, feature highlights, partnership info.

**Pending state**: KYC review status with progress steps.

**Approved state**:
- Card visual at top (simplified flat design, no 3D tilt — too narrow)
- Balance display
- Quick actions: Top Up, Manage, View Details
- Recent card transactions

**All sub-flows as bottom sheets**:
- Top-up wizard (amount → summary → sign → success)
- Manage card (view PIN, block/unblock)
- Order physical card (type → address → shipping → payment)
- KYC flow (ID upload → selfie)

Reuses: `cardStore`, KaiserEx API, all business logic. Only the layout/presentation is rebuilt for narrow width.

### Cashback Page

- List of Bring cashback opportunities
- Each offer: merchant logo, cashback percentage, brief description
- Tap for details → bottom sheet with full info and link to merchant

Reuses: `bringStore`, cashback API

### Activity Page

- Chronological transaction list grouped by date
- Each entry: token icon, type (Sent/Received/Staked/Swapped/DApp), amount, truncated address
- Tap for details → bottom sheet with full transaction info + explorer link

Reuses: transaction data from `walletStore`

---

## Quick Action Flows (Bottom Sheets)

All triggered from the Home page quick actions row:

### Send
Full-screen bottom sheet:
1. Select token (from holdings list)
2. Enter recipient address (manual input, contacts, paste). **Note**: QR scanning via camera (`getUserMedia()`) may have restrictions in Chrome extension side panels — this needs validation. If unsupported, QR scan is omitted and users paste addresses or use contacts.
3. Enter amount (with MAX button, fiat/crypto toggle)
4. Review (fee estimate, total)
5. Sign and submit

### Receive
Bottom sheet with:
- QR code of wallet address
- Address text with copy button
- Share button

### Swap
Bottom sheet with:
- "From" token selector with balance
- "To" token selector
- Amount input (with MAX, 50%)
- Quote preview (rate, slippage, fees)
- Review and confirm

Reuses: `dexHunterStore`, DEX Hunter API

### Perps (Perpetuals)
**Deferred to v1.1** — the existing perpetuals UI (`PerpetualsDialog.vue`) is a 1100x734px dialog with TradingView chart, order book, and position management. This cannot fit in a 400px bottom sheet without a dedicated redesign.

For v1, the Perps quick action button opens a bottom sheet with:
- Summary of open positions (if any)
- "Open Full Dashboard" button to access the full perps interface
- This is a **read-only stub** — no trading in mini-gero v1

The full perps redesign for 400px width is a separate design effort.

### Buy/Sell ADA
Prominent button in the balance section. Opens Moonpay/Guardarian in an external browser tab (existing flow, unchanged).

---

## DApp Signing Overlay

### Architecture

A persistent `<DAppOverlay>` component mounts at the app root level in `App.vue`, above the router. It does not participate in routing — it's an overlay layer.

### Flow

1. DApp calls `window.cardano.gerowallet.enable()` / `.signTx()` / `.signData()`
2. Content script relays to background script
3. Background detects mini-gero is active in the side panel
4. Background sends message to mini-gero via port messaging (instead of opening popup/side panel)
5. `DAppOverlay` receives message, slides up bottom sheet (~85% height, dimmed backdrop)
6. Renders appropriate signing component:
   - **Connect**: DApp name, URL, requested permissions, Approve/Reject
   - **Sign Data**: Message content, Sign/Reject
   - **Sign Tx**: Transaction details, risk assessment, fee, Sign/Reject
7. User approves or rejects
8. Response sent back to background → content script → DApp
9. Bottom sheet dismisses, current page untouched underneath

### Background Script Changes

The current `background.ts` has a `useSidePanel` config flag that routes DApp requests to the options page acting as a side panel (via `openSidebar()`), or falls back to a popup window. **Mini-gero replaces this entire flow.**

When mini-gero is active, it becomes the canonical DApp signing target. The changes:

1. **Mini-gero registers with background on mount**: On app init, mini-gero opens a persistent port with a known name (e.g., `mini-gero-dapp-channel`). This tells background that a mini-gero instance is live.

2. **Background routing priority changes**:
   - If `mini-gero-dapp-channel` port is connected → send DApp request to mini-gero via that port (overlay handles it)
   - If no mini-gero port → fall back to existing behavior (popup window for DApp signing)
   - The `useSidePanel` config flag is **removed** — it's no longer needed since mini-gero IS the side panel

3. **`openSidebar()` is no longer called for DApp signing** — mini-gero is already open. The function remains available for the mode toggle (opening the side panel from the full dashboard).

4. **Message protocol — push-based, not pull-based**: The existing `InternalSidePanelController` uses a pull-based protocol (side panel connects → sends `requestData` → background responds). Mini-gero uses a **push-based** protocol since the side panel is already open:

   **Background → Mini-gero (push):**
   ```typescript
   miniGeroPort.postMessage({
     type: 'dapp-request',
     method: 'enable' | 'signTx' | 'signData',
     requestId: crypto.randomUUID(),  // Correlate request/response
     payload: { /* DApp request data */ }
   });
   ```

   **Mini-gero → Background (response):**
   ```typescript
   miniGeroPort.postMessage({
     type: 'dapp-response',
     requestId: '<matching requestId>',  // Correlate to original request
     data: { /* signed witnesses, approval, etc. */ },
     error: null | 'user_rejected' | '<error message>'
   });
   ```

   **Background resolves** the original DApp promise from the matching `requestId` response. The `requestId` is critical — if two DApp requests arrive before the user responds, they must be queued and correlated correctly. Mini-gero should queue requests and show them one at a time (reject additional requests while one is pending, or queue them).

   **Do NOT reuse `InternalSidePanelController`** — it is pull-based and incompatible with the persistent port model.

5. **The `METHOD.enable`, `METHOD.signTx`, `METHOD.signData` handlers** in background.ts are updated: check for mini-gero port first, then fall back to popup. The `openSidebar()` code paths for these methods are removed.

6. **`useSidePanel` config flag scope**: The flag is removed from background.ts routing logic only. The existing popup components (`DappConnect.vue`, `DappSignData.vue`, `SignTx.vue` in `src/popup/`) are **not modified** — they remain as the fallback when mini-gero is not active. Those components still check `useSidePanel` internally for their own `tabId` extraction, but this code path is only reached when mini-gero is not connected and background falls back to popup. The `AdvancedSettingsTab.vue` toggle, `walletStore` default, and `gero-db` default are left unchanged — they become irrelevant (the toggle does nothing when mini-gero is the canonical side panel) and can be cleaned up in a follow-up PR.

### Signing Components

Mini-gero builds its own signing components for the bottom sheet overlay, extracting business logic from the existing popup components (`DappConnect.vue`, `DappSignData.vue`, `SignTx.vue`). The signing logic (transaction parsing, witness handling, risk assessment) lives in shared utilities — only the UI is rebuilt for 400px width.

**Exceptions to the bottom sheet pattern:**
- **Hardware wallet signing** (Ledger, Trezor, Keystone): flows remain unchanged — they use their own communication channels (WebUSB, WebBLE, QR codes) which work regardless of the UI container
- **PRF wallet signing**: Opens a small popup for WebAuthn (existing pattern in `DappSignData.vue`) — this continues to work since it's a separate window
- **KaiserEx OAuth** (Card page): Opens in an external window — not a bottom sheet

---

## Design Language

- **Dark theme** primary (consistent with Gero's current aesthetic and market conventions)
- **Bottom sheets** as the universal interaction pattern — all sub-flows, all details, all signing
- **Smooth transitions**: slide-up sheets (300ms ease-out), fade backdrops, no hard navigation cuts
- **Touch-friendly**: minimum 44px tap targets, generous padding, swipe-to-dismiss on sheets
- **Typography hierarchy**: large balance number, medium section headers, compact list items
- **400px width design** — nothing adapted or squeezed from desktop, everything purpose-built
- **Accent colors**: retain Gero's existing color palette for quick actions (Send: cyan, Receive: green, Swap: coral, Perps: purple)

---

## Agent Teams Development Plan

The implementation is split across 5 independent teammates, each owning separate files to avoid conflicts:

| Teammate | Responsibility | Key Files |
|----------|---------------|-----------|
| **Shell** | App bootstrap, MiniLayout, BottomNav, MiniHeader, router, manifest changes, mode toggle, DApp overlay system, wallet states (lock screen, wallet selector, no-wallet screen), settings bottom sheet, Vite build config | `src/sidepanel/main.ts`, `src/sidepanel/App.vue`, `src/sidepanel/router.ts`, `src/sidepanel/index.html` (simplify for mini-gero), `src/sidepanel/layouts/`, `DAppOverlay.vue`, `BottomSheet.vue`, `extension/manifest.json`, `src/chrome/background.ts` (DApp routing + openSidebar fix), `vite.config.mts` |
| **Home** | HomePage, BalanceSection, QuickActions, FeaturedCarousel, TokenList, Buy/Sell button | `src/sidepanel/pages/HomePage.vue`, home-related components |
| **Card** | CardPage — all 4 states adapted for 400px, bottom sheet wrappers for all card sub-flows (top-up, manage, order, KYC) | `src/sidepanel/pages/CardPage.vue`, card-related components |
| **Staking** | StakingPage — stakepool + governance segmented toggle, status card, delegation flows | `src/sidepanel/pages/StakingPage.vue`, staking/governance components |
| **Flows** | Send/Receive/Swap bottom sheet flows, ActivityPage, CashbackPage, Perps stub, DApp signing components (Connect, SignData, SignTx) adapted for overlay | `src/sidepanel/pages/ActivityPage.vue`, `CashbackPage.vue`, quick action flow components, signing overlay components |

### Dependency Order

1. **Shell** goes first — provides the app skeleton, layout, routing, and reusable BottomSheet component that all other teammates depend on
2. **Home, Card, Staking, Flows** can all work in parallel once Shell delivers the skeleton

### Development Methodology

- Claude Code Agent Teams with 5 teammates
- Shell teammate delivers first, others start after
- Each teammate works in isolation on their own files
- All teammates share the same stores/services (read-only imports)
- Plan approval required before implementation for each teammate

---

## Resolved Decisions

1. **Wallet switching**: Tapping wallet name in MiniHeader opens a wallet switcher bottom sheet (list of wallets, tap to switch). On first open with multiple wallets, show wallet selector screen.
2. **Settings**: Mini-gero shows essential settings only (network selection, security/lock, theme) in a bottom sheet. "All Settings" link opens the full dashboard.
3. **Onboarding**: Mini-gero does NOT handle wallet creation/import. Shows a "Get Started" screen that opens the full dashboard for onboarding.
4. **Perpetuals**: Deferred to v1.1. v1 shows a read-only positions stub with link to full dashboard.

## Open Questions (Non-Blocking)

1. **Featured carousel content**: What rotates in the carousel? Gero Card promo, cashback deals, new features, announcements? (Can be decided during Home teammate's implementation — carousel component is generic.)
2. **Card page empty state**: When the user hasn't registered for Gero Card, should the Card tab show a full marketing page or a simple CTA? (Can follow existing `OrderCardSection.vue` pattern adapted for 400px.)
