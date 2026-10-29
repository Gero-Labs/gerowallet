<template>
  <div class="gm">
    <!-- Header. The GoMining mark is a partner lockup: it names whose surface this is, nothing else. -->
    <div class="gm__header">
      <div class="gm__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title gm__title">
          <img :src="gominingLogo" class="gm__logo" alt="" />
          {{ $t('navigation.goMining') }}
        </h1>
        <p class="t-body gm__subtitle">{{ $t('gomining.subtitle') }}</p>
      </div>
      <div v-if="phase === 'linked' || config?.environment === 'sandbox'" class="gm__header-side">
        <span v-if="config?.environment === 'sandbox'" class="t-caption gm-status gm-status--sandbox">
          {{ $t('gomining.testEnvironment') }}
        </span>
        <span v-if="phase === 'linked'" class="t-caption gm-status gm-status--ok" role="status">
          <span class="gm-status__dot" aria-hidden="true"></span>
          {{ $t('gomining.connected') }}
        </span>
      </div>
    </div>

    <!-- Loading GoMining's config and this wallet's session -->
    <div v-if="phase === 'loading'" class="gm__loading" role="status">
      <v-progress-circular indeterminate color="var(--g-accent)" size="40" width="3" />
      <span class="t-body">{{ $t('gomining.connecting') }}</span>
    </div>

    <!-- GoMining could not be loaded. Only a request that got no answer at all points at the
         user's connection; an error reply from gero-backend is ours, so it says so. -->
    <div v-else-if="phase === 'unavailable'" class="glass-panel gm__error" role="alert">
      <v-icon size="32" class="gm__error-icon">mdi-alert-circle-outline</v-icon>
      <template v-if="unavailableReason === 'network'">
        <h2 class="t-heading gm__error-title">{{ $t('gomining.connectionFailed') }}</h2>
        <p class="t-body gm__error-text">{{ $t('gomining.connectionFailedDescription') }}</p>
      </template>
      <template v-else>
        <h2 class="t-heading gm__error-title">{{ $t('gomining.unavailableTitle') }}</h2>
        <p class="t-body gm__error-text">{{ $t('gomining.unavailableDescription') }}</p>
      </template>
      <GButton tier="secondary" compact @click="load()">
        <v-icon size="small" start>mdi-refresh</v-icon>
        {{ $t('common.tryAgain') }}
      </GButton>
    </div>

    <!-- This wallet cannot link -->
    <div v-else-if="phase === 'unsupported'" class="glass-panel gm__error" role="status">
      <v-icon size="32" class="gm__info-icon">mdi-information-outline</v-icon>
      <h2 class="t-heading gm__error-title">{{ $t('gomining.unsupportedTitle') }}</h2>
      <p class="t-body gm__error-text">{{ unsupportedText }}</p>
    </div>

    <!-- Not linked yet: what GoMining is, and the miners on offer -->
    <template v-else-if="phase === 'unlinked'">
      <section class="glass-panel gm-link" :aria-label="$t('gomining.linkTitle')">
        <h2 class="t-heading gm-link__title">{{ $t('gomining.linkTitle') }}</h2>
        <p class="t-body gm-link__text">{{ $t('gomining.linkDescription') }}</p>
        <p v-if="sessionExpired" class="t-body-sm gm-link__expired" role="status">{{ $t('gomining.errorSessionExpired') }}</p>
        <div class="gm-link__actions">
          <GButton tier="primary" @click="showConnectDialog = true">
            <v-icon size="small" start>mdi-link-variant</v-icon>
            {{ $t('common.connect') }}
          </GButton>
          <a
            v-if="config?.referralUrl"
            :href="config.referralUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="t-body-sm gm-link__referral"
          >
            {{ $t('gomining.openGoMiningApp') }}
            <v-icon size="x-small">mdi-open-in-new</v-icon>
          </a>
        </div>
      </section>

      <GoMiningShop
        :collections="collections"
        :orders-enabled="!!config?.ordersEnabled"
        :loading="loadingCollections"
        @buy="showConnectDialog = true"
      />
    </template>

    <template v-else-if="phase === 'linked'">
      <!-- Segmented tabs -->
      <div class="gm-tabs" role="tablist" :aria-label="$t('navigation.goMining')">
        <button
          v-for="tab in tabs"
          :id="`gm-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.index ? 'true' : 'false'"
          :aria-controls="`gm-panel-${tab.id}`"
          :class="['t-body-sm', 'gm-tab', { 'gm-tab--active': activeTab === tab.index }]"
          @click="activeTab = tab.index"
        >
          <v-icon size="small">{{ tab.icon }}</v-icon>
          {{ $t(tab.labelKey) }}
          <span v-if="tab.id === 'miners' && miners.length" class="t-caption g-num gm-tab__count">{{ miners.length }}</span>
        </button>
      </div>

      <div v-if="loadFailed" class="t-body-sm gm-partial" role="status">
        <v-icon size="small">mdi-alert-outline</v-icon>
        <span>{{ $t('gomining.partialLoad') }}</span>
      </div>

      <!-- Overview -->
      <div v-if="activeTab === 0" id="gm-panel-overview" class="gm-overview" role="tabpanel" aria-labelledby="gm-tab-overview">
        <GoMiningStatsCard
          class="gm-overview__full"
          :account="accountInfo"
          :latest-day="latestDay"
          :loading="refreshing"
          @refresh="refreshAll()"
        />

        <GoMiningBalanceCard
          :balances="balances"
          :payout-address="accountInfo?.payoutAddress ?? null"
          :loading="loadingBalances"
          @withdraw="showWithdrawDialog = true"
        />

        <section class="glass-panel gm-chart" :aria-label="$t('gomining.earningsHistory')">
          <div class="gm-chart__head">
            <span class="gm-chart__icon"><v-icon size="18">mdi-chart-bar</v-icon></span>
            <span class="t-body-lg">{{ $t('gomining.earningsHistory') }}</span>
            <span class="t-caption gm-chart__range">{{ $t('gomining.last14Days') }}</span>
          </div>

          <div v-if="chartDays.length === 0" class="gm-chart__empty">
            <v-icon size="28" class="gm-chart__empty-icon">mdi-chart-bar</v-icon>
            <span class="t-caption">
              {{ loadingIncome ? $t('gomining.loadingEarnings') : $t('gomining.noMinersForEarnings') }}
            </span>
          </div>

          <!-- One bar a day; the amount is in the tooltip and, for readers, in the hidden text. -->
          <ul v-else class="gm-bars">
            <li v-for="day in chartDays" :key="day.date" class="gm-bars__item">
              <v-tooltip location="top" content-class="custom-tooltip">
                <template #activator="{ props: activatorProps }">
                  <span v-bind="activatorProps" class="gm-bars__bar" :style="{ height: barHeight(day.rewardSats) }"></span>
                </template>
                <span>{{ barLabel(day) }}</span>
              </v-tooltip>
              <span class="gm-sr-only">{{ barLabel(day) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <!-- My miners -->
      <div v-else-if="activeTab === 1" id="gm-panel-miners" role="tabpanel" aria-labelledby="gm-tab-miners">
        <GoMiningMinersGrid
          :miners="miners"
          :orders="orders"
          :loading="loadingMiners"
          @buy-more="activeTab = 2"
        />
      </div>

      <!-- Shop -->
      <div v-else-if="activeTab === 2" id="gm-panel-shop" role="tabpanel" aria-labelledby="gm-tab-shop">
        <GoMiningShop
          :collections="collections"
          :orders-enabled="!!config?.ordersEnabled"
          :loading="loadingCollections"
          @buy="openBuyDialog"
        />
      </div>

      <!-- Earnings -->
      <section v-else-if="activeTab === 3" id="gm-panel-earnings" class="glass-panel gm-earnings" role="tabpanel" aria-labelledby="gm-tab-earnings">
        <div class="gm-earnings__head">
          <span class="gm-chart__icon"><v-icon size="18">mdi-chart-line</v-icon></span>
          <span class="t-body-lg">{{ $t('gomining.earningsHistory') }}</span>
        </div>

        <div v-if="loadingIncome" class="gm-earnings__body" aria-busy="true">
          <v-skeleton-loader type="table-row@6" />
        </div>

        <div v-else-if="days.length === 0" class="gm-earnings__empty">
          <v-icon size="28" class="gm-chart__empty-icon">mdi-history</v-icon>
          <span class="t-body-lg">{{ $t('gomining.noEarningsYet') }}</span>
          <span class="t-caption">{{ $t('gomining.noEarningsDescription') }}</span>
        </div>

        <!-- The card carries the material; the table is transparent over it. -->
        <v-data-table
          v-else
          :headers="earningsHeaders"
          :items="tableDays"
          :items-per-page="10"
          class="gm-table"
          density="compact"
        >
          <template #item.date="{ item }">
            <span class="t-body-sm">{{ formatDate(item.date) }}</span>
          </template>
          <template #item.poolRewardSats="{ item }">
            <span class="g-num">{{ formatBtc(item.poolRewardSats) }}</span>
          </template>
          <template #item.serviceFeeSats="{ item }">
            <span class="g-num">{{ formatBtc(item.serviceFeeSats) }}</span>
          </template>
          <template #item.rewardSats="{ item }">
            <span class="g-num gm-table__in">+{{ formatBtc(item.rewardSats) }} BTC</span>
          </template>
        </v-data-table>
      </section>
    </template>

    <!-- Dialogs -->
    <GoMiningConnectDialog
      v-if="phase === 'unlinked'"
      v-model="showConnectDialog"
      :address="address"
      :connect="connect"
    />

    <GoMiningWithdrawDialog
      v-if="phase === 'linked' && accountInfo?.payoutAddress"
      v-model="showWithdrawDialog"
      :payout-address="accountInfo.payoutAddress"
      :available-sats="balances?.availableSats ?? 0"
      :with-session="withSession"
      @success="onWithdrawSuccess"
    />

    <GoMiningBuyDialog
      v-if="phase === 'linked'"
      v-model="showBuyDialog"
      :collection="selectedCollection"
      :wallet-network="wallet?.network ?? ''"
      :with-session="withSession"
      @changed="onOrderChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtc } from '@/shared/utils/format';
import GButton from '@/shared/components/GButton/GButton.vue';
import snackbar from '@/plugins/snackbar';
import goMiningApi, {
  GoMiningSessionError,
  type GoMiningAccount,
  type GoMiningBalances,
  type GoMiningCollection,
  type GoMiningDay,
  type GoMiningMiner,
  type GoMiningOrder,
} from '@/api/gomining-api';
import { useGoMiningAccount } from './useGoMiningAccount';
import GoMiningStatsCard from './components/GoMiningStatsCard.vue';
import GoMiningBalanceCard from './components/GoMiningBalanceCard.vue';
import GoMiningMinersGrid from './components/GoMiningMinersGrid.vue';
import GoMiningShop from './components/GoMiningShop.vue';
import GoMiningConnectDialog from './dialogs/GoMiningConnectDialog.vue';
import GoMiningWithdrawDialog from './dialogs/GoMiningWithdrawDialog.vue';
import GoMiningBuyDialog from './dialogs/GoMiningBuyDialog.vue';
import gominingLogo from '@/assets/svg/gomining.svg';

const { t } = useTranslation();

const { config, phase, unsupportedReason, unavailableReason, sessionExpired, address, wallet, load, connect, withSession, captureGeneration } = useGoMiningAccount();

/** Days of payouts loaded: the chart shows the last 14, the table all of them. */
const INCOME_DAYS = 30;

const activeTab = ref(0);

const accountInfo = ref<GoMiningAccount | null>(null);
const balances = ref<GoMiningBalances | null>(null);
const miners = ref<GoMiningMiner[]>([]);
const days = ref<GoMiningDay[]>([]);
const orders = ref<GoMiningOrder[]>([]);
const collections = ref<GoMiningCollection[]>([]);

const loadingAccount = ref(false);
const loadingBalances = ref(false);
const loadingMiners = ref(false);
const loadingIncome = ref(false);
const loadingCollections = ref(false);
/** A part of the page failed to load (a refused session is handled separately). */
const loadFailed = ref(false);

const showConnectDialog = ref(false);
const showWithdrawDialog = ref(false);
const showBuyDialog = ref(false);
const selectedCollection = ref<GoMiningCollection | null>(null);

const tabs = [
  { id: 'overview', index: 0, icon: 'mdi-view-dashboard-outline', labelKey: 'gomining.tabOverview' },
  { id: 'miners', index: 1, icon: 'mdi-pickaxe', labelKey: 'gomining.tabMyMiners' },
  { id: 'shop', index: 2, icon: 'mdi-store-outline', labelKey: 'gomining.tabShop' },
  { id: 'earnings', index: 3, icon: 'mdi-chart-line', labelKey: 'gomining.tabEarnings' },
];

const earningsHeaders = computed(() => [
  { title: t('common.date'), key: 'date', sortable: true },
  { title: t('gomining.grossReward'), key: 'poolRewardSats', sortable: true },
  { title: t('gomining.fees'), key: 'serviceFeeSats', sortable: true },
  { title: t('gomining.netReward'), key: 'rewardSats', sortable: true },
]);

const unsupportedText = computed(() => {
  switch (unsupportedReason.value) {
    case 'walletType': return t('gomining.unsupportedWalletType');
    case 'addressType': return t('gomining.unsupportedAddressType');
    case 'network': return config.value?.bitcoinNetwork === 'Testnet' ? t('gomining.unsupportedNetworkTestnet') : t('gomining.unsupportedNetworkMainnet');
    default: return t('gomining.unsupportedChain');
  }
});

const refreshing = computed(() => loadingAccount.value || loadingBalances.value || loadingMiners.value || loadingIncome.value);
const latestDay = computed(() => days.value[days.value.length - 1] ?? null);
const chartDays = computed(() => days.value.slice(-14));
const tableDays = computed(() => [...days.value].reverse());

// ─── Loading ──────────────────────────────────────────────────────────────────

/** One part of the page. A reply for an earlier wallet is dropped; a refused session ends the link. */
async function loadPart<T>(flag: { value: boolean }, call: (token: string) => Promise<T>, apply: (value: T) => void) {
  const fresh = captureGeneration();
  flag.value = true;
  try {
    const value = await withSession(call);
    if (fresh()) apply(value);
  } catch (error) {
    if (fresh() && !(error instanceof GoMiningSessionError)) loadFailed.value = true;
  } finally {
    if (fresh()) flag.value = false;
  }
}

function refreshAccount() {
  return loadPart(loadingAccount, (token) => goMiningApi.getAccount(token), (value) => { accountInfo.value = value; });
}

function refreshBalances() {
  return loadPart(loadingBalances, (token) => goMiningApi.getBalances(token), (value) => { balances.value = value; });
}

function refreshMiners() {
  return loadPart(loadingMiners, (token) => goMiningApi.getMiners(token), (value) => { miners.value = value; });
}

function refreshIncome() {
  return loadPart(loadingIncome, (token) => goMiningApi.getDailyIncome(token, INCOME_DAYS), (value) => { days.value = value; });
}

function refreshOrders() {
  // Orders only feed the "in progress" strip, so their failure is not a page warning.
  const fresh = captureGeneration();
  return withSession((token) => goMiningApi.getOrders(token))
    .then((value) => { if (fresh()) orders.value = value; })
    .catch(() => undefined);
}

async function refreshAll() {
  loadFailed.value = false;
  await Promise.all([refreshAccount(), refreshBalances(), refreshMiners(), refreshIncome(), refreshOrders()]);
}

async function loadCollections() {
  const fresh = captureGeneration();
  loadingCollections.value = true;
  try {
    const value = await goMiningApi.getCollections();
    if (fresh()) collections.value = value;
  } catch {
    if (fresh()) collections.value = [];
  } finally {
    if (fresh()) loadingCollections.value = false;
  }
}

function clearAccountData() {
  accountInfo.value = null;
  balances.value = null;
  miners.value = [];
  days.value = [];
  orders.value = [];
  loadFailed.value = false;
  activeTab.value = 0;
  showWithdrawDialog.value = false;
  showBuyDialog.value = false;
}

watch(phase, (next) => {
  if (next !== 'linked') clearAccountData();
  if (next === 'linked') void refreshAll();
  if (next === 'linked' || next === 'unlinked') void loadCollections();
}, { immediate: true });

// ─── Actions ──────────────────────────────────────────────────────────────────

function openBuyDialog(collection: GoMiningCollection) {
  selectedCollection.value = collection;
  showBuyDialog.value = true;
}

function onWithdrawSuccess() {
  snackbar.fireSuccess(t('gomining.withdrawalRequested'));
  void refreshBalances();
}

function onOrderChanged() {
  void refreshOrders();
  void refreshMiners();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const maxReward = computed(() => Math.max(1, ...chartDays.value.map((day) => day.rewardSats)));

function barHeight(rewardSats: number): string {
  return `${Math.max(4, (rewardSats / maxReward.value) * 100)}%`;
}

function barLabel(day: GoMiningDay): string {
  return t('gomining.earnedOn', { date: formatDate(day.date), amount: formatBtc(day.rewardSats) });
}
</script>

<style scoped lang="scss">
.gm {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-height: 100%;
  padding: var(--g-s-4);
}

/* ── Header ─────────────────────────────────────────────── */
.gm__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.gm__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.gm__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  margin: 0;
}

.gm__logo {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.gm__subtitle {
  margin: 0;
}

.gm__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.gm-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: var(--g-r-pill);
  font-weight: 600;
  white-space: nowrap;
}

.gm-status--ok {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.gm-status--sandbox {
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.gm-status__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: currentColor;
}

/* ── Page states ────────────────────────────────────────── */
.gm__loading,
.gm__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-2);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.gm__error-icon {
  color: var(--g-error);
}

.gm__info-icon {
  color: var(--g-text-2);
}

.gm__error-title {
  margin: 0;
}

.gm__error-text {
  max-width: 42ch;
  margin: 0 0 var(--g-s-2);
}

/* ── Not linked yet ─────────────────────────────────────── */
.gm-link {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
}

.gm-link__title,
.gm-link__text {
  margin: 0;
}

.gm-link__text {
  max-width: 64ch;
}

.gm-link__expired {
  margin: 0;
  color: var(--g-warning);
}

.gm-link__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-3);
  margin-top: var(--g-s-2);
}

.gm-link__referral {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-text-2);
}

.gm-link__referral:hover {
  color: var(--g-text-1);
}

/* ── Partial load ───────────────────────────────────────── */
.gm-partial {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  color: var(--g-warning);
}

/* ── Segmented tabs ─────────────────────────────────────── */
.gm-tabs {
  align-self: flex-start;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
}

.gm-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 32px;
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: var(--g-r-pill);
  background: transparent;
  color: var(--g-text-2);
  font-family: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.gm-tab:hover {
  color: var(--g-text-1);
}

.gm-tab--active {
  background: var(--g-hairline-2);
  color: var(--g-text-1);
}

.gm-tab .v-icon {
  color: inherit;
}

.gm-tab .gm-tab__count {
  font-weight: 500;
}

/* ── Overview grid ──────────────────────────────────────── */
.gm-overview {
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  gap: var(--g-s-4);
}

.gm-overview__full {
  grid-column: 1 / -1;
}

@media (max-width: 960px) {
  .gm-overview {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── Earnings chart ─────────────────────────────────────── */
.gm-chart {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.gm-chart__head,
.gm-earnings__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.gm-chart__range {
  margin-left: auto;
}

.gm-chart__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-chart__icon .v-icon {
  color: var(--g-text-2);
}

.gm-chart__empty,
.gm-earnings__empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-1);
  min-height: 100px;
  text-align: center;
}

.gm-chart__empty-icon {
  margin-bottom: var(--g-s-1);
  color: var(--g-text-3);
}

.gm-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 100px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.gm-bars__item {
  flex: 1 1 0;
  display: flex;
  align-items: flex-end;
  min-width: 0;
  height: 100%;
}

.gm-bars__bar {
  display: block;
  width: 100%;
  min-height: 4px;
  border-radius: var(--g-r-chip);
  background: var(--g-accent);
  opacity: 0.75;
  transition: opacity var(--g-dur-fast) var(--g-ease);
}

.gm-bars__item:hover .gm-bars__bar {
  opacity: 1;
}

.gm-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ── Earnings table ─────────────────────────────────────── */
.gm-earnings {
  display: flex;
  flex-direction: column;
}

.gm-earnings__head {
  padding: var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.gm-earnings__body {
  padding: var(--g-s-3);
}

.gm-earnings__empty {
  padding: var(--g-s-6) var(--g-s-4);
}

.gm-table {
  background: transparent;
  color: var(--g-text-1);
}

.gm-table :deep(.v-data-table-header__content) {
  color: var(--g-text-3);
  font-weight: 500;
}

.gm-table__in {
  color: var(--g-success);
}
</style>
