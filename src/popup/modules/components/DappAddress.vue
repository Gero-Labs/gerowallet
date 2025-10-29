<template>
  <v-card flat class="transparent">
    <v-card-title id="dapp-receiver-label" class="pa-0">
      To
    </v-card-title>
    <v-card-text id="dapp-receiver-wrap" :class="withBg ? {
      unknown: DappRisk[risk] === DappRisk.unknown,
      suspicious: DappRisk[risk] === DappRisk.suspicious,
      blacklist: DappRisk[risk] === DappRisk.blacklist,
      whitelist: DappRisk[risk] === DappRisk.whitelist || address === loggedWallet?.baseAddress
    } : {}">
      <v-card-subtitle id="dapp-receiver-address" class="pa-0" style="display: flex; flex-direction: row; text-align: left;">
        <div style="width: 18px; height: 18px" id="dapp-receiver-check">
          <img :alt="$t('common.trustedAddress')" height="18" width="16" style="margin-right: 2px" :src="riskIcon" v-if="risk" />
          <v-progress-circular size="18" indeterminate v-else color="white" width="3"></v-progress-circular>
        </div>
        {{ address }}
      </v-card-subtitle>
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, toRefs } from 'vue';
import { DappRisk } from '@/models/cardano-shield-types';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';


const { t } = useTranslation();

const { loggedWallet } = toRefs(walletStore);

const props = defineProps({
  address: {
    type: String,
  },
  risk: {
    type: String,
  },
  withBg: {
    type: Boolean,
    default: true
  }
});

const riskIcon = computed(() => {
  if (props.address === loggedWallet.value?.baseAddress) {
    return assets.resolveDappRisk(DappRisk.whitelist);
  }
  return assets.resolveDappRisk(DappRisk[props.risk as keyof typeof DappRisk]);
});
</script>
<style scoped>
#dapp-receiver-wrap {
  background-color: #0F0F0F !important;
  border: 1px solid #272930 !important;
  border-radius: 10px;
  padding: 8px 10px;
}
#dapp-receiver-header {
  display: flex;
  margin-bottom: 6px;
  align-items: center;
  flex-direction: row;
  justify-content: space-between;
}
#dapp-receiver-label {
  color: white;
  font-size: 14px;
  font-weight: 500;
}
#dapp-receiver-details {
  display: flex;
  flex-direction: row;
}
#dapp-receiver-check {
  margin: 2px 6px 2px 0;
}
#dapp-receiver-address {
  color: white;
  font-size: 10px;
  font-weight: 400;
  line-height: 12px;
  word-wrap: break-word;
  word-break: break-all;
  align-items: center;
}
#dapp-receiver-wrap.unknown {
  background: linear-gradient(270deg, #1f1f1f -61.94%, #4b4b4b 115%);
}
#dapp-receiver-wrap.suspicious {
  background: linear-gradient(269.92deg, #552900 1.73%, #915a28 97.85%);
}
#dapp-receiver-wrap.blacklist {
  background: linear-gradient(269.92deg, #250303 1.73%, #5d0101 97.85%);
}
#dapp-receiver-wrap.whitelist {
  background: linear-gradient(91.2deg, #00615b 40.76%, #00221c 103.06%);
}
</style>
