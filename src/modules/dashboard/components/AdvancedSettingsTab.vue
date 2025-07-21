<template>
  <v-tab-item>
    <v-layout class="py-2" column>
      <v-row no-gutters class="py-2" v-if="networks.resolveCashbackSupport(loggedWallet?.chain, loggedWallet?.network)">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Shop & Earn Pop-ups</h3>
          <span class="helper my-0">Get real-time cashback notifications as you explore supported retailer websites.</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <v-switch dense inset v-model="cashbackPopups" hide-details style="margin: auto"></v-switch>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Tx Auto Submit</h3>
          <span class="helper my-0">Automatically submit transactions after signing</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <v-switch dense inset v-model="txAutoSubmit" hide-details style="margin: auto"></v-switch>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Prompt Display Mode</h3>
          <span class="helper my-0">Select pop-ups or side panel for signing and approval prompts</span>
        </v-col>
        <v-col cols="3" style="display: flex;">
          <ToggleSwitch text-left="POPUP" text-right="SIDEPANEL" font-size="10px" v-model="useSidePanel" />
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="9" class="text-left">
          <h3 style="color: white">Re-Sync Wallet</h3>
          <span class="helper my-0">Replacing wallet data from the blockchain. (Might take a while)</span>
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
              <span class="helper my-0">Deleting this wallet removes it from Gero Dashboard, and any remaining funds will be inaccessible. To regain access, restore using your recovery phrase</span>
            </v-col>
            <v-col cols="3" style="align-content: center;">
              <v-btn
                text
                class="px-1"
                color="error"
                @click="deleteWalletDialog = true"
                :disabled="deleteWalletLoading"
                :loading="deleteWalletLoading"
              >
                <v-icon right class="mr-1 ml-0">
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
            Please note that this operation will log you out from the Dashboard
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
<script setup lang="ts">
import { ref, computed, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import db from '@/db';
import snackbar from '@/plugins/snackbar';
import { getTurnOff, setTurnOff } from '@bringweb3/chrome-extension-kit';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import GeroStore from '@/stores/geroStore';
import { setWalletConfiguration } from '@/db/wallet-db';

// Define emits
const emit = defineEmits(['loading']);

// Get reactive store properties
const { loggedWallet, config } = toRefs(walletStore);

// Access Vue instance for router
const vmProxy = getCurrentInstance()!.proxy as any;
const router = vmProxy.$router

// Reactive data
const reSyncLoading = ref<boolean>(false);
const deleteWalletDialog = ref<boolean>(false);
const deleteWalletLoading = ref<boolean>(false);
const cashbackPopupsDisabled = ref<boolean>(false);

// Computed properties
const txAutoSubmit = computed({
  get() {
    return config.value?.txAutoSubmit || false;
  },
  set(val: boolean) {
    if (config.value) {
      config.value.txAutoSubmit = val;
      setWalletConfiguration(loggedWallet.value.id, 'txAutoSubmit', val);
    }
  }
});

const useSidePanel = computed({
  get() {
    return config.value?.useSidePanel || false;
  },
  set(val: boolean) {
    if (config.value) {
      config.value.useSidePanel = val;
      setWalletConfiguration(loggedWallet.value.id, 'useSidePanel', val);
    }
  }
});

const cashbackPopups = computed({
  get() {
    return !cashbackPopupsDisabled.value;
  },
  set(val: boolean) {
    cashbackPopupsDisabled.value = !val;
  }
});

// Watchers
watch(cashbackPopupsDisabled, (newVal) => {
  updateCashbackPopups(newVal);
});

// Methods
const loadCashbackPopups = async () => {
  const val = await getTurnOff();
  cashbackPopupsDisabled.value = val.isTurnedOff;
};

const updateCashbackPopups = async (val: boolean) => {
  await setTurnOff(val);
};

const reSync = async () => {
  reSyncLoading.value = true;
  emit('loading', true);
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.RESYNC,
    data: {},
  });
  reSyncLoading.value = false;
  emit('loading', false);
};

async function submitLogout() {
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.LOGOUT,
    data: { },
  }).then(() => {
    // // Wait for next tick to ensure wallet store is cleared before navigation
    vmProxy.$nextTick(() => {
      router.push('/welcome')
    })
  });
}

const deleteWalletConfirm = async () => {
  deleteWalletLoading.value = true;
  const walletId = loggedWallet.value.id;
  const name = loggedWallet.value.name;
  
  // Remove wallet from geroStore (this will also delete from database)
  await GeroStore.removeWallet(walletId);
  
  // Then logout
  await submitLogout();
  deleteWalletDialog.value = false;
  deleteWalletLoading.value = false;
  snackbar.fireSuccess(`Wallet '${name}' Deleted Successfully.`);
};

// Lifecycle
onMounted(() => {
  loadCashbackPopups();
});
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
