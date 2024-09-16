<template>
  <v-tab-item>
    <v-layout class="py-2" column>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Tx Auto Submit</h3>
          <span class="helper my-0">Automatically submit transactions after signing.</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-switch dense inset v-model="txAutoSubmit" hide-details style="margin: auto"></v-switch>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Re-Sync Wallet</h3>
          <span class="helper my-0">Replacing wallet data from the blockchain. (Might take a while).</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-btn
            block
            outlined
            color="white"
            @click="resync"
            :disabled="resyncLoading"
            :loading="resyncLoading"
          >
            <v-icon
              right
              dark
              class="mr-1"
            >
              mdi-sync
            </v-icon>
            <span class="capitalize">ReSync</span>
            <template v-slot:loader>
              <span class="custom-loader">
                <v-icon light>mdi-cached</v-icon>
              </span>
            </template>
          </v-btn>
        </v-col>
      </v-row>
    </v-layout>
  </v-tab-item>
</template>
<script>
import { walletConfigStore } from '@/store/modules/walletConfig';
import { mapActions, mapState } from 'pinia';
import { appWallet } from '@/store';

export default {
  name: 'AdvancedSettingsTab',
  computed: {
    ...mapState(walletConfigStore, ['config', 'getTxAutoSubmit']),
    txAutoSubmit: {
      get() {
        console.log(this.getTxAutoSubmit)
        return this.getTxAutoSubmit
      },
      async set(val) {
        await this.setTxAutoSubmit(val)
      }
    }
  },
  methods: {
    ...mapActions(walletConfigStore, ['setTxAutoSubmit']),
    async resync() {
      this.resyncLoading = true
      this.$emit('loading', true)
      await appWallet.resync()
      this.resyncLoading = false
      this.$emit('loading', false)
    },
  },
  data: () => ({
    resyncLoading: false
  }),
}
</script>
<style scoped>
.custom-loader {
  animation: loader 1s infinite;
  display: flex;
}
@-moz-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@-webkit-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@-o-keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
@keyframes loader {
  from {
    transform: rotate(0);
  }
  to {
    transform: rotate(-360deg);
  }
}
</style>
