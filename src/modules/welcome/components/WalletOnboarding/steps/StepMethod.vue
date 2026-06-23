<template>
  <div class="step-method">
    <v-list class="transparent" dense nav style="width: inherit;">
      <v-list-item class="mb-6 py-2" @click="$emit('select', 'create')">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="walletSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600;">{{ $t('welcome.createWallet') }}</v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;">{{ $t('welcome.createWalletDescription') }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="mb-6 py-2" @click="$emit('select', 'restore')">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="keyGeroSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600;">{{ $t('welcome.restoreWallet') }}</v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;">{{ $t('welcome.restoreWalletDescription') }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="py-2" @click="$emit('select', 'pair')">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="pairSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600;">{{ $t('welcome.pairHardwareWallet') }}</v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;">{{ $t('welcome.pairHardwareWalletDescription') }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </div>
</template>
<script setup lang="ts">
import assets from '@/utils/assets';
import { computed } from 'vue';
import { NetworkInfo } from '@/utils/networks';

const props = defineProps<{ network?: NetworkInfo }>();
defineEmits<{ (e: 'select', method: 'create' | 'restore' | 'pair'): void; (e: 'back'): void }>();

const isApex = computed(() => !!props.network?.blockchain?.includes('Apex'));
const walletSvg = computed(() => (isApex.value ? assets.walletGeroApexSvg : assets.walletGeroSvg));
const keyGeroSvg = computed(() => (isApex.value ? assets.keyApexSvg : assets.keyGeroSvg));
const pairSvg = computed(() => (isApex.value ? assets.pairApexSvg : assets.pairGeroSvg));
</script>
