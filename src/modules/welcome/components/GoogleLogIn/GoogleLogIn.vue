<template>
  <div class="google-btn-container">
    <GButton
      tier="secondary"
      block
      class="google-btn"
      @click="googleLogin"
      :loading="loadingGoogleLogin"
      :disabled="!props.selectedNetwork?.zkSmartWalletSupport"
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
        v-if="!props.selectedNetwork?.zkSmartWalletSupport"
      >Soon</v-chip>
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
<script setup lang="ts">
import { ref, getCurrentInstance, toRefs } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import CreateGoogleWallet from '@/options/modules/welcome/dialogs/CreateGoogleWallet.vue';
import { google } from '@/utils/assets';
import GButton from '@/shared/components/GButton/GButton.vue';
import { getGoogleWalletWithEmail } from '@/db/gero-db';
import networks from '@/utils/networks';
import { geroStore } from '@/stores/geroStore';
import { Wallet } from '@/models/types';

const props = defineProps<{
  selectedNetwork: any;
}>();

const { wallets } = toRefs(geroStore);

const loadingGoogleLogin = ref(false);
const googleLoginError = ref('');
const accessToken = ref('');
const idToken = ref('');
const profile = ref({});
const newGoogleWalletDialog = ref(false);

const googleLogin = async () => {
  try {
    loadingGoogleLogin.value = true;
    const resp = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: {},
    });
    if (!resp || !resp['data'] || !resp['data']['success']) {
      throw new Error(resp['error'] || 'Unknown error');
    }

    accessToken.value = resp['data']['tokens']['accessToken'];
    idToken.value = resp['data']['tokens']['idToken'];
    console.log('accessToken', accessToken.value);
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken.value}` },
    });
    console.log('profileResp', profileResp);
    if (!profileResp.ok) {
      throw new Error('Failed to fetch Google profile');
    }
    profile.value = await profileResp.json();
    if (!profile.value['email_verified']) {
      throw new Error('Google profile email is not verified');
    }
    const googleWallet = await getGoogleWalletWithEmail(profile.value['email']);
    console.log('googleWallet', googleWallet);
    if (!googleWallet) {
      newGoogleWalletDialog.value = true;
    } else {
      console.log('googleWallet', googleWallet);
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
    console.log('submitLogin', walletId);
    const wallet = (Object.values(wallets.value) as Wallet[]).filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network)).find((wal: Wallet) => wal.id === walletId);
    if (!wallet) {
      newGoogleWalletDialog.value = true;
    } else {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      });
      console.log('submitLogin response', response);
    }
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
</script>
<style scoped>
.google-btn-container{
  width: 100%;
}
/* Surface, border, radius, case and tracking come from GButton's secondary
   tier; only the layout and the deliberate de-emphasis stay local. */
.google-btn {
  margin-top: var(--g-s-4);
  opacity: 0.7;
}
</style>
