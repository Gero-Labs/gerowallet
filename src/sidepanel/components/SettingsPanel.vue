<template>
  <div class="settings-panel">
    <!-- Profile Section -->
    <div class="settings-section">
      <div class="settings-item">
        <div class="settings-label">
          <v-icon size="16" color="#888" class="mr-2">mdi-account-outline</v-icon>
          <span>{{ $t('settings.walletName') }}</span>
        </div>
        <EditableTextField
          :placeholder="t('settings.walletNamePlaceholder')"
          :rules="[
            rules.required(),
            rules.minCharacters(3),
            rules.maxCharacters(40),
            invalidWalletNames(),
            existedWalletName(),
          ]"
          outlined
          dense
          v-model="walletName"
          @onSave="setLoggedWalletName"
        />
      </div>

      <div class="settings-item">
        <div class="settings-label">
          <v-icon size="16" color="#888" class="mr-2">mdi-cash</v-icon>
          <span>{{ $t('settings.currencyPreference') }}</span>
        </div>
        <v-select
          :items="currencies"
          outlined
          dense
          v-model="selectedCurrency"
          hide-details
          attach
          item-text="text"
          item-value="value"
        />
      </div>

      <div class="settings-item">
        <div class="settings-label">
          <v-icon size="16" color="#888" class="mr-2">mdi-translate</v-icon>
          <span>{{ $t('settings.displayLanguage') }}</span>
        </div>
        <v-select
          v-model="loc"
          :items="availableLanguages"
          item-text="name"
          outlined
          dense
          hide-details
          attach
        />
      </div>
    </div>

    <!-- Actions Section -->
    <div class="settings-section">
      <button class="settings-action" @click="lockWallet">
        <v-icon size="18" color="#888" class="mr-2">mdi-lock-outline</v-icon>
        <span>{{ $t('miniGero.lockWallet') }}</span>
        <v-icon size="16" color="#555" class="ml-auto">mdi-chevron-right</v-icon>
      </button>

      <button class="settings-action" @click="openFullSettings">
        <v-icon size="18" color="#888" class="mr-2">mdi-cog-outline</v-icon>
        <span>{{ $t('miniGero.allSettings') }}</span>
        <v-icon size="16" color="#555" class="ml-auto">mdi-chevron-right</v-icon>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import geroStoreDefault from '@/stores/geroStore';
import WalletStore from '@/stores/walletStore';
import { setWalletConfiguration } from '@/db/wallet-db';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import EditableTextField from '@/modules/dashboard/components/EditableTextField.vue';
import languages from '@/plugins/languages';
import rules from '@/utils/rules';
import { READY_LANGUAGES } from '@/plugins/i18n/config';

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const vmProxy = getCurrentInstance()!.proxy as any;
const { loggedWallet } = toRefs(walletStore);
const { wallets } = toRefs(geroStore);

const walletName = ref('');
const loc = ref<string | undefined>(undefined);

const availableLanguages = computed(() => {
  return Object.values(languages).filter(lang => READY_LANGUAGES.includes(lang.iso));
});

const currencies = ref([
  { text: 'USD ($)', value: 'usd' },
  { text: 'EUR (\u20AC)', value: 'eur' },
]);

const { resetRateLoaded } = useCurrencyConverter();

const selectedCurrency = computed({
  get: () => walletStore.config?.currency || 'usd',
  set: async (newCurrency: string) => {
    walletStore.config.currency = newCurrency;
    resetRateLoaded();
    if (walletStore.loggedWallet?.id) {
      try {
        await setWalletConfiguration(walletStore.loggedWallet.id, 'currency', newCurrency);
      } catch (error) {
        console.error('Error saving currency:', error);
      }
    }
  },
});

const otherWalletNames = computed(() => {
  return Object.values(wallets.value)
    .filter((wallet: any) => wallet.name !== loggedWallet.value?.name)
    .map((wallet: any) => wallet.name);
});

const invalidWalletNames = () => {
  return (value: string): string | boolean => !otherWalletNames.value.includes(value) || t('settings.walletNameTaken');
};

const existedWalletName = () => {
  return (value: string): string | boolean => value !== loggedWallet.value.name || '';
};

function setLoggedWalletName(newName: string) {
  geroStoreDefault.setWalletName(loggedWallet.value.id, newName);
}

async function lockWallet() {
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.LOCK,
    data: {},
  });
}

function openFullSettings() {
  chrome.storage.local.set({ openSettingsOnLoad: true });
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  emit('close');
}

watch(loc, async (val) => {
  if (val) {
    const iso = Object.values(languages).find(value => value.name === val)?.iso;
    if (iso) {
      if (iso === geroStore.config?.locale) return;
      const { loadLanguage } = await import('@/plugins/i18n');
      try {
        await loadLanguage(iso);
        await WalletStore.setLocale(iso);
        vmProxy.$i18n.locale = iso;
      } catch (error) {
        console.error(`Failed to load language ${iso}:`, error);
      }
    }
  }
}, { immediate: false });

onMounted(() => {
  walletName.value = loggedWallet.value.name;
  loc.value = languages[geroStore.config?.locale || 'us'].name;
});
</script>

<style scoped>
.settings-panel {
  padding: 4px 8px 16px;
}

.settings-section {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 4px 0;
  margin-bottom: 12px;
}

.settings-item {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  gap: 8px;
}

.settings-item + .settings-item {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.settings-label {
  display: flex;
  align-items: center;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.settings-action {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  transition: background 0.15s ease;
}

.settings-action:hover {
  background: rgba(255, 255, 255, 0.06);
}

.settings-action:first-child {
  border-radius: 14px 14px 0 0;
}

.settings-action:last-child {
  border-radius: 0 0 14px 14px;
}
</style>
