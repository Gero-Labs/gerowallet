<template>
  <v-form ref="form" class="fill-height">
    <v-card outlined class="pa-4 fill-height transparent">
      <div style="width: 100px; margin: auto" class="py-3">
        <img :alt="$t('common.geroLogo')" id="modal-logo-icon" width="100" :src="assets.geroLogo"/>
        <img :alt="$t('common.geroLogo')" id="modal-logo-text" width="100" :src="assets.geroText"/>
      </div>
      <v-card-title class="justify-center" style="font-size: 20px; font-weight: bold; color: white; word-break: break-word">{{ $t('wallet.selectWalletToLogin') }}</v-card-title>
      <v-card-text class="px-2 py-0 fill-height" style="max-width: 400px; margin: auto; height: 100%; max-height: 220px; overflow-y: auto">
        <v-list nav dense class="pa-0" style="background-color: #ffffff0a;" v-if="availableWallets?.length > 0">
          <v-list-item-group v-model="selectedWallet" color="primary">
            <v-list-item v-for="(item, i) in availableWallets" :key="`wallet-${i}`" @click="submitLogin(item)">
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
                <v-img :src="assets.ledgerSvg" contain width="18"></v-img>
              </v-list-item-avatar>
              <v-list-item-avatar tile size="20" v-if="item.type === WalletType.Keystone">
                <v-img :src="assets.keystoneSvg" contain width="18"></v-img>
              </v-list-item-avatar>
            </v-list-item>
          </v-list-item-group>
        </v-list>
        <div v-else>
          {{ $t('wallet.noCardanoMainnetWallets') }}
        </div>
      </v-card-text>
    </v-card>
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, toRefs } from 'vue';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import assets from '@/utils/assets';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';


const { t } = useTranslation();

const { wallets } = toRefs(geroStore);
const { config } = toRefs(walletStore);

const selectedWallet = ref({});
const controller = ref<any>(null);
const tabId = ref<number>();

const useSidePanel = computed(() => {
  return config.value?.useSidePanel || true;
});

const availableWallets = computed(() => {
  return wallets.value.filter(wallet => wallet.chain === Blockchain.CARDANO && wallet.network === Network.MAINNET);
});

const submitLogin = async (wallet: string) => {
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.LOGIN,
    data: { wallet },
  }).then(async () => {
    await controller.value.returnData({ data: 'login', error: undefined });
    window.close();
  });
};

const resolveIcon = (icon: string) => {
  if (icon) {
    return assets.resolveIcon(icon);
  }
  return '';
};

const resolveNetworkIcon = (item: any) => {
  const network = networks.resolveNetwork(item.chain, item.network);
  if (network) {
    return network.icon;
  }
  return '';
};

onMounted(() => {
  if (useSidePanel.value) {
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get("tabId"));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
  } else {
    controller.value = Messaging.createInternalController();
  }
});
</script>
<style scoped>

</style>
