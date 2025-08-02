<template>
  <v-card class="transparent-override" flat style="max-width: 400px; margin: auto; box-shadow: unset!important;">
    <v-card-title class="justify-center" style="color: white; font-size: 32px;">
      {{ $t('welcome') }}
    </v-card-title>
    <v-card-subtitle class="text-center" style="font-size: 20px">
      {{ $t('chooseAWallet') }}
    </v-card-subtitle>
    <v-card-text class="px-2 pa-0 mt-4" style="max-height: 177px; overflow-y: auto">
      <v-list nav dense class="pa-0" style="background-color: transparent; backdrop-filter: blur(4px); min-height: 51px;">
        <v-list-item-group v-model="selectedWallet" color="primary">
          <v-list-item style="background-color: #13161b" v-for="(item, i) in availableWallets" :key="i" @click="submitLogin(item.id)">
            <v-list-item-icon style="height: 40px" class="mr-4">
              <v-badge
                overlap
                avatar
                bottom
                bordered
                offset-y="20"
              >
                <template v-slot:badge>
                  <v-avatar>
                    <v-img :src="resolveNetworkIcon(item)"></v-img>
                  </v-avatar>
                </template>
                <v-avatar size="40">
                  <v-img :src="assets.resolveIcon(item.icon)"></v-img>
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
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import assets from '@/utils/assets';
import { WalletType } from '@/models/types';
import { computed, ref, toRefs, getCurrentInstance } from 'vue';
import networks from '@/utils/networks';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { geroStore } from '@/stores/geroStore';
import loading from '@/stores/loading';
import WalletStore from '@/stores/walletStore';

const selectedWallet = ref<string | null>(null);

type WalletTypeValue = typeof WalletType[keyof typeof WalletType];

interface Wallet {
  id: string;
  name: string;
  chain: string;
  network: string;
  icon?: string;
  type?: WalletTypeValue;
}

const { wallets } = toRefs(geroStore);

const availableWallets = computed<Wallet[]>(() => {
  return (Object.values(wallets.value) as Wallet[])
    .filter((wallet: Wallet) => {
      return networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet.type != WalletType.Google;
    });
});

const resolveNetworkIcon = (item: Wallet): string => {
  const network = networks.resolveNetwork(item.chain, item.network);
  if (network) {
    return network.icon;
  }
  return '';
};

const vmProxy = getCurrentInstance()!.proxy as any

const submitLogin = async (walletId: string): Promise<void> => {
  try {
    const wallet = (Object.values(wallets.value) as Wallet[]).filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network)).find((wal: Wallet) => wal.id === walletId);

    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    // Wait for storage synchronization to complete before navigation
    // Poll for loggedWallet to be set (indicating login is complete)
    const maxWaitTime = 5000; // 5 seconds max wait
    const pollInterval = 50; // 50ms intervals
    const startTime = Date.now();
    
    while (!WalletStore.state.loggedWallet && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    if (!WalletStore.state.loggedWallet) {
      console.error('❌ Login failed: Wallet not found in store after timeout');
      return;
    }
    
    console.debug('✅ Login synchronized, wallet logged in:', !!WalletStore.state.loggedWallet);

    const queryParams = vmProxy.$route.query;
    console.debug('🧭 Starting navigation, current route:', vmProxy.$route.path);
    console.debug('🧭 Query params:', queryParams);

    if (queryParams['redirect']) {
      const redirectPath = decodeURIComponent(queryParams['redirect'].toString());
      console.debug('🧭 Navigating to redirect path:', redirectPath);
      await vmProxy.$router.push(redirectPath);
    } else {
      console.debug('🧭 Navigating to home page: /');
      await vmProxy.$router.push("/");
    }

    console.debug('🧭 Navigation completed, new route:', vmProxy.$route.path);
  } catch (error) {
    console.error(error);
  }
};
</script>
<style scoped>

</style>
