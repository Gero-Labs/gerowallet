<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="emit('close')"
    :title="$t('wallet.receive')"
    :subtitle="$t('wallet.myWalletAddresses')"
    :min-height="300"
    :height="600"
    :persistent="false"
    :img="assets.qrCodeSvg"
    imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
  >
    <v-card-title class="py-0 transparent">
      <v-tabs
        v-model="tab"
        centered
        background-color="transparent"
      >
        <v-tab>{{ $t('wallet.payment') }}</v-tab>
        <v-tab>{{ $t('wallet.reward') }}</v-tab>
        <v-tab v-if="networks.resolveGovernanceSupport(loggedWallet?.chain, loggedWallet?.network)">DRep 105</v-tab>
        <v-tab v-if="networks.resolveGovernanceSupport(loggedWallet?.chain, loggedWallet?.network)">DRep 129</v-tab>
      </v-tabs>
      <v-tabs-items v-model="tab" class="transparent">
        <v-tab-item eager v-for="(item, i) in tabs" :key="i" v-if="item.enabled">
          <v-list-item three-line class="px-0">
            <v-list-item-avatar size="160" rounded>
              <div
                class="qr-container"
                :ref="el => setQrContainerRef(el, i)"
              ></div>
            </v-list-item-avatar>
            <v-list-item-content class="pl-4">
              <h4 class="address-label">{{ item.label }}</h4>
              <div class="address-row">
              <span
                class="address-text"
                @click="triggerCopy(item.value)"
              >
                {{ filters.truncate(item.value) }}
              </span>
                <CopyButton class="ml-1" :ref="el => setCopyButtonRef(el, item.value)" x-small :value="item.value" />
              </div>
              <p class="path-text">{{ $t('navigation.hdPath') }}: {{ item.path }}</p>
              <p class="path-text">{{ $t('navigation.cred') }}: {{ filters.truncate(item.cred) }}<CopyButton class="ml-1" :value="item.cred" x-small /></p>
              <p class="info-text">{{ item.info }}</p>
            </v-list-item-content>
          </v-list-item>
        </v-tab-item>
      </v-tabs-items>
    </v-card-title>
    <v-card-text class="px-3 pb-3">
      <v-expansion-panels v-model="expandedPanels" multiple class="accordion-container">
        <v-expansion-panel style="background-color: #1e273ab3; border-radius: 8px;">
          <v-expansion-panel-header>
            <div class="header-container">
              <div class="icon-container">
                <v-icon color="#333741">mdi-wallet-outline</v-icon>
              </div>
              <h3>{{ $t('wallet.usedAddresses') }} ({{ usedAddresses.length }})</h3>
              <v-spacer />
              <v-switch
                inset
                class="my-0 mr-2"
                v-model="showInternal"
                dense
                hide-details
                :label="$t('wallet.showInternal')"
                @click.stop
              />
            </div>
          </v-expansion-panel-header>
          <v-expansion-panel-content class="content-container">
            <v-card flat class="transparent">
              <v-card-text class="px-0 pt-2">
                <v-simple-table dense style="background-color: transparent">
                  <thead>
                    <tr>
                      <th class="text-left grey--text">{{ $t('wallet.address') }}</th>
                      <th class="text-left grey--text">{{ $t('wallet.path') }}</th>
                      <th class="text-center grey--text">{{ $t('wallet.type') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(item, index) in usedAddresses" :key="index">
                      <td class="text-left">
                        <div class="d-flex align-center">
                          <span class="address-cell">{{ filters.shortenStringWithEllipsis(item.address, 40) }}</span>
                          <CopyButton x-small :value="item.address" class="ml-1" />
                        </div>
                        <div class="d-flex align-center mt-1">
                          <span class="caption grey--text">Cred: {{ filters.truncate(item.cred) }}</span>
                          <CopyButton x-small :value="item.cred" class="ml-1" />
                        </div>
                      </td>
                      <td class="text-left">
                        <span class="path-cell">{{ item.path }}</span>
                      </td>
                      <td class="text-center">
                        <v-chip
                          x-small
                          outlined
                          :color="item.internal ? 'orange' : 'primary'"
                        >
                          {{ item.internal ? 'Internal' : 'External' }}
                        </v-chip>
                      </td>
                    </tr>
                  </tbody>
                </v-simple-table>
                <div v-if="usedAddresses.length === 0" class="text-center py-4 grey--text">
                  No used addresses found
                </div>
              </v-card-text>
            </v-card>
          </v-expansion-panel-content>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, watch, nextTick, toRefs, computed } from 'vue';
import QRCodeStyling from 'qr-code-styling';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { Blockchain } from '@/models/types';


const { t } = useTranslation();

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close']);

const { loggedWallet, keys } = toRefs(walletStore);

const showInternal = ref<boolean>(false);
const expandedPanels = ref<number[]>([]);

// current tab index
const tab = ref(0);

// refs for the QR code container elements
const qrContainers = [ref<HTMLElement | null>(null), ref<HTMLElement | null>(null), ref<HTMLElement | null>(null), ref<HTMLElement | null>(null)];
// hold QRCodeStyling instances
const qrcodes: (QRCodeStyling | null)[] = [null, null, null];
let copyButtonRefs = {};

const setQrContainerRef = (el: Element | null, index: number) => {
  if (el && qrContainers[index]) {
    qrContainers[index].value = el as HTMLElement;
  }
}

const setCopyButtonRef = (el, address) => {
  if (!copyButtonRefs) {
    copyButtonRefs = {};
  }
  if (el && address) {
    copyButtonRefs[address] = el;
  }
}

const triggerCopy = (address) => {
  const copyButtonRef = copyButtonRefs[address];
  if (copyButtonRef && typeof copyButtonRef.copy === 'function') {
    copyButtonRef.copy();
  }
}

const tabs = computed(() => {
  if (!keys.value) {
    return []
  }
  return [
    {
      label: t('wallet.paymentAddress'),
      value: keys.value.payment[0].address,
      path: keys.value.payment[0].path,
      cred: keys.value.payment[0].cred,
      info: t('wallet.paymentAddressInfo', { ticker: networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network) }),
      enabled: true,
    },
    {
      label: t('wallet.rewardAddress'),
      value: keys.value.stake[0].address,
      path: keys.value.stake[0].path,
      cred: keys.value.stake[0].cred,
      info: t('wallet.rewardAddressInfo'),
      enabled: true,
    },
    {
      label: t('wallet.drepId105'),
      value: keys.value.drep105[0].address,
      path: keys.value.drep105[0].path,
      cred: keys.value.drep105[0].cred,
      info: t('wallet.drepIdInfo'),
      enabled: networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
    },
    {
      label: t('wallet.drepId129'),
      value: keys.value.drep129[0].address,
      path: keys.value.drep129[0].path,
      cred: keys.value.drep129[0].cred,
      info: t('wallet.drepIdInfo'),
      enabled: networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
    },
  ]
});

const usedAddresses = computed(() => {
  const results = []
  if (!keys.value) {
    return results
  }
  results.push(...keys.value.payment.filter(a => a.used));
  if (showInternal.value) {
    results.push(...keys.value.change.filter(a => a.used).map(el => {
      return {
        ...el,
        internal: true,
      }
    }));
  }
  console.log('results', results)
  return results
});

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

// whenever the dialog opens, initialize or update all QR codes
watch(
  () => props.isOpen,
  async open => {
    if (!open) return;
    await nextTick();

    tabs.value.forEach((tabItem, i) => {
      // create QR instance if missing
      if (!qrcodes[i]) {
        qrcodes[i] = new QRCodeStyling({
          width: 160,
          height: 160,
          type: 'svg',
          data: tabItem.value,
          image: isApex.value ? assets.geroLogoApex : assets.geroLogo,
          margin: 2,
          qrOptions: { typeNumber: 0, mode: 'Byte', errorCorrectionLevel: 'Q' },
          imageOptions: { hideBackgroundDots: true, imageSize: 0.5, margin: 10, crossOrigin: 'anonymous' },
          backgroundOptions: { color: '#ffffff' },
          cornersSquareOptions: { type: 'extra-rounded' },
          cornersDotOptions: { type: 'dot' }
        });
      } else {
        qrcodes[i]!.update({ data: tabItem.value });
      }

      // append into the container
      const el = qrContainers[i].value;
      if (el) {
        el.innerHTML = '';
        qrcodes[i]!.append(el);
      }
    });
  },
  { immediate: true },
);
</script>

<style scoped>
.qr-container {
  border-radius: 8px;
}

.address-label {
  font-weight: bold;
  font-size: 1.2rem;
  color: #fff;
}

.address-row {
  display: flex;
  align-items: center;
}

.address-text {
  word-break: break-all;
  cursor: pointer;
}

.path-text {
  font-size: 0.9rem;
  color: #bbb;
}

.info-text {
  font-size: 1rem;
  color: #ddd;
  margin-top: 0.5rem;
  word-break: break-word;
}

.used-title {
  margin-top: 1rem;
  font-weight: 600;
}

.cred-text {
  font-size: 0.9rem;
  color: #ccc;
}

/* Collapsible panel styles */
.accordion-container {
  background-color: transparent !important;
  box-shadow: none !important;
}

.accordion-container .v-expansion-panel {
  margin-bottom: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
}

.accordion-container .v-expansion-panel:hover {
  border-color: rgba(0, 223, 243, 0.3);
  box-shadow: 0 0 10px rgba(0, 223, 243, 0.1);
}

.accordion-container .v-expansion-panel--active {
  border-color: rgba(0, 223, 243, 0.5);
  box-shadow: 0 0 15px rgba(0, 223, 243, 0.2);
}

.header-container {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 4px 0;
}

.icon-container {
  background-color: rgba(0, 223, 243, 0.1);
  border-radius: 50%;
  padding: 8px;
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-container .v-icon {
  color: #00dff3 !important;
}

.content-container {
  background-color: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.address-cell {
  font-family: monospace;
  font-size: 0.875rem;
}

.path-cell {
  font-family: monospace;
  font-size: 0.875rem;
  color: #bbb;
}

/* Override expansion panel chevron color */
.v-expansion-panel-header__icon .v-icon {
  color: #00dff3 !important;
}

/* Style the table headers */
.v-data-table thead th {
  font-size: 0.75rem !important;
  font-weight: 600 !important;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Style the switch inside the header */
.v-expansion-panel-header .v-input--switch {
  margin-top: 0 !important;
  padding-top: 0 !important;
}

.v-expansion-panel-header .v-input--switch .v-label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
}
</style>
