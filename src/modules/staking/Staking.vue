<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2" v-if="accountInfo?.controlled_amount && accountInfo?.pool_id">
        <StakingCard></StakingCard>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card flat outlined>
          <v-card-title class="pa-0">
            <v-list-item two-line>
              <v-list-item-content>
                <v-list-item-title style="display: flex">
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
              <v-list-item-action style="align-items: center;" class="ma-0" v-if="geroPoolExists">
                <v-card-title style="color: #00DFF3; font-size: 18px" v-if="geroPoolExists">
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
                          hide-default-footer :search="search" class="poolsTable transparent" @click:row="delegate">
              <template v-slot:[`item.name`]="{ item }">
                <v-list-item three-line style="min-height: 68px" class="px-0">
                  <v-list-item-avatar size="24" style="place-self: center;">
                    <v-img :src="poolExtendedInfo(item).info.url_png_icon_64x64" v-if="poolExtendedInfo(item)?.info?.url_png_icon_64x64" alt="" @error="fallbackImage" eager></v-img>
                  </v-list-item-avatar>
                  <v-list-item-content class="py-1">
                    <v-list-item-title style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: horizontal; overflow: hidden; text-overflow: ellipsis; white-space: normal;">{{ `[${item.ticker}] ${item.name}` }}&nbsp;
                      <div>
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
                            <v-img :src="xLogo" alt="x"></v-img>
                          </v-avatar>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.youtube_handle" @click.stop="" :href="'https://youtube.com/'+poolExtendedInfo(item)?.info?.social?.youtube_handle" target="_blank">
                          <v-icon small>
                            mdi-youtube
                          </v-icon>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.discord_handle" @click.stop="" :href="'https://discord.gg/'+poolExtendedInfo(item)?.info?.social?.discord_handle" target="_blank">
                          <v-icon small>
                            mdi-discord
                          </v-icon>
                        </v-btn>
                        <v-btn icon x-small v-if="poolExtendedInfo(item)?.info?.social?.telegram_handle" @click.stop="" :href="'https://t.me/'+poolExtendedInfo(item)?.info?.social?.telegram_handle" target="_blank">
                          <v-avatar tile size="14">
                            <v-img :src="telegramLogo" alt="x"></v-img>
                          </v-avatar>
                        </v-btn>
                      </div>
                    </v-list-item-title>
                    <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal;" v-if="item.description">{{item.description}}</v-list-item-subtitle>
                    <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal;">
                      {{ item.pool_id_bech32 | truncate }}&nbsp;
                      <CopyButton :value="item.pool_id_bech32" x-small></CopyButton>
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>
              </template>
              <template v-slot:[`item.live_delegators`]="{ item }">
                {{ (item.live_delegators).toLocaleString() }}
              </template>
              <template v-slot:[`item.ros`]="{ item }">
                {{ item.ros.toLocaleString(undefined, {maximumFractionDigits: 2}) }}
              </template>
              <template v-slot:[`item.block_count`]="{ item }">
                {{ item.block_count.toLocaleString() }}
              </template>
              <template v-slot:[`item.live_saturation`]="{ item }">
                <v-progress-linear rounded :color="getColor(item.live_saturation)" height="16" :value="item.live_saturation" striped>
                  <template v-slot:default="{ value }">
                    <strong>{{ Math.ceil(value) }}%</strong>
                  </template>
                </v-progress-linear>
                <div class="justify-space-between d-flex align-items-center" style="font-size: 10px; text-align-last: justify;">
                  <strong>{{ item.active_stake | toCurrency(false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</strong>
                  <strong v-if="Number(item.active_stake) - Number(item.live_stake) > 100000000" style="display: inline-flex; font-size: 10px">
                    <v-icon x-small color="#47cd89" style="font-size: 10px">mdi-arrow-up-bold</v-icon>
                    {{ Number(item.active_stake) - Number(item.live_stake) | toCurrency(false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                  </strong>
                  <strong v-else-if="Number(item.live_stake) - Number(item.active_stake) > 100000000" style="display: inline-flex; font-size: 10px">
                    <v-icon x-small color="#F97066" style="font-size: 10px; line-height: 1.7;">mdi-arrow-down-bold</v-icon>
                    {{ Number(item.live_stake) - Number(item.active_stake) | toCurrency(false, 1, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
                  </strong>
                </div>
              </template>
              <template v-slot:[`item.fixed_cost`]="{ item }">
                <span style="font-size: 14px; color: white" v-if="loggedWallet">{{ item.margin + '%' }} / {{ item.fixed_cost | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))
                  }}</span>
              </template>
              <template v-slot:[`item.pledge`]="{ item }">
                {{ item.pledge | toCurrency(false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}
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
                          {{`[${pool.ticker}] ${pool.name}` }}
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
                              <v-img :src="xLogo" alt="x"></v-img>
                            </v-avatar>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.youtube_handle" @click.stop="" :href="'https://youtube.com/'+poolExtendedInfo(pool)?.info?.social?.youtube_handle" target="_blank">
                            <v-icon small>
                              mdi-youtube
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.discord_handle" @click.stop="" :href="'https://discord.gg/'+poolExtendedInfo(pool)?.info?.social?.discord_handle" target="_blank">
                            <v-icon small>
                              mdi-discord
                            </v-icon>
                          </v-btn>
                          <v-btn icon x-small v-if="poolExtendedInfo(pool)?.info?.social?.telegram_handle" @click.stop="" :href="'https://t.me/'+poolExtendedInfo(pool)?.info?.social?.telegram_handle" target="_blank">
                            <v-avatar tile size="14">
                              <v-img :src="telegramLogo" alt="x"></v-img>
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
                          <v-progress-linear height="20" rounded :value="pool.live_saturation" color="#333741">
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
                            {{ pool.pledge | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}
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
                          <span style="font-size: 14px; color: white" v-if="pool && loggedWallet">{{ pool.margin + '%' }} / {{ pool.fixed_cost | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
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
    <DelegateDialog :isOpen="isDelegateDialogOpen" @close="isDelegateDialogOpen = false" :pool="selectedPool" :tx="txData"></DelegateDialog>
  </v-layout>
</template>
<script>
import filters from "@/shared/utils/filters";
import { appWallet, useStore } from '@/store';
import {mapActions, mapState} from "pinia";
import CopyButton from "@/shared/components/CopyButton.vue";
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import {
  Certificate, Ed25519KeyHash,
  Credential,
  StakeDelegation,
  StakeRegistration, Transaction, TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { buildTx } from '@/shared/utils/builder';
import { toUTxO } from '@/shared/utils/converter';
import StakingCard from '@/modules/dashboard/components/StakingCard.vue';
import networks from "@/shared/utils/networks";

export default {
  name: 'Staking',
  components: { StakingCard, DelegateDialog, CopyButton},
  computed: {
    ...mapState(useStore, ['stakingProView']),
    isPro: {
      get() {
        return this.stakingProView
      },
      set(val) {
        this.setStakingProView(val)
      }
    },
    headers() {
      return [
        {text: 'Name', sortable: true, align: 'left', value: 'name'},
        {text: 'Delegators', sortable: true, align: 'center d-none d-lg-table-cell', value: 'live_delegators', width: 122 },
        {text: 'ROS (%)', sortable: true, align: 'center d-none d-lg-table-cell', value: 'ros', width: 105 },
        {text: 'Blocks', sortable: true, align: 'center d-none d-lg-table-cell', value: 'block_count', width: 96 },
        {
          text: 'Saturation', sortable: true, align: 'center', value: 'live_saturation', width: 128, filter: value => {
            if (!this.hideSaturated) return true
            return value < 99
          }
        },
        {text: 'Fees', sortable: true, align: 'center', value: 'fixed_cost', width: 131 },
        {text: 'Pledge', sortable: true, align: 'center d-none d-lg-table-cell', value: 'pledge', width: 84 }
      ]
    },
    geroPoolExists() {
      return !!networks.resolvePool(this.loggedWallet?.chain, this.loggedWallet?.network)
    },
    ...mapState(useStore, ['pools', 'loggedWallet', 'accountInfo', 'utxos', 'latestTip', 'baseAddress']),
    numPages() {
      // calculate the number of pages we have
      return Math.ceil(this.stakePools.length / this.pageSize);
    },
    stakePools() {
      if (this.pools) {
        let filteredPools = this.pools.filter(pool => pool.pool_status === 'registered')
        if (this.search) {
          filteredPools = filteredPools.filter(pool => (pool.ticker && pool.ticker.toLowerCase().includes(this.search.toLowerCase())) || (pool.name && pool.name.toLowerCase().includes(this.search.toLowerCase())))
          console.log(filteredPools)
        }
        if (this.pledgeMet) {
          filteredPools = filteredPools.filter(pool => {
            return Number(pool.pledge) <= Number(pool.live_pledge)
          })
        }
        return filteredPools
      }
      return []
    },
    pagedPools() {
      // get the start index for your paged result set.
      // The page number starts at 1 so the active item in the pagination is displayed properly.
      // However for our calculation the page number must start at (n-1)
      const startIndex = (this.page - 1) * this.pageSize;

      // create a copy of your assets list so we don't modify the original data set
      const data = [...this.stakePools];

      // only return the data for the current page using splice
      return data.splice(startIndex, this.pageSize);
    },
  },
  watch: {
    search(val) {
      if (val) {
        this.page = 1
      }
    },
  },
  methods: {
    ...mapActions(useStore, ['setStakingProView']),
    getColor(value) {
      if (value > 100) {
        value = 100
      }
      value = value / 100
      //value from 0 to 1
      const hue = ((1 - value) * 120).toString(10);
      return ["hsl(", hue, ",57.26%,54.12%)"].join("");
    },
    delegateToGero() {
      if (this.loggedWallet) {
        const poolId = networks.resolvePool(this.loggedWallet?.chain, this.loggedWallet?.network)
        const pool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
        if (!pool) {
          console.log('Pool Not Found')
          return;
        }
        this.delegate(pool)
      }
    },
    delegate(row) {
      console.log('delegate', row)
      this.selectedPool = row
      const wallet = appWallet;
      // Registration Certificate
      const certificates = [];
      if (!this.accountInfo?.active) {
        const registrationCertificate = Certificate.new_stake_registration(StakeRegistration.new(Credential.from_keyhash(wallet.stakeKey().hash())))
        certificates.push(registrationCertificate);
      }
      // Delegation Certificate
      const delegationCertificate = Certificate.new_stake_delegation(StakeDelegation.new(Credential.from_keyhash(wallet.stakeKey().hash()), Ed25519KeyHash.from_bech32(this.selectedPool.pool_id_bech32)));
      certificates.push(delegationCertificate);
      // UTxOs
      const transactionUnspentOutputs = TransactionUnspentOutputs.new();
      this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
      const txBody = buildTx(this.loggedWallet, undefined, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, certificates, [])
      this.txData = Transaction.new(txBody, TransactionWitnessSet.new())
      console.log(txBody.to_json())
      console.log(this.txData)
      this.isDelegateDialogOpen = true
    },
    poolExtendedInfo(pool) {
      if (pool && pool.pool_extended_info) {
        return JSON.parse(pool.pool_extended_info);
      }
      return undefined
    },
    fallbackImage(e) {
      e.target.src = this.errorImage
    }
  },
  filters,
  data: () => ({
    filters,
    blockchainDB: undefined,
    page: 1,
    pageSize: 12,
    search: '',
    hideSaturated: true,
    pledgeMet: true,
    pageCount: 0,
    xLogo: require('@/assets/svg/x.svg'),
    telegramLogo: require('@/assets/svg/telegram.svg'),
    errorImage: require('@/assets/img/1x1.png'),
    isDelegateDialogOpen: false,
    selectedPool: undefined,
    txData: undefined,
    networks,
  })
}
</script>
<style>
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
  tbody{
    cursor: pointer;
  }
}
</style>
