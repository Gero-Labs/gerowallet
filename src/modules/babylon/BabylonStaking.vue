<template>
  <div class="bab">
    <!-- Header -->
    <div class="bab__header">
      <div class="bab__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title">{{ $t('babylon.title') }}</h1>
        <p class="t-body bab__subtitle">{{ $t('babylon.subtitle') }}</p>
      </div>
      <div class="bab__header-side">
        <GButton tier="secondary" compact :loading="loading" @click="refresh()">
          <v-icon start size="16" color="var(--g-accent)">mdi-refresh</v-icon>
          {{ $t('common.refresh') }}
        </GButton>
      </div>
    </div>

    <!-- Error -->
    <div v-if="error" class="bab-notice bab-notice--error" role="alert">
      <v-icon size="small">mdi-alert-circle-outline</v-icon>
      <span class="bab-notice__text">{{ error }}</span>
      <v-btn
        icon
        variant="text"
        size="small"
        :aria-label="$t('common.close')"
        :title="$t('common.close')"
        @click="error = null"
      >
        <v-icon size="small">mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- Beginner intro -->
    <v-expand-transition>
      <section v-if="showIntro" class="glass-panel bab-intro" :aria-label="$t('babylon.intro.title')">
        <span class="bab-intro__icon" aria-hidden="true">
          <v-icon size="small">mdi-school-outline</v-icon>
        </span>
        <div class="bab-intro__text">
          <h2 class="t-body-lg bab-intro__title">{{ $t('babylon.intro.title') }}</h2>
          <p class="t-body-sm bab-intro__body">{{ $t('babylon.intro.body') }}</p>
          <ol class="bab-intro__steps">
            <li v-for="stepKey in introSteps" :key="stepKey" class="t-caption">{{ $t(stepKey) }}</li>
          </ol>
        </div>
        <GButton tier="tertiary" compact @click="dismissIntro()">{{ $t('babylon.intro.dismiss') }}</GButton>
      </section>
    </v-expand-transition>

    <!-- Position hero -->
    <section class="glass-panel bab-hero" :aria-label="$t('babylon.yourPosition')">
      <div class="bab-hero__top">
        <div class="bab-hero__headline">
          <span class="t-label">{{ $t('babylon.yourPosition') }}</span>
          <div class="bab-hero__amount">
            <span class="t-display g-num">{{ totalPersonalStaked }}</span>
            <span class="g-mono bab-hero__unit">BTC</span>
          </div>
          <span v-if="delegations.length > 0" class="t-caption g-num">
            {{ delegations.length }} {{ delegations.length === 1 ? $t('babylon.delegation') : $t('babylon.delegations') }}
          </span>
          <span v-else class="t-caption">{{ $t('babylon.noPositionYet') }}</span>
        </div>

        <div class="bab-hero__cta">
          <GButton
            tier="primary"
            :disabled="!currentParams && !loading"
            :loading="loading && !currentParams"
            @click="stakeDialog = true"
          >
            <v-icon start size="small">mdi-plus</v-icon>
            {{ $t('babylon.stakeNow') }}
          </GButton>
          <span v-if="currentParams" class="t-caption g-num">
            {{ btcAmount(currentParams.min_staking_amount) }}–{{ btcAmount(currentParams.max_staking_amount) }} BTC
          </span>
        </div>
      </div>

      <!-- Network stats -->
      <div class="bab-hero__stats">
        <div v-for="s in heroStats" :key="s.key" class="glass-tier bab-tile">
          <span class="bab-tile__label">
            <span class="t-label">{{ s.label }}</span>
            <v-tooltip location="bottom" max-width="220" content-class="custom-tooltip">
              <template #activator="{ props: activatorProps }">
                <v-icon v-bind="activatorProps" size="14" class="bab-info">mdi-information-outline</v-icon>
              </template>
              <span>{{ s.tooltip }}</span>
            </v-tooltip>
          </span>
          <span class="t-heading g-num">{{ s.value }}</span>
        </div>
      </div>
    </section>

    <!-- Staking parameters -->
    <section v-if="currentParams" class="glass-panel bab-params" :aria-label="$t('babylon.stakingParams') + currentParams.version">
      <span class="t-label bab-params__title">
        <v-icon size="14">mdi-tune-variant</v-icon>
        {{ $t('babylon.stakingParams') }}{{ currentParams.version }}
      </span>
      <dl class="bab-params__items">
        <div v-for="p in paramItems" :key="p.key" class="bab-params__item">
          <dt class="bab-params__key">
            <span class="t-label">{{ p.label }}</span>
            <v-tooltip location="bottom" max-width="200" content-class="custom-tooltip">
              <template #activator="{ props: activatorProps }">
                <v-icon v-bind="activatorProps" size="14" class="bab-info">mdi-information-outline</v-icon>
              </template>
              {{ p.tooltip }}
            </v-tooltip>
          </dt>
          <dd class="t-body-sm g-num bab-params__val">{{ p.value }}</dd>
        </div>
      </dl>
    </section>

    <!-- My delegations -->
    <section v-if="delegations.length > 0" class="glass-panel bab-section" :aria-label="$t('babylon.myDelegations')">
      <div class="bab-section__head">
        <div class="bab-section__titles">
          <h2 class="t-heading bab-section__title">{{ $t('babylon.myDelegations') }}</h2>
          <span class="t-caption g-num">{{ delegations.length }}</span>
        </div>
      </div>

      <ul class="bab-list">
        <li v-for="d in delegations" :key="d.staking_tx_hash_hex" class="glass-tier bab-deleg">
          <div class="bab-deleg__top">
            <v-tooltip location="bottom" max-width="220" content-class="custom-tooltip">
              <template #activator="{ props: activatorProps }">
                <span v-bind="activatorProps" :class="['bab-status', `bab-status--${delegationTone(d.state)}`]">
                  <v-icon size="12">{{ delegationStateIcon(d.state) }}</v-icon>
                  {{ $t(`babylon.state.${d.state}`) }}
                </span>
              </template>
              {{ $t(`babylon.tooltip.state.${d.state}`) }}
            </v-tooltip>
            <v-btn
              icon
              variant="text"
              size="small"
              :aria-label="$t('babylon.stakeDialog.viewOnExplorer')"
              :title="$t('babylon.stakeDialog.viewOnExplorer')"
              @click="openTx(d.staking_tx_hash_hex)"
            >
              <v-icon size="small">mdi-open-in-new</v-icon>
            </v-btn>
          </div>

          <dl class="bab-facts">
            <div class="bab-facts__item">
              <dt class="t-label">{{ $t('babylon.stakedAmount') }}</dt>
              <dd class="t-body-sm g-num">{{ btcAmount(d.staking_value) }} <span class="bab-unit">BTC</span></dd>
            </div>
            <div class="bab-facts__item">
              <dt class="t-label">{{ $t('babylon.lockTime') }}</dt>
              <dd class="t-body-sm g-num">{{ formatInt(d.staking_tx?.timelock ?? 0) }} <span class="bab-unit">{{ $t('babylon.blocks') }}</span></dd>
            </div>
            <div class="bab-facts__item">
              <dt class="t-label">{{ $t('babylon.startHeight') }}</dt>
              <dd class="t-body-sm g-num">{{ formatInt(d.staking_tx?.start_height ?? 0) }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </section>

    <!-- Finality providers -->
    <section class="glass-panel bab-section" :aria-label="$t('babylon.finalityProviders')">
      <div class="bab-section__head">
        <div class="bab-section__titles">
          <h2 class="t-heading bab-section__title">{{ $t('babylon.finalityProviders') }}</h2>
          <v-tooltip location="bottom" max-width="260" content-class="custom-tooltip">
            <template #activator="{ props: activatorProps }">
              <v-icon v-bind="activatorProps" size="14" class="bab-info">mdi-information-outline</v-icon>
            </template>
            {{ $t('babylon.tooltip.finalityProvider') }}
          </v-tooltip>
          <span v-if="providers.length > 0" class="t-caption g-num">{{ providers.length }}</span>
        </div>
        <label class="bab-search">
          <v-icon size="small" class="bab-search__icon">mdi-magnify</v-icon>
          <input
            v-model="searchQuery"
            type="search"
            class="bab-search__input"
            :placeholder="$t('babylon.searchProviders')"
            :aria-label="$t('common.search')"
            @keydown.esc="searchQuery = ''"
          />
        </label>
      </div>

      <!-- Sort -->
      <div class="bab-sort" role="group" :aria-label="$t('babylon.sortBy')">
        <span class="t-label">{{ $t('babylon.sortBy') }}</span>
        <div class="bab-sort__group">
          <button
            v-for="s in sortOptions"
            :key="s.key"
            type="button"
            :class="['bab-sort__btn', { 'bab-sort__btn--active': sortKey === s.key }]"
            :aria-pressed="sortKey === s.key ? 'true' : 'false'"
            @click="setSort(s.key)"
          >
            {{ s.label }}
            <v-icon v-if="sortKey === s.key" size="14">{{ sortAsc ? 'mdi-arrow-up' : 'mdi-arrow-down' }}</v-icon>
          </button>
        </div>
      </div>

      <!-- Column legend (each label explains the metric under it) -->
      <div v-if="filteredProviders.length > 0" class="bab-cols">
        <span class="bab-cols__spacer" />
        <span v-for="col in providerCols" :key="col.key" class="bab-cols__col">
          <v-tooltip location="bottom" max-width="200" content-class="custom-tooltip">
            <template #activator="{ props: activatorProps }">
              <span v-bind="activatorProps" class="t-label bab-cols__label">{{ col.label }}</span>
            </template>
            {{ col.tooltip }}
          </v-tooltip>
        </span>
        <span class="bab-cols__end" />
      </div>

      <v-skeleton-loader v-if="loading && providers.length === 0" type="list-item-two-line@4" />

      <div v-if="!loading && filteredProviders.length === 0" class="bab-empty">
        <v-icon size="32" class="bab-empty__icon">mdi-shield-off-outline</v-icon>
        <span class="t-caption">{{ searchQuery ? $t('babylon.noProvidersSearch') : $t('babylon.noProviders') }}</span>
      </div>

      <ul class="bab-list">
        <li
          v-for="provider in filteredProviders"
          :key="provider.btc_pk"
          :class="['glass-tier', 'bab-fp', { 'bab-fp--open': expandedPk === provider.btc_pk }]"
        >
          <!-- Summary row: the whole row toggles the details -->
          <button
            type="button"
            class="bab-fp__summary"
            :aria-expanded="expandedPk === provider.btc_pk ? 'true' : 'false'"
            :aria-controls="providerPanelId(provider)"
            @click="toggleExpand(provider)"
          >
            <span class="bab-fp__avatar" aria-hidden="true">{{ providerInitial(provider) }}</span>

            <span class="bab-fp__info">
              <span class="bab-fp__name-row">
                <span class="bab-fp__name">{{ provider.description.moniker || $t('babylon.unknownProvider') }}</span>
                <v-tooltip v-if="provider.description.identity" location="bottom" max-width="200" content-class="custom-tooltip">
                  <template #activator="{ props: activatorProps }">
                    <v-icon v-bind="activatorProps" size="14" class="bab-fp__verified">mdi-check-decagram</v-icon>
                  </template>
                  {{ $t('babylon.identityVerified') }}: {{ provider.description.identity }}
                </v-tooltip>
              </span>
              <span class="t-caption g-mono bab-fp__pk">{{ provider.btc_pk.slice(0, 12) }}…{{ provider.btc_pk.slice(-8) }}</span>
            </span>

            <span class="bab-fp__metrics">
              <span :class="['bab-fp__metric', { 'bab-fp__metric--sorted': sortKey === 'commission' }]">
                <span class="bab-fp__metric-val g-num" :style="{ color: commissionColor(provider.commission) }">
                  {{ formatCommission(provider.commission) }}
                </span>
                <span class="t-label">{{ $t('babylon.col.fee') }}</span>
              </span>
              <span :class="['bab-fp__metric', { 'bab-fp__metric--sorted': sortKey === 'tvl' }]">
                <span class="bab-fp__metric-val g-num">{{ formatBtcCompact(provider.active_tvl) }}</span>
                <span class="t-label">{{ $t('babylon.col.tvl') }}</span>
              </span>
              <span :class="['bab-fp__metric', { 'bab-fp__metric--sorted': sortKey === 'stakers' }]">
                <span class="bab-fp__metric-val g-num">{{ formatInt(provider.active_delegations ?? 0) }}</span>
                <span class="t-label">{{ $t('babylon.col.stakers') }}</span>
              </span>
            </span>

            <v-icon size="small" class="bab-fp__chevron">mdi-chevron-down</v-icon>
          </button>

          <!-- Details -->
          <v-expand-transition>
            <div v-if="expandedPk === provider.btc_pk" :id="providerPanelId(provider)" class="bab-fp__details">
              <p v-if="provider.description.details" class="t-body-sm bab-fp__desc">{{ provider.description.details }}</p>
              <p v-else class="t-body-sm bab-fp__desc bab-fp__desc--empty">{{ $t('babylon.noDescription') }}</p>

              <div v-if="provider.description.website || provider.description.security_contact" class="bab-fp__links">
                <a
                  v-if="provider.description.website"
                  :href="normalizeUrl(provider.description.website)"
                  target="_blank"
                  rel="noopener"
                  class="t-caption bab-fp__link"
                >
                  <v-icon size="14">mdi-web</v-icon>
                  {{ provider.description.website }}
                </a>
                <span v-if="provider.description.security_contact" class="t-caption bab-fp__contact">
                  <v-icon size="14">mdi-shield-account-outline</v-icon>
                  {{ provider.description.security_contact }}
                </span>
              </div>

              <dl class="bab-facts bab-facts--boxed">
                <div class="bab-facts__item">
                  <dt class="t-label">{{ $t('babylon.activeTVL') }}</dt>
                  <dd class="t-body-sm g-num">{{ btcAmount(provider.active_tvl) }} <span class="bab-unit">BTC</span></dd>
                </div>
                <div v-if="provider.total_tvl != null" class="bab-facts__item">
                  <dt class="t-label">{{ $t('babylon.totalTvl') }}</dt>
                  <dd class="t-body-sm g-num">{{ btcAmount(provider.total_tvl) }} <span class="bab-unit">BTC</span></dd>
                </div>
                <div class="bab-facts__item">
                  <dt class="t-label">{{ $t('babylon.activeStakers') }}</dt>
                  <dd class="t-body-sm g-num">{{ formatInt(provider.active_delegations ?? 0) }}</dd>
                </div>
                <div v-if="provider.total_delegations != null" class="bab-facts__item">
                  <dt class="t-label">{{ $t('babylon.totalStakers') }}</dt>
                  <dd class="t-body-sm g-num">{{ formatInt(provider.total_delegations ?? 0) }}</dd>
                </div>
              </dl>

              <div class="bab-fp__pk-full">
                <span class="t-label">{{ $t('babylon.btcPk') }}</span>
                <span class="t-caption g-mono">{{ provider.btc_pk }}</span>
              </div>

              <GButton tier="secondary" block @click="selectProvider(provider)">
                <v-icon start size="16" color="var(--g-accent)">mdi-lock-plus-outline</v-icon>
                {{ $t('babylon.stakeWith', { name: provider.description.moniker || $t('babylon.unknownProvider') }) }}
              </GButton>
            </div>
          </v-expand-transition>
        </li>
      </ul>

      <GButton v-if="hasMore" tier="tertiary" block :loading="loadingMore" @click="loadMore()">
        <v-icon start size="small">mdi-chevron-down</v-icon>
        {{ $t('common.loadMore') }}
      </GButton>
    </section>

    <BabylonStakeDialog
      v-model="stakeDialog"
      :params="currentParams"
      :selected-provider="selectedProvider"
      :btc-address="btcAddress"
      :is-testnet="isTestnet"
      :staker-btc-pk="stakerBtcPk"
      @staked="refresh"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, toRefs } from 'vue';
import BabylonStakeDialog from './dialogs/BabylonStakeDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import babylonApi, { type BabylonParamVersion, type BabylonFinalityProvider, type BabylonDelegation, type BabylonStats } from '@/api/babylon-api';
import { deriveXOnlyPubKeyFromXpub } from '@/chains/bitcoin/bitcoinKeyManager';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtc, formatInt } from '@/shared/utils/format';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const stakeDialog = ref(false);
const searchQuery = ref('');

// Sort state
type SortKey = 'tvl' | 'commission' | 'stakers' | 'name';
const sortKey = ref<SortKey>('tvl');
const sortAsc = ref(false);

// Expanded provider row
const expandedPk = ref<string | null>(null);

function toggleExpand(provider: BabylonFinalityProvider) {
  expandedPk.value = expandedPk.value === provider.btc_pk ? null : provider.btc_pk;
}

function providerPanelId(provider: BabylonFinalityProvider): string {
  return `bab-fp-${provider.btc_pk.slice(0, 16)}`;
}

function providerInitial(provider: BabylonFinalityProvider): string {
  return provider.description.moniker?.charAt(0)?.toUpperCase() || '?';
}

function normalizeUrl(url: string): string {
  if (!url) return '#';
  return url.startsWith('http') ? url : `https://${url}`;
}

// Intro banner (dismissed via localStorage)
const INTRO_STORAGE_KEY = 'babylon_intro_dismissed';
const showIntro = ref(!localStorage.getItem(INTRO_STORAGE_KEY));

function dismissIntro() {
  showIntro.value = false;
  localStorage.setItem(INTRO_STORAGE_KEY, '1');
}

const stats = ref<BabylonStats | null>(null);
const currentParams = ref<BabylonParamVersion | null>(null);
const providers = ref<BabylonFinalityProvider[]>([]);
const delegations = ref<BabylonDelegation[]>([]);
const selectedProvider = ref<BabylonFinalityProvider | null>(null);
const hasMore = ref(false);
let nextKey = '';

const isTestnet = computed(() => loggedWallet.value?.network === Network.TESTNET);
const btcAddress = computed(() => loggedWallet.value?.baseAddress ?? '');

// X-only pubkey (64 hex) used as the staker identity on the Babylon network.
// Derived from the account xpub → child m/0/0 → drop the 02/03 prefix byte.
const stakerBtcPk = computed<string>(() => {
  const xpub = loggedWallet.value?.publicKey;
  if (!xpub) return '';
  try {
    return deriveXOnlyPubKeyFromXpub(xpub);
  } catch {
    return '';
  }
});

const totalPersonalStaked = computed(() => {
  const sats = delegations.value
    .filter(d => ['active', 'pending'].includes(d.state))
    .reduce((sum, d) => sum + d.staking_value, 0);
  return formatBtc(sats);
});

const introSteps = ['babylon.intro.step1', 'babylon.intro.step2', 'babylon.intro.step3'];

const heroStats = computed(() => [
  {
    key: 'tvl',
    label: t('babylon.activeTVL'),
    value: stats.value ? `${btcAmount(stats.value.active_tvl)} BTC` : '—',
    tooltip: t('babylon.tooltip.activeTvl'),
  },
  {
    key: 'stakers',
    label: t('babylon.stakersLabel'),
    value: stats.value ? formatInt(stats.value.total_stakers ?? stats.value.active_stakers ?? 0) : '—',
    tooltip: t('babylon.tooltip.totalStakers'),
  },
  {
    key: 'providers',
    label: t('babylon.providers'),
    value: stats.value ? formatInt(stats.value.active_finality_providers ?? providers.value.length) : '—',
    tooltip: t('babylon.tooltip.activeProviders'),
  },
  {
    key: 'unbonding',
    label: t('babylon.unbondingTime'),
    value: currentParams.value ? formatUnbonding(currentParams.value.unbonding_time) : '—',
    tooltip: t('babylon.tooltip.unbondingWait'),
  },
]);

const paramItems = computed(() => {
  const p = currentParams.value;
  if (!p) return [];
  return [
    { key: 'min', label: t('babylon.minStake'), tooltip: t('babylon.tooltip.minStake'), value: `${btcAmount(p.min_staking_amount)} BTC` },
    { key: 'max', label: t('babylon.maxStake'), tooltip: t('babylon.tooltip.maxStake'), value: `${btcAmount(p.max_staking_amount)} BTC` },
    {
      key: 'duration',
      label: t('babylon.duration'),
      tooltip: t('babylon.tooltip.duration'),
      value: `${formatInt(p.min_staking_time ?? 0)}–${formatInt(p.max_staking_time ?? 0)} ${t('babylon.blocks')}`,
    },
    { key: 'unbonding', label: t('babylon.unbondingTime'), tooltip: t('babylon.tooltip.unbondingTime'), value: formatUnbonding(p.unbonding_time) },
  ];
});

const sortOptions = computed(() => [
  { key: 'tvl' as SortKey, label: t('babylon.col.tvl') },
  { key: 'commission' as SortKey, label: t('send.fee') },
  { key: 'stakers' as SortKey, label: t('babylon.stakersLabel') },
  { key: 'name' as SortKey, label: t('common.name') },
]);

const providerCols = computed(() => [
  { key: 'fee', label: t('babylon.col.fee'), tooltip: t('babylon.tooltip.col.fee') },
  { key: 'tvl', label: t('babylon.col.tvl'), tooltip: t('babylon.tooltip.col.tvl') },
  { key: 'stakers', label: t('babylon.col.stakers'), tooltip: t('babylon.tooltip.col.stakers') },
]);

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value;
  } else {
    sortKey.value = key;
    // Sensible defaults: lowest fee first, highest TVL/stakers first, A→Z for name
    sortAsc.value = key === 'commission' || key === 'name';
  }
}

const filteredProviders = computed(() => {
  let list = providers.value;

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(p =>
      p.description.moniker?.toLowerCase().includes(q) ||
      p.btc_pk.toLowerCase().includes(q)
    );
  }

  return [...list].sort((a, b) => {
    let result = 0;
    switch (sortKey.value) {
      case 'tvl':        result = (b.active_tvl ?? 0) - (a.active_tvl ?? 0); break;
      case 'commission': result = parseFloat(a.commission || '0') - parseFloat(b.commission || '0'); break;
      case 'stakers':    result = (b.active_delegations ?? 0) - (a.active_delegations ?? 0); break;
      case 'name':       result = (a.description?.moniker || '').localeCompare(b.description?.moniker || ''); break;
    }
    return sortAsc.value ? -result : result;
  });
});

/** The shared 8-decimal BTC format, with a dash for a value the API did not send. */
function btcAmount(sats: number | undefined | null): string {
  if (sats == null || Number.isNaN(sats)) return '—';
  return formatBtc(sats);
}

// Compact BTC display: shows fewer decimals for zero or small values
function formatBtcCompact(sats: number | undefined | null): string {
  if (sats == null || Number.isNaN(sats)) return '—';
  const btc = sats / 1e8;
  if (btc === 0) return '0';
  if (btc < 0.001) return btc.toFixed(8);
  return btc.toFixed(4);
}

// Commission color: green ≤5%, neutral <10%, warning at 10%, error above
function commissionColor(commission: string): string {
  const pct = parseFloat(commission) * 100;
  if (pct <= 5) return 'var(--g-success)';
  if (pct < 10) return 'inherit';
  if (pct === 10) return 'var(--g-warning)';
  return 'var(--g-error)';
}

function formatUnbonding(blocks: number): string {
  return babylonApi.formatUnbondingDays(blocks);
}

function formatCommission(commission: string): string {
  return `${(parseFloat(commission) * 100).toFixed(1)}%`;
}

type StatusTone = 'success' | 'warning' | 'accent' | 'neutral';

function delegationTone(state: string): StatusTone {
  switch (state) {
    case 'active': return 'success';
    case 'pending': return 'warning';
    case 'unbonding': return 'accent';
    case 'withdrawable': return 'success';
    default: return 'neutral';
  }
}

function delegationStateIcon(state: string): string {
  switch (state) {
    case 'active': return 'mdi-check-circle';
    case 'pending': return 'mdi-clock-outline';
    case 'unbonding': return 'mdi-lock-open-outline';
    case 'withdrawable': return 'mdi-arrow-up-circle-outline';
    case 'withdrawn': return 'mdi-check-all';
    default: return 'mdi-circle-outline';
  }
}

function openTx(txid: string) {
  const url = isTestnet.value
    ? `https://mempool.space/testnet/tx/${txid}`
    : `https://mempool.space/tx/${txid}`;
  window.open(url, '_blank');
}

function selectProvider(provider: BabylonFinalityProvider) {
  selectedProvider.value = provider;
  stakeDialog.value = true;
}

async function refresh() {
  loading.value = true;
  error.value = null;
  try {
    const [statsResult, paramsResult, providersResult] = await Promise.all([
      babylonApi.getStats(isTestnet.value).catch(() => null),
      babylonApi.getGlobalParams(isTestnet.value).catch(() => null),
      babylonApi.getFinalityProviders(isTestnet.value).catch(() => null),
    ]);

    stats.value = statsResult;

    if (paramsResult?.versions?.length) {
      currentParams.value = paramsResult.versions[paramsResult.versions.length - 1];
    }

    if (providersResult) {
      // v2 API may return array under 'data' or 'finality_providers'
      providers.value = providersResult.data ?? [];
      nextKey = providersResult.pagination?.next_key || '';
      hasMore.value = !!nextKey;
    }

    if (stakerBtcPk.value) {
      const deleg = await babylonApi.getStakerDelegations(stakerBtcPk.value, isTestnet.value).catch(() => null);
      if (deleg) delegations.value = deleg.data;
    }
  } catch (e) {
    error.value = t('babylon.loadFailed');
    console.error('⛓ Babylon:', e);
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const result = await babylonApi.getFinalityProviders(isTestnet.value, nextKey);
    providers.value = [...providers.value, ...(result.data ?? [])];
    nextKey = result.pagination?.next_key || '';
    hasMore.value = !!nextKey;
  } finally {
    loadingMore.value = false;
  }
}

onMounted(() => refresh());
</script>

<style scoped lang="scss">
/* ── Page ───────────────────────────────────────────────── */
.bab {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.bab__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.bab__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.bab__headline h1 {
  margin: 0;
}

.bab__subtitle {
  margin: 0;
}

.bab__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

/* ── Notices ────────────────────────────────────────────── */
.bab-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
  font-size: 13px;
}

.bab-notice .v-icon {
  color: inherit;
}

.bab-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.bab-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── Intro ──────────────────────────────────────────────── */
.bab-intro {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.bab-intro__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  color: var(--g-accent);
}

.bab-intro__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.bab-intro__title,
.bab-intro__body {
  margin: 0;
}

.bab-intro__steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: var(--g-s-1) 0 0;
  padding-left: var(--g-s-4);
}

/* ── Position hero ──────────────────────────────────────── */
.bab-hero {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.bab-hero__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}

.bab-hero__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}

.bab-hero__amount {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.bab-hero__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.bab-hero__cta {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
}

.bab-hero__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--g-s-2);
}

@media (max-width: 720px) {
  .bab-hero__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.bab-tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3);
}

.bab-tile__label {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.bab-info {
  color: var(--g-text-3);
  cursor: help;
}

/* ── Parameters ─────────────────────────────────────────── */
.bab-params {
  display: flex;
  align-items: center;
  gap: var(--g-s-4);
  flex-wrap: wrap;
  padding: var(--g-s-3) var(--g-s-4);
}

.bab-params__title {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
}

.bab-params__items {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  margin: 0;
}

.bab-params__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 var(--g-s-3);
}

.bab-params__item + .bab-params__item {
  border-left: 1px solid var(--g-hairline-1);
}

.bab-params__key {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}

.bab-params__val {
  margin: 0;
  color: var(--g-text-1);
}

/* ── Sections and lists ─────────────────────────────────── */
.bab-section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}

.bab-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}

.bab-section__titles {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.bab-section__title {
  margin: 0;
}

.bab-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* ── Delegation state chip (a control-sized pill, so the tint is a fill) ── */
.bab-status {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  height: 22px;
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  color: var(--g-text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: help;
}

.bab-status .v-icon {
  color: inherit;
}

.bab-status--success {
  color: var(--g-success);
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
}

.bab-status--warning {
  color: var(--g-warning);
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
}

.bab-status--accent {
  color: var(--g-accent);
  border-color: color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.bab-status--neutral {
  color: var(--g-text-3);
}

/* ── Delegations ────────────────────────────────────────── */
.bab-deleg {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
}

.bab-deleg__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

/* ── Facts grids ────────────────────────────────────────── */
.bab-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-3);
  margin: 0;
}

.bab-facts--boxed {
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.bab-facts__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bab-facts__item dd {
  margin: 0;
  color: var(--g-text-1);
}

.bab-unit {
  color: var(--g-text-3);
  font-size: 11px;
}

/* ── Search pill ────────────────────────────────────────── */
.bab-search {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 36px;
  max-width: 220px;
  padding: 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  cursor: text;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

/* The field's focus ring lives on the pill, so the input inside needs none of its own. */
.bab-search:focus-within {
  border-color: var(--g-accent);
}

.bab-search .bab-search__icon {
  color: var(--g-text-3);
}

.bab-search__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.bab-search__input::placeholder {
  color: var(--g-text-3);
}

/* ── Sort control ───────────────────────────────────────── */
.bab-sort {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}

.bab-sort__group {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
}

.bab-sort__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  height: 28px;
  padding: 0 var(--g-s-3);
  border: 0;
  border-radius: var(--g-r-pill);
  background: transparent;
  color: var(--g-text-2);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.bab-sort__btn:hover {
  color: var(--g-text-1);
}

.bab-sort__btn--active {
  background: var(--g-hairline-2);
  color: var(--g-text-1);
}

.bab-sort__btn .v-icon {
  color: inherit;
}

/* ── Column legend, aligned with the metrics in each row ── */
.bab-cols {
  display: flex;
  align-items: center;
  gap: var(--g-s-4);
  padding: 0 var(--g-s-3);
}

.bab-cols__spacer {
  flex: 1;
}

.bab-cols__col {
  width: 56px;
  text-align: right;
}

.bab-cols__label {
  cursor: help;
  border-bottom: 1px dashed var(--g-hairline-3);
}

.bab-cols__end {
  width: 24px;
}

/* ── Provider rows ──────────────────────────────────────── */
.bab-fp {
  overflow: hidden;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.bab-fp:hover {
  @include g-glass-tier-hover;
}

.bab-fp--open {
  @include g-glass-tier-active;
}

.bab-fp__summary {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  padding: var(--g-s-3);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.bab-fp__avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

.bab-fp__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bab-fp__name-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-width: 0;
}

.bab-fp__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bab-fp__verified {
  flex: none;
  color: var(--g-accent);
  cursor: help;
}

.bab-fp__pk {
  line-height: 1.3;
}

.bab-fp__metrics {
  flex: none;
  display: flex;
  gap: var(--g-s-4);
}

.bab-fp__metric {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 56px;
}

.bab-fp__metric-val {
  color: var(--g-text-2);
  font-size: 13px;
  font-weight: 600;
}

.bab-fp__metric--sorted .bab-fp__metric-val {
  color: var(--g-text-1);
}

.bab-fp__chevron {
  flex: none;
  width: 24px;
  color: var(--g-text-3);
  transition: transform var(--g-dur-base) var(--g-ease);
}

.bab-fp--open .bab-fp__chevron {
  transform: rotate(180deg);
}

@media (max-width: 600px) {
  .bab-cols {
    display: none;
  }

  .bab-fp__metrics {
    gap: var(--g-s-2);
  }
}

.bab-fp__details {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}

.bab-fp__desc {
  margin: 0;
}

.bab-fp__desc--empty {
  color: var(--g-text-3);
  font-style: italic;
}

.bab-fp__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}

.bab-fp__link,
.bab-fp__contact {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bab-fp__link {
  color: var(--g-accent);
  text-decoration: none;
}

.bab-fp__link:hover {
  text-decoration: underline;
}

.bab-fp__pk-full {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ── Empty state ────────────────────────────────────────── */
.bab-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.bab-empty__icon {
  color: var(--g-text-3);
}
</style>
