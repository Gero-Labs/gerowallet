<template>
  <div class="welcome-root">
    <!-- Full-width crisp background image -->
    <div class="welcome-background">
      <img :src="welcomeBg" class="welcome-background-image" />
    </div>
    
    <!-- Main container -->
    <div class="welcome-container">
      <!-- Left column - Liquid glass panel -->
      <div class="welcome-left-column">
        <div class="welcome-glass-panel">
          <div class="welcome-content">
            <div class="logo-container">
              <div
                class="logo"
                :style="{
                  backgroundImage: `url(${logo})`,
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                  width: '122px',
                  height: '138px',
                }" 
              />
            </div>
            
            <div class="text-container">
              <div class="subtitle">Your New</div>
              <div class="title">
                <span class="title-regular">Single Pane of</span>
                <span :class="['title-gradient', gradientClass]">&nbsp;Glass</span>
              </div>
              <NetworkSelector @network-changed="onNetworkChanged" />
              
              <v-btn
                block
                :class="['create-btn', isApex ? 'apexButton transition' : 'geroButton transition']"
                large
                @click="enableCreateOrImportSeedPhrase"
              >
                Create or Import Seed Phrase
              </v-btn>
              
              <v-btn
                block
                outlined
                class="google-btn"
                large
                @click="googleLogin"
                :loading="loadingGoogleLogin"
                :disabled="!selectedNetwork?.zkFoldSupport"
              >
                <v-avatar size="24" class="mr-2">
                  <v-img :src="assets.google" />
                </v-avatar>
                Google Sign In
                <v-chip color="primary" outlined x-small class="px-1 ml-2" v-if="!selectedNetwork?.zkFoldSupport">Soon</v-chip>
              </v-btn>
              
              <div class="zkfold-credit">
                <span>Powered by</span>
                <v-img :src="assets.zkFold" contain class="zkfold-logo"></v-img>
              </div>
            </div>
          </div>
          
          <div class="footer-left">
            &#169; 2025 A.D. Labs
          </div>
        </div>
      </div>
      
      <!-- Right column - Clean background, no glass effects -->
      <div class="welcome-right-column">
        <div class="right-content">
          <!-- No wallets state -->
          <div v-if="!createOrImportSeedPhrase && Array.isArray(availableWallets) && availableWallets.length == 0" class="right-panel">
            <NoWalletsWelcomeCard />
          </div>
          
          <!-- Create/Import state -->
          <div v-else-if="createOrImportSeedPhrase" class="right-panel">
            <CreateOrImportSeedPhrase @back="disableCreateOrImportSeedPhrase" :network="selectedNetwork" />
          </div>
          
          <!-- Wallets list -->
          <div v-else class="right-panel">
            <WalletsListLogin />
          </div>
          
          <!-- Footer -->
          <div class="footer-right">
            <v-btn text :ripple="false" class="footer-btn" @click="privacyPolicyDialog = true">
              {{ $t('privacyPolicy') }}
            </v-btn>
            <v-divider vertical></v-divider>
            <v-btn 
              text 
              :ripple="false" 
              class="footer-btn"
              href="https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true"
              target="_blank"
            >
              {{ $t('termsOfService') }}
            </v-btn>
            <v-divider vertical></v-divider>
            <v-btn text :ripple="false" class="footer-btn" @click="changeLogDialog = true">
              Change Log ({{ `v${version}` }})
            </v-btn>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Dialogs -->
    <PrivacyPolicyDialog :isOpen="privacyPolicyDialog" @close="privacyPolicyDialog = false" :persistent="false" />
    <ChangeLogDialog :isOpen="changeLogDialog" @close="changeLogDialog = false" :persistent="false" />
    <CreateGoogleWallet
      :isOpen="newGoogleWalletDialog"
      @close="newGoogleWalletDialog = false"
      :persistent="false"
      :google-account="profile"
      :tokens="{ accessToken, idToken}"
      :network="selectedNetwork"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, getCurrentInstance, toRefs } from 'vue';
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
import { geroStore } from '@/stores/geroStore';

const privacyPolicyDialog = ref(false);
const changeLogDialog = ref(false);
const newGoogleWalletDialog = ref(false);
const createOrImportSeedPhrase = ref<boolean>(false);
const selectedNetwork = ref<any>(null);

const { wallets } = toRefs(geroStore);

const onNetworkChanged = (network: any) => {
  selectedNetwork.value = network;
};

const enableCreateOrImportSeedPhrase = (): void => {
  createOrImportSeedPhrase.value = true;
}

const disableCreateOrImportSeedPhrase = (): void => {
  createOrImportSeedPhrase.value = false;
}

//@ts-ignore
const version = ref<string>(APP_VERSION);

const availableWallets = computed(() => {
  return Object.values(wallets.value)?.filter((wallet: any) => networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet?.type !== WalletType.Google);
});

const geroLogoApex = assets.geroDashboardApex;
const geroLogo = assets.geroDashboard;
const isApex = ref(false);

const logo = computed(() => {
  if (selectedNetwork.value?.blockchain?.includes('Apex')) {
    isApex.value = true;
    return geroLogoApex;
  }
  isApex.value = false;
  return geroLogo;
});

const welcomeBg = computed(() => {
  if (selectedNetwork.value?.blockchain?.includes('Apex')) {
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
    console.log('submitLogin', walletId);
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

<style scoped>
.welcome-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.welcome-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.welcome-background-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: none;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
  transform: translateY(20%);
}

.welcome-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  gap: 60px;
  z-index: 1;
  max-width: 1440px;
  margin: 0 auto;
}

/* LEFT COLUMN - LIQUID GLASS */
.welcome-left-column {
  width: 38%; /* Reduced from 41.666667% */
  height: 100%;
  position: relative;
}

.welcome-glass-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  
  /* Liquid glass effect */
  background: 
    linear-gradient(135deg, rgba(19, 22, 27, 0.6) 0%, rgba(19, 22, 27, 0.5) 100%),
    radial-gradient(circle at 20% 50%, rgba(45, 240, 247, 0.04) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.03) 0%, transparent 50%);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  
  border-right: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset -1px 0 0 rgba(45, 240, 247, 0.08),
    4px 0 24px rgba(0, 0, 0, 0.4);
}

.welcome-glass-panel::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  z-index: 1;
}

.welcome-glass-panel::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: 
    radial-gradient(600px circle at 50% 0%, rgba(45, 240, 247, 0.05), transparent 50%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

.welcome-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  position: relative;
  z-index: 2;
}

.logo-container {
  margin-bottom: 40px;
}

.logo {
  transition: all 0.3s ease;
}

.text-container {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.subtitle {
  font-size: 16px;
  font-weight: 300;
  margin-bottom: 4px;
}

.title {
  font-size: 36px !important;
  white-space: nowrap;
  margin-bottom: 20px;
  line-height: 1 !important;
}

.title-regular {
  font-weight: 400 !important;
  font-size: 36px !important;
  line-height: 1 !important;
  letter-spacing: 1.32px;
}

.title-gradient {
  font-weight: 700 !important;
  font-size: 36px !important;
  line-height: 1 !important;
  letter-spacing: 1.32px;
}

.description {
  color: #94979c;
  font-size: 16px;
  white-space: nowrap;
  margin-bottom: 20px;
}

.create-btn {
  margin-top: 12px;
  letter-spacing: normal;
  border-radius: 8px;
  text-transform: none;
}

.google-btn {
  margin-top: 16px;
  background-color: black;
  text-transform: none;
  border-color: #373A41;
  color: white;
  letter-spacing: normal;
  border-radius: 8px;
  opacity: 0.7;
}

.zkfold-credit {
  width: 100%;
  font-size: 10px;
  font-weight: 300;
  margin-top: 3px;
  color: #5B5B5B;
  display: flex;
  align-items: center;
}

.zkfold-logo {
  height: 14px;
  width: 43px;
  margin-left: 2px;
  max-width: 43px;
}

.footer-left {
  padding: 12px 20px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  position: relative;
  z-index: 2;
}

/* RIGHT COLUMN - CLEAN BACKGROUND */
.welcome-right-column {
  width: 62%; /* Increased from 58.333333% to account for left column reduction */
  height: 100%;
  position: relative;
  /* NO backdrop-filter or blur effects here */
  background: transparent;
}

.right-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.right-panel {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 80px 20px 20px 20px;
}

.footer-right {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  padding: 0 20px;
}

.footer-btn {
  text-transform: none;
  font-size: 10px;
}

/* Fallback for browsers without backdrop-filter support */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .welcome-glass-panel {
    background-color: rgba(19, 22, 27, 0.95);
  }
}

/* Responsive */
@media (max-width: 768px) {
  .welcome-container {
    flex-direction: column;
  }
  
  .welcome-left-column {
    width: 100%;
    height: auto;
    min-height: 300px;
  }
  
  .welcome-right-column {
    width: 100%;
    height: auto;
    flex: 1;
  }
}
</style>