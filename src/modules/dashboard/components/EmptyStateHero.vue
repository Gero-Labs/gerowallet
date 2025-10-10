<template>
  <v-card
    flat
    class="empty-state-hero liquid-glass"
    :style="{
      minHeight: '400px',
      position: 'relative',
      overflow: 'hidden'
    }"
  >

    <!-- Content container -->
    <v-card-text class="hero-content">
      <!-- Welcome message -->
      <div class="welcome-section">
        <h1 class="hero-title">
          {{ isNewUser ? 'Welcome to Gero Wallet!' : 'Your wallet is empty' }}
        </h1>

        <p class="hero-subtitle">
          {{ subtitle }}
        </p>
      </div>

      <!-- Backup reminder/status for empty wallets - Full Width -->
      <div class="backup-section mt-6 backup-container" v-if="shouldBackup || isBackupComplete">
        <v-card class="backup-card liquid-glass-subtle">
          <v-card-text class="pa-4 pb-3">
            <div class="d-flex align-center mb-3">
              <v-icon
                :color="isBackupComplete ? 'success' : primaryColor"
                class="mr-3"
                size="32"
              >
                {{ isBackupComplete ? 'mdi-shield-check-outline' : 'mdi-shield-check' }}
              </v-icon>
              <div>
                <h3 class="backup-title mb-1">
                  {{ isBackupComplete ? 'Wallet Secured' : 'Secure Your Wallet' }}
                </h3>
                <p class="backup-subtitle mb-0">
                  {{ isBackupComplete
                    ? 'Your seed phrase has been safely backed up'
                    : 'Back up your seed phrase to protect your funds'
                  }}
                </p>
              </div>
            </div>

            <!-- Show different content based on backup status -->
            <template v-if="!isBackupComplete">
              <v-alert
                type="error"
                text
                class="mb-3 backup-alert"
              >
                Your 24-word seed phrase is the only way to recover your wallet.
                Store it securely offline.
              </v-alert>

              <div class="text-center">
                <v-btn
                  :color="primaryColor"
                  @click="$emit('backup-wallet')"
                  class="backup-btn"
                >
                  <v-icon left small>mdi-content-save</v-icon>
                  Export Seed Phrase
                </v-btn>
                <p class="mt-1 mb-0 text-caption backup-help-text">
                  Quick and secure • Takes 2 minutes
                </p>
              </div>
            </template>

            <!-- Completed state -->
            <template v-else>
              <v-alert
                type="success"
                text
                class="mb-0 backup-alert"
                :icon="false"
              >
                Great job! Your wallet is protected. Keep your seed phrase safe.
              </v-alert>
            </template>
          </v-card-text>
        </v-card>
      </div>


      <!-- Feature cards with spanning background -->
      <v-row class="mt-8 feature-cards-grid" justify="center">
        <!-- Card 1: Buy Crypto (only for Cardano) -->
        <v-col cols="12" sm="6" md="4" lg="2" v-if="networks.resolveBuySupported(loggedWallet?.chain, loggedWallet?.network)">
          <div class="feature-card-container buy-card-emphasized">
            <div
              class="feature-card-background card-1"
              :style="{
                backgroundImage: `url(${featureBackgroundImage})`,
                backgroundSize: cardBackgroundSize,
                backgroundPosition: '0% center',
                backgroundRepeat: 'no-repeat'
              }"
            ></div>
            <div class="feature-card-glass" @click="$emit('buy-crypto')">
              <!-- Ray of light effect -->
              <div class="light-ray"></div>
              <div class="feature-card-content">
                <div class="feature-card-main">
                  <v-icon size="48" :color="primaryColor" class="mb-3">
                    mdi-credit-card-plus
                  </v-icon>
                  <h3 class="feature-title">Buy {{ currencySymbol }}</h3>
                  <p class="feature-description">Purchase with credit card</p>
                </div>
                <v-chip small :color="primaryColor" text-color="white">
                  Instant
                </v-chip>
              </div>
            </div>
          </div>
        </v-col>

        <!-- Card 2: Receive -->
        <v-col cols="12" sm="6" md="4" lg="2">
          <div class="feature-card-container">
            <div
              class="feature-card-background card-2"
              :style="{
                backgroundImage: `url(${featureBackgroundImage})`,
                backgroundSize: cardBackgroundSize,
                backgroundPosition: isApex ? '0% center' : '20% center',
                backgroundRepeat: 'no-repeat'
              }"
            ></div>
            <div class="feature-card-glass" @click="$emit('show-receive')">
              <div class="feature-card-content">
                <div class="feature-card-main">
                  <v-icon size="48" :color="primaryColor" class="mb-3">
                    mdi-qrcode
                  </v-icon>
                  <h3 class="feature-title">Receive</h3>
                  <p class="feature-description">Share your address</p>
                </div>
                <v-chip
                  v-if="walletAddress"
                  small
                  :color="copiedFeedback ? 'success' : primaryColor"
                  text-color="white"
                  @click.stop="copyToClipboard"
                >
                  <v-icon small left>{{ copiedFeedback ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                  {{ copiedFeedback ? 'Copied!' : 'Copy Address' }}
                </v-chip>
              </div>
            </div>
          </div>
        </v-col>

        <!-- Card 3: Learn -->
<!--        <v-col cols="12" sm="6" md="4" lg="2">-->
<!--          <div class="feature-card-container">-->
<!--            <div-->
<!--              class="feature-card-background card-3"-->
<!--              :style="{-->
<!--                backgroundImage: `url(${featureBackgroundImage})`,-->
<!--                backgroundSize: cardBackgroundSize,-->
<!--                backgroundPosition: isApex ? '33% center' : '40% center',-->
<!--                backgroundRepeat: 'no-repeat'-->
<!--              }"-->
<!--            ></div>-->
<!--            <div class="feature-card-glass" @click="$emit('open-learn')">-->
<!--              <div class="feature-card-content">-->
<!--                <div class="feature-card-main">-->
<!--                  <v-icon size="48" :color="primaryColor" class="mb-3">-->
<!--                    mdi-school-->
<!--                  </v-icon>-->
<!--                  <h3 class="feature-title">Learn</h3>-->
<!--                  <p class="feature-description">Discover {{ blockchain }} ecosystem</p>-->
<!--                </div>-->
<!--                <v-chip small :color="primaryColor" text-color="white">-->
<!--                  Learn-->
<!--                </v-chip>-->
<!--              </div>-->
<!--            </div>-->
<!--          </div>-->
<!--        </v-col>-->

        <!-- Card 4: Gero Card (only for Cardano) -->
        <v-col cols="12" sm="6" md="4" lg="2" v-if="networks.resolveGeroCardSupport(loggedWallet?.chain, loggedWallet?.network)">
          <div class="feature-card-container">
            <div
              class="feature-card-background card-4"
              :style="{
                backgroundImage: `url(${featureBackgroundImage})`,
                backgroundSize: cardBackgroundSize,
                backgroundPosition: '60% center',
                backgroundRepeat: 'no-repeat'
              }"
            />
            <div class="feature-card-glass" @click="navigateToCard">
              <div class="feature-card-content">
                <div class="feature-card-main">
                  <v-icon size="48" :color="primaryColor" class="mb-3">
                    mdi-credit-card
                  </v-icon>
                  <h3 class="feature-title">Gero Card</h3>
                  <p class="feature-description">Top up with ADA</p>
                </div>
                <v-chip small :color="primaryColor" text-color="white">
                  Coming Soon
                </v-chip>
              </div>
            </div>
          </div>
        </v-col>

        <!-- Card 4/5: Staking Rewards -->
        <v-col cols="12" sm="6" md="4" lg="2">
          <div class="feature-card-container">
            <div
              class="feature-card-background card-5"
              :style="{
                backgroundImage: `url(${featureBackgroundImage})`,
                backgroundSize: cardBackgroundSize,
                backgroundPosition: isApex ? '66% center' : '80% center',
                backgroundRepeat: 'no-repeat'
              }"
            />
            <div class="feature-card-glass" @click="navigateToStaking">
              <div class="feature-card-content">
                <div class="feature-card-main">
                  <v-icon size="48" :color="primaryColor" class="mb-3">
                    mdi-cash-clock
                  </v-icon>
                  <h3 class="feature-title">Staking Rewards</h3>
                  <p class="feature-description">Earn rewards by staking</p>
                </div>
                <v-chip small :color="primaryColor" text-color="white">
                  Explore Staking
                </v-chip>
              </div>
            </div>
          </div>
        </v-col>

        <!-- Card 5/6: Cashback (only for Cardano) -->
        <v-col cols="12" sm="6" md="4" lg="2" v-if="!isApex">
          <div class="feature-card-container">
            <div
              class="feature-card-background card-6"
              :style="{
                backgroundImage: `url(${featureBackgroundImage})`,
                backgroundSize: cardBackgroundSize,
                backgroundPosition: '100% center',
                backgroundRepeat: 'no-repeat'
              }"
            ></div>
            <div class="feature-card-glass" @click="navigateToCashback">
              <div class="feature-card-content">
                <div class="feature-card-main">
                  <v-icon size="48" :color="primaryColor" class="mb-3">
                    mdi-cash-refund
                  </v-icon>
                  <h3 class="feature-title">Cashback</h3>
                  <p class="feature-description">Earn cashback online</p>
                </div>
                <v-chip small :color="primaryColor" text-color="white">
                  Browse Deals
                </v-chip>
              </div>
            </div>
          </div>
        </v-col>
      </v-row>

    </v-card-text>

    <!-- Animated background elements -->
    <div class="floating-elements">
      <div
        v-for="i in 5"
        :key="i"
        class="floating-circle"
        :style="{
          width: `${Math.random() * 100 + 50}px`,
          height: `${Math.random() * 100 + 50}px`,
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 5}s`,
          animationDuration: `${15 + Math.random() * 10}s`
        }"
      ></div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { toRefs, ref, getCurrentInstance, computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import assets from '@/utils/assets';
import networks from '@/utils/networks';

const { loggedWallet } = toRefs(walletStore);
const instance = getCurrentInstance();

interface Props {
  isNewUser?: boolean;
  showTutorial?: boolean;
  shouldBackup?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isNewUser: false,
  showTutorial: true
});

const emit = defineEmits([
  'buy-crypto',
  'show-receive',
  'open-learn',
  'start-tutorial',
  'load-sample-data',
  'backup-wallet'
]);

const blockchain = computed(() => loggedWallet.value?.chain || 'Blockchain');

const currencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
         loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

const primaryColor = computed(() => {
  return isApex.value ? '#dc753e' : '#00c7f3';
});

const cardBackgroundSize = computed(() => {
  // For Apex: 3 cards spanning, for Cardano: 6 cards spanning
  return isApex.value ? '300% 100%' : '600% 100%';
});

// Background image for the feature cards spanning effect
const featureBackgroundImage = computed(() => {
  return assets.emptyState;
});

const subtitle = computed(() => {
  if (props.isNewUser) {
    return `Let's get you started with some ${currencySymbol.value} to explore the ${blockchain.value} ecosystem`;
  }
  return `Add ${currencySymbol.value} to start using your wallet and explore all features`;
});

const walletAddress = computed(() => loggedWallet.value?.baseAddress || '');

// Check if wallet backup is complete
const isBackupComplete = computed(() => {
  // Access config directly from reactive store for better reactivity
  const config = walletStore.config;
  return config && 'backup' in config && config.backup === true;
});

// Copy functionality
const copiedFeedback = ref(false);

const copyToClipboard = async () => {
  if (!walletAddress.value) return;

  try {
    await navigator.clipboard.writeText(walletAddress.value);
    copiedFeedback.value = true;

    // Reset feedback after 2 seconds
    setTimeout(() => {
      copiedFeedback.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy address:', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = walletAddress.value;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);

    copiedFeedback.value = true;
    setTimeout(() => {
      copiedFeedback.value = false;
    }, 2000);
  }
};

// Navigation functions
const navigateToCard = () => {
  const router = instance?.proxy?.$router;
  if (router) {
    router.push('/card');
  }
};

const navigateToStaking = () => {
  const router = (instance?.proxy as any)?.$router;
  if (router) {
    router.push('/staking');
  }
};

const navigateToCashback = () => {
  const router = (instance?.proxy as any)?.$router;
  if (router) {
    router.push('/cashback');
  }
};
</script>

<style scoped>
.empty-state-hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hero-content {
  position: relative;
  z-index: 2;
  padding: 48px 24px !important;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
}

.welcome-section {
  text-align: center;
  margin-bottom: 32px;
}

.hero-avatar {
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(20px) !important;
  border: 2px solid rgba(255, 255, 255, 0.2) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
}

.hero-title {
  font-size: 2.5rem !important;
  font-weight: 600 !important;
  color: white !important;
  margin-bottom: 16px !important;
}

.hero-subtitle {
  font-size: 1.125rem !important;
  color: rgba(255, 255, 255, 0.9) !important;
  max-width: 600px;
  margin: 0 auto;
}

.quick-actions-grid {
  max-width: 1000px;
  margin: 0 auto;
}

.action-card {
  cursor: pointer;
  transition: all 0.3s ease !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  min-height: 200px;
  display: flex;
  align-items: center;
}

.action-card:hover {
  transform: translateY(-4px);
  border-color: v-bind(primaryColor) !important;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4) !important;
}


.copy-address-chip {
  backdrop-filter: blur(10px) !important;
  transition: all 0.2s ease !important;
  cursor: pointer !important;
}

.copy-address-chip:hover {
  transform: scale(1.05) !important;
}

.action-title {
  font-size: 1.125rem !important;
  font-weight: 600 !important;
  color: white !important;
  margin-bottom: 8px !important;
}

.action-description {
  font-size: 0.875rem !important;
  color: rgba(255, 255, 255, 0.8) !important;
  line-height: 1.4 !important;
}

.liquid-glass-subtle {
  background-color: rgba(255, 255, 255, 0.05) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
}

.tutorial-card {
  border: 1px solid v-bind(primaryColor) !important;
}

/* Backup section styles - toned down */
.backup-card {
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
}

.backup-container {
  max-width: 50%;
  margin: 0 auto;
}

.backup-title {
  font-size: 1.25rem !important;
  font-weight: 600 !important;
  color: white !important;
}

.backup-subtitle {
  font-size: 0.875rem !important;
  color: rgba(255, 255, 255, 0.8) !important;
  line-height: 1.4 !important;
}

.backup-btn {
  min-width: 180px !important;
  font-weight: 500 !important;
  text-transform: none !important;
}

.backup-alert {
  font-size: 0.875rem !important;
}

.backup-help-text {
  color: rgba(255, 255, 255, 0.6) !important;
  font-size: 0.75rem !important;
}

.sample-data-btn {
  color: rgba(255, 255, 255, 0.6) !important;
  text-transform: none !important;
}

.sample-data-btn:hover {
  color: rgba(255, 255, 255, 0.9) !important;
}

/* Floating animation elements */
.floating-elements {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  z-index: 0;
}

.floating-circle {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%);
  animation: float-up 20s linear infinite;
}

@keyframes float-up {
  0% {
    transform: translateY(100vh) scale(0);
    opacity: 0;
  }
  10% {
    opacity: 0.5;
  }
  90% {
    opacity: 0.5;
  }
  100% {
    transform: translateY(-100vh) scale(1.5);
    opacity: 0;
  }
}

/* Feature cards with spanning background */
.feature-cards-grid {
  max-width: 1200px;
  margin: 0 auto;
}

.feature-card-container {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  height: 220px;
  transition: all 0.3s ease;
}

.feature-card-container:hover {
  transform: translateY(-4px);
}

.feature-card-background {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
  z-index: 1;
}

.feature-card-glass {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border-radius: 12px;
  z-index: 2;
  display: flex;
  flex-direction: column;

  /* Liquid glass effect */
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  isolation: isolate;
}

.feature-card-container:hover .feature-card-glass {
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.25);
}

.feature-card-content {
  position: relative;
  z-index: 2;
  padding: 20px 16px 16px 16px;
  text-align: center;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.feature-card-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-grow: 1;
}

.feature-card-main .v-icon {
  margin-bottom: 12px;
}

.feature-card-main .feature-title {
  margin-top: 8px;
  margin-bottom: 8px;
  height: 24px;
  display: flex;
  align-items: center;
}

.feature-card-main .feature-description {
  flex-grow: 1;
  display: flex;
  align-items: flex-start;
  margin-bottom: 16px;
}

.feature-title {
  font-size: 1rem !important;
  font-weight: 600 !important;
  color: white !important;
  margin-bottom: 8px !important;
}

.feature-description {
  font-size: 0.875rem !important;
  color: rgba(255, 255, 255, 0.8) !important;
  line-height: 1.4 !important;
  margin-bottom: 16px !important;
}

/* Light ray animation for Buy card */
.buy-card-emphasized .light-ray {
  position: absolute;
  top: -50%;
  left: -150%;
  width: 150%;
  height: 200%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0) 40%,
    rgba(255, 255, 255, 0.3) 50%,
    rgba(255, 255, 255, 0) 60%,
    transparent 100%
  );
  transform: rotate(25deg);
  animation: light-sweep 8s ease-in-out infinite;
  z-index: 3;
  pointer-events: none;
}

@keyframes light-sweep {
  0% {
    left: -150%;
  }
  15% {
    left: 150%;
  }
  100% {
    left: 150%;
  }
}

/* Enhance the buy card on hover */
.buy-card-emphasized:hover {
  transform: translateY(-6px);
  transition: all 0.3s ease;
}

.buy-card-emphasized .feature-card-glass {
  border-color: rgba(255, 255, 255, 0.25);
  box-shadow: 0 8px 32px rgba(0, 199, 243, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.buy-card-emphasized:hover .feature-card-glass {
  box-shadow: 0 12px 40px rgba(0, 199, 243, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.35);
}

/* Responsive adjustments */
@media (max-width: 960px) {
  .hero-title {
    font-size: 2rem !important;
  }

  .hero-content {
    padding: 32px 16px !important;
  }

  .action-card {
    min-height: 180px;
  }

  .feature-card-wrapper {
    min-height: 180px;
  }
}
</style>
