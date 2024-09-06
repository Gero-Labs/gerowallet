<template>
  <v-tab-item>
    <v-layout class="py-2" column>
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
import { appWallet } from '@/store';

export default {
  name: 'AdvancedSettingsTab',
  computed: {
    // ...mapState(useStore, ['connectedDapps']),
  },
  methods: {
    async resync() {
      this.resyncLoading = true
      this.$emit('loading', true)
      await appWallet.resync()
      this.resyncLoading = false
      this.$emit('loading', false)
    }
    // ...mapActions(useStore, ['disconnectDapp']),
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
