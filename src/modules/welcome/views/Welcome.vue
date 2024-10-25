<template>
  <v-container class="py-0" :style="{direction: $t('rtl') === 'true' ? 'rtl' : 'ltr', maxWidth: '1000px'}">
    <v-card flat class="transparent pa-0" style="top: 40px">
      <v-card-title class="justify-center" style="color: white; font-size: 32px;">{{$t('welcome') }}</v-card-title>
      <v-card-subtitle class="text-center pt-1" style="font-size: 20px" v-if="walletSetup || !Array.isArray(wallets) || !wallets.length">{{ $t('chooseAnOption') }}</v-card-subtitle>
      <v-card-subtitle class="text-center pt-1" style="font-size: 20px" v-else>{{ $t('chooseAWallet') }}</v-card-subtitle>
      <v-card-title class="justify-center pt-0" v-if="walletSetup || !Array.isArray(wallets) || !wallets.length">
        <network-selector ref="networkSelector"></network-selector>
      </v-card-title>
      <v-card-text class="pb-12 px-12">
        <div v-if="walletSetup || !Array.isArray(wallets) || !wallets.length">
          <v-row class="fill-height">
            <v-col cols="12" md="4" lg="4" class="d-flex align-center" @click="createWalletDialog = true">
              <parallax-card style="margin-left: auto; margin-right: auto;"
                             :data-image="walletCreateCardBg">
                <h1 slot="header" style="line-height: 1;">{{ $t('createWallet') }}</h1>
                <p slot="content">{{ $t('createWalletSubtitle') }}</p>
              </parallax-card>
            </v-col>
            <v-col cols="12" md="4" lg="4" class="d-flex align-center" @click="restoreWalletDialog = true">
              <parallax-card style="margin-left: auto; margin-right: auto;"
                             :data-image="walletRestoreCardBg">
                <h1 slot="header" style="line-height: 1">{{ $t('restoreWallet') }}</h1>
                <p slot="content">{{ $t('restoreWalletSubtitle') }}</p>
              </parallax-card>
            </v-col>
            <v-col cols="12" md="4" lg="4" v-if="network" class="d-flex align-center" :style="network.supportedHardware ? { } : { pointerEvents: 'none' }" @click="pairHardwareWalletDialog = true">
              <v-chip large v-if="!network.supportedHardware"
                style="position: fixed;
                transform: translateX(50%) translateX(64px);
                z-index: 4;"
                color="red"
              >
                SOON
              </v-chip>
              <parallax-card :style="network.supportedHardware ? { marginLeft: 'auto', marginRight: 'auto' } : { marginLeft: 'auto', marginRight: 'auto', filter: 'brightness(0.5)' }"
                             :data-image="hardwarePairCardBg">
                <h1 slot="header" style="line-height: 1">{{ $t('hardwareWallet') }}</h1>
                <p slot="content">{{ $t('hardwareWalletSubtitle') }}</p>
              </parallax-card>
            </v-col>
          </v-row>
          <div class="text-center justify-center">
            <v-btn class="mt-4" :ripple="false" text plain @click="walletSetup = false" v-show="wallets?.length > 0">{{$t('signIn')}}&nbsp;<v-icon small>mdi-chevron-right</v-icon></v-btn>
          </div>
        </div>
        <v-card v-else class="transparent" flat style="max-width: 400px; margin: auto">
          <v-card-text class="px-2 py-0" style="max-height: 177px; overflow-y: auto">
            <v-list nav dense class="pa-0" style="background-color: #ffffff0a;">
              <v-list-item-group v-model="selectedWallet" color="primary">
                <v-list-item v-for="(item, i) in wallets" :key="i" @click="submitLogin(item.id)">
                  <v-list-item-icon>
                    <v-badge
                        overlap
                        avatar
                        bottom
                        bordered
                        offset-y="3"
                    >
                      <template v-slot:badge>
                        <v-avatar>
                          <v-img :src="resolveNetworkIcon(item)"></v-img>
                        </v-avatar>
                      </template>
                      <v-avatar size="40">
                        <v-img :src="resolveIcon(item.icon)"></v-img>
                      </v-avatar>
                    </v-badge>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>
                      {{ item.name }}
                    </v-list-item-title>
                    <v-list-item-subtitle>
                      {{ item.chain }} - {{item.network}}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                  <v-list-item-avatar tile size="20" v-if="item.type === WalletType.Ledger">
                    <v-img :src="require('@/assets/svg/ledger.svg')" contain width="18"></v-img>
                  </v-list-item-avatar>
                  <v-list-item-avatar tile size="20" v-if="item.type === WalletType.Keystone">
                    <v-img :src="require('@/assets/svg/keystone.svg')" contain width="18"></v-img>
                  </v-list-item-avatar>
                </v-list-item>
              </v-list-item-group>
            </v-list>
          </v-card-text>
          <v-divider></v-divider>
          <v-card-actions class="justify-center pt-10">
            <v-btn text plain :ripple="false" @click="walletSetup = true"><v-icon small>mdi-chevron-left</v-icon>&nbsp;{{$t('walletSetup')}}</v-btn>
          </v-card-actions>
        </v-card>
      </v-card-text>
    </v-card>
    <create-wallet :dialog="createWalletDialog" @dialogChange="createWalletDialogChange"></create-wallet>
    <restore-wallet :dialog="restoreWalletDialog" @dialogChange="restoreWalletDialogChange"></restore-wallet>
    <pair-hardware-wallet :dialog="pairHardwareWalletDialog" @dialogChange="pairHardwareWalletDialogChange"></pair-hardware-wallet>
  </v-container>
</template>
<script>
import CreateWallet from "@/modules/welcome/dialogs/CreateWallet.vue";
import ParallaxCard from "@/modules/welcome/components/ParallaxCard.vue";
import PairHardwareWallet from "@/modules/welcome/dialogs/PairHardwareWallet.vue";
import {useStore} from "@/store"
import {mapActions, mapState} from "pinia";
import RestoreWallet from "@/modules/welcome/dialogs/RestoreWallet.vue";
import networks from "@/shared/utils/networks";
import NetworkSelector from '@/modules/navigation/components/NetworkSelector.vue';
import { WalletType } from '@/models/types';

export default {
  name: 'welcome',
  components: { NetworkSelector, PairHardwareWallet, ParallaxCard, CreateWallet, RestoreWallet},
  computed: {
    WalletType() {
      return WalletType
    },
    ...mapState(useStore, ['wallets','network']),
    walletCreateCardBg() {
      if (this.network?.blockchain?.includes("Apex")) {
        return this.walletCreateApexBg
      }
      return this.walletCreateBg
    },
    walletRestoreCardBg() {
      if (this.network?.blockchain?.includes("Apex")) {
        return this.walletRestoreApexBg
      }
      return this.walletRestoreBg
    },
    hardwarePairCardBg() {
      if (this.network?.blockchain?.includes("Apex")) {
        return this.hardwareWalletApexBg
      }
      return this.hardwareWalletBg
    }
  },
  methods: {
    ...mapActions(useStore, ['login']),
    async submitLogin(walletId) {
      await this.login(walletId)
      const path = localStorage.getItem('intendedUrl')?"/report":"/"
      await this.$router.push(path)
    },
    resolveIcon(icon) {
      if (icon) {
        return require('@/assets/svg/'+icon+'.svg')
      }
      return ''
    },
    resolveNetworkIcon(item) {
      const network = this.networks.resolveNetwork(item.chain, item.network)
      if (network) {
        return network.icon
      }
      return ''
    },
    createWalletDialogChange(val) {
      this.createWalletDialog = val
    },
    restoreWalletDialogChange(val) {
      this.restoreWalletDialog = val
    },
    pairHardwareWalletDialogChange(val) {
      this.pairHardwareWalletDialog = val
    }
  },
  data: () => ({
    networks,
    store: useStore,
    createWalletDialog: false,
    restoreWalletDialog: false,
    pairHardwareWalletDialog: false,
    walletSetup: false,
    selectedWallet: {},
    walletCreateBg: require('@/modules/welcome/assets/wallet_new.png'),
    walletRestoreBg: require('@/modules/welcome/assets/wallet_restore.png'),
    hardwareWalletBg: require('@/modules/welcome/assets/hardware_wallet.png'),
    walletCreateApexBg: require('@/modules/welcome/assets/wallet_new_apex.png'),
    walletRestoreApexBg: require('@/modules/welcome/assets/wallet_restore_apex.png'),
    hardwareWalletApexBg: require('@/modules/welcome/assets/hardware_wallet_apex.png')
  }),
  mounted() {

  }
}
</script>
