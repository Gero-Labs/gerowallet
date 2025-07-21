<template>
  <v-tab-item>
    <v-layout class="py-0" column>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Wallet Name</h3>
          <span class="helper  my-0">Edit your wallet name</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <EditableTextField
            placeholder="e.g. My New Wallet"
            :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40), invalidWalletNames(), existedWalletName()]"
            outlined
            dense
            v-model="walletName"
            @onSave="setLoggedWalletName"
          ></EditableTextField>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Wallet Profile Picture</h3>
          <span class="helper">Choose a profile picture for your wallet</span>
        </v-col>
        <v-col cols="5" class="d-flex justify-space-between" style="align-content: center; flex-flow: wrap;">
          <v-row no-gutters>
            <v-col cols="12" class="text-center py-2">
              <v-avatar size="100" rounded>
                <v-img v-if="loggedWallet" :src="avatar"></v-img>
              </v-avatar>
            </v-col>
            <v-col cols="12" class="py-2">
              <v-btn
                block
                outlined
                color="grey"
                autocapitalize="on"
                @click="uploadPicture"
              >
                <span>Upload Picture</span>
                <v-icon
                  right
                  dark
                > mdi-cloud-upload-outline
                </v-icon>
              </v-btn>
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                style="display: none"
                @change="onFileChange"
              />
            </v-col>
            <v-col cols="12" class="py-2">
              <v-btn
                block
                outlined
                color="grey"
                disabled
              >
                <span>Choose NFT</span>
                <v-icon
                  right
                  dark
                >
                  mdi-account-box-outline
                </v-icon>
              </v-btn>
            </v-col>
          </v-row>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Currency Preference</h3>
          <span class="helper">Choose your preferred currency</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-select
            :items="currencies"
            outlined
            dense
            v-model="selectedCurrency"
            hide-details
            return-object
            disabled
          ></v-select>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Display Language</h3>
          <span class="helper">Set the language for Gero Dashboard</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-select v-model="loc" :items="Object.values(languages)" item-text="name" outlined dense hide-details disabled>
            <template v-slot:item="{ item }">
              <v-list-item-avatar size="20">
                <flag :iso="item.iso" style="font-size: 20px;"></flag>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
              </v-list-item-content>
            </template>
            <template v-slot:selection="{ item }">
              <v-list-item dense style="min-height: 32px; height: 32px;">
                <v-list-item-avatar size="20">
                  <flag :iso="item.iso" style="font-size: 20px;"></flag>
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
          <h3 style="color: white">Region</h3>
          <span class="helper">Choose region, affects dates & time</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-text-field outlined disabled dense value="English (US)" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-2">
        <v-col cols="7" class="text-left">
          <h3 style="color: white">Welcome Guide</h3>
          <span class="helper">Display the introductory guide to help you navigate your wallet</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-btn
            block
            outlined
            color="grey"
            @click="showGuide"
          >
            <span>Show Guide</span>
          </v-btn>
        </v-col>
      </v-row>
    </v-layout>
  </v-tab-item>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, toRefs, getCurrentInstance } from 'vue';
import languages from '@/plugins/languages';
import assets from '@/utils/assets';
import EditableTextField from '@/modules/dashboard/components/EditableTextField.vue';
import rules from '@/utils/rules';
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import geroStoreDefault from '@/stores/geroStore';
import WalletStore from '@/stores/walletStore';

// Define emits
const emit = defineEmits(['close']);

// Get store instance
const { loggedWallet, config } = toRefs(walletStore);
const { wallets } = toRefs(geroStore);

// Access Vue instance for i18n
const vmProxy = getCurrentInstance()!.proxy as any;

// Reactive data
const currencies = ref(['USD', 'AUD', 'CAD', 'EUR', 'GBP']);
const selectedCurrency = ref('USD');
const walletName = ref('');
const loc = ref<string | undefined>(undefined);
const fileInput = ref<HTMLInputElement | null>(null);

// Computed properties
const otherWalletNames = computed(() => {
  return Object.values(wallets.value).filter(wallet => wallet.name !== loggedWallet.value.name).map(wallet => wallet.name);
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
  return (value: string) => !otherWalletNames.value.includes(value) || 'Wallet name already taken.';
};

const existedWalletName = () => {
  return (value: string) => value !== loggedWallet.value.name || '';
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

const onFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    const picBase64 = e.target?.result as string;
    geroStoreDefault.setWalletIcon(loggedWallet.value.id, picBase64);
  };
  reader.readAsDataURL(file);
};

// Watchers
watch(loc, (val) => {
  if (val) {
    const iso = Object.values(languages).find(value => value.name === val)?.iso;
    if (iso) {
      WalletStore.setLocale(iso);
      vmProxy.$i18n.locale = iso;
    }
  }
});

// Lifecycle
onMounted(() => {
  walletName.value = loggedWallet.value.name;
  loc.value = languages[config.value.locale || 'us'].name;
});
</script>

<style scoped>
h2 {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.75rem;
  color: #F5F5F6;
}

.helper {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
  color: #94969C;
}

.col-6 {
  padding: 0 !important;
}
</style>
