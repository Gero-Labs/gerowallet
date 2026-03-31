<template>
  <div class="onboarding-wrap">
    <div class="onboarding-card">
      <!-- Icon -->
      <div class="onboarding-icon-wrap">
        <div class="onboarding-icon-ring">
          <v-icon size="36" class="onboarding-icon">mdi-lightning-bolt</v-icon>
        </div>
      </div>

      <!-- Title -->
      <div class="onboarding-title">{{ $t('perpetuals.connectToStrike') }}</div>

      <!-- Description -->
      <div class="onboarding-desc">{{ $t('perpetuals.onboardingDescription') }}</div>

      <!-- Error -->
      <div v-if="error" class="onboarding-error">
        <v-icon size="14" color="#F97066" class="mr-1">mdi-alert-circle-outline</v-icon>
        <span>{{ error }}</span>
      </div>

      <!-- Key display (after generation) -->
      <div v-if="publicKey" class="key-card">
        <div class="key-card-label">
          <v-icon size="12" color="#26FAB0" class="mr-1">mdi-check-circle</v-icon>
          {{ $t('perpetuals.keyGenerated') }}
        </div>
        <div class="key-row">
          <span class="key-value">{{ truncatedKey }}</span>
          <v-btn icon x-small class="copy-btn" @click="copyKey()">
            <v-icon size="14" :color="copied ? '#26FAB0' : 'rgba(255,255,255,0.45)'">
              {{ copied ? 'mdi-check' : 'mdi-content-copy' }}
            </v-icon>
          </v-btn>
        </div>
      </div>

      <!-- Generate button / Connected state -->
      <v-btn
        v-if="!isConnected"
        block
        depressed
        :loading="isLoading"
        class="connect-btn"
        @click="generateAndConnect()"
      >
        <v-icon size="16" class="mr-2">mdi-key-variant</v-icon>
        {{ $t('perpetuals.generateApiKeys') }}
      </v-btn>

      <div v-else class="connected-state">
        <v-icon size="16" color="#26FAB0" class="mr-2">mdi-check-circle</v-icon>
        <span class="connected-label">{{ $t('perpetuals.connected') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';

const emit = defineEmits<{
  (e: 'connected'): void;
}>();

const { isConnected, isLoading, publicKey, error, generateAndConnect } = useStrikeOnboarding();

const copied = ref(false);

const truncatedKey = computed(() => {
  if (!publicKey.value) return '';
  const key = publicKey.value;
  if (key.length <= 20) return key;
  return `${key.slice(0, 10)}...${key.slice(-8)}`;
});

async function copyKey() {
  if (!publicKey.value) return;
  try {
    await navigator.clipboard.writeText(publicKey.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // ignore
  }
}

watch(isConnected, (val) => {
  if (val) emit('connected');
});
</script>

<style scoped>
.onboarding-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px 16px;
}

.onboarding-card {
  width: 100%;
  max-width: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background:
    linear-gradient(180deg, rgba(19, 22, 27, 0.7) 0%, rgba(10, 12, 16, 0.8) 100%),
    radial-gradient(ellipse at 50% 0%, rgba(0, 199, 243, 0.08) 0%, transparent 60%);
  backdrop-filter: blur(32px) saturate(1.6);
  -webkit-backdrop-filter: blur(32px) saturate(1.6);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 28px 20px 24px;
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.onboarding-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-icon-ring {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  background: rgba(0, 199, 243, 0.1);
  border: 1px solid rgba(0, 199, 243, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 24px rgba(0, 199, 243, 0.15);
}

.onboarding-icon {
  color: #00c7f3 !important;
}

.onboarding-title {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  text-align: center;
  letter-spacing: -0.01em;
}

.onboarding-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  line-height: 1.55;
}

.onboarding-error {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.1);
  border: 1px solid rgba(249, 112, 102, 0.25);
  font-size: 11px;
  color: #F97066;
  width: 100%;
}

.key-card {
  width: 100%;
  background: rgba(38, 250, 176, 0.06);
  border: 1px solid rgba(38, 250, 176, 0.2);
  border-radius: 10px;
  padding: 10px 12px;
}

.key-card-label {
  display: flex;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #26FAB0;
  margin-bottom: 6px;
}

.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.key-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.03em;
}

.copy-btn {
  flex-shrink: 0;
}

.connect-btn {
  width: 100% !important;
  height: 42px !important;
  border-radius: 10px !important;
  background: rgba(0, 199, 243, 0.12) !important;
  color: #00c7f3 !important;
  border: 1px solid rgba(0, 199, 243, 0.3) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
  transition: background 0.18s ease !important;
}

.connect-btn:hover:not(.v-btn--disabled) {
  background: rgba(0, 199, 243, 0.2) !important;
}

.connected-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border-radius: 10px;
  background: rgba(38, 250, 176, 0.08);
  border: 1px solid rgba(38, 250, 176, 0.2);
  width: 100%;
}

.connected-label {
  font-size: 13px;
  font-weight: 700;
  color: #26FAB0;
}
</style>
