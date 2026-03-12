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
| Stores | `src/stores/*` | walletStore, cardStore, stakingStore, governanceStore, bringStore, priceStore, etc. |
| Services | `src/services/*` | ably, sync, walletManager, storeMessaging, krakenWebSocket |
| APIs | `src/api/*` | blockchain-api, dexhunter-api, tap-tools-api, cashback-api, crypto-api, etc. |
| Database | `src/db/*` | gero-db, wallet-db, portfolio-cache |
| Background | `src/chrome/*` | messaging, background communication, serialization |
| i18n | `src/plugins/i18n/*` | Translation strings (us.ts, de.ts) |
| Utilities | `src/shared/utils/*` | crypto, builder, resolver, errorHandler |
| Composables | `src/shared/composables/*` | Reusable composables where applicable |

### Build Configuration

The Vite config (`vite.config.mts`) already builds `src/sidepanel/index.html` as a separate entry. No build changes needed beyond ensuring the side panel entry compiles correctly with mini-gero's new components.

### Manifest Changes

```json
{
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "action": {
    "default_popup": ""
  }
}
```

- Extension icon click opens the side panel (no popup)
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` set in background.ts

---

## Mode Toggle

A toggle button in the top navigation switches between mini and full mode:

- **Full dashboard header** (ContentLayout): Toggle button calls `chrome.sidePanel.open({ tabId })` to open mini-gero, optionally with a visual indicator that mini mode is available
- **Mini-gero header** (MiniHeader): Toggle button calls `chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') })` to open full dashboard

Both modes share the same stores, so wallet state is always in sync. The user can have both open simultaneously if desired.

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
2. Enter recipient address (manual input, contacts, QR scan)
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
Bottom sheet with perpetuals trading interface.

Reuses: existing perpetuals logic and API integration

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

`src/chrome/background.ts` needs to detect when mini-gero is the active side panel and route DApp requests to it via port messaging instead of opening a new popup or side panel. This requires:

- A way for mini-gero to register itself with the background (port connection on mount)
- Background checks for active mini-gero port before falling back to popup
- Message format compatible with existing `InternalSidePanelController` pattern

### Signing Components

The existing signing components (`DappConnect.vue`, `DappSignData.vue`, `SignTx.vue`) contain the business logic. For mini-gero, we either:
- Adapt them to render inside the bottom sheet (preferred — reuse logic)
- Build thin wrapper components that import the signing logic but have mini-specific UI

Hardware wallet signing (Ledger, Trezor, Keystone) flows remain unchanged — they use their own communication channels (WebUSB, WebBLE, QR codes) which work regardless of the UI container.

PRF wallet signing opens a small popup for WebAuthn (existing pattern in `DappSignData.vue`) — this continues to work since it's a separate window.

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
| **Shell** | App bootstrap, MiniLayout, BottomNav, MiniHeader, router, manifest changes, mode toggle, DApp overlay system | `src/sidepanel/` core, `App.vue`, `router.ts`, `layouts/`, `DAppOverlay.vue`, `BottomSheet.vue`, manifest.json, background.ts DApp routing |
| **Home** | HomePage, BalanceSection, QuickActions, FeaturedCarousel, TokenList, Buy/Sell button | `src/sidepanel/pages/HomePage.vue`, home-related components |
| **Card** | CardPage — all 4 states adapted for 400px, bottom sheet wrappers for all card sub-flows (top-up, manage, order, KYC) | `src/sidepanel/pages/CardPage.vue`, card-related components |
| **Staking** | StakingPage — stakepool + governance segmented toggle, status card, delegation flows, CashbackPage | `src/sidepanel/pages/StakingPage.vue`, `CashbackPage.vue`, staking/governance components |
| **Flows** | Send/Receive/Swap/Perps bottom sheet flows, ActivityPage, DApp signing components (Connect, SignData, SignTx) adapted for overlay | `src/sidepanel/pages/ActivityPage.vue`, quick action flow components, signing overlay components |

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

## Open Questions

1. **Wallet switching**: How should multi-wallet switching work in mini-gero? Avatar dropdown in header? Separate wallet selector page?
2. **Settings**: Full settings page in mini-gero, or just essential settings (network, security) with "Open Full Settings" link?
3. **Onboarding**: If no wallet exists, should mini-gero handle wallet creation/import, or redirect to the full dashboard?
4. **Perpetuals UI**: How much of the perps trading interface fits in a bottom sheet at 400px? May need a dedicated flow design.
5. **Featured carousel content**: What rotates in the carousel? Gero Card promo, cashback deals, new features, announcements?
