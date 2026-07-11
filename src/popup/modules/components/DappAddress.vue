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
          <v-tooltip top content-class="custom-tooltip" v-if="risk">
            <template v-slot:activator="{ on, attrs }">
              <img
                :alt="t('common.trustedAddress')"
                height="18"
                width="16"
                style="margin-right: 2px; cursor: pointer"
                :src="riskIcon"
                v-bind="attrs"
                v-on="on"
              />
            </template>
            <span>{{ riskTooltip }}</span>
          </v-tooltip>
          <v-progress-circular size="18" indeterminate v-else color="white" width="3"></v-progress-circular>
        </div>
        <v-list-item class="px-0" dense style="min-height: 10px;">
          <v-list-item-content class="pa-0">
            <v-list-item-title style="display: flex; justify-content: space-between; ">
              <CopyButton v-if="address" :value="address" :title="filters.truncate(address)" x-small></CopyButton>
              <div style="place-self: center;">
                <v-chip
                  v-if="contactInfo && contactInfo.isHandle"
                  outlined
                  class="px-1 mr-1"
                  x-small
                  color="white"
                  style="margin-left: 1px; margin-bottom: 1px"
                ><span style="color: var(--g-success); font-weight: 600">$</span>{{ contactInfo.label.replace(/^\$/, '') }}
                </v-chip>
                <v-chip
                  v-else-if="contactInfo"
                  outlined
                  class="px-1 mr-1"
                  x-small
                  color="warning"
                  style="margin-left: 1px; margin-bottom: 1px"
                ><v-icon x-small class="mr-1">mdi-account</v-icon>{{ contactInfo.label }}</v-chip>
                <v-chip outlined x-small v-if="isScriptAddress">Script</v-chip>
              </div>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>

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
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';

const { t } = useTranslation();

const { loggedWallet, contacts } = toRefs(walletStore);

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

const contactMap = computed(() => {
  const map = new Map<string, { label: string; isHandle: boolean }>();
  Object.values(contacts.value).forEach((contact: any) => {
    if (contact.address && contact.name) {
      map.set(contact.address, {
        label: contact.handle || contact.name,
        isHandle: !!contact.handle,
      });
    }
  });
  return map;
})

const contactInfo = computed(() => {
  return contactMap.value.get(props.address);
});

const isScriptAddress = computed(() => {
  if (!props.address) {
    return false;
  }
  try {
    const address = Cardano.Address.fromString(props.address);
    return address.getType() === Cardano.AddressType.BasePaymentScriptStakeKey ||
      address.getType() === Cardano.AddressType.BasePaymentScriptStakeScript ||
      address.getType() === Cardano.AddressType.EnterpriseScript
  } catch (e) {
    return false;
  }
})

const riskIcon = computed(() => {
  if (props.address === loggedWallet.value?.baseAddress) {
    return assets.resolveDappRisk(DappRisk.whitelist);
  }
  return assets.resolveDappRisk(DappRisk[props.risk as keyof typeof DappRisk]);
});

const riskTooltip = computed(() => {
  const currentRisk = props.address === loggedWallet.value?.baseAddress
    ? DappRisk.whitelist
    : DappRisk[props.risk as keyof typeof DappRisk];

  switch (currentRisk) {
    case DappRisk.whitelist:
      return t('common.trustedAddressTooltip');
    case DappRisk.blacklist:
      return t('common.blacklistedAddressTooltip');
    case DappRisk.suspicious:
      return t('common.suspiciousAddressTooltip');
    case DappRisk.timeout:
      return t('common.timeoutAddressTooltip');
    case DappRisk.unknown:
    default:
      return t('common.unknownAddressTooltip');
  }
});
</script>
<style scoped>
#dapp-receiver-wrap {
  background-color: var(--g-canvas) !important;
  border: 1px solid var(--g-hairline-2) !important;
  border-radius: var(--g-r-control);
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
  color: var(--g-text-1);
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
  color: var(--g-text-1);
  font-size: 11px;
  font-weight: 400;
  line-height: 12px;
  word-wrap: break-word;
  word-break: break-all;
  align-items: center;
}
#dapp-receiver-wrap.unknown {
  background: var(--g-raised);
}
#dapp-receiver-wrap.suspicious {
  background: var(--g-warning-fill);
}
#dapp-receiver-wrap.blacklist {
  background: var(--g-error-fill);
}
#dapp-receiver-wrap.whitelist {
  background: var(--g-success-fill);
}
</style>
