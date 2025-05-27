<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="emit('close')"
    title="Receive ADA"
    subtitle="Share your address or scan the QR code to receive ADA safely."
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
        <v-tab>DRep</v-tab>
      </v-tabs>
      <v-tabs-items v-model="tab" class="transparent">
        <v-tab-item eager v-for="(item, i) in tabs" :key="i">
          <v-list-item three-line class="px-0">
            <v-list-item-avatar size="160" rounded>
              <div
                class="qr-container"
                :ref="el => qrContainers[i].value = el"
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
                <CopyButton :ref="el => setCopyButtonRef(el, item.value)" x-small :value="item.value" />
              </div>
              <p class="path-text">{{ item.path }}</p>
              <p class="info-text">{{ item.info }}</p>
            </v-list-item-content>
          </v-list-item>
        </v-tab-item>
      </v-tabs-items>
    </v-card-title>
    <v-card-title class="py-0 px-3">Used Addresses</v-card-title>
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
                <span style="color: white">Cred: </span>{{ filters.shortenStringWithEllipsis(item.cred, 40) }}
                <CopyButton x-small :value="item.cred" />
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </template>
      </v-data-table>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import QRCodeStyling from 'qr-code-styling';
import { useStore } from '@/stores';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import assets from '@/utils/assets';
import { governanceStore } from '@/stores/modules/governance';
import { walletConfigStore } from '@/stores/modules/walletConfig';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits(['close']);

const store = useStore();
const governanceStore1 = governanceStore();
const walletConfigStore1 = walletConfigStore();

// current tab index
const tab = ref(0);

// refs for the QR code container elements
const qrContainers = [ref<HTMLElement | null>(null), ref<HTMLElement | null>(null), ref<HTMLElement | null>(null)];
// hold QRCodeStyling instances
const qrcodes: (QRCodeStyling | null)[] = [null, null, null];
let copyButtonRefs = {};

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

// tab definitions
const tabs = [
  {
    label: 'Payment Address',
    value: store.baseAddress,
    path: 'm/1852\'/1815\'/0\'/0/0',
    info: 'Generate new address after each use for privacy.',
  },
  {
    label: 'Reward (Stake) Address',
    value: store.stakeAddress,
    path: 'm/1852\'/1815\'/0\'/2/0',
    info: 'Use this to claim staking rewards.',
  },
  {
    label: 'Delegated Rep (DRep) ID',
    value: governanceStore1.drepId,
    path: 'm/1852\'/1815\'/0\'/3/0',
    info: 'Share to delegate your stake securely.',
  },
];

// table for used addresses
const usedHeaders = [{ text: 'Address', value: 'address', align: 'left' }];
const usedAddresses = ref<any[]>([]);

function updateUsed() {
  const all = walletConfigStore1.addresses || {};
  usedAddresses.value = Object.values(all).filter(a => a.address !== store.baseAddress);
}

function copyAddress(addr: string) {
  navigator.clipboard.writeText(addr);
}

// whenever the dialog opens, initialize or update all QR codes
watch(
  () => props.isOpen,
  async open => {
    if (!open) return;
    await nextTick();

    tabs.forEach((tabItem, i) => {
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

    updateUsed();
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
