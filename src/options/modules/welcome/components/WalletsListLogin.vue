<template>
  <v-card class="transparent-override" flat style="max-width: 400px; margin: auto">
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
  return Object.values(wallets.value).filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet.type != WalletType.Google);
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
    const wallet = Object.values(wallets.value).filter(wallet => networks.resolveNetwork(wallet?.chain, wallet?.network)).find(wal => wal.id === walletId);

    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });
    const queryParams = vmProxy.$route.query;
    if (queryParams['redirect']) {
      await vmProxy.$router.push(decodeURIComponent(queryParams['redirect'].toString()));
    } else {
      await vmProxy.$router.push("/");
    }
  } catch (error) {
    console.error(error);
  }
};
</script>
<style scoped>

</style>
