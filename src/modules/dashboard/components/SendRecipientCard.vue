<template>
  <div
    class="recipient-card"
    :class="{
      'recipient-card--multi': canDelete || showHeader,
      'recipient-card--expanded': isExpanded && showHeader,
      'mb-3': showHeader,
    }"
  >
    <!-- Collapsed view (multi-recipient only) -->
    <div
      v-if="!isExpanded && showHeader"
      class="recipient-card__collapsed"
      @click="$emit('expand')"
    >
      <v-icon small class="mr-2" color="#00DFF3">mdi-account-outline</v-icon>
      <span class="caption font-weight-medium mr-1" style="color: #CECFD2;">
        {{ $t('wallet.recipient') }} {{ index + 1 }}
      </span>
      <span class="collapsed-address">
        {{ displayAddress }}
      </span>
      <v-chip v-if="totalAdaDisplay" x-small color="#00DFF330" text-color="#00DFF3" class="ml-auto">
        {{ totalAdaDisplay }}
      </v-chip>
      <v-icon small class="ml-2" style="opacity: 0.3;">mdi-pencil-outline</v-icon>
    </div>

    <!-- Expanded view -->
    <template v-if="isExpanded">
      <!-- Card header (multi-recipient only) -->
      <div v-if="showHeader" class="recipient-card__header">
        <v-icon x-small class="mr-1" color="#00DFF3">mdi-account-outline</v-icon>
        <span class="caption font-weight-medium" style="color: #94969C; font-size: 11px !important;">
          {{ $t('wallet.recipient') }} {{ index + 1 }}
        </span>
        <v-spacer />
        <v-tooltip bottom content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn icon x-small class="mr-0" v-bind="attrs" v-on="on" @click="$emit('duplicate')">
              <v-icon style="font-size: 13px;" color="rgba(255,255,255,0.35)">mdi-content-copy</v-icon>
            </v-btn>
          </template>
          <span>{{ $t('wallet.duplicateRecipient') }}</span>
        </v-tooltip>
        <v-tooltip v-if="canDelete" bottom content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn icon x-small v-bind="attrs" v-on="on" @click="$emit('remove')">
              <v-icon style="font-size: 13px;" color="#F97066">mdi-trash-can-outline</v-icon>
            </v-btn>
          </template>
          <span>{{ $t('wallet.removeRecipient') }}</span>
        </v-tooltip>
      </div>

      <!-- Card content -->
      <div :class="showHeader ? 'px-3 pb-3' : ''">
        <!-- Contact/QR row -->
        <v-row no-gutters class="mb-2">
          <v-col cols="6" class="pr-1">
            <v-menu
              v-model="contactsMenu"
              :close-on-content-click="false"
              offset-y
              min-width="340"
              max-height="300"
              transition="fade-transition"
              attach
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  outlined
                  block
                  color="#272930"
                  style="background-color: #0F0F0F; height: 36px;"
                  class="pl-0 contact-btn"
                  :disabled="!contacts || Object.values(contacts).length === 0"
                  v-bind="attrs"
                  v-on="on"
                >
                  <v-list-item dense class="px-0" style="min-height: 36px;">
                    <v-avatar size="28" class="mx-0">
                      <v-icon small color="#00DFF3">mdi-book-open-variant-outline</v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: white; font-size: 11px">{{ $t('wallet.contacts') }}</v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-btn>
              </template>
              <v-card outlined style="background: #0c0e12 !important; border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 16px !important; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;">
                <v-card-title class="py-2">
                  {{ $t('wallet.contacts') }}
                  <v-spacer />
                  <v-btn icon small @click="contactsMenu = false"><v-icon>mdi-window-close</v-icon></v-btn>
                </v-card-title>
                <v-card-text class="pa-0">
                  <v-data-table
                    dense
                    class="transparent"
                    :headers="contactsHeaders"
                    :items="contacts ? Object.values(contacts) : []"
                    hide-default-footer
                    disable-pagination
                    @click:row="selectContact"
                  >
                    <template v-slot:[`item.address`]="{ item }">
                      {{ filters.truncate(item.address) }}
                    </template>
                  </v-data-table>
                </v-card-text>
              </v-card>
            </v-menu>
          </v-col>
          <v-col cols="6" class="pl-1">
            <v-btn
              outlined
              block
              color="#272930"
              style="background-color: #0F0F0F; height: 36px;"
              class="pl-0 contact-btn"
              @click="qrScanDialog = true"
            >
              <v-list-item dense class="px-0" style="min-height: 36px;">
                <v-avatar size="28" class="mx-0">
                  <v-icon small color="#00DFF3">mdi-qrcode</v-icon>
                </v-avatar>
                <v-list-item-content>
                  <v-list-item-title style="color: white; font-size: 11px">{{ $t('wallet.qrScan') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-btn>
            <QRAddressScannerDialog
              :isOpen="qrScanDialog"
              :chain="loggedWallet && loggedWallet.chain"
              :network="loggedWallet && loggedWallet.network"
              @close="qrScanDialog = false"
              @scan="onQRScan"
            />
          </v-col>
        </v-row>

        <!-- Address textarea -->
        <v-textarea
          v-if="loggedWallet"
          v-model="localAddress"
          :label="$t('wallet.recipientAddress')"
          :placeholder="isMainnetCardano ? $t('wallet.enterRecipientOrHandle') : $t('wallet.enterRecipientAddress')"
          rows="3"
          outlined
          :rules="[rules.recipientRules(loggedWallet.chain, loggedWallet.network)]"
          class="recipient-address"
          :loading="resolving"
          hide-details
          dense
          clearable
          @input="resolveAddress"
        >
          <template v-slot:append>
            <v-progress-circular v-if="resolving" color="white" size="20" indeterminate />
            <v-icon v-else-if="resolvedFailed" color="#F97066">mdi-alert</v-icon>
          </template>
        </v-textarea>

        <!-- Handle resolution preview -->
        <v-list-item v-if="handleAsset" class="px-0 pt-1" style="min-height: 48px;">
          <v-list-item-avatar v-if="handleAsset.img" size="40" rounded>
            <v-img :src="handleAsset.img" contain />
          </v-list-item-avatar>
          <v-list-item-subtitle style="white-space: normal; font-size: 11px">
            {{ recipient.resolvedAddress }}
          </v-list-item-subtitle>
        </v-list-item>

        <!-- Assets section (shown only when address is valid) -->
        <div v-if="isAddressValid" class="mt-2">
          <AssetsToSendStep
            :value="assetsModel"
            :tokens="availableTokens"
            :excluded-collectible-fingerprints="excludedCollectibleFingerprints"
            @input="onAssetsInput"
            @setMax="onSetMax"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref, computed, watch } from 'vue';
import { toRefs } from 'vue';
import debounce from 'lodash/debounce';
import AssetsToSendStep from './AssetsToSendStep.vue';
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import type { SendRecipient, Token } from '@/models/send-flow.types';
import adaHandleApi from '@/api/ada-handle.api';
import rules from '@/utils/rules';
import filters from '@/shared/utils/filters';
import { isPaymentAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';
import assets from '@/utils/assets';

interface Props {
  recipient: SendRecipient;
  index: number;
  isExpanded: boolean;
  canDelete: boolean;
  /** Whether to show the card header (Recipient N label + actions) — false for single-recipient */
  showHeader: boolean;
  /** All wallet tokens with balances reduced by other cards' commitments */
  availableTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
  /** Fingerprints of NFTs fully committed by other cards */
  excludedCollectibleFingerprints?: Set<string>;
}

const props = withDefaults(defineProps<Props>(), {
  showHeader: false,
});
const emit = defineEmits<{
  (e: 'expand'): void;
  (e: 'update:recipient', value: SendRecipient): void;
  (e: 'duplicate'): void;
  (e: 'remove'): void;
  (e: 'setMax', payload: { tokenIndex: number }): void;
}>();

const { loggedWallet, contacts } = toRefs(walletStore);

const localAddress = ref<string>(props.recipient.address);
const resolving = ref<boolean>(false);
const resolvedFailed = ref<boolean>(false);
const handleAsset = ref<{ name?: string; img?: string } | null>(null);
const contactsMenu = ref<boolean>(false);
const qrScanDialog = ref<boolean>(false);

const contactsHeaders = [
  { text: 'Name', value: 'name' },
  { text: 'Address', value: 'address' },
];

const isMainnetCardano = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO &&
  loggedWallet.value?.network === Network.MAINNET
);

const nativeTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

const isAddressValid = computed(() => {
  const addr = props.recipient.resolvedAddress || localAddress.value;
  if (!addr) return false;
  const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network);
  return rule(addr) === true;
});

const displayAddress = computed(() => {
  const addr = props.recipient.address || props.recipient.resolvedAddress || '';
  return filters.truncate(addr);
});

const totalAdaDisplay = computed(() => {
  const adaToken = props.recipient.selectedTokens.find(t => t.ticker === nativeTicker.value);
  if (!adaToken || !Number(adaToken.quantity)) return '';
  return `${adaToken.quantity} ${nativeTicker.value}`;
});

const assetsModel = computed(() => ({
  selectedTokens: props.recipient.selectedTokens,
  selectedCollectibles: props.recipient.selectedCollectibles,
  minAda: props.recipient.minAda,
  adaShortage: props.recipient.adaShortage,
}));

function emitAddress(paymentAddress: string, rawInput: string, resolved: boolean) {
  emit('update:recipient', {
    ...props.recipient,
    address: rawInput,
    resolvedAddress: resolved ? paymentAddress : (isPaymentAddress(rawInput) ? rawInput : null),
  });
}

function onAssetsInput(val: { selectedTokens?: SendRecipient['selectedTokens']; selectedCollectibles?: SendRecipient['selectedCollectibles'] }) {
  emit('update:recipient', {
    ...props.recipient,
    selectedTokens: val.selectedTokens ?? props.recipient.selectedTokens,
    selectedCollectibles: val.selectedCollectibles ?? props.recipient.selectedCollectibles,
  });
}

function onSetMax(tokenIndex: number) {
  emit('setMax', { tokenIndex });
}

const resolveAdaHandle = debounce(async (val: string) => {
  if (val.length <= 1) {
    resolvedFailed.value = true;
    return;
  }
  resolving.value = true;
  try {
    const res = await adaHandleApi.resolve(val.replace('$', ''));
    if (res.status === 200 && res.data?.resolved_addresses?.ada) {
      handleAsset.value = { name: res.data.name, img: assets.resolveIcon(res.data.image) };
      resolvedFailed.value = false;
      emitAddress(res.data.resolved_addresses.ada, val, true);
    } else {
      resolvedFailed.value = true;
      handleAsset.value = null;
      emitAddress('', val, false);
    }
  } catch {
    resolvedFailed.value = true;
    handleAsset.value = null;
    emitAddress('', val, false);
  } finally {
    resolving.value = false;
  }
}, 1000);

function resolveAddress(val: string | null) {
  const address = val || '';
  handleAsset.value = null;
  resolvedFailed.value = false;
  if (address.startsWith('$') && isMainnetCardano.value) {
    resolveAdaHandle(address);
  } else {
    emitAddress(address, address, false);
  }
}

function onQRScan(address: string) {
  localAddress.value = address;
  handleAsset.value = null;
  qrScanDialog.value = false;
  emitAddress(address, address, false);
}

function selectContact(item: { handle?: string; address: string; name?: string }) {
  contactsMenu.value = false;
  if (item.handle && isMainnetCardano.value) {
    localAddress.value = item.handle;
    resolveAdaHandle(item.handle);
  } else {
    localAddress.value = item.address;
    emitAddress(item.address, item.address, false);
  }
}

watch(() => props.recipient.address, (newVal) => {
  if (newVal !== localAddress.value) {
    localAddress.value = newVal;
    if (!newVal) {
      handleAsset.value = null;
      resolvedFailed.value = false;
    }
  }
});
</script>

<style scoped>
/* Single recipient — no card wrapper, content flows directly */
.recipient-card {
  text-align: left;
}

/* Multi-recipient — card wrapper with subtle border */
.recipient-card--multi {
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  transition: border-color 0.2s ease;
}

.recipient-card--multi:hover {
  border-color: rgba(255, 255, 255, 0.1);
}

.recipient-card--expanded {
  border-color: rgba(0, 223, 243, 0.15) !important;
}

/* Collapsed state */
.recipient-card__collapsed {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  min-height: 44px;
  transition: background-color 0.15s ease;
  border-radius: 12px;
}

.recipient-card__collapsed:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.collapsed-address {
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Expanded header */
.recipient-card__header {
  display: flex;
  align-items: center;
  padding: 8px 12px 4px;
  min-height: 32px;
}

/* Contact buttons */
.contact-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
}

/* Address textarea styling — matches existing SendRecipientDetailsStep */
.recipient-address :deep(.v-input__control .v-input__slot) {
  background-color: #292929;
  border-radius: 6px;
  padding: 5px 10px;
}

.recipient-address :deep(textarea) {
  resize: none;
}
</style>
