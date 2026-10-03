<template>
  <div class="gero-wallet">
    <header class="gero-wallet__bar">
      <div class="gero-wallet__brand">
        <span class="t-heading">{{ t('card.geroCard') }}</span>
        <CardChip>{{ t('card.poweredByKaiserex') }}</CardChip>
      </div>
      <div v-if="isSignedIn" class="gero-wallet__identity">
        <template v-if="email">
          <span class="t-caption">{{ t('card.signedInAs') }}</span>
          <span class="t-body-sm gero-wallet__email">{{ email }}</span>
        </template>
        <GButton tier="tertiary" compact @click="handleLogout">{{ t('card.signOut') }}</GButton>
      </div>
    </header>

    <div v-if="showLoadingState" class="gero-wallet__state" role="status">
      <IsoScene name="empty" class="gero-wallet__state-art" />
      <v-progress-circular indeterminate color="primary" size="28" width="2" />
      <p class="t-body">{{ loadingMessage || t('wallet.loadingYourWallet') }}</p>
    </div>

    <div v-else-if="showErrorState" class="gero-wallet__state" role="alert">
      <IsoScene name="attention" class="gero-wallet__state-art" />
      <h1 class="t-title">{{ t('wallet.somethingWentWrong') }}</h1>
      <p class="t-body">{{ error || t('wallet.unexpectedError') }}</p>
      <GButton tier="primary" @click="handleRetry">{{ t('wallet.tryAgain') }}</GButton>
    </div>

    <component
      v-else
      :is="currentComponent"
      @auth-complete="handleAuthComplete"
      @kyc-complete="handleKYCComplete"
      @error="setError"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useWalletStatus } from '@/composables/useWalletStatus';
import { useTranslation } from '@/shared/composables/useTranslation';
import cardStore from '@/stores/modules/card';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from '@/modules/wallet/components/ui/CardChip.vue';
import KaiserexAuthPage from '@/modules/wallet/components/KaiserexAuthPage.vue';
import OrderCardSection from '@/modules/wallet/pages/OrderCardSection.vue';
import PendingSection from '@/modules/wallet/pages/PendingSection.vue';
import HomeSection from '@/modules/wallet/pages/HomeSection.vue';

const { t } = useTranslation();

const {
  currentState,
  error,
  loadingMessage,
  showLoadingState,
  showErrorState,
  initialize,
  handleAuthComplete: onAuthComplete,
  handleKYCComplete: onKYCComplete,
  setError,
  clearError,
} = useWalletStatus();

const WALLET_COMPONENTS = {
  auth: KaiserexAuthPage, // signed out (or the application was rejected)
  new: OrderCardSection, // verify identity
  pending: PendingSection, // verification under review
  approved: HomeSection, // card dashboard
} as const;

const currentComponent = computed(
  () => WALLET_COMPONENTS[currentState.value as keyof typeof WALLET_COMPONENTS] || KaiserexAuthPage,
);

const isSignedIn = computed(() => cardStore.isAuthenticated);
const email = computed(() => cardStore.state.userInfo?.email || '');

async function handleAuthComplete(): Promise<void> {
  try {
    await onAuthComplete();
    clearError();
  } catch (failure) {
    console.error('Authentication completion failed:', failure);
    setError(t('card.signInFailed'));
  }
}

async function handleKYCComplete(status = 'pending', data?: unknown): Promise<void> {
  try {
    await onKYCComplete(status, data);
    clearError();
  } catch (failure) {
    console.error('KYC completion failed:', failure);
    setError(t('card.pleaseTryAgain'));
  }
}

async function handleRetry(): Promise<void> {
  clearError();
  try {
    await cardStore.initialize();
  } catch {
    setError(t('card.pleaseTryAgain'));
  }
}

async function handleLogout(): Promise<void> {
  try {
    await cardStore.logout();
  } catch (failure) {
    console.error('Logout failed:', failure);
    setError(t('card.pleaseTryAgain'));
  }
}

onMounted(async () => {
  try {
    await initialize();
  } catch {
    setError(t('card.pleaseTryAgain'));
  }
});
</script>

<style lang="scss" scoped>
.gero-wallet {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  position: relative;
}

.gero-wallet__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3) var(--g-s-4);
  padding: var(--g-s-4) clamp(16px, 3vw, 32px);
  border-bottom: 1px solid var(--g-hairline-1);
}

.gero-wallet__brand,
.gero-wallet__identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
}

.gero-wallet__email {
  color: var(--g-text-1);
}

.gero-wallet__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-4);
  min-height: 400px;
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;

  h1,
  p {
    margin: 0;
    max-width: 420px;
  }
}

.gero-wallet__state-art {
  width: 200px;
}
</style>
