<template>
  <div>
    <v-list-item @click="openMultisigDialog">
      <v-list-item-icon>
        <v-icon>mdi-account-multiple-plus</v-icon>
      </v-list-item-icon>
      <v-list-item-content>
        <v-list-item-title>Create Multisig Wallet</v-list-item-title>
      </v-list-item-content>
    </v-list-item>

    <create-multisig-wallet-dialog v-model="showMultisigDialog" @create="handleMultisigWalletCreated" />
  </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import { CreateMultisigWalletDialog } from '@/modules/multisig';
import { MultisigWallet } from '@/models/script';

@Component({
  components: {
    CreateMultisigWalletDialog,
  },
})
export default class MultisigNavItem extends Vue {
  showMultisigDialog = false;

  openMultisigDialog(): void {
    this.showMultisigDialog = true;
  }

  handleMultisigWalletCreated(wallet: MultisigWallet): void {
    console.log('Multisig wallet created:', wallet);
    // Handle the created wallet (e.g., store it, navigate to it, etc.)
    // this.$store.dispatch('walletConfig/addMultisigWallet', wallet);
  }
}
</script>
