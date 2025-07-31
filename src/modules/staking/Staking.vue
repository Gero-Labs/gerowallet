<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2" v-if="account?.controlled_amount && account?.pool_id">
        <StakingCard></StakingCard>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card flat outlined class="liquid-glass">
          <v-card-title class="pa-0">
            <v-list-item two-line>
              <v-list-item-content>
                <v-list-item-title style="display: flex; overflow: visible;">
                  Available Stake Pools
                  <v-spacer></v-spacer>
                  <div style="display: flex;">
                    <p class="mr-5 my-auto">PRO</p>
                    <v-switch
                      inset
                      dense
                      v-model="isPro"
                      hide-details
                      style="margin-top: 0; align-items: center;"
                    >
                    </v-switch>
                  </div>
                </v-list-item-title>
                <v-list-item-subtitle>
                  Earn rewards by staking your {{ networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network) }} tokens with {{ loggedWallet?.chain }}'s extensive network of stake pools.
                </v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action style="align-items: center;" class="ma-0" v-if="geroPoolExists && !delegatingToGero">
                <v-card-title style="color: #00DFF3; font-size: 18px">
                  Consider supporting us
                </v-card-title>
                <v-card-subtitle>
                  <v-btn small
                         style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black"
                         @click="delegateToGero"
                  >
                    Stake with GERO
                  </v-btn>
                </v-card-subtitle>
              </v-list-item-action>
            </v-list-item>
          </v-card-title>
          <v-card-subtitle class="pt-5">
            <v-row no-gutters style="align-items: center;">
              <v-col class="px-1" cols="12" lg="6" md="4" sm="6" xs="12">
                <v-text-field
                  v-model="search"
                  clearable
                  outlined
                  dense
                  label="Search by pool name or ticker"
                  prepend-inner-icon="mdi-magnify"
                  hide-details
                >
                </v-text-field>
              </v-col>
              <v-col class="px-1" cols="12" lg="3" md="4" sm="6" xs="12">
                <v-switch dense v-model="hideSaturated" label="Hide Saturated" hide-details style="margin: auto"></v-switch>
              </v-col>
              <v-col class="px-1" cols="12" lg="3" md="4" sm="6" xs="12">
                <v-switch dense v-model="pledgeMet" label="Pledge Met" hide-details style="margin: auto"></v-switch>
              </v-col>
            </v-row>
          </v-card-subtitle>
          <v-card-text class="py-0">
            <v-data-table v-if="isPro" dense :headers="headers" :items="stakePools" :items-per-page="8" :page.sync="page"
                          @page-count="pageCount = $event" :header-props="{ 'sort-icon': 'mdi-menu-up' }" multi-sort
                          hide-default-footer class="poolsTable transparent" @click:row="delegate">
              <template v-slot:[`item.name`]="{ item }">
                <v-list-item three-line style="min-height: 68px" class="px-0">
                  <v-list-item-avatar size="24" style="place-self: center;">
                    <v-img :src="poolExtendedInfo(item).info.url_png_icon_64x64" v-if="poolExtendedInfo(item)?.info?.url_png_icon_64x64" alt="" @error="assets.fallbackImage" eager></v-img>
                  </v-list-item-avatar>
                  <v-list-item-content class="py-1">
                    <v-list-item-title style="display: -webkit-box; -webkit-box-orient: horizontal; overflow: hidden; text-overflow: ellipsis; white-space: normal;">{{ `[${item.ticker}] ${item.name ? item.name : ''}` }}
                      <div class="ml-1">
                        <v-btn icon x-small v-if="item?.homepage" @click.stop="" :href="item?.homepage" target="_blank">
                          <v-icon small>
                            mdi-web
                          </v-icon>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.facebook_handle" @click.stop="" :href="'https://www.facebook.com/'+poolExtendedInfo(item)?.info?.social?.facebook_handle" target="_blank">
                          <v-icon small>
                            mdi-facebook
                          </v-icon>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.twitter_handle" @click.stop="" :href="'https://x.com/'+poolExtendedInfo(item)?.info?.social?.twitter_handle" target="_blank">
                          <v-avatar tile size="14">
                            <v-img :src="assets.xSvg" alt="x"></v-img>
                          </v-avatar>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.youtube_handle" @click.stop="" :href="'https://youtube.com/'+poolExtendedInfo(item)?.info?.social?.youtube_handle" target="_blank">
                          <v-icon small>
                            mdi-youtube
                          </v-icon>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.discord_handle" @click.stop="" :href="'https://discord.gg/'+poolExtendedInfo(item)?.info?.social?.discord_handle" target="_blank">
                          <v-avatar tile size="14">
                            <v-img :src="assets.discordSvg" width="14" height="14" alt="discord" contain></v-img>
                          </v-avatar>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.telegram_handle" @click.stop="" :href="'https://t.me/'+poolExtendedInfo(item)?.info?.social?.telegram_handle" target="_blank">
                          <v-avatar tile size="14">
                            <v-img :src="assets.telegramSvg" alt="x"></v-img>
                          </v-avatar>
                        </v-btn>
                      </div>
                    </v-list-item-title>
                    <v-list-item-subtitle style="display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal;" v-if="item.description">{{item.description}}</v-list-item-subtitle>
                    <v-list-item-subtitle style="display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal;" class="mr-1">
                      {{ filters.truncate(item.pool_id_bech32) }}
                      <CopyButton :value="item.pool_id_bech32" x-small></CopyButton>
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
              <template v-slot:[`item.live_delegators`]="{ item }">
                {{ (item.live_delegators).toLocaleString('en-US') }}
              </template>
              <template v-slot:[`item.ros`]="{ item }">
                {{ item.ros.toLocaleString('en-US', {maximumFractionDigits: 2}) }}
              </template>
              <template v-slot:[`item.block_count`]="{ item }">
                {{ item.block_count.toLocaleString('en-US') }}
              </template>
              <template v-slot:[`item.live_saturation`]="{ item }">
                <v-progress-linear rounded :color="filters.getColor(item.live_saturation)" height="16" :value="item.live_saturation" striped>
                  <template v-slot:default="{ value }">
                    <strong>{{ Math.ceil(value) }}%</strong>
                  </template>
                </v-progress-linear>
                <div class="justify-space-between d-flex align-items-center" style="font-size: 10px; text-align-last: justify;">
                  <strong>{{ filters.toCurrency(item.active_stake, false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</strong>
                  <strong v-if="Number(item.active_stake) - Number(item.live_stake) > 100000000" style="display: inline-flex; font-size: 10px">
                    <v-icon x-small color="#47cd89" style="font-size: 10px">mdi-arrow-up-bold</v-icon>
                    {{ filters.toCurrency(Number(item.active_stake) - Number(item.live_stake), false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                  </strong>
                  <strong v-else-if="Number(item.live_stake) - Number(item.active_stake) > 100000000" style="display: inline-flex; font-size: 10px">
                    <v-icon x-small color="#F97066" style="font-size: 10px; line-height: 1.7;">mdi-arrow-down-bold</v-icon>
                    {{ filters.toCurrency(Number(item.live_stake) - Number(item.active_stake), false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                  </strong>
                </div>
              </template>
              <template v-slot:[`item.fixed_cost`]="{ item }">
                <span style="font-size: 14px; color: white" v-if="loggedWallet">{{ item.margin + '%' }} / {{ filters.toCurrency(item.fixed_cost, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))
                  }}</span>
              </template>
              <template v-slot:[`item.pledge`]="{ item }">
                {{ filters.toCurrency(item.pledge, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                <v-icon x-small color="#47cd89" v-if="Number(item.pledge) <= Number(item.live_pledge)">mdi-check</v-icon>
                <v-icon x-small color="#F97066" v-else>mdi-close</v-icon>
              </template>
            </v-data-table>
            <v-row no-gutters v-else>
              <v-col cols="12" xl="3" lg="4" md="6" sm="12" v-for="(pool, index) in pagedPools" :key="index"
                     class="px-2 py-2">
                <v-hover
                  v-slot="{ hover }"
                >
                  <v-card
                    flat
                    outlined
                    :color="hover ? '#FFFFFF' : '#84CAFF'"
                    style="border-radius: 12px"
                    @click="delegate(pool)"
                    class="fill-height"
                  >
                    <v-list-item v-if="pool">
                      <v-list-item-content class="pb-0">
                        <v-list-item-title>
                          {{`[${pool.ticker}] ${pool.name ? pool.name : ''}` }}
                        </v-list-item-title>
                        <v-list-item-subtitle>
                          <v-btn icon x-small v-if="pool?.homepage" @click.stop="" :href="pool?.homepage" target="_blank">
                            <v-icon small>
                              mdi-web
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.facebook_handle" @click.stop="" :href="'https://www.facebook.com/'+poolExtendedInfo(pool)?.info?.social?.facebook_handle" target="_blank">
                            <v-icon small>
                              mdi-facebook
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.twitter_handle" @click.stop="" :href="'https://x.com/'+poolExtendedInfo(pool)?.info?.social?.twitter_handle" target="_blank">
                            <v-avatar tile size="14">
                              <v-img :src="assets.xSvg" alt="x"></v-img>
                            </v-avatar>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.youtube_handle" @click.stop="" :href="'https://youtube.com/'+poolExtendedInfo(pool)?.info?.social?.youtube_handle" target="_blank">
                            <v-icon small>
                              mdi-youtube
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.discord_handle" @click.stop="" :href="'https://discord.gg/'+poolExtendedInfo(pool)?.info?.social?.discord_handle" target="_blank">
                            <v-avatar tile size="14">
                              <v-img :src="assets.discordSvg" alt="discord" width="14" height="14" contain></v-img>
                            </v-avatar>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.telegram_handle" @click.stop="" :href="'https://t.me/'+poolExtendedInfo(pool)?.info?.social?.telegram_handle" target="_blank">
                            <v-avatar tile size="14">
                              <v-img :src="assets.telegramSvg" alt="telegram"></v-img>
                            </v-avatar>
                          </v-btn>
                        </v-list-item-subtitle>
                      </v-list-item-content>
                      <v-list-item-avatar class="ma-0" size="32" v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64">
                        <v-img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" eager></v-img>
                      </v-list-item-avatar>
                    </v-list-item>
                    <v-card-text class="pt-0">
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">Saturation</span>
                        </v-col>
                        <v-col cols="7">
                          <v-progress-linear height="20" rounded striped :value="pool.live_saturation" :color="filters.getColor(pool.live_saturation)">
                            <span>{{ pool.live_saturation + '%' }}</span>
                          </v-progress-linear>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">Pledge</span>
                        </v-col>
                        <v-col cols="7">
                          <v-chip x-small color="#085D3A" style="border: 1px solid #75E0A7; color: #75E0A7; " v-if="loggedWallet">
                            {{ filters.toCurrency(pool.pledge, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}
                          </v-chip>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">ROS</span>
                        </v-col>
                        <v-col cols="7">
                          <span style="font-size: 14px; color: white">{{ (pool.ros).toFixed(2) + '%' }}</span>
                        </v-col>
                      </v-row>
                      <v-row no-gutters>
                        <v-col cols="5">
                          <span style="font-size: 14px; color: white">Fees</span>
                        </v-col>
                        <v-col cols="7">
                          <span style="font-size: 14px; color: white" v-if="pool && loggedWallet">{{ pool.margin + '%' }} / {{ filters.toCurrency(pool.fixed_cost, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>
                </v-hover>
              </v-col>
            </v-row>
          </v-card-text>
          <v-card-actions style="justify-content: center;">
            <v-pagination style="max-width: 400px" :total-visible="6" circle class="pagination mb-2" v-model="page" :length="numPages"></v-pagination>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
    <DelegateDialog v-if="txData" :isOpen="isDelegateDialogOpen" @close="closeDelegateDialog" :pool="selectedPool" :tx="txData"></DelegateDialog>
  </v-layout>
</template>
<script setup lang="ts">
import { computed, ref, toRefs, watch, onMounted } from 'vue';
import CopyButton from "@/shared/components/CopyButton.vue";
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import { Cardano } from '@cardano-sdk/core';
import StakingCard from '@/modules/dashboard/components/StakingCard.vue';
import networks from "@/utils/networks";
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import filters from '@/shared/utils/filters';
import { getStakeKey } from '@/chrome/serialization';
import { setWalletConfiguration } from '@/db/wallet-db';

const { config, loggedWallet, account, utxos, keys } = toRefs(walletStore);
const { epochParams, pools, tip } = toRefs(networkStore);

const page = ref<number>(1);
const pageSize = ref<number>(12);
const pageCount = ref<number>(0);
const hideSaturated = ref<boolean>(true);
const pledgeMet = ref<boolean>(true);
const search = ref<string>('');
const selectedPool = ref<any>(null);
const txData = ref<any>(null);
const isDelegateDialogOpen = ref<boolean>(false);

const headers = computed(() => {
  return [
    {text: 'Name', sortable: true, align: 'left', value: 'name'},
    {text: 'Delegators', sortable: true, align: 'center d-none d-lg-table-cell', value: 'live_delegators', width: 122 },
    {text: 'ROS (%)', sortable: true, align: 'center d-none d-lg-table-cell', value: 'ros', width: 105 },
    {text: 'Blocks', sortable: true, align: 'center d-none d-lg-table-cell', value: 'block_count', width: 96 },
    {
      text: 'Saturation', sortable: true, align: 'center', value: 'live_saturation', width: 128, filter: value => {
        if (!hideSaturated.value) return true
        return value < 99
      }
    },
    {text: 'Fees', sortable: true, align: 'center', value: 'fixed_cost', width: 131 },
    {text: 'Pledge', sortable: true, align: 'center d-none d-lg-table-cell', value: 'pledge', width: 84 }
  ]
});

let isPro = computed({
  get: () => {
    return config.value.stakingProView
  },
  set: (val) => {
    config.value.stakingProView = val
    setWalletConfiguration(loggedWallet.value.id, 'stakingProView', val)
  }
})

const geroPoolExists = computed(() => {
  return !!networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network)
})

const geroPoolId = computed(() => {
  return networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network)
});

const delegatingToGero = computed(() => {
  if (account.value) {
    return geroPoolId.value === account.value.pool_id
  }
  return false
});

const stakePools = computed(() => {
  if (pools.value) {
    let filteredPools = Object.values(pools.value).filter((pool: any) => pool.pool_status === 'registered')
    if (search.value) {
      filteredPools = filteredPools.filter((pool: any) => (pool.ticker && pool.ticker.toLowerCase().includes(search.value.toLowerCase())) || (pool.name && pool.name.toLowerCase().includes(search.value.toLowerCase())))
    }
    if (pledgeMet.value) {
      filteredPools = filteredPools.filter((pool: any) => {
        return Number(pool.pledge) <= Number(pool.live_pledge)
      })
    }
    filteredPools.sort((a: any, b: any) => {
      if (a.pool_id_bech32 === geroPoolId.value) return -1;
      if (b.pool_id_bech32 === geroPoolId.value) return 1;
      return 0;
    });
    return filteredPools
  }
  return []
})

const numPages = computed(() => {
  return Math.ceil(stakePools.value.length / pageSize.value);
})

const pagedPools = computed<any[]>(() => {
  // get the start index for your paged result set.
  // The page number starts at 1 so the active item in the pagination is displayed properly.
  // However for our calculation the page number must start at (n-1)
  const startIndex = (page.value - 1) * pageSize.value;

  // create a copy of your assets list so we don't modify the original data set
  const data = [...stakePools.value];

  // only return the data for the current page using splice
  return data.splice(startIndex, pageSize.value);
})

watch(search, (val) => {
  if (val) {
    page.value = 1
  }
})

const delegateToGero = () => {
  if (loggedWallet.value) {
    const poolId = networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network)
    const pool = pools.value[poolId]
    if (!pool) {
      return;
    }
    delegate(pool)
  }
}

function delegate(row: any) {
  console.log('delegate', row)
  selectedPool.value = row

  const certificates: Cardano.Certificate[] = [];

  console.log(getStakeKey(loggedWallet.value.publicKey, 0).hash().hex())
  console.log(selectedPool.value.pool_id_bech32)
  console.log(keys.value.stake[0].cred)

  // Create stake credential from the key hash
  const stakeCredential: Cardano.Credential = {
    type: Cardano.CredentialType.KeyHash,
    hash: keys.value.stake[0].cred
  };

  if (!account.value?.active) {
    // Create stake registration certificate
    const registrationCertificate: Cardano.StakeRegistrationCertificate = {
      __typename: Cardano.CertificateType.StakeRegistration,
      stakeCredential
    };
    certificates.push(registrationCertificate);
  }

  // Create stake delegation certificate
  const poolId = Cardano.PoolId(selectedPool.value.pool_id_bech32);
  const delegationCertificate: Cardano.StakeDelegationCertificate = {
    __typename: Cardano.CertificateType.StakeDelegation,
    stakeCredential,
    poolId
  };
  certificates.push(delegationCertificate);

  // Create change output - for delegation we typically send change back to our own address
  const changeOutput: Cardano.TxOut = {
    address: keys.value.payment[0].address, // Use first payment address for change
    value: {
      coins: BigInt(0), // Will be calculated properly during signing
      assets: new Map()
    }
  };

  // Build transaction body using Cardano JS SDK
  const txBody: Cardano.TxBody = {
    inputs: utxos.value.map((utxo: Cardano.Utxo) => utxo[0]),
    outputs: [changeOutput],
    fee: BigInt(200000), // Estimated fee (will be calculated properly by signing infrastructure)
    validityInterval: {
      invalidHereafter: Cardano.Slot(tip.value.slot + 3600) // 1 hour from now
    },
    certificates
  };

  // Serialize transaction for the dialog
  const transaction: Cardano.Tx = {
    id: Cardano.TransactionId('0'.repeat(64)), // Temporary ID
    body: txBody,
    witness: {
      signatures: new Map()
    }
  };

  txData.value = transaction;
  console.log('Transaction built with Cardano JS SDK:', transaction);
  isDelegateDialogOpen.value = true;
}

const closeDelegateDialog = () => {
  isDelegateDialogOpen.value = false;
  txData.value = null;
  selectedPool.value = null;
}

const poolExtendedInfo = (pool: any) => {
  if (pool && pool.pool_extended_info) {
    return JSON.parse(pool.pool_extended_info);
  }
  return undefined
}

onMounted(() => {
  // isPro.value =
})
</script>
<style scoped>
.v-progress-linear__determinate {
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}

.v-data-table-header {
  background-color: rgb(22, 27, 38);
}

.v-data-table>.v-data-table__wrapper>table>tbody>tr>td, .v-data-table>.v-data-table__wrapper>table>tbody>tr>th, .v-data-table>.v-data-table__wrapper>table>tfoot>tr>td, .v-data-table>.v-data-table__wrapper>table>tfoot>tr>th, .v-data-table>.v-data-table__wrapper>table>thead>tr>td, .v-data-table>.v-data-table__wrapper>table>thead>tr>th {
  padding: 0 10px;
  transition: height .2s cubic-bezier(.4,0,.6,1);
}

.poolsTable {
  :is(tbody) {
    cursor: pointer;
  }
}
</style>
