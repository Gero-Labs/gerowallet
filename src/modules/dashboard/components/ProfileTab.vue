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
            <v-icon color="error" x-small class="ml-1" v-if="hasNewProfilePicture">
              mdi-circle
            </v-icon>
          </h3>
          <span class="helper">{{ $t('settings.chooseProfilePicture') }}</span>
        </v-col>
        <v-col cols="5" class="d-flex justify-center" style="align-content: center">
          <v-tooltip top content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <NotificationDot :show="hasNewProfilePicture" overlap bordered pulse>
                <v-avatar
                  size="96"
                  rounded
                  class="profile-avatar-clickable"
                  v-bind="attrs"
                  v-on="on"
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
            <v-icon color="error" x-small class="ml-1" v-if="hasNewLanguage">
              mdi-circle
            </v-icon>
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
import ProfilePictureDialog from '@/modules/dashboard/dialogs/ProfilePictureDialog.vue';
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

import { READY_LANGUAGES } from '@/plugins/i18n/config';

// Feature notifications for new German language
const hasNewLanguage = computed(() => isFeatureNew('settings.profile.germanLanguage'));

// Feature notification for new profile picture picker
const hasNewProfilePicture = computed(() => isFeatureNew('settings.profile.profilePicture'));

// Filter to only show ready languages
const availableLanguages = computed(() => {
  return Object.values(languages).filter(lang => READY_LANGUAGES.includes(lang.iso));
});

// Get store instance
const { loggedWallet } = toRefs(walletStore);
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
const profilePicDialog = ref<InstanceType<typeof ProfilePictureDialog>>();

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

const openProfilePicDialog = () => {
  if (hasNewProfilePicture.value) {
    markFeatureAsSeen('settings.profile.profilePicture');
  }
  profilePicDialog.value?.open();
};

const handleLanguageSelectorFocus = () => {
  // Mark German language feature as seen when user opens the language selector
  if (hasNewLanguage.value) {
    markFeatureAsSeen('settings.profile.germanLanguage');
  }
};

// Watchers
// Watch for user changing the dropdown
watch(loc, async (val) => {
  if (val) {
    const iso = Object.values(languages).find(value => value.name === val)?.iso;
    if (iso) {
      // CRITICAL: Don't call setLocale if we're already at this locale
      if (iso === geroStore.config?.locale) {
        return;
      }

      // Load language file and update locale
      const { loadLanguage } = await import('@/plugins/i18n');
      try {
        await loadLanguage(iso);
        await WalletStore.setLocale(iso);
        vmProxy.$i18n.locale = iso;
        await vmProxy.$nextTick();
      } catch (error) {
        console.error(`Failed to load language ${iso}:`, error);
      }
    }
  }
}, { immediate: false });

// Lifecycle - Set initial value from store
onMounted(() => {
  walletName.value = loggedWallet.value.name;
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
