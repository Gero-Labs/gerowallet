<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2" v-if="account?.controlled_amount && account?.pool_id">
        <StakingCard></StakingCard>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card flat outlined class="glass-panel">
          <v-card-title class="pa-0">
            <v-list-item two-line>
              <v-list-item-content>
                <v-list-item-title class="staking-header">
                  {{ $t('staking.availableStakePools') }}
                  <v-spacer></v-spacer>
                  <div class="staking-pro-toggle">
                    <p class="mr-5 my-auto">{{ $t('staking.pro') }}</p>
                    <v-switch inset dense v-model="isPro" hide-details class="staking-switch"> </v-switch>
                  </div>
                </v-list-item-title>
                <v-list-item-subtitle>
                  {{ $t('staking.earnRewardsByStakingDesc') }}
                  {{ networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network) }} tokens with
                  {{ loggedWallet?.chain }}'s extensive network of stake pools.
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action class="staking-gero-support ma-0" v-if="geroPoolExists && !delegatingToGero">
                <v-card-subtitle>
                  <v-btn small class="geroButton" style="color: var(--g-on-grad)!important" @click="delegateToGero">{{ $t('staking.stakeWithGero') }}</v-btn>
                </v-card-subtitle>
              </v-list-item-action>
            </v-list-item>
          </v-card-title>
          <v-card-subtitle class="pt-5">
            <v-row no-gutters class="staking-filters-row">
              <v-col class="px-1" cols="12" lg="6" md="4" sm="6" xs="12">
                <v-text-field
                  v-model="search"
                  clearable
                  outlined
                  dense
                  :label="$t('staking.searchPoolNameTicker')"
                  prepend-inner-icon="mdi-magnify"
                  hide-details
                >
                </v-text-field>
              </v-col>
              <v-col class="px-1" cols="12" lg="3" md="4" sm="6" xs="12">
                <v-switch
                  dense
                  v-model="hideSaturated"
                  :label="$t('staking.hideSaturated')"
                  hide-details
                  class="staking-filter-switch"
                ></v-switch>
              </v-col>
              <v-col class="px-1" cols="12" lg="3" md="4" sm="6" xs="12">
                <v-switch
                  dense
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
              <v-icon color="error" large>mdi-alert</v-icon>
              <p class="mt-2 error--text">{{ poolsError }}</p>
              <v-btn @click="reloadWithFilters" color="primary">{{ $t('staking.retry') }}</v-btn>
            </div>
            <v-data-table
              v-if="isPro"
              dense
              :headers="headers"
              :items="paginatedPools"
              :items-per-page="15"
              :page.sync="page"
              @page-count="pageCount = $event"
              :header-props="{ 'sort-icon': 'mdi-menu-up' }"
              :must-sort="true"
              hide-default-footer
              class="poolsTable transparent"
              :sort-by.sync="sortBy"
              :sort-desc.sync="sortDesc"
              :loading="poolsLoading"
              @click:row="delegate"
            >
              <template v-slot:[`item.name`]="{ item }">
                <v-list-item three-line style="min-height: 68px" class="px-0">
                  <v-list-item-avatar size="24" style="place-self: center; margin-right: 8px !important">
                    <v-img
                      :src="poolExtendedInfo(item).info.url_png_icon_64x64"
                      v-if="poolExtendedInfo(item)?.info?.url_png_icon_64x64"
                      alt=""
                      @error="assets.fallbackImage"
                      eager
                    ></v-img>
                  </v-list-item-avatar>
                  <v-list-item-content class="py-1">
                    <v-list-item-title class="pool-name-title"
                      >{{ `[${item.ticker}] ${item.name ? item.name : ''}` }}
                      <div class="ml-1">
                        <v-btn icon x-small v-if="item?.homepage" @click.stop="" :href="item?.homepage" target="_blank">
                          <v-icon small> mdi-web </v-icon>
                        </v-btn>
                        <v-btn
                          icon
                          x-small
                          v-if="poolExtendedInfo(item)?.info?.social?.facebook_handle"
                          @click.stop=""
                          :href="'https://www.facebook.com/' + poolExtendedInfo(item)?.info?.social?.facebook_handle"
                          target="_blank"
                        >
                          <v-icon small> mdi-facebook </v-icon>
                        </v-btn>
                        <v-btn
                          icon
                          x-small
                          v-if="poolExtendedInfo(item)?.info?.social?.twitter_handle"
                          @click.stop=""
                          :href="'https://x.com/' + poolExtendedInfo(item)?.info?.social?.twitter_handle"
                          target="_blank"
                        >
                          <v-avatar tile size="14">
                            <v-img :src="assets.xSvg" alt="x"></v-img>
                          </v-avatar>
                        </v-btn>
                        <v-btn
                          icon
                          x-small
                          v-if="poolExtendedInfo(item)?.info?.social?.youtube_handle"
                          @click.stop=""
                          :href="'https://youtube.com/' + poolExtendedInfo(item)?.info?.social?.youtube_handle"
                          target="_blank"
                        >
                          <v-icon small> mdi-youtube </v-icon>
                        </v-btn>
                        <v-btn
                          icon
                          x-small
                          v-if="poolExtendedInfo(item)?.info?.social?.discord_handle"
                          @click.stop=""
                          :href="'https://discord.gg/' + poolExtendedInfo(item)?.info?.social?.discord_handle"
                          target="_blank"
                        >
                          <v-avatar tile size="14">
                            <v-img :src="assets.discordSvg" width="14" height="14" alt="discord" contain></v-img>
                          </v-avatar>
                        </v-btn>
                        <v-btn
                          icon
                          x-small
                          v-if="poolExtendedInfo(item)?.info?.social?.telegram_handle"
                          @click.stop=""
                          :href="'https://t.me/' + poolExtendedInfo(item)?.info?.social?.telegram_handle"
                          target="_blank"
                        >
                          <v-avatar tile size="14">
                            <v-img :src="assets.telegramSvg" alt="x"></v-img>
                          </v-avatar>
                        </v-btn>
                      </div>
                    </v-list-item-title>
                    <v-list-item-subtitle class="pool-description" v-if="item.description">{{
                      item.description
                    }}</v-list-item-subtitle>
                    <v-list-item-subtitle class="pool-id-subtitle mr-1">
                      {{ filters.truncate(item.pool_id_bech32) }}
                      <CopyButton :value="item.pool_id_bech32" x-small></CopyButton>
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
              <template v-slot:[`item.live_delegators`]="{ item }">
                {{ item.live_delegators.toLocaleString('en-US') }}
              </template>
              <template v-slot:[`item.ros`]="{ item }">
                {{ item.ros.toLocaleString('en-US', { maximumFractionDigits: 2 }) }}
              </template>
              <template v-slot:[`item.block_count`]="{ item }">
                {{ item.block_count.toLocaleString('en-US') }}
              </template>
              <template v-slot:[`item.live_saturation`]="{ item }">
                <v-progress-linear
                  rounded
                  :color="filters.getColor(item.live_saturation)"
                  height="16"
                  :value="item.live_saturation"
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
                    <v-icon x-small color="success" class="stake-arrow-icon">mdi-arrow-up-bold</v-icon>
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
                    <v-icon x-small color="error" class="stake-arrow-icon-down">mdi-arrow-down-bold</v-icon>
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
                <v-icon x-small color="success" v-if="Number(item.pledge) <= Number(item.live_pledge)"
                  >mdi-check</v-icon
                >
                <v-icon x-small color="error" v-else>mdi-close</v-icon>
              </template>
            </v-data-table>
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
                      <v-list-item-content class="pb-0">
                        <v-list-item-title>
                          {{ `[${pool.ticker}] ${pool.name ? pool.name : ''}` }}
                        </v-list-item-title>
                        <v-list-item-subtitle>
                          <v-btn
                            icon
                            x-small
                            v-if="pool?.homepage"
                            @click.stop=""
                            :href="pool?.homepage"
                            target="_blank"
                          >
                            <v-icon small> mdi-web </v-icon>
                          </v-btn>
                          <v-btn
                            icon
                            x-small
                            v-if="poolExtendedInfo(pool)?.info?.social?.facebook_handle"
                            @click.stop=""
                            :href="'https://www.facebook.com/' + poolExtendedInfo(pool)?.info?.social?.facebook_handle"
                            target="_blank"
                          >
                            <v-icon small> mdi-facebook </v-icon>
                          </v-btn>
                          <v-btn
                            icon
                            x-small
                            v-if="poolExtendedInfo(pool)?.info?.social?.twitter_handle"
                            @click.stop=""
                            :href="'https://x.com/' + poolExtendedInfo(pool)?.info?.social?.twitter_handle"
                            target="_blank"
                          >
                            <v-avatar tile size="14">
                              <v-img :src="assets.xSvg" alt="x"></v-img>
                            </v-avatar>
                          </v-btn>
                          <v-btn
                            icon
                            x-small
                            v-if="poolExtendedInfo(pool)?.info?.social?.youtube_handle"
                            @click.stop=""
                            :href="'https://youtube.com/' + poolExtendedInfo(pool)?.info?.social?.youtube_handle"
                            target="_blank"
                          >
                            <v-icon small> mdi-youtube </v-icon>
                          </v-btn>
                          <v-btn
                            icon
                            x-small
                            v-if="poolExtendedInfo(pool)?.info?.social?.discord_handle"
                            @click.stop=""
                            :href="'https://discord.gg/' + poolExtendedInfo(pool)?.info?.social?.discord_handle"
                            target="_blank"
                          >
                            <v-avatar tile size="14">
                              <v-img :src="assets.discordSvg" alt="discord" width="14" height="14" contain></v-img>
                            </v-avatar>
                          </v-btn>
                          <v-btn
                            icon
                            x-small
                            v-if="poolExtendedInfo(pool)?.info?.social?.telegram_handle"
                            @click.stop=""
                            :href="'https://t.me/' + poolExtendedInfo(pool)?.info?.social?.telegram_handle"
                            target="_blank"
                          >
                            <v-avatar tile size="14">
                              <v-img :src="assets.telegramSvg" alt="telegram"></v-img>
                            </v-avatar>
                          </v-btn>
                        </v-list-item-subtitle>
                      </v-list-item-content>
                      <v-list-item-avatar
                        class="ma-0"
                        size="32"
                        v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64"
                      >
                        <v-img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" eager></v-img>
                      </v-list-item-avatar>
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
                            :value="pool.live_saturation"
                            :color="filters.getColor(pool.live_saturation)"
                          >
                            <span>{{ pool.live_saturation + '%' }}</span>
                          </v-progress-linear>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span class="pool-card-label">{{ $t('staking.pledge') }}</span>
                        </v-col>
                        <v-col cols="7">
                          <v-chip x-small class="pool-pledge-chip" v-if="loggedWallet">
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
                          <span class="pool-card-value">{{ pool.ros.toFixed(2) + '%' }}</span>
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
              @input="loadPaginatedPools"
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
  </v-layout>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, toRefs, watch, onBeforeUnmount, getCurrentInstance } from 'vue';
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
const { selectedPool, txData, isDelegateDialogOpen, delegateToGero, delegate, closeDelegateDialog } = useDelegation();

const {
  pools: paginatedPools,
  paginationMeta,
  loading: poolsLoading,
  error: poolsError,
  filters: poolsFilters,
} = toRefs(stakingStore.state);

const page = ref<number>(1);
const pageSize = ref<number>(15);
const pageCount = ref<number>(0);

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

const headers = computed(() => {
  return [
    { text: t('common.name'), sortable: true, align: 'left', value: 'name' },
    {
      text: t('staking.delegators'),
      sortable: true,
      align: 'center d-none d-lg-table-cell',
      value: 'live_delegators',
      width: 122,
    },
    { text: t('staking.ros') + ' (%)', sortable: true, align: 'center d-none d-lg-table-cell', value: 'ros', width: 105 },
    { text: t('staking.blocks'), sortable: true, align: 'center d-none d-lg-table-cell', value: 'block_count', width: 96 },
    {
      text: t('staking.saturation'),
      sortable: true,
      align: 'center',
      value: 'live_saturation',
      width: 128,
      filter: value => {
        if (!hideSaturated.value) return true;
        return value < 99;
      },
    },
    { text: t('staking.fees'), sortable: true, align: 'center', value: 'fixed_cost', width: 131 },
    { text: t('staking.pledge'), sortable: true, align: 'center d-none d-lg-table-cell', value: 'pledge', width: 96 },
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
    loadPaginatedPools(1);
  }
});

type PoolExtendedInfo = {
  info?: { url_png_icon_64x64?: string; url_png_logo?: string; [key: string]: unknown };
  [key: string]: unknown;
};
type PoolRow = { pool_extended_info?: string; pool_id_bech32?: string; pool_id?: string };

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

onMounted(() => {
  // Load initial paginated pools data
  reloadWithFilters();

  // Handle ?pool=<id> deep-link from Global Search — pre-fill search
  const poolQuery = instance?.proxy?.$route?.query?.pool;
  if (poolQuery && typeof poolQuery === 'string') {
    searchInput.value = poolQuery;
  }
});

onBeforeUnmount(() => {
  stakingStore.clearCurrentPool();
});
</script>
<style scoped>
.v-progress-linear__determinate {
  background: var(--g-accent);
}

.v-data-table-header {
  /* Transparent over the glass-panel card; a solid fill would read as an
     opaque slab on the see-through material. */
  background-color: transparent;
}

.v-data-table > .v-data-table__wrapper > table > tbody > tr > td,
.v-data-table > .v-data-table__wrapper > table > tbody > tr > th,
.v-data-table > .v-data-table__wrapper > table > tfoot > tr > td,
.v-data-table > .v-data-table__wrapper > table > tfoot > tr > th,
.v-data-table > .v-data-table__wrapper > table > thead > tr > td,
.v-data-table > .v-data-table__wrapper > table > thead > tr > th {
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

/* Pool cards: a raised card with a hairline that lifts to the chain accent on
   hover. The label/value tone gap is the hierarchy (both were text-1 before).
   Translucent fill (not solid cardBackground): these sit INSIDE the glass-panel
   container, and nested tiers over glass are tints, not opaque slabs. */
.pool-card {
  background: var(--g-hairline-1) !important;
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

.pool-card .v-list-item__title {
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
