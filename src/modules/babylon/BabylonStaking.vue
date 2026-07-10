<template>
  <v-container fluid class="pa-3 babylon-page">

    <!-- Header -->
    <div class="d-flex align-center mb-4" style="gap: 12px;">
      <div class="babylon-icon-wrap">
        <img :src="assets.coinsStacked" width="26" height="26" alt="Babylon" style="object-fit: contain; filter: brightness(0) saturate(100%) invert(79%) sepia(31%) saturate(6636%) hue-rotate(347deg) brightness(98%) contrast(97%);" />
      </div>
      <div>
        <div class="text-h6 font-weight-bold babylon-title">{{ $t('navigation.staking') }}</div>
        <div class="text-caption babylon-subtitle">{{ $t('babylon.subtitle') }}</div>
      </div>
      <v-spacer />
      <v-btn small icon :loading="loading" @click="refresh" class="refresh-btn">
        <v-icon small>mdi-refresh</v-icon>
      </v-btn>
    </div>

    <!-- Error -->
    <v-alert
      v-if="error"
      type="warning"
      outlined
      dense
      dismissible
      class="mb-3"
      @input="error = null"
      style="border-radius: var(--g-r-control) !important;"
    >{{ error }}</v-alert>

    <!-- ── BEGINNER INTRO BANNER ───────────────────────────── -->
    <v-expand-transition>
      <div v-if="showIntro" class="intro-banner liquid-glass mb-4">
        <div class="intro-icon-wrap">
          <v-icon color="#F7931A" size="22">mdi-bitcoin</v-icon>
        </div>
        <div class="intro-text">
          <div class="intro-title">{{ $t('babylon.intro.title') }}</div>
          <div class="intro-body">{{ $t('babylon.intro.body') }}</div>
          <div class="intro-steps mt-2">
            <div v-for="step in introSteps" :key="step.icon" class="intro-step">
              <v-icon x-small color="primary" class="mr-1">{{ step.icon }}</v-icon>
              <span>{{ $t(step.textKey) }}</span>
            </div>
          </div>
        </div>
        <v-btn icon x-small class="intro-dismiss" @click="dismissIntro">
          <v-icon small style="opacity: 0.45;">mdi-close</v-icon>
        </v-btn>
      </div>
    </v-expand-transition>

    <!-- ── HERO CARD ─────────────────────────────────────── -->
    <div class="hero-card liquid-glass mb-4">
      <div class="hero-glow" />

      <div class="hero-body">
        <!-- Left: position summary -->
        <div class="hero-left">
          <div class="hero-eyebrow">
            <v-icon x-small color="#F7931A" class="mr-1">mdi-bitcoin</v-icon>
            <span>{{ $t('babylon.yourPosition') || 'Your Staked Position' }}</span>
          </div>
          <div class="hero-amount">
            <span class="hero-amount-number">{{ totalPersonalStaked }}</span>
            <span class="hero-amount-unit">BTC</span>
          </div>
          <div class="hero-meta" v-if="delegations.length > 0">
            <v-chip x-small color="rgba(247,147,26,0.2)" text-color="primary" class="mr-1" style="border: 1px solid rgba(247,147,26,0.3);">
              {{ delegations.length }} {{ delegations.length === 1 ? $t('babylon.delegation') || 'delegation' : $t('babylon.delegations') || 'delegations' }}
            </v-chip>
          </div>
          <div class="hero-meta-empty text-caption" v-else style="opacity: 0.45; margin-top: 4px;">
            {{ $t('babylon.noPositionYet') || 'No active position yet' }}
          </div>
        </div>

        <!-- Right: CTA -->
        <div class="hero-right">
          <v-btn
            class="stake-cta"
            :class="{ 'stake-cta--pulse': delegations.length === 0 && currentParams }"
            :disabled="!currentParams && !loading"
            :loading="loading && !currentParams"
            @click="stakeDialog = true"
          >
            <v-icon left small>mdi-plus</v-icon>
            {{ $t('babylon.stakeNow') }}
          </v-btn>
          <div v-if="currentParams" class="cta-hint text-caption">
            {{ formatBtc(currentParams.min_staking_amount) }}–{{ formatBtc(currentParams.max_staking_amount) }} BTC
          </div>
        </div>
      </div>

      <!-- Stats strip with tooltips -->
      <div class="hero-stats">
        <div class="hstat" v-for="s in heroStats" :key="s.key">
          <div class="hstat-val">{{ s.value }}</div>
          <div class="hstat-label">
            <span>{{ s.label }}</span>
            <v-tooltip bottom max-width="220" content-class="babylon-tooltip">
              <template #activator="{ on }">
                <v-icon v-on="on" class="hstat-info">mdi-information-outline</v-icon>
              </template>
              <span>{{ s.tooltip }}</span>
            </v-tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- ── STAKING PARAMETERS (compact) ──────────────────── -->
    <div v-if="currentParams" class="params-strip liquid-glass mb-3">
      <div class="params-strip-title">
        <v-icon x-small color="primary" class="mr-1">mdi-tune-variant</v-icon>
        <span class="t-label" style="opacity: 0.7;">
          {{ $t('babylon.stakingParams') || 'Parameters v' }}{{ currentParams.version }}
        </span>
      </div>
      <div class="params-strip-items">
        <div class="pitem">
          <span class="pitem-label">
            {{ $t('babylon.minStake') }}
            <v-tooltip bottom max-width="200" content-class="babylon-tooltip">
              <template #activator="{ on }">
                <v-icon v-on="on" class="pitem-info">mdi-information-outline</v-icon>
              </template>
              {{ $t('babylon.tooltip.minStake') }}
            </v-tooltip>
          </span>
          <span class="pitem-val">{{ formatBtc(currentParams.min_staking_amount) }} BTC</span>
        </div>
        <div class="pitem-sep" />
        <div class="pitem">
          <span class="pitem-label">
            {{ $t('babylon.maxStake') }}
            <v-tooltip bottom max-width="200" content-class="babylon-tooltip">
              <template #activator="{ on }">
                <v-icon v-on="on" class="pitem-info">mdi-information-outline</v-icon>
              </template>
              {{ $t('babylon.tooltip.maxStake') }}
            </v-tooltip>
          </span>
          <span class="pitem-val">{{ formatBtc(currentParams.max_staking_amount) }} BTC</span>
        </div>
        <div class="pitem-sep" />
        <div class="pitem">
          <span class="pitem-label">
            {{ $t('babylon.duration') || 'Duration' }}
            <v-tooltip bottom max-width="200" content-class="babylon-tooltip">
              <template #activator="{ on }">
                <v-icon v-on="on" class="pitem-info">mdi-information-outline</v-icon>
              </template>
              {{ $t('babylon.tooltip.duration') }}
            </v-tooltip>
          </span>
          <span class="pitem-val">{{ (currentParams.min_staking_time ?? 0).toLocaleString() }}–{{ (currentParams.max_staking_time ?? 0).toLocaleString() }} <span style="opacity:0.5; font-size:11px;">blk</span></span>
        </div>
        <div class="pitem-sep" />
        <div class="pitem">
          <span class="pitem-label">
            {{ $t('babylon.unbondingTime') }}
            <v-tooltip bottom max-width="200" content-class="babylon-tooltip">
              <template #activator="{ on }">
                <v-icon v-on="on" class="pitem-info">mdi-information-outline</v-icon>
              </template>
              {{ $t('babylon.tooltip.unbondingTime') }}
            </v-tooltip>
          </span>
          <span class="pitem-val">{{ formatUnbonding(currentParams.unbonding_time) }}</span>
        </div>
      </div>
    </div>

    <!-- ── MY DELEGATIONS ─────────────────────────────────── -->
    <div v-if="delegations.length > 0" class="mb-4">
      <div class="section-header mb-2">
        <v-icon small color="primary" class="mr-1">mdi-safe-square-outline</v-icon>
        <span class="section-title">{{ $t('babylon.myDelegations') }}</span>
        <v-chip x-small color="rgba(247,147,26,0.15)" text-color="primary" class="ml-2"
          style="border: 1px solid rgba(247,147,26,0.25);">{{ delegations.length }}</v-chip>
      </div>

      <v-card
        v-for="d in delegations"
        :key="d.staking_tx_hash_hex"
        outlined
        class="delegation-card liquid-glass mb-2"
      >
        <div class="delegation-inner">
          <!-- Status bar -->
          <div class="delegation-status-bar" :class="`status-${d.state}`" />

          <div class="delegation-content">
            <div class="d-flex align-center mb-2" style="gap: 8px;">
              <v-tooltip bottom max-width="200" content-class="babylon-tooltip">
                <template #activator="{ on }">
                  <v-chip x-small :color="delegationStateColor(d.state)" text-color="white" style="font-size: 11px; font-weight: 700; letter-spacing: 0.04em;" v-on="on">
                    <v-icon x-small left>{{ delegationStateIcon(d.state) }}</v-icon>
                    {{ $t(`babylon.state.${d.state}`) || d.state }}
                  </v-chip>
                </template>
                {{ $t(`babylon.tooltip.state.${d.state}`) || d.state }}
              </v-tooltip>
              <v-spacer />
              <v-btn icon x-small @click="openTx(d.staking_tx_hash_hex)" style="opacity: 0.5;">
                <v-icon x-small>mdi-open-in-new</v-icon>
              </v-btn>
            </div>

            <div class="delegation-metrics">
              <div class="dmetric">
                <div class="dmetric-label">{{ $t('babylon.stakedAmount') }}</div>
                <div class="dmetric-val">{{ formatBtc(d.staking_value) }} <span class="dmetric-unit">BTC</span></div>
              </div>
              <div class="dmetric">
                <div class="dmetric-label">{{ $t('babylon.lockTime') }}</div>
                <div class="dmetric-val">{{ (d.staking_tx?.timelock ?? 0).toLocaleString() }} <span class="dmetric-unit">blks</span></div>
              </div>
              <div class="dmetric">
                <div class="dmetric-label">{{ $t('babylon.startHeight') }}</div>
                <div class="dmetric-val">#{{ (d.staking_tx?.start_height ?? 0).toLocaleString() }}</div>
              </div>
            </div>
          </div>
        </div>
      </v-card>
    </div>

    <!-- ── FINALITY PROVIDERS ─────────────────────────────── -->
    <div>
      <!-- Section header row -->
      <div class="section-header mb-2">
        <div class="d-flex align-center" style="gap: 6px;">
          <v-icon small color="primary">mdi-shield-half-full</v-icon>
          <span class="section-title">{{ $t('babylon.finalityProviders') }}</span>
          <v-tooltip bottom max-width="260" content-class="babylon-tooltip">
            <template #activator="{ on }">
              <v-icon v-on="on" style="font-size: 13px; opacity: 0.4; cursor: help;">mdi-information-outline</v-icon>
            </template>
            {{ $t('babylon.tooltip.finalityProvider') }}
          </v-tooltip>
          <v-chip v-if="providers.length > 0" x-small outlined style="border-color: rgba(247,147,26,0.3); color: rgba(247,147,26,0.8);">
            {{ providers.length }}
          </v-chip>
        </div>
        <v-text-field
          v-model="searchQuery"
          dense
          hide-details
          clearable
          :placeholder="$t('babylon.searchProviders')"
          prepend-inner-icon="mdi-magnify"
          class="provider-search"
          style="max-width: 200px;"
        />
      </div>

      <!-- Sort + filter row -->
      <div class="sort-row mb-3">
        <span class="sort-label">{{ $t('babylon.sortBy') }}:</span>
        <div class="sort-chips">
          <div
            v-for="s in sortOptions"
            :key="s.key"
            class="sort-chip"
            :class="{ 'sort-chip--active': sortKey === s.key }"
            @click="setSort(s.key)"
          >
            {{ s.label }}
            <v-icon v-if="sortKey === s.key" style="font-size: 11px; margin-left: 2px;">
              {{ sortAsc ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
            </v-icon>
          </div>
        </div>
      </div>

      <!-- Column labels (with tooltips) -->
      <div v-if="filteredProviders.length > 0" class="provider-col-headers mb-1">
        <div style="flex: 1;" />
        <div v-for="col in providerCols" :key="col.key" class="pcol">
          <v-tooltip bottom max-width="200" content-class="babylon-tooltip">
            <template #activator="{ on }">
              <span class="pcol-label" v-on="on">{{ col.label }}</span>
            </template>
            {{ col.tooltip }}
          </v-tooltip>
        </div>
        <div style="width: 20px;" />
      </div>

      <v-skeleton-loader v-if="loading && providers.length === 0" type="list-item-two-line@4" />

      <div v-if="!loading && filteredProviders.length === 0" class="providers-empty">
        <v-icon color="rgba(247,147,26,0.3)" size="32">mdi-shield-off-outline</v-icon>
        <div class="text-caption mt-2" style="opacity: 0.45;">{{ searchQuery ? $t('babylon.noProvidersSearch') : $t('babylon.noProviders') }}</div>
      </div>

      <div class="providers-list">
        <v-card
          v-for="(provider, idx) in filteredProviders"
          :key="provider.btc_pk"
          outlined
          class="provider-card liquid-glass"
          :class="{ 'provider-card--expanded': expandedPk === provider.btc_pk }"
          :style="{ animationDelay: `${idx * 30}ms` }"
          @click="toggleExpand(provider)"
        >
          <!-- ── Summary row ── -->
          <div class="provider-inner">
            <!-- Avatar -->
            <div class="provider-avatar" :style="{ background: providerColorBg(provider.description.moniker) }">
              <span class="provider-initial" :style="{ color: providerColor(provider.description.moniker) }">
                {{ provider.description.moniker?.charAt(0)?.toUpperCase() || '?' }}
              </span>
            </div>

            <!-- Info -->
            <div class="provider-info">
              <div class="d-flex align-center" style="gap: 5px;">
                <span class="provider-name">{{ provider.description.moniker || $t('babylon.unknownProvider') }}</span>
                <!-- Identity badge -->
                <v-tooltip v-if="provider.description.identity" bottom max-width="200" content-class="babylon-tooltip">
                  <template #activator="{ on }">
                    <v-icon v-on="on" style="font-size: 12px; color: var(--g-accent); opacity: 0.75; cursor: help;">mdi-check-decagram</v-icon>
                  </template>
                  {{ $t('babylon.identityVerified') }}: {{ provider.description.identity }}
                </v-tooltip>
                <!-- Website icon -->
                <v-btn
                  v-if="provider.description.website"
                  icon x-small
                  style="width: 14px; height: 14px; opacity: 0.35;"
                  @click.stop="openWebsite(provider.description.website)"
                >
                  <v-icon style="font-size: 11px;">mdi-web</v-icon>
                </v-btn>
              </div>
              <div class="provider-pk" style="font-family: var(--g-font-mono); opacity: 0.35; font-size: 11px;">
                {{ provider.btc_pk.slice(0, 12) }}…{{ provider.btc_pk.slice(-8) }}
              </div>
            </div>

            <!-- Metrics -->
            <div class="provider-metrics">
              <div class="pmetric" :class="{ 'pmetric--sorted': sortKey === 'commission' }">
                <div class="pmetric-val" :style="{ color: commissionColor(provider.commission) }">
                  {{ formatCommission(provider.commission) }}
                </div>
                <div class="pmetric-label">{{ $t('babylon.col.fee') }}</div>
              </div>
              <div class="pmetric" :class="{ 'pmetric--sorted': sortKey === 'tvl' }">
                <div class="pmetric-val">{{ formatBtcCompact(provider.active_tvl) }}</div>
                <div class="pmetric-label">{{ $t('babylon.col.tvl') }}</div>
              </div>
              <div class="pmetric" :class="{ 'pmetric--sorted': sortKey === 'stakers' }">
                <div class="pmetric-val">{{ (provider.active_delegations ?? 0).toLocaleString() }}</div>
                <div class="pmetric-label">{{ $t('babylon.col.stakers') }}</div>
              </div>
            </div>

            <!-- Expand chevron -->
            <v-icon small class="provider-chevron" :class="{ 'provider-chevron--open': expandedPk === provider.btc_pk }">
              mdi-chevron-down
            </v-icon>
          </div>

          <!-- ── Expanded details ── -->
          <v-expand-transition>
            <div v-if="expandedPk === provider.btc_pk" class="provider-expanded" @click.stop>
              <div class="provider-expanded-body">

                <!-- Description -->
                <div v-if="provider.description.details" class="provider-desc">
                  {{ provider.description.details }}
                </div>
                <div v-else class="provider-desc provider-desc--empty">
                  {{ $t('babylon.noDescription') }}
                </div>

                <!-- Links row -->
                <div v-if="provider.description.website || provider.description.security_contact" class="provider-links-row">
                  <a
                    v-if="provider.description.website"
                    :href="normalizeUrl(provider.description.website)"
                    target="_blank"
                    class="provider-link"
                    @click.stop
                  >
                    <v-icon x-small class="mr-1">mdi-web</v-icon>
                    {{ provider.description.website }}
                  </a>
                  <span v-if="provider.description.security_contact" class="provider-contact">
                    <v-icon x-small class="mr-1">mdi-shield-account-outline</v-icon>
                    {{ provider.description.security_contact }}
                  </span>
                </div>

                <!-- Total stats row -->
                <div class="provider-total-stats">
                  <div class="ptstat">
                    <div class="ptstat-label">{{ $t('babylon.activeTVL') }}</div>
                    <div class="ptstat-val">{{ formatBtc(provider.active_tvl) }} <span class="ptstat-unit">BTC</span></div>
                  </div>
                  <template v-if="provider.total_tvl != null">
                  <div class="ptstat-sep" />
                  <div class="ptstat">
                    <div class="ptstat-label">{{ $t('babylon.totalTvl') }}</div>
                    <div class="ptstat-val">{{ formatBtc(provider.total_tvl) }} <span class="ptstat-unit">BTC</span></div>
                  </div>
                  </template>
                  <div class="ptstat-sep" />
                  <div class="ptstat">
                    <div class="ptstat-label">{{ $t('babylon.activeStakers') }}</div>
                    <div class="ptstat-val">{{ (provider.active_delegations ?? 0).toLocaleString() }}</div>
                  </div>
                  <template v-if="provider.total_delegations != null">
                  <div class="ptstat-sep" />
                  <div class="ptstat">
                    <div class="ptstat-label">{{ $t('babylon.totalStakers') }}</div>
                    <div class="ptstat-val">{{ (provider.total_delegations ?? 0).toLocaleString() }}</div>
                  </div>
                  </template>
                </div>

                <!-- BTC PK (full) -->
                <div class="provider-pk-full">
                  <span class="ptstat-label">{{ $t('babylon.btcPk') }}</span>
                  <span class="provider-pk-hex">{{ provider.btc_pk }}</span>
                </div>

                <!-- Stake CTA -->
                <v-btn
                  color="primary"
                  dark
                  small
                  block
                  class="provider-stake-btn"
                  @click.stop="selectProvider(provider)"
                >
                  <v-icon left small>mdi-lock-plus-outline</v-icon>
                  {{ $t('babylon.stakeWith', { name: provider.description.moniker || $t('babylon.unknownProvider') }) }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </v-card>
      </div>

      <v-btn v-if="hasMore" text color="primary" block @click="loadMore" :loading="loadingMore" small class="mt-2">
        <v-icon left small>mdi-chevron-down</v-icon>
        {{ $t('common.loadMore') }}
      </v-btn>
    </div>

    <!-- Babylon Stake Dialog -->
    <BabylonStakeDialog
      v-model="stakeDialog"
      :params="currentParams"
      :selected-provider="selectedProvider"
      :btc-address="btcAddress"
      :is-testnet="isTestnet"
      :staker-btc-pk="stakerBtcPk"
      @staked="refresh"
    />
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toRefs } from 'vue';
import BabylonStakeDialog from './dialogs/BabylonStakeDialog.vue';
import babylonApi, { type BabylonParamVersion, type BabylonFinalityProvider, type BabylonDelegation, type BabylonStats } from '@/api/babylon-api';
import { deriveXOnlyPubKeyFromXpub } from '@/chains/bitcoin/bitcoinKeyManager';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import assets from '@/utils/assets';

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

// Expanded provider card
const expandedPk = ref<string | null>(null);

function toggleExpand(provider: BabylonFinalityProvider) {
  expandedPk.value = expandedPk.value === provider.btc_pk ? null : provider.btc_pk;
}

function openWebsite(url: string) {
  const href = normalizeUrl(url);
  window.open(href, '_blank');
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
  return (sats / 1e8).toFixed(8);
});

const introSteps = [
  { icon: 'mdi-numeric-1-circle-outline', textKey: 'babylon.intro.step1' },
  { icon: 'mdi-numeric-2-circle-outline', textKey: 'babylon.intro.step2' },
  { icon: 'mdi-numeric-3-circle-outline', textKey: 'babylon.intro.step3' },
];

const heroStats = computed(() => [
  {
    key: 'tvl',
    label: 'Active TVL',
    value: stats.value ? `${formatBtc(stats.value.active_tvl)} BTC` : '—',
    tooltip: 'Total BTC currently locked and actively staked across all Babylon participants',
  },
  {
    key: 'stakers',
    label: 'Stakers',
    value: stats.value ? (stats.value.total_stakers ?? stats.value.active_stakers ?? 0).toLocaleString() : '—',
    tooltip: 'Number of unique Bitcoin addresses currently participating in Babylon staking',
  },
  {
    key: 'providers',
    label: 'Providers',
    value: stats.value ? (stats.value.active_finality_providers ?? providers.value.length).toString() : '—',
    tooltip: 'Finality Providers are validator nodes that use your delegated BTC to secure and finalize blocks on the Babylon chain',
  },
  {
    key: 'unbonding',
    label: 'Unbonding',
    value: currentParams.value ? formatUnbonding(currentParams.value.unbonding_time) : '—',
    tooltip: 'Minimum wait time after requesting to unstake before your BTC becomes withdrawable',
  },
]);

const sortOptions = computed(() => [
  { key: 'tvl' as SortKey, label: 'TVL' },
  { key: 'commission' as SortKey, label: 'Fee' },
  { key: 'stakers' as SortKey, label: 'Stakers' },
  { key: 'name' as SortKey, label: 'Name' },
]);

const providerCols = computed(() => [
  { key: 'fee', label: 'Fee', tooltip: 'Commission percentage charged on your staking rewards' },
  { key: 'tvl', label: 'TVL', tooltip: 'Total Value Locked — BTC currently delegated to this provider' },
  { key: 'stakers', label: 'Stakers', tooltip: 'Number of active staking delegations to this provider' },
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

const PROVIDER_COLORS = ['#F7931A', '#1e88e5', '#43a047', '#F7931A', '#e53935', '#00acc1', '#8e24aa', '#f4511e'];

function providerColor(name: string | undefined): string {
  if (!name) return PROVIDER_COLORS[0];
  return PROVIDER_COLORS[name.charCodeAt(0) % PROVIDER_COLORS.length];
}

function providerColorBg(name: string | undefined): string {
  return providerColor(name) + '18';
}

function formatBtc(sats: number | undefined | null): string {
  if (sats == null || isNaN(sats as number)) return '—';
  return (sats / 1e8).toFixed(8);
}

// Compact BTC display: shows fewer decimals for zero or small values
function formatBtcCompact(sats: number | undefined | null): string {
  if (sats == null || isNaN(sats as number)) return '—';
  const btc = sats / 1e8;
  if (btc === 0) return '0';
  if (btc < 0.001) return btc.toFixed(8);
  return btc.toFixed(4);
}

// Commission color: green ≤5%, neutral ≤9%, orange ≤10%, red >10%
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

function delegationStateColor(state: string): string {
  switch (state) {
    case 'active': return 'success';
    case 'pending': return 'warning';
    case 'unbonding': return 'primary';
    case 'withdrawable': return 'success';
    case 'withdrawn': return 'var(--g-text-3)';
    default: return 'var(--g-text-3)';
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
      providers.value = providersResult.data ?? (providersResult as any).finality_providers ?? [];
      nextKey = providersResult.pagination?.next_key || '';
      hasMore.value = !!nextKey;
    }

    if (stakerBtcPk.value) {
      const deleg = await babylonApi.getStakerDelegations(stakerBtcPk.value, isTestnet.value).catch(() => null);
      if (deleg) delegations.value = deleg.data;
    }
  } catch (e) {
    error.value = 'Failed to load Babylon staking data';
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

<style scoped>
/* ── Page ── */
.babylon-page {
  --bab-purple: var(--g-accent);
  --bab-purple-dim: rgba(247, 147, 26, 0.15);
  --bab-orange: var(--g-accent);
  --bab-glass: var(--g-hairline-1);
  --bab-border: var(--g-hairline-1);
}

.babylon-icon-wrap {
  width: 40px; height: 40px;
  border-radius: var(--g-r-card);
  background: rgba(247, 147, 26, 0.1);
  border: 1px solid rgba(247, 147, 26, 0.2);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.babylon-title { letter-spacing: -0.01em; }
.babylon-subtitle { opacity: 0.5; font-size: 11px; }

.refresh-btn { opacity: 0.5; }
.refresh-btn:hover { opacity: 1; }

/* ── Intro Banner ── */
.intro-banner {
  border-radius: var(--g-r-card) !important;
  border: 1px solid rgba(247, 147, 26, 0.2) !important;
  background: rgba(247, 147, 26, 0.06) !important;
  padding: 14px 14px 14px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.intro-icon-wrap {
  width: 32px; height: 32px;
  border-radius: var(--g-r-control);
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.2);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
}

.intro-text { flex: 1; min-width: 0; }

.intro-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--bab-orange);
  margin-bottom: 4px;
  letter-spacing: -0.01em;
}

.intro-body {
  font-size: 11px;
  opacity: 0.65;
  line-height: 1.5;
}

.intro-steps {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.intro-step {
  font-size: 11px;
  opacity: 0.55;
  display: flex;
  align-items: center;
}

.intro-dismiss {
  flex-shrink: 0;
  margin-top: -4px;
  margin-right: -4px;
}

/* ── Hero Card ── */
.hero-card {
  border-radius: var(--g-r-sheet) !important;
  border: 1px solid rgba(247, 147, 26, 0.18) !important;
  background: rgba(247, 147, 26, 0.05) !important;
  position: relative;
  overflow: hidden;
}

.hero-glow {
  position: absolute;
  top: -60px; right: -60px;
  width: 220px; height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(247,147,26,0.18) 0%, transparent 70%);
  pointer-events: none;
}

.hero-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 16px;
  gap: 16px;
}

.hero-left { flex: 1; }

.hero-eyebrow {
  display: flex;
  align-items: center;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.55;
  margin-bottom: 6px;
}

.hero-amount {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1;
  margin-bottom: 8px;
}

.hero-amount-number {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--bab-purple);
}

.hero-amount-unit {
  font-size: 14px;
  font-weight: 600;
  opacity: 0.5;
  letter-spacing: 0.04em;
}

.hero-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.stake-cta {
  background: var(--g-grad) !important;
  color: var(--g-text-1) !important;
  border-radius: var(--g-r-control) !important;
  font-weight: 700 !important;
  letter-spacing: 0.03em;
  text-transform: none !important;
  padding: 0 20px !important;
  height: 40px !important;
  transition: transform 0.15s ease !important;
}

.stake-cta:hover {
  transform: translateY(-1px);
}

.cta-hint {
  opacity: 0.4;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* Hero stats strip */
.hero-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--bab-border);
}

.hstat {
  padding: 12px 16px;
  text-align: center;
  position: relative;
}

.hstat:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0; top: 20%; height: 60%;
  width: 1px;
  background: var(--bab-border);
}

.hstat-val {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--bab-purple);
  margin-bottom: 2px;
}

.hstat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}

.hstat-info {
  font-size: 11px !important;
  cursor: help;
  opacity: 0.6;
  transition: opacity 0.15s;
}

.hstat-info:hover { opacity: 1; }

/* ── Params Strip ── */
.params-strip {
  border-radius: var(--g-r-control) !important;
  border: 1px solid rgba(247, 147, 26, 0.12) !important;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.params-strip-title {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.params-strip-items {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
  flex-wrap: wrap;
}

.pitem {
  display: flex;
  flex-direction: column;
  padding: 0 14px;
}

.pitem-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.4;
  margin-bottom: 1px;
  display: flex;
  align-items: center;
  gap: 3px;
}

.pitem-info {
  font-size: 11px !important;
  cursor: help;
  transition: opacity 0.15s;
}

.pitem-val {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}

.pitem-sep {
  width: 1px;
  height: 24px;
  background: var(--bab-border);
  flex-shrink: 0;
}

/* ── Section headers ── */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.75;
}

/* ── Sort row ── */
.sort-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sort-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.4;
  flex-shrink: 0;
}

.sort-chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.sort-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: var(--g-r-pill);
  border: 1px solid rgba(247, 147, 26, 0.25);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  color: var(--g-text-3);
  background: transparent;
  transition: all 0.15s ease;
  user-select: none;
}

.sort-chip:hover {
  border-color: rgba(247, 147, 26, 0.5);
  color: rgba(247, 147, 26, 0.75);
  background: rgba(247, 147, 26, 0.06);
}

.sort-chip--active {
  border-color: rgba(247, 147, 26, 0.5) !important;
  color: var(--g-accent) !important;
  background: rgba(247, 147, 26, 0.12) !important;
}

/* ── Provider column headers ── */
.provider-col-headers {
  display: flex;
  align-items: center;
  padding: 0 14px;
}

.pcol {
  width: 52px;
  text-align: right;
}

.pcol-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.3;
  cursor: help;
  border-bottom: 1px dashed var(--g-hairline-3);
  transition: opacity 0.15s;
}

.pcol-label:hover { opacity: 0.6; }

/* ── Provider search ── */
.provider-search :deep(.v-input__control) {
  min-height: 34px !important;
}
.provider-search :deep(.v-input__slot) {
  background: var(--bab-glass) !important;
  border: 1px solid var(--bab-border) !important;
  border-radius: var(--g-r-control) !important;
  font-size: 12px;
}
.provider-search :deep(input::placeholder) { opacity: 0.35; }

/* ── Delegations ── */
.delegation-card {
  border-radius: var(--g-r-control) !important;
  border: 1px solid rgba(247, 147, 26, 0.15) !important;
  overflow: hidden;
}

.delegation-inner { display: flex; }

.delegation-status-bar {
  width: 3px;
  flex-shrink: 0;
}
.status-active { background: var(--g-success); }
.status-pending { background: var(--g-warning); }
.status-unbonding { background: var(--g-accent); }
.status-withdrawable { background: var(--g-success); }
.status-withdrawn { background: var(--g-text-3); }

.delegation-content { padding: 12px; flex: 1; }

.delegation-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.dmetric-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.4;
  margin-bottom: 2px;
}

.dmetric-val {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.dmetric-unit {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.45;
  letter-spacing: 0.04em;
}

/* ── Providers ── */
.providers-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.provider-card {
  cursor: pointer;
  border-radius: var(--g-r-control) !important;
  border: 1px solid var(--bab-border) !important;
  transition: border-color 0.18s ease, transform 0.15s ease, box-shadow 0.18s ease;
  animation: fadeSlideIn 0.3s ease both;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.provider-card:hover {
  border-color: rgba(247, 147, 26, 0.35) !important;
  transform: translateX(2px);
  box-shadow: -3px 0 0 0 var(--bab-purple) !important;
}

.provider-inner {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  gap: 12px;
}

.provider-avatar {
  width: 36px; height: 36px;
  border-radius: var(--g-r-control);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.provider-initial {
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
}

.provider-info { flex: 1; min-width: 0; }

.provider-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.provider-metrics {
  display: flex;
  gap: 16px;
  flex-shrink: 0;
}

.pmetric { text-align: right; min-width: 44px; }

.pmetric--sorted .pmetric-val {
  color: var(--bab-orange);
}

.pmetric--sorted .pmetric-label {
  opacity: 0.55;
}

.pmetric-val {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.pmetric-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.35;
}

.provider-chevron {
  color: rgba(247, 147, 26, 0.35) !important;
  transition: transform 0.22s ease, opacity 0.15s ease;
  flex-shrink: 0;
}

.provider-chevron--open {
  transform: rotate(180deg);
  color: rgba(247, 147, 26, 0.7) !important;
}

.provider-card:hover .provider-chevron {
  opacity: 1 !important;
  color: rgba(247, 147, 26, 0.6) !important;
}

.provider-card--expanded {
  border-color: rgba(247, 147, 26, 0.3) !important;
}

/* ── Expanded content ── */
.provider-expanded {
  border-top: 1px solid var(--g-hairline-1);
}

.provider-expanded-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-desc {
  font-size: 11px;
  line-height: 1.55;
  opacity: 0.6;
}

.provider-desc--empty {
  opacity: 0.25;
  font-style: italic;
}

.provider-links-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.provider-link {
  font-size: 11px;
  color: var(--g-accent) !important;
  text-decoration: none;
  display: flex;
  align-items: center;
  opacity: 0.8;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: opacity 0.15s;
}

.provider-link:hover { opacity: 1; text-decoration: underline; }

.provider-contact {
  font-size: 11px;
  opacity: 0.4;
  display: flex;
  align-items: center;
}

.provider-total-stats {
  display: flex;
  align-items: center;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  overflow: hidden;
}

.ptstat {
  flex: 1;
  padding: 8px 10px;
  text-align: center;
  position: relative;
}

.ptstat:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 0; top: 20%; height: 60%;
  width: 1px;
  background: var(--g-hairline-1);
}

.ptstat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  opacity: 0.35;
  margin-bottom: 2px;
}

.ptstat-val {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.ptstat-unit {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.4;
}

.ptstat-sep {
  width: 1px;
  height: 30px;
  background: var(--g-hairline-1);
  flex-shrink: 0;
}

.provider-pk-full {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.provider-pk-hex {
  font-family: var(--g-font-mono);
  font-size: 11px;
  opacity: 0.3;
  word-break: break-all;
}

.provider-stake-btn {
  border-radius: var(--g-r-control) !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

/* ── Empty state ── */
.providers-empty {
  text-align: center;
  padding: 40px 16px;
  opacity: 0.7;
}

/* ── Tooltip ── */
:deep(.babylon-tooltip) {
  font-size: 11px !important;
  line-height: 1.4 !important;
  background: var(--g-overlay) !important;
  border: 1px solid rgba(247, 147, 26, 0.2) !important;
  border-radius: var(--g-r-control) !important;
  padding: 8px 10px !important;
}
</style>