<script setup lang="ts">
import { ref, computed } from 'vue';
import { geroDashboardApex, geroDashboard, zkFold } from '@/utils/assets';
import NetworkSelector from '@/options/modules/navigation/components/NetworkSelector.vue';
import GoogleLogin from '@/modules/welcome/components/GoogleLogIn/GoogleLogIn.vue';
import GButton from '@/shared/components/GButton/GButton.vue';

const emits = defineEmits<{
  (e: 'networkChanged', network: any): void;
  (e: 'createOrImportSeedPhrase'): void;
}>();

const props = defineProps<{
  selectedNetwork: any;
  createOrImportSeedPhrase: any;
}>();

const isApex = ref(false);

const onNetworkChanged = (network: any) => {
    emits('networkChanged', network);
};

const enableCreateOrImportSeedPhrase = (): void => {
    emits('createOrImportSeedPhrase');
};

const logo = computed(() => {
  if (props.selectedNetwork && props.selectedNetwork.blockchain?.includes('Apex')) {
    isApex.value = true;
    return geroDashboardApex;
  }
  isApex.value = false;
  return geroDashboard;
});

const gradientClass = computed(() =>
  isApex.value ? 'apex-gradient-text' : 'gradient-text'
);
</script>

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

      <div class="text-container">
        <div class="subtitle">Your New</div>
        <div class="title">
          <span class="title-regular">Single Pane of</span>
          <span :class="['title-gradient', gradientClass]">&nbsp;Glass</span>
        </div>
        <NetworkSelector @network-changed="onNetworkChanged" />

        <GButton
          block
          :class="['create-btn', isApex ? 'apexButton transition' : 'geroButton transition']"
          large
          @click:button="enableCreateOrImportSeedPhrase"
        >
          Create or Import Seed Phrase
        </GButton>

        <GoogleLogin :selected-network="selectedNetwork" />

        <div class="zkfold-credit">
          <span>Powered by</span>
          <v-img :src="zkFold" contain class="zkfold-logo"></v-img>
        </div>
      </div>
    </div>

    <div class="footer-left">&#169; 2025 A.D. Labs</div>
  </div>
</template>

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
  background: linear-gradient(135deg, rgba(19, 22, 27, 0.6) 0%, rgba(19, 22, 27, 0.5) 100%),
    radial-gradient(circle at 20% 50%, rgba(45, 240, 247, 0.04) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.03) 0%, transparent 50%);
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
  justify-content: center;
  padding: 20px;
  position: relative;
  z-index: 2;
}

.logo-container {
  margin-bottom: 40px;
}

.logo-container .logo {
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

.zkfold-credit {
  width: 100%;
  font-size: 10px;
  font-weight: 300;
  margin-top: 3px;
  color: #5b5b5b;
  display: flex;
  align-items: center;
}

.zkfold-credit .zkfold-logo {
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
</style>
