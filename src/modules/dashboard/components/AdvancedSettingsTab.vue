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
      <h2 class="text-left pb-2" style="color: #ff6464">Danger Zone</h2>
      <v-card outlined style="border-color: #ff6464; background-color: transparent!important;">
        <v-card-text>
          <v-row no-gutters class="py-2">
            <v-col cols="7" class="text-left">
              <h3 class="white--text">Delete Wallet</h3>

              <span class="helper my-0">Deleting this wallet removes it from Gero Dashboard, and any remaining funds will be inaccessible. To regain access, restore using your recovery phrase.</span>
            </v-col>
            <v-col cols="5" style="align-content: center;">
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

export default {
  name: 'AdvancedSettingsTab',
  computed: {
    ...mapState(useStore, ['loggedWallet']),
    ...mapState(walletConfigStore, ['config', 'getTxAutoSubmit']),
    txAutoSubmit: {
      get() {
        return this.getTxAutoSubmit
      },
      async set(val) {
        await this.setTxAutoSubmit(val)
      }
    }
  },
  methods: {
    ...mapActions(useStore, ['logout']),
    ...mapActions(walletConfigStore, ['setTxAutoSubmit']),
    async resync() {
      this.resyncLoading = true
      this.$emit('loading', true)
      await appWallet.resync()
      this.resyncLoading = false
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
    resyncLoading: false,
    deleteWalletDialog: false,
    deleteWalletLoading: false
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
