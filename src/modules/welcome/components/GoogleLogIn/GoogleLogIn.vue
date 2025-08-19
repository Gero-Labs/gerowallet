<script setup lang="ts">
import { ref, getCurrentInstance } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import db from '@/db';
import CreateGoogleWallet from '@/options/modules/welcome/dialogs/CreateGoogleWallet.vue';
import { google } from '@/utils/assets';
import GButton from '@/shared/components/GButton/GButton.vue';

const props = defineProps<{
  selectedNetwork: any;
}>();

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

    const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken.value}` },
    });
    if (!profileResp.ok) {
      throw new Error('Failed to fetch Google profile');
    }
    profile.value = await profileResp.json();
    if (!profile.value['email_verified']) {
      throw new Error('Google profile email is not verified');
    }
    const googleWallet = await db.getGoogleWalletWithEmail(profile.value['email']);
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
    console.log('submitLogin', walletId);
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

<template>
  <div class="google-btn-container">

    <GButton
      block
      outlined
      class="google-btn"
      large
      @click="googleLogin"
      :loading="loadingGoogleLogin"
      :disabled="!props.selectedNetwork?.zkFoldSupport"
    >
      <v-avatar size="24" class="mr-2">
        <v-img :src="google" />
      </v-avatar>
      Google Sign In
      <v-chip color="primary" outlined x-small class="px-1 ml-2" v-if="!props.selectedNetwork?.zkFoldSupport">Soon</v-chip>
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
.google-btn-container{
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
