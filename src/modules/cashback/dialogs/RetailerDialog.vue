<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="$t('cashback.dealDetails')"
    subtitle=""
    :min-height="600"
    :height="620"
    :width="500"
    :persistent="false"
  >
    <v-card-title class="pa-0">
      <v-list-item v-if="retailer" class="px-0">
        <v-list-item-avatar :color="retailer.backgroundColor ? retailer.backgroundColor : '#fff'" size="60" v-if="retailer.img">
          <v-img :src="retailer.img" contain style="margin: auto;" eager></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title style="word-break: break-word; font-size: 24px">
            {{retailer.section ?  (retailer.name + " > " + retailer.section) : retailer.name}}
          </v-list-item-title>
          <v-list-item-subtitle class="pa-0" style="word-break: break-word; color: #00DFF3">
            Up to {{ retailer.maxCashback.toFixed(0) }}{{retailer.cashbackSymbol}} Cashback
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-card-title>
    <v-card-title class="px-1 pt-0 pb-2" style="font-size: 14px">
      {{ $t('cashback.cashbackTermsExclusions') }}
    </v-card-title>
    <v-card-text class="px-4 pt-2 pb-0 cashbackTerms" style="z-index: 1; border-radius: 10px; background-color: #0f0f0f">
      <div v-if="loading" style="width: 100%; height: 100%; align-content: center" class="text-center" >
        <v-progress-circular color="primary" size="80" width="8" indeterminate ></v-progress-circular>
        <div class="pt-4">{{ $t('common.loading') }}...</div>
      </div>
      <VueShowdown v-else :markdown="fileContent" flavor="vanilla" :options="{ emoji: true }"/>
    </v-card-text>
    <v-card-actions class="px-0 pt-4 justify-center text-center" style="flex-direction: column;">
      <v-btn
        :loading="loading || !retailerUrl"
        class="geroButton"
        :disabled="disabled || !retailerUrl"
        style="color: black!important;"
        @click="startShopping()"
      >{{ $t('cashback.startShopping') }}</v-btn>
      <v-card-subtitle class="pa-0 pt-3">{{ $t('cashback.startShoppingTerms') }}</v-card-subtitle>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import axios from 'axios';
import networks from '@/utils/networks';
import cashbackApi from '@/api/cashback-api';
import { walletStore } from '@/stores/walletStore';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  retailer: {
    type: Object as () => any,
  },
  retailerTermsBasePath: {
    type: String,
    default: 'https://media.bringweb3.io/cashback-terms'
  },
  searchTerm: {
    type: String,
  }
});

const emit = defineEmits(['close']);
const { loggedWallet } = toRefs(walletStore);

const retailerUrl = ref<string | null>(null);
const fileContent = ref<string | null>(null);
const loading = ref(true);
const disabled = ref(true);

const startShopping = () => {
  if (retailerUrl.value) {
    window.open(retailerUrl.value, '_blank');
    cashbackApi.analytics(
      props.retailer.id,
      props.retailer.name,
      loggedWallet.value?.baseAddress.value,
      networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
      props.searchTerm
    );
  }
};

const getContent = async () => {
  fileContent.value = "";
  try {
    const response = await axios.get(props.retailerTermsBasePath + props.retailer?.termsPath);
    fileContent.value = response.data;
    disabled.value = false;
  } catch (e) {
    fileContent.value = e as string;
  }
};

const activate = async () => {
  try {
    let search = '';
    if (props.searchTerm) {
      search = props.searchTerm;
    }
    const response = await cashbackApi.activate(
      props.retailer.id,
      loggedWallet.value.baseAddress,
      networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network),
      search
    );
    if (response.status) {
      retailerUrl.value = response.url;
    } else {
      retailerUrl.value = "";
    }
  } catch (e) {
    console.log(e);
  }
};

watch(() => props.isOpen, async (val) => {
  if (val) {
    retailerUrl.value = null;
    loading.value = true;
    disabled.value = true;
    const promises = [];
    promises.push(getContent());
    promises.push(activate());
    await Promise.all(promises);
    loading.value = false;
  }
});
</script>
<style scoped>

.card-text {
  width: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

::-webkit-scrollbar {
  width: 14px;
}

::-webkit-scrollbar-thumb {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}

/* Handle on hover */
::-webkit-scrollbar-thumb:hover {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}

</style>
<style>
.cashbackTerms strong {
  color: white!important;
}
</style>
