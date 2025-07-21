<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="emit('close')"
    title="My Wallet Addresses"
    subtitle=""
    :min-height="300"
    :height="600"
  >
    <v-card-title class="py-0 transparent">
      <v-tabs
        v-model="tab"
        centered
        background-color="transparent"
      >
        <v-tab>Payment</v-tab>
        <v-tab>Reward</v-tab>
        <v-tab>DRep 105</v-tab>
        <v-tab>DRep 129</v-tab>
      </v-tabs>
      <v-tabs-items v-model="tab" class="transparent">
        <v-tab-item eager v-for="(item, i) in tabs" :key="i">
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
              <p class="path-text">HD Path: {{ item.path }}</p>
              <p class="path-text">Cred: {{ filters.truncate(item.cred) }}<CopyButton class="ml-1" :value="item.cred" x-small /></p>
              <p class="info-text">{{ item.info }}</p>
            </v-list-item-content>
          </v-list-item>
        </v-tab-item>
      </v-tabs-items>
    </v-card-title>
    <v-card-title class="py-0 pb-2 px-3">
      Used Addresses
      <v-spacer />
      <v-switch
        inset
        class="my-0"
        v-model="showInternal"
        dense
        hide-details
        label="Internal Addresses"
      />
    </v-card-title>
    <v-card-text class="px-3 pb-0">
      <v-data-table
        :headers="usedHeaders"
        :items="usedAddresses"
        hide-default-footer
        hide-default-header
        disable-pagination
      >
        <template #item.address="{ item }">
          <v-list-item class="py-0">
            <v-list-item-content>
              <v-list-item-title>
                {{ filters.shortenStringWithEllipsis(item.address, 40) }}
                <CopyButton x-small :value="item.address" />
              </v-list-item-title>
              <v-list-item-subtitle>
                <span style="color: white">HD Path: </span>{{ item.path }}
              </v-list-item-subtitle>
              <v-list-item-subtitle>
                <span style="color: white">Cred: </span>{{ filters.truncate(item.cred) }}
                <CopyButton x-small :value="item.cred" />
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-action v-if="item.internal">
              <v-chip small outlined color="primary">Internal</v-chip>
            </v-list-item-action>
          </v-list-item>
        </template>
      </v-data-table>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, toRefs, computed } from 'vue';
import QRCodeStyling from 'qr-code-styling';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close']);

const { loggedWallet, keys } = toRefs(walletStore);

const showInternal = ref<boolean>(false);

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
      label: 'Payment Address',
      value: keys.value.payment[0].address,
      path: keys.value.payment[0].path,
      cred: keys.value.payment[0].cred,
      info: `Share your payment address or scan the QR code to receive ${networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)} safely.`,
    },
    {
      label: 'Reward (Stake) Address',
      value: keys.value.stake[0].address,
      path: keys.value.stake[0].path,
      cred: keys.value.stake[0].cred,
      info: 'Use this to claim staking rewards.',
    },
    {
      label: 'Delegated Representative ID (CIP-105)',
      value: keys.value.drep105[0].address,
      path: keys.value.drep105[0].path,
      cred: keys.value.drep105[0].cred,
      info: 'Used to Participate in Cardano Governance Actions.',
    },
    {
      label: 'Delegated Representative ID (CIP-129)',
      value: keys.value.drep129[0].address,
      path: keys.value.drep129[0].path,
      cred: keys.value.drep129[0].cred,
      info: 'Used to Participate in Cardano Governance Actions.',
    },
  ]
})

// table for used addresses
const usedHeaders = [{ text: 'Address', value: 'address', align: 'left' }];

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
  return results
})

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
          image: assets.geroLogo,
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
}

.used-title {
  margin-top: 1rem;
  font-weight: 600;
}

.cred-text {
  font-size: 0.9rem;
  color: #ccc;
}
</style>
