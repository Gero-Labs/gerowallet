# Strike v2 Migration — Plan 3: Account, Positions, History & Deposits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Strike account onboarding, deposit/withdraw flows (on-chain), position tracking, and trade history.

**Architecture:**

Strike v2 is a separate execution layer on Cardano. Key architectural facts:

- **Account is USD-denominated.** All balances, PnL, and margin are in USD.
- **Auth uses a dedicated Ed25519 key pair** — generated independently (NOT derived from the Cardano wallet mnemonic). Users generate a key, register public key with Strike.
- **Deposits require an on-chain Cardano transaction** — send ADA/tokens to the locker contract. Validators verify, volatile assets are auto-swapped to stablecoins (ADA → USDM), then USD balance is credited.
- **Withdrawals require a wallet signature** — user signs a withdrawal message, validators verify margin safety, then an on-chain tx releases funds.
- **Trading (orders, leverage, margin) is pure API calls** — no Cardano transactions.
- **Liquidation cascade:** Margin call (70%) → Reduce-only (90%) → Liquidation (100%) → Bankruptcy → Insurance Fund → ADL.
- **Funding rates:** periodic payments between longs/shorts, applied to account balance, can trigger liquidation.

**Tech Stack:** Vue.js 2.7, TypeScript, Cardano SDK (for deposit tx building), `strike-v2.user.ts` + `strike-v2.trade.ts` from Plan 1

**Depends on:** Plan 1 (API Client + Auth), Plan 2 (Market composables + Trading UI)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/modules/market/composables/useStrikeOnboarding.ts` | Key generation, account registration, connection status |
| `src/modules/market/composables/useStrikeDeposit.ts` | Deposit flow: quote → build Cardano tx → sign → submit → wait for credit |
| `src/modules/market/composables/useStrikeWithdraw.ts` | Withdraw flow: quote → sign message → submit → wait for on-chain settlement |
| `src/modules/market/composables/useStrikeAccount.ts` | Account state, balances, portfolio summary |
| `src/modules/market/composables/useStrikePositions.ts` | Open + closed positions, real-time PnL |
| `src/modules/market/composables/useStrikeHistory.ts` | Order/fill/funding/transaction history with pagination |
| `src/modules/market/composables/useStrikeUserWs.ts` | WebSocket: real-time account/position/order updates |
| `src/sidepanel/components/perps/StrikeOnboarding.vue` | First-time setup: generate keys, connect account |
| `src/sidepanel/components/perps/DepositSheet.vue` | Deposit bottom sheet: amount, preview, sign Cardano tx |
| `src/sidepanel/components/perps/WithdrawSheet.vue` | Withdraw bottom sheet: amount, destination, sign message |
| `src/sidepanel/components/perps/AccountPanel.vue` | Account summary: balance, margin, unrealized PnL, deposit/withdraw buttons |
| `src/sidepanel/components/perps/PositionsTable.vue` | Open positions with live PnL, close button |
| `src/sidepanel/components/perps/ClosedPositionsTable.vue` | Closed positions with realized PnL |
| `src/sidepanel/components/perps/OrdersTable.vue` | Open orders + order history |
| `src/sidepanel/components/perps/HistoryTabs.vue` | Fills, Funding, Transactions tabs |
| `src/sidepanel/components/perps/PortfolioChart.vue` | Equity curve from portfolio history |

---

### Task 1: Strike Account Onboarding Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeOnboarding.ts`

This handles first-time Strike account setup. The flow:
1. Check if user has Strike API keys stored (in wallet config DB or chrome.storage)
2. If not → show onboarding UI to generate keys
3. Generate Ed25519 key pair using `generateStrikeKeyPair()` from `strike-v2.auth.ts`
4. User confirms → public key is registered with Strike (may need a registration API call or on-chain tx)
5. Keys are stored securely (encrypted with spending password, same as mnemonic)
6. On subsequent logins, keys are loaded and passed to `setStrikeApiKeys()`

- [ ] **Step 1: Create onboarding composable**

State: `isConnected`, `isLoading`, `publicKey`
Methods:
- `checkConnection()` — check if keys exist in storage
- `generateAndStore(spendingPassword)` — generate key pair, encrypt private key, store both
- `loadKeys(spendingPassword)` — decrypt and call `setStrikeApiKeys()`
- `disconnect()` — clear keys, call `clearStrikeApiKeys()`

Storage: Store in wallet config table (per-wallet, encrypted same as mnemonic):
```
{ strikePublicKey: string, strikeEncryptedPrivateKey: string }
```

- [ ] **Step 2: Commit**

---

### Task 2: Strike Onboarding UI

**Files:**
- Create: `src/sidepanel/components/perps/StrikeOnboarding.vue`

Shown when user opens perps but hasn't connected to Strike yet.

Template:
1. Strike Finance logo + "Connect to Strike" heading
2. Explanation text: "Generate an API key pair to trade on Strike Finance"
3. "Generate Keys" button → triggers key generation
4. Shows public key after generation (copyable)
5. "Confirm & Connect" button → stores keys, emits `connected`
6. Loading states for key generation and account registration

Requires spending password input (for encrypting the private key).

- [ ] **Step 1: Create onboarding component**
- [ ] **Step 2: Commit**

---

### Task 3: Deposit Flow Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeDeposit.ts`

The deposit flow is on-chain — requires building and signing a Cardano transaction.

Flow:
1. User enters amount (in ADA or supported token)
2. Request deposit quote from Strike validators (API endpoint TBD — may be `/v2/deposit/quote`)
3. Quote returns: locker contract address, required amount, quote expiration, estimated USD credit
4. Build Cardano transaction sending ADA to the locker address
5. Sign transaction (spending password / hardware wallet / PassKey — same as send flow)
6. Submit transaction to Cardano blockchain
7. Wait for validators to verify (poll or WebSocket notification)
8. Balance credited on Strike account

**Note:** The exact deposit API endpoints need to be confirmed with Strike. The v2 API spec we have doesn't include deposit/withdraw endpoints — these may be validator-specific endpoints or part of a separate API.

State: `depositQuote`, `depositStatus`, `isLoading`, `error`
Methods:
- `requestQuote(amount, asset)` → get deposit quote from validators
- `buildAndSignTx(quote, password)` → build Cardano tx, sign, submit
- `pollStatus(txHash)` → wait for confirmation + credit

- [ ] **Step 1: Create deposit composable (placeholder with TODO for validator API)**
- [ ] **Step 2: Commit**

---

### Task 4: Withdraw Flow Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeWithdraw.ts`

Withdrawals require signing a message with the wallet (not a Cardano transaction).

Flow:
1. User enters amount and destination address
2. Request withdrawal quote from validators
3. Quote returns: message to sign, estimated on-chain delivery time
4. User signs the withdrawal message with their Cardano wallet (Ed25519 signature)
5. Submit signed message to validators
6. Validators verify: signature, quote validity, margin safety (won't cause liquidation)
7. Validators construct + submit on-chain tx to release funds
8. Funds arrive in user's Cardano wallet

State: `withdrawQuote`, `withdrawStatus`, `isLoading`, `error`
Methods:
- `requestQuote(amount, asset, destinationAddress)` → get withdrawal quote
- `signAndSubmit(quote, password)` → sign message, submit to validators
- `pollStatus(withdrawalId)` → wait for on-chain settlement

**Note:** Same as deposits — exact endpoints need confirmation from Strike.

- [ ] **Step 1: Create withdraw composable (placeholder with TODO for validator API)**
- [ ] **Step 2: Commit**

---

### Task 5: Deposit Sheet UI

**Files:**
- Create: `src/sidepanel/components/perps/DepositSheet.vue`

Bottom sheet for depositing ADA into Strike account.

Template:
1. "Deposit" title
2. Amount input (ADA) with "MAX" button (wallet ADA balance)
3. Preview section:
   - Amount: X ADA
   - Estimated USD credit: $Y (after swap to stablecoin)
   - Network fee: ~Z ADA
   - Quote expires in: countdown timer
4. Warning: "Volatile assets are automatically converted to stablecoins"
5. Spending password / PassKey / hardware wallet signing (reuse existing signing pattern from SendSheet.vue)
6. "Deposit" button → loading → success/error state

**Important:** This component needs the same signing infrastructure as the Send flow — spending password input, hardware wallet support (Ledger, Trezor, Keystone), PRF/PassKey support. Reference `src/sidepanel/components/flows/SendSheet.vue` for the pattern.

- [ ] **Step 1: Create deposit sheet**
- [ ] **Step 2: Commit**

---

### Task 6: Withdraw Sheet UI

**Files:**
- Create: `src/sidepanel/components/perps/WithdrawSheet.vue`

Bottom sheet for withdrawing from Strike to Cardano wallet.

Template:
1. "Withdraw" title
2. Amount input (USD) with "MAX" button (Strike available balance minus margin buffer)
3. Destination address (default: user's wallet address, editable)
4. Asset selector (ADA, USDM, etc.)
5. Preview:
   - Amount: $X
   - Estimated ADA received: Y ADA (if withdrawing as ADA)
   - Estimated delivery: ~Z minutes
6. Warning if withdrawal would reduce margin below safe level
7. Wallet signature step (sign the withdrawal authorization message)
8. "Withdraw" button → loading → pending → confirmed

- [ ] **Step 1: Create withdraw sheet**
- [ ] **Step 2: Commit**

---

### Task 7: Account State Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeAccount.ts`

- [ ] **Step 1: Create account composable**

State: `account`, `balances`, `portfolio`, `loading`
Computed: `walletBalance`, `availableBalance`, `unrealizedPnl`, `marginBalance`, `totalMargin`, `allTimePnl`, `realizedPnl`, `feeTier`, `isTradingEnabled`, `equityHistory`
Methods: `loadAccount()`, `loadPortfolio()`

**Important context for display:**
- All values are USD-denominated strings from the API
- Show margin ratio indicator (0% healthy → 70% warning → 90% danger → 100% liquidation)
- Show margin mode per symbol from `account.symbol_settings`

- [ ] **Step 2: Commit**

---

### Task 8: Positions Composable

**Files:**
- Create: `src/modules/market/composables/useStrikePositions.ts`

- [ ] **Step 1: Create positions composable**

State: `positions`, `closedPositions`, `loadingOpen`, `loadingClosed`
Computed: `openPositionCount`, `totalUnrealizedPnl`
Methods: `loadPositions(symbol?)`, `loadClosedPositions(params)`, `getPositionBySymbol(symbol)`

**Position display context:**
- `upnl` is server-calculated (no client-side PnL math needed)
- `liquidation_price` is server-calculated
- `maintenance_margin` indicates how close to liquidation
- Show accumulated funding fees per position if available
- Margin mode badge (Cross/Isolated) per position

- [ ] **Step 2: Commit**

---

### Task 9: History Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeHistory.ts`

- [ ] **Step 1: Create history composable with pagination**

State: `orderHistory`, `fillHistory`, `fundingHistory`, `transactionHistory`, `loading`
Methods: `loadOrderHistory(params)`, `loadFillHistory(params)`, `loadFundingHistory(params)`, `loadTransactionHistory(params)`

**History display context:**
- Fill history: highlight `auto_close_type` (liquidation, ADL, bankrupt) with warning badges
- Funding history: positive = received (green), negative = paid (red)
- Transaction history: types include deposit, withdraw, fee, realized_pnl, liquidation
- All timestamps in Unix ms — format to user's locale

- [ ] **Step 2: Commit**

---

### Task 10: User Data WebSocket

**Files:**
- Create: `src/modules/market/composables/useStrikeUserWs.ts`

- [ ] **Step 1: Create user WebSocket composable**

Events to handle:
- `ACCOUNT_UPDATE` → refresh account balances
- `ORDER_TRADE_UPDATE` → refresh open orders, positions
- `POSITION_UPDATE` → refresh positions
- `BALANCE_UPDATE` → refresh balances

When events arrive, update the corresponding composable state (useStrikeAccount, useStrikePositions, useStrikeTrading).

**Connection:** Requires authentication (listenKey or auth headers in WS URL). Reconnect on disconnect with backoff.

- [ ] **Step 2: Commit**

---

### Task 11: Account Panel Component

**Files:**
- Create: `src/sidepanel/components/perps/AccountPanel.vue`

- [ ] **Step 1: Create account panel**

Shows:
- Wallet Balance (USD)
- Available Balance (USD)
- Margin Balance with ratio indicator (0-100% bar, colored by risk level)
- Unrealized PnL (colored)
- Deposit / Withdraw buttons (open respective sheets)
- If not connected: show StrikeOnboarding instead

- [ ] **Step 2: Commit**

---

### Task 12: Position/Order/History Table Components

**Files:**
- Create: `src/sidepanel/components/perps/PositionsTable.vue`
- Create: `src/sidepanel/components/perps/ClosedPositionsTable.vue`
- Create: `src/sidepanel/components/perps/OrdersTable.vue`
- Create: `src/sidepanel/components/perps/HistoryTabs.vue`

- [ ] **Step 1: Create position table**

Per position: symbol, side badge, size, entry price, mark price, PnL (colored), leverage, margin mode badge, liquidation price, accumulated funding, close button.

Highlight positions near liquidation (margin ratio > 70%) with warning indicator.

- [ ] **Step 2: Create orders table**

Open orders + history tabs. Cancel button per order. "Cancel All" header action.
Status chips: open (blue), filled (green), canceled (grey), rejected (red), liquidation (orange).

- [ ] **Step 3: Create history tabs**

Fills: highlight liquidation/ADL fills with badge.
Funding: running total, positive/negative coloring.
Transactions: type badge, status badge.

- [ ] **Step 4: Commit all**

---

### Task 13: Equity Curve Chart

**Files:**
- Create: `src/sidepanel/components/perps/PortfolioChart.vue`

- [ ] **Step 1: Create equity chart**

Uses `portfolio.history` data: `[timestamp_ms, accountValue, realizedPnl, unrealizedPnl][]`
- Line chart: account value over time
- Time range selector (matches portfolio API)
- Show all-time PnL, volume, fee tier in summary row

- [ ] **Step 2: Commit**

---

### Task 14: i18n Keys for Deposit/Withdraw/Onboarding

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add keys**

```
perpetuals.connectToStrike, perpetuals.generateKeys, perpetuals.confirmConnect,
perpetuals.deposit, perpetuals.withdraw, perpetuals.depositAmount, perpetuals.withdrawAmount,
perpetuals.estimatedCredit, perpetuals.networkFee, perpetuals.quoteExpires,
perpetuals.stablecoinWarning, perpetuals.marginSafetyWarning,
perpetuals.estimatedDelivery, perpetuals.destinationAddress,
perpetuals.marginRatio, perpetuals.marginCall, perpetuals.reduceOnlyMode,
perpetuals.accumulatedFunding, perpetuals.closedPositions,
perpetuals.autoCloseType, perpetuals.liquidation, perpetuals.adl, perpetuals.bankrupt
```

- [ ] **Step 2: Commit**

---

## Summary

After completing this plan:
- Strike account onboarding (key generation, secure storage)
- On-chain deposit flow (build Cardano tx → sign → submit → validators verify → USD credited)
- Withdrawal flow (request quote → sign message → validators settle on-chain)
- Full account management (USD balances, margin ratios, risk indicators)
- Real-time position tracking with server-calculated PnL and liquidation prices
- Comprehensive history (orders, fills, funding, transactions) with liquidation/ADL highlighting
- User data WebSocket for live updates
- Equity curve chart

## Open Questions
1. **Deposit/Withdraw API endpoints** — Not in the v2 API spec we have. Need confirmation: are these `/v2/deposit/quote` and `/v2/withdraw/quote`, or separate validator endpoints?
2. **Key registration** — How is the public key registered with Strike? API call, on-chain tx, or manual on the Strike website?
3. **Locker contract address** — Is this returned in the deposit quote, or is it a fixed address per chain?
4. **Stablecoin swap visibility** — Should the user see the ADA→USDM swap step, or is it hidden behind "Estimated USD credit"?
