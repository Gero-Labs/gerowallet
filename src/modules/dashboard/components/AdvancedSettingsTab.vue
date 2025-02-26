<template>
  <v-tab-item>
    <v-layout class="py-2" column>
      <v-row no-gutters class="py-2" v-if="networks.resolveCashbackSupport(loggedWallet?.chain, loggedWallet?.network)">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Shop & Earn Pop-ups</h3>
          <span class="helper my-0">Get real-time cashback notifications as you explore supported retailer websites.</span>
        </v-col>
        <v-col cols="3" style="align-content: center;">
          <v-switch dense inset v-model="cashbackPopups" hide-details style="margin: auto"></v-switch>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Tx Auto Submit</h3>
          <span class="helper my-0">Automatically submit transactions after signing.</span>
        </v-col>
        <v-col cols="3" style="align-content: center;">
          <v-switch dense inset v-model="txAutoSubmit" hide-details style="margin: auto"></v-switch>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Re-Sync Wallet</h3>
          <span class="helper my-0">Replacing wallet data from the blockchain. (Might take a while).</span>
        </v-col>
        <v-col cols="3" style="align-content: center;">
          <v-btn
            block
            outlined
            color="white"
            @click="reSync"
            :disabled="reSyncLoading"
            :loading="reSyncLoading"
          >
            <v-icon
              left
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
      <h2 class="text-left pb-2" style="color: #ff6464">Danger Zone</h2>
      <v-card outlined style="border-color: #ff6464; background-color: transparent!important;">
        <v-card-text>
          <v-row no-gutters class="py-2">
            <v-col cols="9" class="text-left pr-1">
              <h3 class="white--text">Delete Wallet</h3>
              <span class="helper my-0">Deleting this wallet removes it from Gero Dashboard, and any remaining funds will be inaccessible. To regain access, restore using your recovery phrase.</span>
            </v-col>
            <v-col cols="3" style="align-content: end;">
              <v-btn
                block
                outlined
                color="error"
                @click="deleteWalletDialog = true"
                :disabled="deleteWalletLoading"
                :loading="deleteWalletLoading"
              >
                <v-icon right class="mr-1">
                  mdi-delete
                </v-icon>
                Delete Wallet
              </v-btn>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
      <v-dialog v-model="deleteWalletDialog" max-width="500px">
        <v-card>
          <v-card-title>Are you sure you want to delete this wallet?</v-card-title>
          <v-card-text>
            Please note that this operation will log you out from the Dashboard.
          </v-card-text>
          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn color="primary" text @click="deleteWalletDialog = false" :disabled="deleteWalletLoading">Cancel</v-btn>
            <v-btn color="primary" @click="deleteWalletConfirm" :disabled="deleteWalletLoading" :loading="deleteWalletLoading">OK</v-btn>
            <v-spacer></v-spacer>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-layout>
  </v-tab-item>
</template>
<script>
import { walletConfigStore } from '@/store/modules/walletConfig';
import { mapActions, mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import db from '@/db';
import snackbar from '@/plugins/snackbar';
import { getTurnOff, setTurnOff } from '@bringweb3/chrome-extension-kit';
import networks from '@/shared/utils/networks';

export default {
  name: 'AdvancedSettingsTab',
  watch: {
    cashbackPopupsDisabled(newVal, oldVal) {
      console.log('newVal', newVal)
      console.log('oldVal', oldVal)
      this.updateCashbackPopups(newVal);
    },
  },
  computed: {
    networks() {
      return networks
    },
    ...mapState(useStore, ['loggedWallet']),
    ...mapState(walletConfigStore, ['config', 'getTxAutoSubmit', 'getCashbackPopup']),
    txAutoSubmit: {
      get() {
        return this.getTxAutoSubmit
      },
      async set(val) {
        await this.setTxAutoSubmit(val)
      }
    },
    cashbackPopups: {
      get() {
        return !this.cashbackPopupsDisabled
      },
      set(val) {
        this.cashbackPopupsDisabled = !val
      }
    }
  },
  methods: {
    ...mapActions(useStore, ['logout']),
    ...mapActions(walletConfigStore, ['setTxAutoSubmit']),
    async loadCashbackPopups() {
      const val = await getTurnOff()
      this.cashbackPopupsDisabled = val.isTurnedOff;
    },
    async updateCashbackPopups(val) {
      await setTurnOff(val);
    },
    async reSync() {
      this.reSyncLoading = true
      this.$emit('loading', true)
      await appWallet.resync()
      this.reSyncLoading = false
      this.$emit('loading', false)
    },
    async deleteWalletConfirm() {
      this.deleteWalletLoading = true
      const walletId = appWallet.id
      const name = appWallet.name
      await this.logout()
      await db.deleteWallet(walletId)
      this.deleteWalletDialog = false
      this.deleteWalletLoading = false
      await this.$router.push("/welcome")
      snackbar.fireSuccess(`Wallet '${name}' Deleted Successfully.`)
    },
  },
  data: () => ({
    reSyncLoading: false,
    deleteWalletDialog: false,
    deleteWalletLoading: false,
    cashbackPopupsDisabled: false,
  }),
  created() {
    this.loadCashbackPopups();
  }
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
