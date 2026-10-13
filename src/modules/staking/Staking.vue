<template>
  <div class="d-flex flex-wrap flex-grow-1">
    <v-row no-gutters>
      <v-col cols="12" class="pa-2" v-if="account?.controlled_amount && account?.pool_id">
        <StakingCard></StakingCard>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card flat variant="outlined" class="glass-panel">
          <v-card-title class="pa-0">
            <v-list-item lines="two">
              <div class="g-list-content">
                <v-list-item-title class="staking-header">
                  {{ $t('staking.availableStakePools') }}
                  <v-spacer></v-spacer>
                  <div class="staking-pro-toggle">
                    <p class="mr-5 my-auto">{{ $t('staking.pro') }}</p>
                    <v-switch inset density="compact" v-model="isPro" hide-details class="staking-switch"> </v-switch>
                  </div>
                </v-list-item-title>
                <v-list-item-subtitle>
                  {{ $t('staking.earnRewardsByStakingDesc') }}
                  {{ networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network) }} tokens with
                  {{ loggedWallet?.chain }}'s extensive network of stake pools.
                </v-list-item-subtitle>
              </div>
              <div class="staking-gero-support ma-0 g-list-action" v-if="geroPoolExists && !delegatingToGero">
                <v-card-subtitle>
                  <v-btn v-if="isDelegationPending" size="small" class="geroButton" style="color: var(--g-on-grad)!important" disabled>
                    <v-progress-circular indeterminate size="14" width="2" class="mr-2" />
                    {{ $t('staking.delegationPending') }}
                  </v-btn>
                  <v-btn v-else size="small" class="geroButton" style="color: var(--g-on-grad)!important" @click="delegateToGero">{{ $t('staking.stakeWithGero') }}</v-btn>
                </v-card-subtitle>
              </div>
            </v-list-item>
          </v-card-title>
          <v-card-subtitle class="pt-5">
            <v-row no-gutters class="staking-filters-row">
              <v-col class="px-1" cols="12" lg="6" md="4" sm="6" xs="12">
                <v-text-field
                  v-model="search"
                  clearable
                  variant="outlined"
                  density="compact"
                  :label="$t('staking.searchPoolNameTicker')"
                  prepend-inner-icon="mdi-magnify"
                  hide-details
                >
                </v-text-field>
              </v-col>
              <v-col class="px-1" cols="12" lg="3" md="4" sm="6" xs="12">
                <v-switch
                  density="compact"
                  v-model="hideSaturated"
                  :label="$t('staking.hideSaturated')"
                  hide-details
                  class="staking-filter-switch"
                ></v-switch>
              </v-col>
              <v-col class="px-1" cols="12" lg="3" md="4" sm="6" xs="12">
                <v-switch
                  density="compact"
                  v-model="pledgeMet"
                  :label="$t('staking.pledgeMet')"
                  hide-details
                  class="staking-filter-switch"
                ></v-switch>
              </v-col>
            </v-row>
          </v-card-subtitle>
          <v-card-text class="py-0">
            <!-- Error message -->
            <div v-if="poolsError" class="text-center py-4">
              <v-icon color="error" size="large">mdi-alert</v-icon>
              <p class="mt-2 error--text">{{ poolsError }}</p>
              <v-btn @click="reloadWithFilters" color="primary">{{ $t('staking.retry') }}</v-btn>
            </div>
            <v-data-table-server
              v-if="isPro"
              density="compact"
              :headers="headers"
              :items="paginatedPools"
              :items-per-page="pageSize"
              :items-length="paginationMeta?.total_items || 0"
              item-value="pool_id_bech32"
              v-model:page="page"
              :header-props="{ 'sort-icon': 'mdi-menu-up' }"
              :must-sort="true"
              hide-default-footer
              class="poolsTable transparent"
              v-model:sort-by="tableSort"
              :loading="poolsLoading"
              @click:row="(_event, { item }) => delegate(item)"
            >
              <template v-slot:[`item.name`]="{ item }">
                <v-list-item lines="three" style="min-height: 68px" class="px-0">
                  <v-avatar size="24" style="place-self: center; margin-right: 8px !important">
                    <v-img
                      :src="poolIcon(item)"
                      alt=""
                      @error="assets.fallbackImage"
                      eager
                    ></v-img>
                  </v-avatar>
                  <div class="py-1 g-list-content">
                    <v-list-item-title class="pool-name-title"
                      >{{ item.ticker ? `[${item.ticker}] ${item.name ? item.name : ''}` : (item.pool_id_bech32 ? `${item.pool_id_bech32.slice(0, 10)}…${item.pool_id_bech32.slice(-6)}` : 'Unknown Pool') }}
                      <div class="ml-1"><v-btn v-for="link in poolLinks(item)" :key="link.href" icon variant="text" size="x-small" @click.stop="" :href="link.href" target="_blank">
  <v-avatar v-if="link.image" rounded="0" size="14"><v-img :src="link.image" alt="" /></v-avatar>
  <v-icon v-else size="small">{{ link.icon }}</v-icon>
</v-btn></div>
                    </v-list-item-title>
                    <v-list-item-subtitle class="pool-description" v-if="item.description">{{
                      item.description
                    }}</v-list-item-subtitle>
                    <v-list-item-subtitle class="pool-id-subtitle mr-1">
                      {{ filters.truncate(item.pool_id_bech32) }}
                      <CopyButton :value="item.pool_id_bech32" x-small></CopyButton>
                    </v-list-item-subtitle>
                  </div>
                </v-list-item>
              </template>
              <template v-slot:[`item.live_delegators`]="{ item }">
                {{ (item.live_delegators ?? 0).toLocaleString('en-US') }}
              </template>
              <template v-slot:[`item.ros`]="{ item }">
                {{ (item.ros ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) }}
              </template>
              <template v-slot:[`item.block_count`]="{ item }">
                {{ (item.block_count ?? 0).toLocaleString('en-US') }}
              </template>
              <template v-slot:[`item.live_saturation`]="{ item }">
                <v-progress-linear
                  rounded
                  :color="filters.getColor(item.live_saturation)"
                  height="16"
                  :model-value="item.live_saturation"
                  striped
                >
                  <template v-slot:default="{ value }">
                    <strong>{{ Math.ceil(value) }}%</strong>
                  </template>
                </v-progress-linear>
                <div class="pool-saturation-details">
                  <strong>{{
                    filters.toCurrency(
                      item.active_stake,
                      false,
                      1,
                      networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                      '',
                      true
                    )
                  }}</strong>
                  <strong
                    v-if="Number(item.active_stake) - Number(item.live_stake) > 100000000"
                    class="stake-change-up"
                  >
                    <v-icon size="x-small" color="success" class="stake-arrow-icon">mdi-arrow-up-bold</v-icon>
                    {{
                      filters.toCurrency(
                        Number(item.active_stake) - Number(item.live_stake),
                        false,
                        1,
                        networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                        '',
                        true
                      )
                    }}
                  </strong>
                  <strong
                    v-else-if="Number(item.live_stake) - Number(item.active_stake) > 100000000"
                    class="stake-change-down"
                  >
                    <v-icon size="x-small" color="error" class="stake-arrow-icon-down">mdi-arrow-down-bold</v-icon>
                    {{
                      filters.toCurrency(
                        Number(item.live_stake) - Number(item.active_stake),
                        false,
                        1,
                        networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                        '',
                        true
                      )
                    }}
                  </strong>
                </div>
              </template>
              <template v-slot:[`item.fixed_cost`]="{ item }">
                <span class="pool-fees-text" v-if="loggedWallet"
                  >{{ item.margin + '%' }} /
                  {{
                    filters.toCurrency(
                      item.fixed_cost,
                      false,
                      0,
                      networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                    )
                  }}</span
                >
              </template>
              <template v-slot:[`item.pledge`]="{ item }">
                {{
                  filters.toCurrency(
                    item.pledge,
                    false,
                    2,
                    networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                    '',
                    true
                  )
                }}
                <v-icon size="x-small" color="success" v-if="Number(item.pledge) <= Number(item.live_pledge)"
                  >mdi-check</v-icon
                >
                <v-icon size="x-small" color="error" v-else>mdi-close</v-icon>
              </template>
            </v-data-table-server>
            <v-row no-gutters v-else>
              <v-col
                cols="12"
                xl="3"
                lg="4"
                md="6"
                sm="12"
                v-for="(pool, index) in paginatedPools"
                :key="index"
                class="px-2 py-2"
              >
                <v-card
                  flat
                  class="pool-card fill-height"
                  @click="delegate(pool)"
                >
                    <v-list-item v-if="pool">
                      <v-avatar size="32" class="mr-3 align-self-center">
                        <v-img :src="poolIcon(pool)" alt="" @error="assets.fallbackImage" eager></v-img>
                      </v-avatar>
                      <div class="pb-0 g-list-content">
                        <v-list-item-title>
                          {{ pool.ticker ? `[${pool.ticker}] ${pool.name ? pool.name : ''}` : (pool.pool_id_bech32 ? `${pool.pool_id_bech32.slice(0, 10)}…${pool.pool_id_bech32.slice(-6)}` : 'Unknown Pool') }}
                        </v-list-item-title>
                        <v-list-item-subtitle>
                          <v-btn v-for="link in poolLinks(pool)" :key="link.href" icon variant="text" size="x-small" @click.stop="" :href="link.href" target="_blank">
  <v-avatar v-if="link.image" rounded="0" size="14"><v-img :src="link.image" alt="" /></v-avatar>
  <v-icon v-else size="small">{{ link.icon }}</v-icon>
</v-btn></v-list-item-subtitle>
                      </div>
                      <v-avatar
                        class="ma-0"
                        size="32"
                        v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64"
                      >
                        <v-img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" eager></v-img>
                      </v-avatar>
                    </v-list-item>
                    <v-card-text class="pt-0">
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span class="pool-card-label">{{ $t('staking.saturation') }}</span>
                        </v-col>
                        <v-col cols="7">
                          <v-progress-linear
                            height="20"
                            rounded
                            striped
                            :model-value="pool.live_saturation"
                            :color="filters.getColor(pool.live_saturation)"
                          >
                            <span>{{ (pool.live_saturation ?? 0) + '%' }}</span>
                          </v-progress-linear>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span class="pool-card-label">{{ $t('staking.pledge') }}</span>
                        </v-col>
                        <v-col cols="7">
                          <v-chip size="x-small" class="pool-pledge-chip" v-if="loggedWallet">
                            {{
                              filters.toCurrency(
                                pool.pledge,
                                false,
                                0,
                                networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                              )
                            }}
                          </v-chip>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span class="pool-card-label">ROS</span>
                        </v-col>
                        <v-col cols="7">
                          <span class="pool-card-value">{{ (pool.ros ?? 0).toFixed(2) + '%' }}</span>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span class="pool-card-label">{{ $t('staking.fees') }}</span>
                        </v-col>
                        <v-col cols="7">
                          <span class="pool-card-value" v-if="pool && loggedWallet"
                            >{{ pool.margin + '%' }} /
                            {{
                              filters.toCurrency(
                                pool.fixed_cost,
                                false,
                                0,
                                networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                              )
                            }}</span
                          >
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>
              </v-col>
            </v-row>
          </v-card-text>
          <v-card-actions class="staking-pagination-wrapper">
            <v-pagination
              class="staking-pagination mb-2"
              :total-visible="6"
              circle
              v-model="page"
              :length="numPages"
              @update:model-value="loadPaginatedPools"
              :disabled="poolsLoading"
            ></v-pagination>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
    <DelegateDialog
      v-if="txData"
      :isOpen="isDelegateDialogOpen"
      @close="closeDelegateDialog"
      :pool="selectedPool"
      :tx="txData"
    ></DelegateDialog>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, toRefs, watch, onBeforeUnmount, getCurrentInstance } from 'vue';
import type { DataTableHeader, DataTableSortItem } from 'vuetify';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useDelegation } from '@/shared/composables/useDelegation';
import debounce from 'lodash/debounce';
import CopyButton from '@/shared/components/CopyButton.vue';
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import StakingCard from '@/modules/dashboard/components/StakingCard.vue';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import stakingStore from '@/stores/stakingStore';
import filters from '@/shared/utils/filters';
import { setWalletConfiguration } from '@/db/wallet-db';

const { t } = useTranslation();
const instance = getCurrentInstance();

const { config, loggedWallet, account } = toRefs(walletStore);

// Use the shared delegation composable
const { selectedPool, txData, isDelegateDialogOpen, isDelegationPending, delegateToGero, delegate, closeDelegateDialog } = useDelegation();

const {
  pools: paginatedPools,
  paginationMeta,
  loading: poolsLoading,
  error: poolsError,
  filters: poolsFilters,
} = toRefs(stakingStore.state);

const page = ref<number>(1);
const pageSize = ref<number>(15);

// Use reactive filters from store
const hideSaturated = computed({
  get: () => poolsFilters.value.hideSaturated,
  set: value => {
    stakingStore.updateFilters({ hideSaturated: value });
    reloadWithFilters(); // Reload with new filters
  },
});

const pledgeMet = computed({
  get: () => poolsFilters.value.pledgeMet,
  set: value => {
    stakingStore.updateFilters({ pledgeMet: value });
    reloadWithFilters(); // Reload with new filters
  },
});

// Create a debounced search value that will trigger the actual search
const searchInput = ref(poolsFilters.value.search);

// Create a debounced function to update search
const debouncedUpdateSearch = debounce((value: string) => {
  stakingStore.updateFilters({ search: value });
  reloadWithFilters(); // Reload with new filters
}, 500); // 500ms debounce

// Watch searchInput and trigger the debounced update
watch(searchInput, newValue => {
  debouncedUpdateSearch(newValue);
});

const search = computed({
  get: () => searchInput.value,
  set: value => {
    searchInput.value = value; // This will trigger the debounced search
  },
});

// Helper function to reload data with current filters
const reloadWithFilters = () => {
  page.value = 1; // Reset to first page
  loadPaginatedPools(1);
};

const sortBy = ref<string>('ros');
const sortDesc = ref<boolean>(true);
const tableSort = computed<DataTableSortItem[]>({
  get: (): DataTableSortItem[] => [{ key: sortBy.value, order: sortDesc.value ? 'desc' : 'asc' }],
  set: value => { sortBy.value = value[0]?.key || 'ros'; sortDesc.value = value[0]?.order === 'desc'; },
});

const headers = computed<DataTableHeader[]>(() => {
  return [
    { title: t('common.name'), sortable: true, align: 'start', key: 'name' },
    {
      title: t('staking.delegators'),
      sortable: true,
      align: 'center', headerProps: { class: 'd-none d-lg-table-cell' }, cellProps: { class: 'd-none d-lg-table-cell' },
      key: 'live_delegators',
      width: 122,
    },
    { title: t('staking.ros') + ' (%)', sortable: true, align: 'center', headerProps: { class: 'd-none d-lg-table-cell' }, cellProps: { class: 'd-none d-lg-table-cell' }, key: 'ros', width: 105 },
    { title: t('staking.blocks'), sortable: true, align: 'center', headerProps: { class: 'd-none d-lg-table-cell' }, cellProps: { class: 'd-none d-lg-table-cell' }, key: 'block_count', width: 96 },
    {
      title: t('staking.saturation'),
      sortable: true,
      align: 'center',
      key: 'live_saturation',
      width: 128,
    },
    { title: t('staking.fees'), sortable: true, align: 'center', key: 'fixed_cost', width: 131 },
    { title: t('staking.pledge'), sortable: true, align: 'center', headerProps: { class: 'd-none d-lg-table-cell' }, cellProps: { class: 'd-none d-lg-table-cell' }, key: 'pledge', width: 96 },
  ];
});

let isPro = computed({
  get: () => {
    return config.value.stakingProView;
  },
  set: val => {
    config.value.stakingProView = val;
    setWalletConfiguration(loggedWallet.value.id, 'stakingProView', val);
  },
});

const geroPoolExists = computed(() => {
  return !!networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const geroPoolId = computed(() => {
  return networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const delegatingToGero = computed(() => {
  if (account.value) {
    return geroPoolId.value === account.value.pool_id;
  }
  return false;
});

// Function to load paginated pools
const loadPaginatedPools = async (pageNum: number = 1) => {
  if (!loggedWallet.value) return;

  await stakingStore.loadPoolsPaginated(loggedWallet.value, {
    page: pageNum,
    per_page: pageSize.value,
    sort_by: sortBy.value,
    sort_direction: sortDesc.value ? 'desc' : 'asc',
  });
};

const numPages = computed(() => {
  if (paginationMeta.value) {
    return paginationMeta.value.total_pages;
  }
  return 1;
});

watch([sortBy, sortDesc], ([newSortBy, newSortDesc]) => {
  if (newSortBy !== undefined && newSortDesc !== undefined) {
    page.value = 1;
    loadPaginatedPools(1);
  }
});

type PoolExtendedInfo = {
  info?: { url_png_icon_64x64?: string; url_png_logo?: string; social?: { facebook_handle?: string; twitter_handle?: string; youtube_handle?: string; discord_handle?: string; telegram_handle?: string }; [key: string]: unknown };
  [key: string]: unknown;
};
type PoolRow = { homepage?: string; pool_extended_info?: string; pool_id_bech32?: string; pool_id?: string };

const poolLinks = (pool: PoolRow) => {
  const social = poolExtendedInfo(pool)?.info?.social;
  return [
    { href: pool.homepage, icon: 'mdi-web', image: undefined },
    { href: social?.facebook_handle && 'https://www.facebook.com/' + social.facebook_handle, icon: 'mdi-facebook', image: undefined },
    { href: social?.twitter_handle && 'https://x.com/' + social.twitter_handle, image: assets.xSvg, icon: undefined },
    { href: social?.youtube_handle && 'https://youtube.com/' + social.youtube_handle, icon: 'mdi-youtube', image: undefined },
    { href: social?.discord_handle && 'https://discord.gg/' + social.discord_handle, image: assets.discordSvg, icon: undefined },
    { href: social?.telegram_handle && 'https://t.me/' + social.telegram_handle, image: assets.telegramSvg, icon: undefined },
  ].filter(link => !!link.href);
};

const poolExtendedInfoCache = new Map<string, PoolExtendedInfo>();
const poolExtendedInfo = (pool: PoolRow | null | undefined) => {
  if (pool && pool.pool_extended_info) {
    const key = pool.pool_id_bech32 || pool.pool_id;
    if (key && poolExtendedInfoCache.has(key)) return poolExtendedInfoCache.get(key);
    const parsed: PoolExtendedInfo = JSON.parse(pool.pool_extended_info);
    // Sanitize icon URL — some pools leave the placeholder instruction text
    // ("http(s) url to pool icon; ...") which starts with "http" but 404s, so
    // require a real http(s):// scheme with no spaces.
    const validUrl = (u: unknown) => typeof u === 'string' && /^https?:\/\/\S+$/.test(u);
    if (parsed?.info?.url_png_icon_64x64 && !validUrl(parsed.info.url_png_icon_64x64)) {
      parsed.info.url_png_icon_64x64 = '';
    }
    if (parsed?.info?.url_png_logo && !validUrl(parsed.info.url_png_logo)) {
      parsed.info.url_png_logo = '';
    }
    if (key) poolExtendedInfoCache.set(key, parsed);
    return parsed;
  }
  return undefined;
};

// Deterministic blockies-style identicon (inline SVG data URI) used when a pool
// has no published extended-metadata logo — preview/testnet pools almost never
// publish one. Inline data URI keeps it CSP-safe inside the extension.
const identiconCache = new Map<string, string>();
const poolIdenticon = (seedStr: string): string => {
  const cached = identiconCache.get(seedStr);
  if (cached) return cached;
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let seed = h >>> 0;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hue = Math.floor(rand() * 360);
  const fg = `hsl(${hue},62%,58%)`;
  const bg = `hsl(${(hue + 200) % 360},22%,16%)`;
  const n = 5;
  let rects = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < Math.ceil(n / 2); x++) {
      if (rand() > 0.5) {
        rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
        const mx = n - 1 - x;
        if (mx !== x) rects += `<rect x="${mx}" y="${y}" width="1" height="1"/>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect width="5" height="5" fill="${bg}"/><g fill="${fg}">${rects}</g></svg>`;
  const uri = `data:image/svg+xml;base64,${btoa(svg)}`;
  identiconCache.set(seedStr, uri);
  return uri;
};

// Avatar src for a pool: its published extended-metadata icon when present,
// otherwise a deterministic identicon derived from the pool id.
const poolIcon = (pool: PoolRow | null | undefined): string => {
  const ext = poolExtendedInfo(pool)?.info?.url_png_icon_64x64;
  if (ext) return ext;
  const seed = pool?.pool_id_bech32 || pool?.pool_id || '';
  return seed ? poolIdenticon(seed) : '';
};

onMounted(() => {
  // Load initial paginated pools data
  reloadWithFilters();
});

// Handle ?pool=<id> deep-link from Global Search — pre-fill search. A watcher,
// not a mount-time read: the page sits in ContentLayout's keep-alive, so a
// second pool picked from search arrives on an already-mounted page.
watch(
  () => instance?.proxy?.$route?.query?.['pool'],
  (poolQuery) => {
    if (poolQuery && typeof poolQuery === 'string') {
      searchInput.value = poolQuery;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stakingStore.clearCurrentPool();
});
</script>
<style scoped lang="scss">
.v-progress-linear__determinate {
  background: var(--g-accent);
}

.v-data-table-header {
  /* Transparent over the glass-panel card; a solid fill would read as an
     opaque slab on the see-through material. */
  background-color: transparent;
}

.v-data-table > .v-table__wrapper > table > tbody > tr > td,
.v-data-table > .v-table__wrapper > table > tbody > tr > th,
.v-data-table > .v-table__wrapper > table > tfoot > tr > td,
.v-data-table > .v-table__wrapper > table > tfoot > tr > th,
.v-data-table > .v-table__wrapper > table > thead > tr > td,
.v-data-table > .v-table__wrapper > table > thead > tr > th {
  padding: 0 10px;
  transition: height 0.2s cubic-bezier(0.4, 0, 0.6, 1);
}

.poolsTable {
  :is(tbody) {
    cursor: pointer;
  }
}

/* Staking page styles */
.staking-header {
  display: flex;
  overflow: visible;
}

.staking-pro-toggle {
  display: flex;
}

.staking-switch {
  margin-top: 0;
  align-items: center;
}

.staking-gero-support {
  align-items: center;
}

.staking-support-title {
  color: var(--g-accent);
  font-size: 16px;
}

.staking-filters-row {
  align-items: center;
}

.staking-filter-switch {
  margin: auto;
}

/* Pool table styles */
.pool-name-title {
  display: -webkit-box;
  -webkit-box-orient: horizontal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.pool-description {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.pool-id-subtitle {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
}

.pool-saturation-details {
  font-size: 11px;
  text-align-last: justify;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stake-change-up {
  display: inline-flex;
  font-size: 11px;
}

.stake-change-down {
  display: inline-flex;
  font-size: 11px;
}

.stake-arrow-icon {
  font-size: 11px;
}

.stake-arrow-icon-down {
  font-size: 11px;
  line-height: 1.7;
}

.pool-fees-text {
  font-size: 14px;
  color: var(--g-text-1);
}

/* Pool cards: a glass tier (Material 6) nested in the glass-panel container —
   a lighter pane over it, never a solid slab — with a hairline that lifts to
   the chain accent on hover. The label/value tone gap is the hierarchy. */
.pool-card {
  @include g-glass-tier(true);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-1) !important;
  transition: border-color var(--g-dur-fast) ease, transform var(--g-dur-fast) ease,
    box-shadow var(--g-dur-fast) ease;
  cursor: pointer;
}

.pool-card:hover {
  border-color: color-mix(in srgb, var(--g-accent) 45%, transparent) !important;
  transform: translateY(-2px);
  box-shadow: var(--g-shadow-menu);
}

.pool-card .v-list-item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.pool-card-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-3);
}

.pool-card-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.pool-pledge-chip {
  background: var(--g-success-fill) !important;
  border: 1px solid var(--g-success-line);
  color: var(--g-success) !important;
  font-variant-numeric: tabular-nums;
}

/* Pagination styles */
.staking-pagination-wrapper {
  justify-content: center;
}

.staking-pagination {
  max-width: 400px;
}
</style>
