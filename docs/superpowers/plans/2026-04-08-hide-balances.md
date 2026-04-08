# Hide Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-wallet eye icon toggle on the dashboard that masks all monetary values with bullet characters for privacy.

**Architecture:** Store `hideBalances` boolean in per-wallet config (same pattern as `hideScamTokens`). PortfolioChart gets the eye icon button. All dashboard components that display monetary values read from `walletStore.config.hideBalances` and conditionally render masked text (`••••••`) instead of real values. The chart Y-axis uses a custom formatter that returns masked text when hidden.

**Tech Stack:** Vue 2.7 (Composition API / `<script setup>`), TypeScript, Vuetify 2.7, lightweight-charts, Dexie.js

---

### Task 1: Add `hideBalances` to wallet config and store

**Files:**
- Modify: `src/stores/walletStore.ts:78-93` (config defaults)
- Modify: `src/stores/walletStore.ts:332-337` (add setter, near `setHideScamTokens`)

- [ ] **Step 1: Add `hideBalances` default to walletStore config**

In `src/stores/walletStore.ts`, add `hideBalances: false` to the config object inside `Vue.observable`:

```typescript
config: {
  tokenAllocationSort: {
    by: 'allocation',
    desc: true
  },
  hideScamTokens: false,
  hideUnratedTokens: false,
  hideUnverifiedTokens: false,
  hideBalances: false,  // <-- add this line
  stakingProView: false,
  currency: 'usd',
  locale: 'us',
  txAutoSubmit: true,
  useSidePanel: true,
  websiteProtection: true,
},
```

- [ ] **Step 2: Add `setHideBalances` method**

In `src/stores/walletStore.ts`, add a setter method right after `setHideScamTokens` (around line 337):

```typescript
setHideBalances(value: boolean) {
  if (walletStore.config && walletStore.loggedWallet) {
    walletStore.config.hideBalances = value;
    broadcastFromBackground({ config: walletStore.config });
    setWalletConfiguration(walletStore.loggedWallet.id, 'hideBalances', value);
  }
},
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/walletStore.ts
git commit -m "feat: add hideBalances config to wallet store"
```

---

### Task 2: Add i18n keys

**Files:**
- Modify: `src/plugins/i18n/us.ts` (dashboard section, around line 668)
- Modify: `src/plugins/i18n/de.ts` (dashboard section, around line 777)

- [ ] **Step 1: Add English translation keys**

In `src/plugins/i18n/us.ts`, add after the existing `dashboard.all` key:

```typescript
'dashboard.hideBalances': 'Hide balances',
'dashboard.showBalances': 'Show balances',
```

- [ ] **Step 2: Add German translation keys**

In `src/plugins/i18n/de.ts`, add in the corresponding dashboard section:

```typescript
'dashboard.hideBalances': 'Guthaben ausblenden',
'dashboard.showBalances': 'Guthaben einblenden',
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat: add i18n keys for hide balances toggle"
```

---

### Task 3: Add eye icon to PortfolioChart

**Files:**
- Modify: `src/modules/dashboard/components/PortfolioChart.vue:6-40` (template header + amount area)
- Modify: `src/modules/dashboard/components/PortfolioChart.vue:~280` (script setup section)

- [ ] **Step 1: Import store setter and add reactive ref**

In the `<script setup>` section of `PortfolioChart.vue`, add the import for the store setter (the file already imports `walletStore`). Add a computed property for `hideBalances`:

```typescript
import { walletStoreActions } from '@/stores/walletStore';
// (or wherever setHideBalances is exported — follow the existing import pattern for setHideScamTokens)

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

const toggleHideBalances = () => {
  walletStoreActions.setHideBalances(!hideBalances.value);
};
```

- [ ] **Step 2: Add eye icon button to the header row**

In the template, inside the `metrics-header-row` div (around line 6-30), add the eye icon button right before the existing refresh button:

```vue
<v-tooltip bottom content-class="custom-tooltip">
  <template v-slot:activator="{ on, attrs }">
    <v-btn icon x-small v-bind="attrs" v-on="on" @click="toggleHideBalances()">
      <v-icon small>{{ hideBalances ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
    </v-btn>
  </template>
  <span>{{ hideBalances ? $t('dashboard.showBalances') : $t('dashboard.hideBalances') }}</span>
</v-tooltip>
```

- [ ] **Step 3: Mask the portfolio amount display**

Replace the portfolio-amount section (lines 32-40) to conditionally show masked values:

```vue
<div
  class="portfolio-amount"
  @click="!hideBalances && toggleCurrency()"
  :class="{ clickable: !hideBalances && availableCurrencies.length > 1 }"
>
  <template v-if="hideBalances">
    <span class="portfolio-amount-masked">••••••</span>
  </template>
  <template v-else>
    <span class="currency-symbol">{{ currentCurrencyConfig.symbol }}</span>
    <OdometerCounter v-if="isReadyToRender" :value="activePortfolioValue" format="decimal" :duration="1000" :key="selectedCurrency" />
    <span v-else class="portfolio-amount-placeholder">—</span>
  </template>
</div>
```

- [ ] **Step 4: Add CSS for masked text**

In the `<style>` section of PortfolioChart.vue, add:

```css
.portfolio-amount-masked {
  font-size: inherit;
  letter-spacing: 2px;
  opacity: 0.5;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/components/PortfolioChart.vue
git commit -m "feat: add eye icon toggle and balance masking to PortfolioChart"
```

---

### Task 4: Mask chart Y-axis labels

**Files:**
- Modify: `src/modules/dashboard/components/PortfolioChart.vue:749-771` (chart priceFormat formatter)

- [ ] **Step 1: Update the chart price formatter**

In the `areaSeries` config (around line 749-771), update the `priceFormat.formatter` to return masked text when hidden:

```typescript
priceFormat: {
  type: 'custom',
  formatter: (price: number) => {
    if (hideBalances.value) return '••••••';
    if (price >= 1e6) return (price / 1e6).toFixed(1) + 'M';
    if (price >= 1e3) return (price / 1e3).toFixed(1) + 'K';
    if (price >= 1) return price.toFixed(0);
    return price.toFixed(2);
  },
  minMove: 1,
},
```

- [ ] **Step 2: Re-apply chart series when hideBalances changes**

Add a watcher so the chart updates its Y-axis labels when the toggle changes. Find where the chart is set up (the `initChart` or similar function) and add:

```typescript
watch(hideBalances, () => {
  if (areaSeries && chart) {
    areaSeries.applyOptions({
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => {
          if (hideBalances.value) return '••••••';
          if (price >= 1e6) return (price / 1e6).toFixed(1) + 'M';
          if (price >= 1e3) return (price / 1e3).toFixed(1) + 'K';
          if (price >= 1) return price.toFixed(0);
          return price.toFixed(2);
        },
        minMove: 1,
      },
    });
  }
});
```

- [ ] **Step 3: Also mask the crosshair tooltip price**

The crosshair horizontal line shows a price label. Update the crosshair config (around line 730) to hide labels when balances are hidden. Add a watcher:

```typescript
watch(hideBalances, () => {
  if (chart) {
    chart.applyOptions({
      crosshair: {
        horzLine: {
          labelVisible: !hideBalances.value,
        },
      },
    });
  }
});
```

(This can be combined with the watcher in Step 2.)

- [ ] **Step 4: Commit**

```bash
git add src/modules/dashboard/components/PortfolioChart.vue
git commit -m "feat: mask chart Y-axis labels and crosshair when balances hidden"
```

---

### Task 5: Mask BitcoinBalanceCard amounts

**Files:**
- Modify: `src/modules/dashboard/components/BitcoinBalanceCard.vue:36-56` (balance template)
- Modify: `src/modules/dashboard/components/BitcoinBalanceCard.vue:~90` (script setup)

- [ ] **Step 1: Add hideBalances computed ref**

In the `<script setup>` section, add:

```typescript
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
```

(`walletStore` is already imported in this file.)

- [ ] **Step 2: Mask the balance display**

Update the balance-block template (lines 36-56):

```vue
<div class="balance-block">
  <div class="balance-field-label">Available Balance</div>

  <div class="balance-primary">
    <span class="balance-number">{{ hideBalances ? '••••••' : formatBtc(availableBalance) }}</span>
    <span class="balance-unit">BTC</span>
  </div>

  <div class="balance-sats">
    <svg class="sat-bolt" viewBox="0 0 10 16" fill="#F7931A" width="7" height="11" style="opacity:0.65;flex-shrink:0">
      <polygon points="6,0 0,9 5,9 4,16 10,7 5,7"/>
    </svg>
    <span class="sats-num">{{ hideBalances ? '••••••' : Number(availableBalance).toLocaleString() }}</span>
    <span class="sats-label">sats</span>
  </div>

  <div class="balance-usd" v-if="btcPrice">
    <span class="usd-amount">{{ hideBalances ? '$•••' : '$' + formatUsdRaw(usdValue) }}</span>
    <span class="usd-label">USD</span>
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/dashboard/components/BitcoinBalanceCard.vue
git commit -m "feat: mask Bitcoin balance amounts when balances hidden"
```

---

### Task 6: Mask TransactionsCard amounts

**Files:**
- Modify: `src/modules/dashboard/components/TransactionsCard.vue:238-262` (amount column template)
- Modify: `src/modules/dashboard/components/TransactionsCard.vue` (script setup)

- [ ] **Step 1: Add hideBalances computed ref**

In the `<script setup>` section, add:

```typescript
import { walletStore } from '@/stores/walletStore';
// (walletStore may already be imported — check first)

const hideBalances = computed(() => walletStore.config?.hideBalances || false);
```

- [ ] **Step 2: Mask transaction amounts**

Update the `item.amount` slot template (lines 238-262):

```vue
<template v-slot:[`item.amount`]="{ item }">
  <div v-if="loggedWallet" style="display: flex; flex-direction: column; align-items: center">
    <div
      :style="{
        color: getColor(item),
        fontSize: '14px',
        paddingBottom: '4px',
        textWrap: 'nowrap',
      }"
    >
      <template v-if="hideBalances">••••••</template>
      <template v-else>
        {{
          filters.toCurrency(
            item.ada ?? 0,
            true,
            0,
            networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network),
            '',
            false
          )
        }}
      </template>
    </div>
    <div style="font-size: 12px; color: #c4c4c4; white-space: nowrap">
      <template v-if="hideBalances">$•••</template>
      <template v-else>
        {{ filters.toCurrency(convertFiat((item.ada ?? 0) * adaPrice), true, 0, getCurrencySymbol(), '', false, 6) }}
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/dashboard/components/TransactionsCard.vue
git commit -m "feat: mask transaction amounts when balances hidden"
```

---

### Task 7: Mask TokensTab amounts

**Files:**
- Modify: `src/modules/assets/components/TokensTab.vue:73-136` (quantity, price, value, mcap columns)
- Modify: `src/modules/assets/components/TokensTab.vue` (script setup)

- [ ] **Step 1: Add hideBalances computed ref**

In the `<script setup>` section:

```typescript
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
```

- [ ] **Step 2: Mask token quantity column**

Update the quantity display (around lines 73-76). Wrap the existing `filters.toCurrency(item.quantity, ...)` calls:

For the abbreviated display (line 73):
```vue
{{ hideBalances ? '••••••' : filters.toCurrency(item.quantity, false, 3, '', '', true, item.metadata?.decimals) }}
```

For the full display (line 76):
```vue
{{ hideBalances ? '••••••' : filters.toCurrency(item.quantity, false, 6, '', '', false, item.metadata?.decimals) }}
```

- [ ] **Step 3: Mask token price column**

Update the price display (around lines 88-91):

```vue
{{ hideBalances ? '••••••' : filters.toCurrency(item.price, false, 4, getCurrencySymbol(), '', true, 0) }}
```

```vue
{{ hideBalances ? '••••••' : filters.toCurrency(item.price, false, 6, getCurrencySymbol(), '', false, 0) }}
```

- [ ] **Step 4: Mask token value column**

Update the value display (around lines 122-125):

```vue
{{ hideBalances ? '••••••' : filters.toCurrency(item.value, false, 3, getCurrencySymbol(), '', true, 0) }}
```

```vue
{{ hideBalances ? '••••••' : filters.toCurrency(item.value, false, 6, getCurrencySymbol(), '', false, 0) }}
```

- [ ] **Step 5: Mask market cap column**

Update the mcap display (around lines 133-136):

```vue
{{ hideBalances ? '••••••' : filters.toCurrency(Number(item.mcap), false, 2, getCurrencySymbol(), '', true, 0) }}
```

```vue
{{ hideBalances ? '••••••' : filters.toCurrency(Number(item.mcap), false, 4, getCurrencySymbol(), '', false, 0) }}
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/assets/components/TokensTab.vue
git commit -m "feat: mask token amounts in TokensTab when balances hidden"
```

---

### Task 8: Manual testing

- [ ] **Step 1: Build and load extension**

```bash
npm run build
```

Load the built extension in Chrome (`chrome://extensions` → Load unpacked → `dist/`).

- [ ] **Step 2: Test Cardano wallet**

1. Log in to a Cardano wallet
2. Navigate to Dashboard
3. Verify the eye icon appears in the top-right of the PortfolioChart card
4. Click the eye icon — verify:
   - Portfolio total shows `••••••`
   - Chart Y-axis labels show `••••••`
   - Transaction amounts show `••••••` / `$•••`
   - Token quantities, prices, values show `••••••`
   - Chart line/bars remain visible
   - Eye icon changes to `mdi-eye-off`
5. Click again — verify everything shows real values again
6. Hide balances, close extension, reopen — verify balances stay hidden
7. Navigate to Staking/Assets/other screens — verify those are NOT masked

- [ ] **Step 3: Test Bitcoin wallet (if available)**

1. Switch to Bitcoin wallet
2. Verify eye icon in PortfolioChart or equivalent
3. Verify BTC balance, sats, and USD values get masked

- [ ] **Step 4: Test per-wallet isolation**

1. Hide balances on Wallet A
2. Switch to Wallet B — verify balances are visible
3. Switch back to Wallet A — verify balances still hidden
