<template>
  <v-tab-item>
    <v-layout class="py-0" column>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.walletName') }}</h3>
          <span class="helper my-0">{{ $t('settings.editWalletName') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <EditableTextField
            :placeholder="$t('settings.walletNamePlaceholder')"
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
          ></EditableTextField>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.walletProfilePicture') }}</h3>
          <span class="helper">{{ $t('settings.chooseProfilePicture') }}</span>
        </v-col>
        <v-col cols="5" class="d-flex justify-space-between" style="align-content: center; flex-flow: wrap">
          <v-row no-gutters>
            <v-col cols="12" class="text-center py-2">
              <v-avatar size="96" rounded>
                <v-img v-if="loggedWallet" :src="avatar"></v-img>
              </v-avatar>
            </v-col>
            <v-col cols="12" class="py-2">
              <v-btn block outlined color="grey" autocapitalize="on" @click="uploadPicture">
                <span>{{ $t('settings.uploadPicture') }}</span>
                <v-icon right dark> mdi-cloud-upload-outline </v-icon>
              </v-btn>
              <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFileChange" />
            </v-col>
            <v-col cols="12" class="py-2">
              <v-btn block outlined color="grey" disabled>
                <span>{{ $t('settings.chooseNFT') }}</span>
                <v-icon right dark> mdi-account-box-outline </v-icon>
              </v-btn>
            </v-col>
          </v-row>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.currencyPreference') }}</h3>
          <span class="helper">{{ $t('settings.choosePreferredCurrency') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-select
            :items="currencies"
            outlined
            dense
            v-model="selectedCurrency"
            hide-details
            attach
            item-text="text"
            item-value="value"
          ></v-select>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">
            {{ $t('settings.displayLanguage') }}
            <NotificationDot
              :show="hasNewLanguage"
              color="success"
              :pulse="true"
            />
          </h3>
          <span class="helper">{{ $t('settings.setLanguageHelper') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-select
            v-model="loc"
            :items="availableLanguages"
            item-text="name"
            outlined
            dense
            hide-details
            attach
            @focus="handleLanguageSelectorFocus"
          >
            <template v-slot:item="{ item }">
              <v-list-item-avatar size="20">
                <flag :iso="item.iso" style="font-size: 20px"></flag>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
              </v-list-item-content>
            </template>
            <template v-slot:selection="{ item }">
              <v-list-item dense style="min-height: 32px; height: 32px">
                <v-list-item-avatar size="20">
                  <flag :iso="item.iso" style="font-size: 20px"></flag>
                </v-list-item-avatar>
                <v-list-item-content class="py-0">
                  <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </template>
          </v-select>
          <!--          <v-text-field disabled outlined dense value="English" hide-details></v-text-field>-->
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.region') }}</h3>
          <span class="helper">{{ $t('settings.regionHelper') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-text-field outlined disabled dense :value="$t('settings.regionValue')" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.welcomeGuide') }}</h3>
          <span class="helper">{{ $t('settings.welcomeGuideHelper') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-btn block outlined color="grey" @click="showGuide">
            <span>{{ $t('settings.showGuide') }}</span>
          </v-btn>
        </v-col>
      </v-row>
    </v-layout>
  </v-tab-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import languages from '@/plugins/languages';
import assets from '@/utils/assets';
import EditableTextField from '@/modules/dashboard/components/EditableTextField.vue';
import NotificationDot from '@/shared/components/NotificationDot.vue';
import rules from '@/utils/rules';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import geroStoreDefault from '@/stores/geroStore';
import WalletStore from '@/stores/walletStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { setWalletConfiguration } from '@/db/wallet-db';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

// Define emits
const emit = defineEmits(['close']);

// Translation
const { t } = useTranslation();

// Feature notifications for new German language
const hasNewLanguage = computed(() => isFeatureNew('settings.profile.germanLanguage'));

// Filter to only show ready languages (English US, English GB, German)
const READY_LANGUAGES = ['us', 'gb', 'de'];

const availableLanguages = computed(() => {
  return Object.values(languages).filter(lang => READY_LANGUAGES.includes(lang.iso));
});

// Get store instance
const { loggedWallet, config } = toRefs(walletStore);
const { wallets } = toRefs(geroStore);

// Access Vue instance for i18n
const vmProxy = getCurrentInstance()!.proxy as any;

// Reactive data
const currencies = ref([
  { text: 'USD ($)', value: 'usd' },
  { text: 'EUR (€)', value: 'eur' },
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
        console.log(`Currency changed to: ${newCurrency} and saved to IndexedDB`);
      } catch (error) {
        console.error('Error saving currency to IndexedDB:', error);
      }
    }
  },
});

const walletName = ref('');
const loc = ref<string | undefined>(undefined);
const fileInput = ref<HTMLInputElement | null>(null);

// Computed properties
const otherWalletNames = computed(() => {
  return Object.values(wallets.value)
    .filter((wallet: any) => wallet.name !== loggedWallet.value?.name)
    .map((wallet: any) => wallet.name);
});

const avatar = computed(() => {
  if (loggedWallet.value.icon.includes('http')) {
    return loggedWallet.value.icon;
  } else {
    return assets.resolveIcon(loggedWallet.value.icon);
  }
});

// Validation functions
const invalidWalletNames = () => {
  return (value: string): string | boolean => !otherWalletNames.value.includes(value) || t('settings.walletNameTaken');
};

const existedWalletName = () => {
  return (value: string): string | boolean => value !== loggedWallet.value.name || '';
};

// Methods
const showGuide = () => {
  emit('close');
  geroStoreDefault.setConfig({ welcomeDone: false });
};

const setLoggedWalletName = (newWalletName: string) => {
  geroStoreDefault.setWalletName(loggedWallet.value.id, newWalletName);
};

const uploadPicture = () => {
  fileInput.value?.click();
};

const onFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async e => {
    const picBase64 = e.target?.result as string;
    await geroStoreDefault.setWalletIcon(loggedWallet.value.id, picBase64);

    // Update loggedWallet icon immediately for live preview
    loggedWallet.value.icon = picBase64;
  };
  reader.readAsDataURL(file);
};

const handleLanguageSelectorFocus = () => {
  // Mark German language feature as seen when user opens the language selector
  if (hasNewLanguage.value) {
    markFeatureAsSeen('settings.profile.germanLanguage');
  }
};

// Watchers
watch(loc, async (val) => {
  if (val) {
    const iso = Object.values(languages).find(value => value.name === val)?.iso;
    if (iso) {
      // CRITICAL FIX: Load language file before switching (race condition fix)
      const { loadLanguage } = await import('@/plugins/i18n');
      try {
        await loadLanguage(iso);

        // Update store and i18n locale ONLY after successful load
        await WalletStore.setLocale(iso);
        vmProxy.$i18n.locale = iso;
        await vmProxy.$nextTick();
      } catch (error) {
        console.error(`Failed to load language ${iso}:`, error);
        // Don't update store if load failed - will cause UI inconsistency
      }
    }
  }
}, { immediate: false });

// Watch for locale changes from other sources (e.g., LanguageSelector on Welcome screen)
watch(() => geroStore.config?.locale, (newLocale) => {
  if (newLocale && languages[newLocale]) {
    const newLanguageName = languages[newLocale].name;
    if (loc.value !== newLanguageName) {
      loc.value = newLanguageName;
    }
  }
});

// Lifecycle
onMounted(() => {
  walletName.value = loggedWallet.value.name;
  // CRITICAL: Read from geroStore (global preference) instead of walletStore
  // This ensures locale persists across login/logout
  loc.value = languages[geroStore.config?.locale || 'us'].name;
});
</script>

<style scoped>
h2 {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.75rem;
  color: #f5f5f6;
}

.helper {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
  color: #94969c;
}

.col-6 {
  padding: 0 !important;
}
</style>
