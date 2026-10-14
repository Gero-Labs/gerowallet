<template>
  <v-window-item>
    <div class="d-flex flex-column py-0">
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.walletName') }}</h3>
          <span class="helper my-0">{{ $t('settings.editWalletName') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
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
            hide-details
            v-model="walletName"
            @onSave="setLoggedWalletName"
          ></EditableTextField>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">
            {{ $t('settings.walletProfilePicture') }}
            <v-icon color="error" size="x-small" class="ml-1" v-if="hasNewProfilePicture">
              mdi-circle
            </v-icon>
          </h3>
          <span class="helper">{{ $t('settings.chooseProfilePicture') }}</span>
        </v-col>
        <v-col cols="5" class="d-flex justify-center" style="align-content: center">
          <v-tooltip location="top"  content-class="custom-tooltip">
            <template v-slot:activator="{ props: activatorProps }">
              <NotificationDot v-bind="activatorProps" :show="hasNewProfilePicture" overlap bordered pulse>
                <v-avatar
                  size="96"
                  rounded
                  class="profile-avatar-clickable"
                  v-bind="activatorProps"

                  @click="openProfilePicDialog"
                >
                  <v-img v-if="loggedWallet" :src="avatar" />
                  <div class="profile-avatar-overlay">
                    <v-icon color="white" size="20">mdi-camera</v-icon>
                  </div>
                </v-avatar>
              </NotificationDot>
            </template>
            <span>{{ $t('settings.clickToChange') }}</span>
          </v-tooltip>
        </v-col>
      </v-row>
      <ProfilePictureDialog ref="profilePicDialog" />
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.currencyPreference') }}</h3>
          <span class="helper">{{ $t('settings.choosePreferredCurrency') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-select
            :items="currencies"
            variant="outlined"
            density="compact"
            v-model="selectedCurrency"
            hide-details
            attach
            item-title="text"
            item-value="value"
          ></v-select>
        </v-col>
      </v-row>
      <v-row v-if="explorerOptions.length > 1" no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.blockExplorer') }}</h3>
          <span class="helper">{{ $t('settings.blockExplorerHelper') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-select
            :items="explorerOptions"
            variant="outlined"
            density="compact"
            v-model="selectedExplorer"
            :hint="explorerHint"
            :persistent-hint="!!explorerHint"
            :hide-details="!explorerHint"
            attach
            item-title="name"
            item-value="id"
          >
            <template v-slot:item="{ item , props: itemProps }"><v-list-item v-bind="itemProps"><template #title>
              <v-avatar size="20">
                <v-img :src="EXPLORER_LOGOS[item.id]" alt="" />
              </v-avatar>
              <div class="g-list-content">
                <v-list-item-title>{{ item.name }}</v-list-item-title>
              </div>
            </template></v-list-item></template>
            <template v-slot:selection="{ item }">
              <v-avatar size="20" class="mr-2">
                <v-img :src="EXPLORER_LOGOS[item.id]" alt="" />
              </v-avatar>
              <span>{{ item.name }}</span>
            </template>
          </v-select>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">
            {{ $t('settings.displayLanguage') }}
            <v-icon color="error" size="x-small" class="ml-1" v-if="hasNewLanguage">
              mdi-circle
            </v-icon>
          </h3>
          <span class="helper">{{ $t('settings.setLanguageHelper') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-select
            v-model="loc"
            :items="availableLanguages"
            item-title="name"
            item-value="iso"
            variant="outlined"
            density="compact"
            hide-details
            attach
            @focus="handleLanguageSelectorFocus"
          >
            <template v-slot:item="{ item , props: itemProps }"><v-list-item v-bind="itemProps"><template #title>
              <v-avatar size="20">
                <flag :iso="item.iso" style="font-size: 20px"></flag>
              </v-avatar>
              <div class="g-list-content">
                <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
              </div>
            </template></v-list-item></template>
            <template v-slot:selection="{ item }">
              <v-list-item density="compact" style="min-height: 32px; height: 32px">
                <v-avatar size="20">
                  <flag :iso="item.iso" style="font-size: 20px"></flag>
                </v-avatar>
                <div class="py-0 g-list-content">
                  <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
                </div>
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
          <v-text-field variant="outlined" disabled density="compact" :model-value="$t('settings.regionValue')" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">{{ $t('settings.welcomeGuide') }}</h3>
          <span class="helper">{{ $t('settings.welcomeGuideHelper') }}</span>
        </v-col>
        <v-col cols="5" style="align-content: center">
          <v-btn block variant="outlined" color="grey" @click="showGuide">
            <span>{{ $t('settings.showGuide') }}</span>
          </v-btn>
        </v-col>
      </v-row>
    </div>
  </v-window-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, toRefs } from 'vue';
import languages from '@/plugins/languages';
import assets from '@/utils/assets';
import EditableTextField from '@/modules/dashboard/components/EditableTextField.vue';
import ProfilePictureDialog from '@/modules/dashboard/dialogs/ProfilePictureDialog.vue';
import NotificationDot from '@/shared/components/NotificationDot.vue';
import rules from '@/utils/rules';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import geroStoreDefault from '@/stores/geroStore';
import WalletStore from '@/stores/walletStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useExplorer } from '@/shared/composables/useExplorer';
import { DEFAULT_CARDANO_EXPLORER } from '@/shared/utils/explorer';
import { EXPLORER_LOGOS } from '@/shared/utils/explorerLogos';
import { setWalletConfiguration } from '@/db/wallet-db';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

// Define emits
const emit = defineEmits(['close']);

// Translation
const { t } = useTranslation();

import { READY_LANGUAGES } from '@/plugins/i18n.config';

// Feature notification for the newest language (Spanish)
const hasNewLanguage = computed(() => isFeatureNew('settings.profile.spanishLanguage'));

// Feature notification for new profile picture picker
const hasNewProfilePicture = computed(() => isFeatureNew('settings.profile.profilePicture'));

// Filter to only show ready languages
const availableLanguages = computed(() => {
  return Object.values(languages).filter(lang => READY_LANGUAGES.some(locale => locale === lang.iso));
});

// Get store instance
const { loggedWallet } = toRefs(walletStore);
const { wallets } = toRefs(geroStore);

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
// Per-wallet: the choices depend on the wallet's chain and network. Hidden
// when the chain has a single explorer (Apex) or none (Bitcoin, Midnight).
const { explorerOptions, explorerId, setExplorer } = useExplorer();

const selectedExplorer = computed({
  get: () => explorerId.value,
  set: (id: string) => {
    setExplorer(id).catch((error) => {
      console.error('Error saving explorer preference:', error);
    });
  },
});

const explorerHint = computed(() => {
  const chosen = explorerOptions.value.find(option => option.id === explorerId.value);
  if (!chosen?.partial) return '';
  const fallback = explorerOptions.value.find(option => option.id === DEFAULT_CARDANO_EXPLORER);
  return t('settings.blockExplorerPartial', { explorer: chosen.name, fallback: fallback?.name ?? '' });
});

// Use locale codes as select values and the persisted global preference as the
// source of truth, just like the welcome-screen language selector.
const loc = computed({
  get: () => geroStore.config?.locale || 'us',
  set: async (locale: string) => {
    if (!READY_LANGUAGES.some(ready => ready === locale) || locale === geroStore.config?.locale) return;
    try {
      await WalletStore.setLocale(locale);
    } catch (error) {
      console.error(`Failed to set language ${locale}:`, error);
    }
  },
});
const profilePicDialog = ref<InstanceType<typeof ProfilePictureDialog>>();

// Computed properties
const otherWalletNames = computed(() => {
  return Object.values(wallets.value)
    .filter(wallet => wallet.name !== loggedWallet.value?.name)
    .map(wallet => wallet.name);
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

const openProfilePicDialog = () => {
  if (hasNewProfilePicture.value) {
    markFeatureAsSeen('settings.profile.profilePicture');
  }
  profilePicDialog.value?.open();
};

const handleLanguageSelectorFocus = () => {
  // Mark the new-language feature as seen when user opens the language selector
  if (hasNewLanguage.value) {
    markFeatureAsSeen('settings.profile.spanishLanguage');
  }
};

// Lifecycle - Set initial value from store
onMounted(() => {
  walletName.value = loggedWallet.value.name;
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

.profile-avatar-clickable {
  cursor: pointer;
  position: relative;
  transition: opacity 0.2s;
}

.profile-avatar-clickable:hover {
  opacity: 0.85;
}

.profile-avatar-clickable:hover .profile-avatar-overlay {
  opacity: 1;
}

.profile-avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  border-radius: inherit;
  opacity: 0;
  transition: opacity 0.2s;
}
</style>
