<template>
  <v-form ref="form" class="fill-height">
    <v-card outlined class="pa-4 fill-height transparent">
      <div style="width: 100px; margin: auto" class="py-3">
        <img alt="Gero Logo" id="modal-logo-icon" width="100" :src="require('@/assets/svg/gero-logo.svg')"/>
        <img alt="Gero Logo" id="modal-logo-text" width="100" :src="require('@/assets/svg/gero-text.svg')"/>
      </div>
      <v-card-title class="justify-center" style="font-size: 20px; font-weight: bold; color: white; word-break: break-word">Select a Wallet to Login</v-card-title>
      <v-card-text class="px-2 py-0 fill-height" style="max-width: 400px; margin: auto; height: 100%; max-height: 220px; overflow-y: auto">
        <v-list nav dense class="pa-0" style="background-color: #ffffff0a;">
          <v-list-item-group v-model="selectedWallet" color="primary">
            <v-list-item v-for="(item, i) in availableWallets" :key="`wallet-${i}`" @click="submitLogin(item.id)">
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
              <v-list-item-avatar tile size="20" v-if="item.type === 'Ledger'">
                <v-img :src="require('@/assets/svg/ledger.svg')" contain width="18"></v-img>
              </v-list-item-avatar>
            </v-list-item>
          </v-list-item-group>
        </v-list>
      </v-card-text>
    </v-card>
  </v-form>
</template>
<script>
import { useStore } from '@/store';
import { mapActions, mapState } from 'pinia';
import networks from '@/shared/utils/networks';
import { Blockchain, Network } from '@/models/types';

export default {
  name: 'DappSignData',
  computed: {
    ...mapState(useStore, ['wallets']),
    availableWallets() {
      return this.wallets.filter(wallet => wallet.chain === Blockchain.CARDANO && wallet.network === Network.MAINNET)
    },
  },
  methods: {
    ...mapActions(useStore, ['login']),
    async submitLogin(walletId) {
      await this.login(walletId)
      window.close();
    },
    resolveIcon(icon) {
      if (icon) {
        return require('@/assets/svg/'+icon+'.svg')
      }
      return ''
    },
    resolveNetworkIcon(item) {
      const network = networks.resolveNetwork(item.chain, item.network)
      if (network) {
        return network.icon
      }
      return ''
    },
  },
  data() {
    return {
      selectedWallet: {},
    };
  },
};
</script>
<style scoped>

</style>
