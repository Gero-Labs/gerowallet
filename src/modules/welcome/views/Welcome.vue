<template>
  <v-container class="pa-0" :style="{direction: $t('rtl') === 'true' ? 'rtl' : 'ltr', height: '100vh'}">
    <v-card variant="flat" class="transparent-override pa-0 fill-height">
      <v-card-text class="pa-0 fill-height">
        <v-row class="fill-height" no-gutters>
          <v-col cols="12" lg="5" md="5" sm="5">
            <div style="background-color: #13161B; width: 100%; height: 100%; align-content: center; justify-items: center; display: flex; flex-direction: column;" >
              <div class="fill-height" style="flex-flow: column; display: flex; align-items: center; justify-content: center;">
                <div
                  class="transition"
                  :style="{
                    backgroundImage: `url(${logo}`,
                    backgroundSize: 'contain',
                    backgroundRepeat: 'no-repeat',
                    width: '106px',
                    height: '120px',
                }" />
                <div class="mt-10" style="width: 100%; max-width: 360px; position: relative; flex-direction: column; justify-content: center; align-items: center; display: flex">
                  <div style="width: 100%; justify-content: left; display: flex; flex-direction: column; font-size: 12px; font-weight: 300;">Your New </div>
                  <div style="width: 100%; justify-content: left; display: flex; font-size: 31px; white-space: nowrap;">
                    <span style="font-weight: 400; line-height: 34px; letter-spacing: 1.32px;">Single Pane of</span>
                    <span :class="['transition', gradientClass]" :style="{
                    fontWeight: '700',
                    lineHeight: '34px',
                    letterSpacing: '1.32px',
                    }">&nbsp;Glass</span>
                  </div>
                  <span class="my-5" style="color: #94979c; font-size: 16px; white-space: nowrap;">Choose an option to get started</span>
                  <NetworkSelector />
                  <v-btn
                    block
                    :class="['mt-3', isApex ? 'apexButton transition' : 'geroButton transition']"
                    large
                    :style="{
                      letterSpacing: 'normal',
                      borderRadius: '8px'
                    }"
                    @click="enableCreateOrImportSeedPhrase"
                  >
                  Create or Import Seed Phrase
                  </v-btn>
                  <v-btn
                    block
                    outlined
                    class="mt-4"
                    large
                    style="background-color: black; text-transform: none; border-color: #373A41; color: white; letter-spacing: normal; border-radius: 8px"
                    base-color="white"
                    @click="googleLogin"
                    :loading="loadingGoogleLogin"
                    :disabled="!network?.zkFoldSupport"
                  >
                    <v-avatar size="24" class="mr-2">
                      <v-img :src="assets.google" />
                    </v-avatar>
                    Google Sign In
                    <v-chip color="primary" outlined x-small class="px-1 ml-2" v-if="!network?.zkFoldSupport">Soon</v-chip>
                  </v-btn>
                  <div style="width: 100%; justify-content: left; display: flex; font-size: 10px; font-weight: 300; margin-top: 3px">
                    <span style="color: #5B5B5B">Powered by</span>
                    <v-img :src="assets.zkFold" contain style="height: 14px; width: 43px; margin-left: 2px; max-width: 43px; align-self: center;"></v-img>
                  </div>
                </div>
              </div>
              <v-footer
                class="py-0"
                height="38"
                style="max-height: 38px; font-size: 10px;"
                color="transparent"
              >
                &#169; 2025 A.D. Labs
              </v-footer>
            </div>
          </v-col>
          <v-col cols="12" lg="7" md="7" sm="7">
            <div style="position: relative; width: 100%; height: 100%;">
              <div class="transition" :style="{
                width: '100%',
                height: '100%',
                position: 'absolute',
                borderRadius: '20px',
                backgroundImage: `url(${welcomeBg})`,
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                display: 'inline-flex',
                backgroundSize: 'cover',
                backgroundPositionX: 'center',
                backgroundPositionY: '295px',
                zIndex: 0,
              }" />
              <div style="display: flex;" v-if="!createOrImportSeedPhrase && Array.isArray(availableWallets) && availableWallets.length == 0" class="fill-height">
                <NoWalletsWelcomeCard />
              </div>
              <div style="display: flex;" v-else-if="createOrImportSeedPhrase" class="fill-height">
                <CreateOrImportSeedPhrase @back="disableCreateOrImportSeedPhrase" />
              </div>
              <div style="display: flex;" v-else class="fill-height">
                <WalletsListLogin />
              </div>
              <v-footer
                absolute
                class="py-0 px-0"
                height="38"
                style="height: 38px; max-height: 38px;"
                color="transparent"
              >
                <v-container class="pa-0 fill-height d-flex justify-center" style="max-width: 1440px">
                  <v-btn
                    text
                    :ripple="false"
                    style="text-transform: none; font-size: 10px"
                    @click="privacyPolicyDialog = true"
                  >
                    {{ $t('privacyPolicy') }}
                  </v-btn>
                  <v-divider vertical></v-divider>
                  <v-btn
                    text
                    :ripple="false"
                    style="text-transform: none; font-size: 10px"
                    href="https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true"
                    target="_blank"
                  >
                    {{ $t('termsOfService') }}
                  </v-btn>
                  <v-divider vertical></v-divider>
                  <v-btn
                    text
                    :ripple="false"
                    style="text-transform: none; font-size: 10px"
                    @click="changeLogDialog = true"
                  >
                    Change Log ({{ `v${version}` }})
                  </v-btn>
                  <PrivacyPolicyDialog :isOpen="privacyPolicyDialog" @close="privacyPolicyDialog = false" :persistent="false" />
                  <ChangeLogDialog :isOpen="changeLogDialog" @close="changeLogDialog = false" :persistent="false" />
                </v-container>
              </v-footer>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
      <CreateGoogleWallet :isOpen="newGoogleWalletDialog" @close="newGoogleWalletDialog = false" :persistent="false" :google-account="profile" :tokens="{ accessToken, idToken}" />
    </v-card>
  </v-container>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from '@/stores';
import { storeToRefs } from 'pinia';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import PrivacyPolicyDialog from '@/options/modules/navigation/dialogs/PrivacyPolicyDialog.vue';
import ChangeLogDialog from '@/options/modules/navigation/dialogs/ChangeLogDialog.vue';
import { MessageTypes } from '@/models/MessageTypes';
import NoWalletsWelcomeCard from '@/options/modules/welcome/components/NoWalletsWelcomeCard.vue';
import { WalletType } from '@/models/types';
import WalletsListLogin from '@/options/modules/welcome/components/WalletsListLogin.vue';
import CreateOrImportSeedPhrase from '@/options/modules/welcome/components/CreateOrImportSeedPhrase.vue';
import NetworkSelector from '@/options/modules/navigation/components/NetworkSelector.vue';
import CreateGoogleWallet from '@/options/modules/welcome/dialogs/CreateGoogleWallet.vue';
import { Messaging } from '@/chrome/messaging';
import db from '@/db';

const privacyPolicyDialog = ref(false);
const changeLogDialog = ref(false);
const newGoogleWalletDialog = ref(false);

const store = useStore();
const { wallets, network } = storeToRefs(store);
const createOrImportSeedPhrase = ref<boolean>(false);

const enableCreateOrImportSeedPhrase = (): void => {
  createOrImportSeedPhrase.value = true;
}
const disableCreateOrImportSeedPhrase = (): void => {
  createOrImportSeedPhrase.value = false;
}

type WalletTypeValue = typeof WalletType[keyof typeof WalletType];

interface Wallet {
  id: string;
  name: string;
  chain: string;
  network: string;
  icon?: string;
  type?: WalletTypeValue;
}

//@ts-ignore
const version = ref<string>(APP_VERSION);

const availableWallets = computed<Wallet[]>(() => {
  return wallets.value.filter((wallet: Wallet) => networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet?.type !== WalletType.Google);
});

const geroLogoApex = assets.geroDashboardApex;
const geroLogo = assets.geroDashboard;
const isApex = ref(false);

const logo = computed(() => {
  if (network.value?.blockchain?.includes('Apex')) {
    isApex.value = true;
    return geroLogoApex;
  }
  isApex.value = false;
  return geroLogo;
});

const welcomeBg = computed(() => {
  if (network.value?.blockchain?.includes('Apex')) {
    return assets.apexBg;
  }
  return assets.cardanoBg;
})

const loadingGoogleLogin = ref(false);
const googleLoginError = ref('');
const accessToken = ref('');
const idToken = ref('');
const profile = ref({});

const vmProxy = getCurrentInstance()!.proxy as any

const submitLogin = async (walletId: string): Promise<void> => {
  try {
    await store.setLogin(Number(walletId));
  } catch (error) {
    console.error(error);
  }
  const queryParams = vmProxy.$route.query;
  if (queryParams['redirect']) {
    await vmProxy.$router.push(decodeURIComponent(queryParams['redirect'].toString()));
  } else {
    await vmProxy.$router.push("/");
  }
};

const googleLogin = async () => {
  try {
    loadingGoogleLogin.value = true;
    const resp = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_WITH_GOOGLE,
      data: { },
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
}
const gradientClass = computed(() =>
  isApex.value ? 'apex-gradient-text' : 'gradient-text'
);
</script>
<style>

.transparent-override.v-card {
  background: transparent !important;
}

.custom-bg.v-card {
  background-color: rgba(255, 255, 255, 0.1) !important;
}

:root {
  /* height of one pair (two spans) */
  --pair-height: 58px;
  /* total items to cycle through (excluding duplicate) */
  --count: 4;
  /* pause before each slide */
  --pause: 800ms;
  /* slide duration */
  --slide: 600ms;
  /* total cycle = (pause + slide) * count */
  --cycle: calc((var(--pause) + var(--slide)) * var(--count));
  /* back-easing curve */
  --easing-back: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.stats-viewport {
  width: 100%;
  height: var(--pair-height);
  overflow: hidden;
  position: relative;
  background: rgba(12,14,18,0.5);
  border-radius: 12px;
  outline: 2px solid rgba(255,255,255,0.1);
  backdrop-filter: blur(8px);
}

.stats-list {
  /* animate the whole stack */
  animation: scroll var(--cycle) infinite;
  animation-timing-function: var(--easing-back);
}

.span-pair {
  display: flex;
  flex-flow: column;
  justify-content: space-between;
  height: var(--pair-height);
  padding: 0 0 9px 16px;
  box-sizing: border-box;
  justify-self: left;
}

/* keyframes:
   - show for var(--pause)
   - slide up over var(--slide)
   - repeat for each of the 4 items */
@keyframes scroll {
  /* 1) item 1 static */
  0%                              { transform: translateY(0); }
  /* pause 800ms → 800/5600 = 14.2857% */
  14.2857%                        { transform: translateY(0); }

  /* 2) slide to item 2 over 600ms → next 10.7143% */
  25%                             { transform: translateY(calc(-1 * var(--pair-height))); }

  /* 3) item 2 static */
  39.2857%                        { transform: translateY(calc(-1 * var(--pair-height))); }

  /* 4) slide to item 3 */
  50%                             { transform: translateY(calc(-2 * var(--pair-height))); }

  /* 5) item 3 static */
  64.2857%                        { transform: translateY(calc(-2 * var(--pair-height))); }

  /* 6) slide to item 4 */
  75%                             { transform: translateY(calc(-3 * var(--pair-height))); }

  /* 7) item 4 static */
  89.2857%                        { transform: translateY(calc(-3 * var(--pair-height))); }

  /* 8) slide to duplicated item 1 */
  100%                            { transform: translateY(calc(-4 * var(--pair-height))); }
}

/* typography */
.label {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}
.value {
  font-size: 32px;
  font-weight: 700;
  line-height: 24px;
}

.v-badge__badge {
  padding: 0 !important;
}

</style>
