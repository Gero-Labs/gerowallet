<template>
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

      <div class="welcome-heading">
        <div class="welcome-title">{{ $t('welcome.welcomeMessage') }}</div>
        <div class="welcome-subtitle">{{ $t('welcome.chooseAWallet') }}</div>
      </div>

      <WalletsListLogin :hide-header="true" class="wallet-list-block" @network-change="onNetworkChange" />
    </div>

    <div class="footer-left">&#169; {{ new Date().getFullYear() }} {{ $t('welcome.adLabs') }}</div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { geroDashboardApex, geroDashboardPrime, geroDashboardVector, geroDashboardBitcoin, geroDashboard } from '@/utils/assets';
import WalletsListLogin from '@/options/modules/welcome/components/WalletsListLogin.vue';
import { NetworkInfo } from '@/utils/networks';

const props = defineProps<{
  selectedNetwork: NetworkInfo;
}>();

const emit = defineEmits<{
  (e: 'network-change', n: NetworkInfo): void;
}>();

const onNetworkChange = (n: NetworkInfo): void => {
  emit('network-change', n);
};

// Logo reacts to the selected network's brand colors.
const logo = computed(() => {
  const bc = props.selectedNetwork?.blockchain;
  if (bc === 'Apex Fusion Prime') return geroDashboardPrime;
  if (bc === 'Apex Fusion Vector') return geroDashboardVector;
  if (bc?.includes('Apex')) return geroDashboardApex;
  if (bc?.includes('Bitcoin')) return geroDashboardBitcoin;
  return geroDashboard;
});
</script>
<style scoped>
.welcome-left-column {
  width: 38%;
  height: 100%;
  position: relative;
}

.welcome-glass-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border-right: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset -1px 0 0 rgba(45, 240, 247, 0.08),
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
  background: radial-gradient(600px circle at 50% 0%, rgba(45, 240, 247, 0.05), transparent 50%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

.welcome-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start; /* logo, heading, list stack from the top */
  padding: 18px;
  position: relative;
  z-index: 2;
  max-width: 428px;
}

.logo-container {
  margin-top: 56px; /* bring the logo down from the top edge */
  margin-bottom: 16px;
}

.welcome-heading {
  text-align: center;
  margin-bottom: 20px;
}

.welcome-title {
  font-size: 30px;
  font-weight: 700;
  color: #fff;
  line-height: 1.2;
}

.welcome-subtitle {
  font-size: 17px;
  color: #94979c;
  margin-top: 4px;
}

.wallet-list-block {
  width: 100%;
}

.logo-container .logo {
  transition: all 0.3s ease;
}

.text-container {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 10px;
}

.subtitle {
  font-size: 16px;
  font-weight: 300;
  margin-bottom: 4px;
}

.title {
  font-size: 36px !important;
  white-space: normal;
  margin-bottom: 20px;
  line-height: 1.2 !important;
  word-break: break-word;
  hyphens: auto;
}

.title-regular {
  font-weight: 400 !important;
  font-size: 36px !important;
  line-height: 1.2 !important;
  letter-spacing: 1.32px;
}

.title-gradient {
  font-weight: 700 !important;
  font-size: 36px !important;
  line-height: 1.2 !important;
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

.footer-left {
  padding: 12px 20px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  position: relative;
  z-index: 2;
}

/* Responsive font sizing for longer text */
@media (max-width: 1200px) {
  .title {
    font-size: 32px !important;
  }

  .title-regular,
  .title-gradient {
    font-size: 32px !important;
  }
}

@media (max-width: 900px) {
  .title {
    font-size: 28px !important;
  }

  .title-regular,
  .title-gradient {
    font-size: 28px !important;
  }
}
</style>
