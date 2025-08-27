<script setup lang="ts">
import { ref, getCurrentInstance, computed, toRefs } from 'vue';
import db from '@/db';
import CreateGoogleWallet from '@/options/modules/welcome/dialogs/CreateGoogleWallet.vue';
import { google } from '@/utils/assets';
import GButton from '@/shared/components/GButton/GButton.vue';
import ZkFold from '@/shared/utils/zkFold';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import networks from '@/utils/networks';

type WalletTypeValue = typeof WalletType[keyof typeof WalletType];

interface Wallet {
  id: string;
  name: string;
  chain: string;
  network: string;
  icon?: string;
  type?: WalletTypeValue;
}

const props = defineProps<{
  selectedNetwork: any;
}>();

const { loggedWallet } = toRefs(walletStore);
const { wallets } = toRefs(geroStore);

const loadingGoogleLogin = ref(false);
const googleLoginError = ref('');
const newGoogleWalletDialog = ref(false);
const zkFold = new ZkFold();

const googleLogin = async () => {
  try {
    loadingGoogleLogin.value = true;
    await zkFold.initConnection();
    await zkFold.fetchProfile();

    const googleWallet = await db.getGoogleWalletWithEmail(zkFold.profile.value['email']);
    if (!googleWallet) {
      newGoogleWalletDialog.value = true;
    } else {
      await submitLogin(googleWallet.id);
    }
  } catch (err: any) {
    console.error(err);
    googleLoginError.value = err.message || 'Login failed';
  } finally {
    loadingGoogleLogin.value = false;
  }
};

const vmProxy = getCurrentInstance()!.proxy as any;

const submitLogin = async (walletId: string): Promise<void> => {
  try {
    const wallet = (Object.values(wallets.value) as Wallet[]).filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network)).find((wal: Wallet) => wal.id === walletId);

    await zkFold.login(wallet);

    // Wait for storage synchronization to complete before navigation
    // Poll for loggedWallet to be set (indicating login is complete)
    const maxWaitTime = 5000; // 5 seconds max wait
    const pollInterval = 50; // 50ms intervals
    const startTime = Date.now();

    while (!loggedWallet.value && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    if (!loggedWallet.value) {
      console.error('❌ Login failed: Wallet not found in store after timeout');
      return;
    }

    console.debug('✅ Login synchronized, wallet logged in:', !!loggedWallet.value);
  } catch (error) {
    console.error(error);
  }
  const queryParams = vmProxy.$route.query;
  if (queryParams['redirect']) {
    await vmProxy.$router.push(decodeURIComponent(queryParams['redirect'].toString()));
  } else {
    await vmProxy.$router.push('/');
  }
};

const accessToken = computed(() => zkFold.accessToken.value);
const idToken = computed(() => zkFold.idToken.value);
const profile = computed(() => zkFold.profile.value);

console.log('Selected Network:', props.selectedNetwork);
</script>

<template>
  <div class="google-btn-container">
    <GButton
      block
      outlined
      class="google-btn"
      large
      @click:button="googleLogin"
      :loading="loadingGoogleLogin"
      
    >
      <v-avatar size="24" class="mr-2">
        <v-img :src="google" />
      </v-avatar>
      Google Sign In
      <v-chip 
        color="primary" 
        outlined 
        x-small 
        class="px-1 ml-2" 
        v-if="!props.selectedNetwork?.zkFoldSupport"
        >
        Soon
      </v-chip>
    </GButton>

    <CreateGoogleWallet
      :isOpen="newGoogleWalletDialog"
      @close="newGoogleWalletDialog = false"
      :persistent="false"
      :google-account="profile"
      :tokens="{ accessToken, idToken }"
      :network="props.selectedNetwork"
    />
  </div>
</template>

<style scoped>
.google-btn-container {
  width: 100%;
}
.google-btn {
  margin-top: 16px;
  background-color: black;
  text-transform: none;
  border-color: #373a41;
  color: white;
  letter-spacing: normal;
  border-radius: 8px;
  opacity: 0.7;
}
</style>
