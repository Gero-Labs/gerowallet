<template>
  <div
    class="recipient-card"
    :class="{
      'recipient-card--multi': showHeader,
      'recipient-card--expanded': isExpanded && showHeader,
    }"
  >
    <!-- ─── Collapsed view (multi-recipient only) ─── -->
    <div
      v-if="!isExpanded && showHeader"
      class="recipient-card__collapsed"
      @click="$emit('expand')"
    >
      <div class="collapsed-left">
        <v-icon x-small color="#00DFF3" class="mr-2">mdi-account-outline</v-icon>
        <span class="collapsed-label">
          {{ $t('wallet.recipient') }} {{ index + 1 }}
        </span>
        <span v-if="displayAddress" class="collapsed-address">
          {{ displayAddress }}
        </span>
      </div>
      <div class="collapsed-right">
        <v-chip v-if="totalAdaDisplay" x-small color="#00DFF330" text-color="#00DFF3">
          {{ totalAdaDisplay }}
        </v-chip>
        <v-icon x-small class="ml-1" style="opacity: 0.25;">mdi-chevron-down</v-icon>
      </div>
    </div>

    <!-- ─── Expanded view ─── -->
    <template v-if="isExpanded">
      <!-- Header (multi-recipient only) -->
      <div v-if="showHeader" class="recipient-card__header">
        <v-icon x-small class="mr-1" color="#00DFF3">mdi-account-outline</v-icon>
        <span class="header-label">
          {{ $t('wallet.recipient') }} {{ index + 1 }}
        </span>
        <v-spacer />
        <v-tooltip bottom content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-btn icon x-small v-bind="attrs" v-on="on" @click="$emit('duplicate')">
              <v-icon style="font-size: 13px;" color="rgba(255,255,255,0.3)">mdi-content-duplicate</v-icon>
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

      <!-- Card body -->
      <div :class="showHeader ? 'recipient-card__body' : ''">
        <!-- Address row: [Address field] [Contacts] [QR] -->
        <div class="address-row">
          <!-- Address text field (single line) -->
          <v-text-field
            v-if="loggedWallet"
            v-model="localAddress"
            :placeholder="isMainnetCardano ? $t('wallet.enterRecipientOrHandle') : $t('wallet.enterRecipientAddress')"
            outlined
            dense
            hide-details="auto"
            class="address-input"
            :rules="[rules.recipientRules(loggedWallet.chain, loggedWallet.network)]"
            :loading="resolving"
            clearable
            @input="resolveAddress"
          >
            <!-- Handle image prepended inside input when resolved -->
            <template v-slot:prepend-inner>
              <v-avatar v-if="handleAsset && handleAsset.img" size="20" class="mr-1" style="margin-top: -2px;">
                <v-img :src="handleAsset.img" contain />
              </v-avatar>
            </template>
            <template v-slot:append>
              <v-progress-circular v-if="resolving" color="white" size="16" width="2" indeterminate />
              <v-icon v-else-if="resolvedFailed" color="#F97066" small>mdi-alert</v-icon>
            </template>
          </v-text-field>

          <!-- Contact book button -->
          <v-btn
            icon
            small
            class="address-row__icon-btn"
            @click="contactsDialog = true"
          >
            <v-icon small color="#00DFF3">mdi-book-open-variant-outline</v-icon>
          </v-btn>

          <!-- Contacts dialog -->
          <v-dialog v-model="contactsDialog" max-width="480" overlay-color="#1f242f" overlay-opacity="0.7">
            <v-card class="contacts-dialog-card">
              <v-card-title class="contacts-dialog-header">
                <v-icon small color="#00DFF3" class="mr-2">mdi-book-open-variant-outline</v-icon>
                {{ $t('wallet.contacts') }}
                <v-spacer />
                <v-btn icon small @click="contactsDialog = false">
                  <v-icon>mdi-window-close</v-icon>
                </v-btn>
              </v-card-title>

              <v-card-text class="contacts-dialog-body">
                <template v-if="contacts && Object.values(contacts).length > 0">
                  <div
                    v-for="contact in Object.values(contacts)"
                    :key="contact.address"
                    class="contact-item"
                    @click="selectContact(contact)"
                  >
                    <div class="contact-item__info">
                      <span class="contact-item__name">{{ contact.name || $t('wallet.unnamed') }}</span>
                      <span class="contact-item__address">{{ filters.truncate(contact.address, 20) }}</span>
                    </div>
                    <v-icon x-small style="opacity: 0.3;">mdi-chevron-right</v-icon>
                  </div>
                </template>
                <div v-else class="contacts-empty">
                  <v-icon size="40" color="rgba(255,255,255,0.15)" class="mb-3">mdi-book-open-variant-outline</v-icon>
                  <div>{{ $t('wallet.noContacts') }}</div>
                </div>
              </v-card-text>
            </v-card>
          </v-dialog>

          <!-- QR scan button -->
          <v-btn
            icon
            small
            class="address-row__icon-btn"
            @click="qrScanDialog = true"
          >
            <v-icon small color="#00DFF3">mdi-qrcode</v-icon>
          </v-btn>
          <QRAddressScannerDialog
            :isOpen="qrScanDialog"
            :chain="loggedWallet && loggedWallet.chain"
            :network="loggedWallet && loggedWallet.network"
            @close="qrScanDialog = false"
            @scan="onQRScan"
          />
        </div>

        <!-- Assets section (shown only when address is valid) -->
        <div class="assets-section">
          <AssetsToSendStep
            ref="assetsStepRef"
            :value="assetsModel"
            :tokens="availableTokens"
            :excluded-collectible-fingerprints="excludedCollectibleFingerprints"
            :compact="true"
            @input="onAssetsInput"
            @setMax="onSetMax"
            @openCollectiblesDialog="collectiblesDialogOpen = true"
          />
          <SelectCollectiblesDialog
            :isOpen="collectiblesDialogOpen"
            :collections="assetsStepRef?.collections || []"
            :selectedCollectibles="assetsStepRef?.selectedCollectibles || []"
            @close="collectiblesDialogOpen = false"
            @update:selectedCollectibles="onCollectiblesUpdate"
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
import SelectCollectiblesDialog from '@/modules/dashboard/dialogs/SelectCollectiblesDialog.vue';
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
  showHeader: boolean;
  availableTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
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

const assetsStepRef = ref<InstanceType<typeof AssetsToSendStep> | null>(null);
const collectiblesDialogOpen = ref<boolean>(false);

const localAddress = ref<string>(props.recipient.address);
const resolving = ref<boolean>(false);
const resolvedFailed = ref<boolean>(false);
const handleAsset = ref<{ name?: string; img?: string } | null>(null);
const contactsDialog = ref<boolean>(false);
const qrScanDialog = ref<boolean>(false);

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

function onCollectiblesUpdate(collectibles: any[]) {
  if (assetsStepRef.value) {
    assetsStepRef.value.updateCollectibles(collectibles);
  }
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
      const resolved = res.data.resolved_addresses.ada;
      localAddress.value = `${val} (${filters.truncate(resolved)})`;
      emitAddress(resolved, val, true);
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
  contactsDialog.value = false;
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

const cardTotalAmounts = computed(() => assetsStepRef.value?.totalAmounts ?? null);

defineExpose({ cardTotalAmounts });
</script>

<style scoped>
.recipient-card {
  text-align: left;
}

/* ─── Multi-recipient card wrapper ─── */
.recipient-card--multi {
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  margin-bottom: 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.recipient-card--expanded {
  border-color: rgba(0, 223, 243, 0.15) !important;
  box-shadow: 0 0 0 1px rgba(0, 223, 243, 0.06);
}

/* ─── Collapsed ─── */
.recipient-card__collapsed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  min-height: 42px;
  border-radius: 12px;
  transition: background-color 0.15s ease;
}

.recipient-card__collapsed:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.collapsed-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.collapsed-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: 8px;
}

.collapsed-label {
  color: #CECFD2;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  margin-right: 8px;
}

.collapsed-address {
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Expanded header ─── */
.recipient-card__header {
  display: flex;
  align-items: center;
  padding: 10px 14px 4px;
}

.header-label {
  color: #94969C;
  font-size: 12px;
  font-weight: 500;
}

/* ─── Expanded body ─── */
.recipient-card__body {
  padding: 0 14px 14px;
}

/* ─── Address row ─── */
.address-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.address-row__icon-btn {
  width: 28px !important;
  height: 28px !important;
  min-height: 28px !important;
  flex-shrink: 0;
  margin-top: 4px;
}

.address-input {
  flex: 1;
  min-width: 0;
}

.address-input :deep(.v-input__slot) {
  background-color: #292929 !important;
  border-radius: 8px;
  min-height: 32px !important;
  padding: 0 8px !important;
}

.address-input :deep(input) {
  font-size: 12px;
  padding: 4px 0;
}

.address-input :deep(fieldset) {
  border-color: transparent !important;
}

.address-input :deep(.v-input__slot:hover fieldset) {
  border-color: rgba(255, 255, 255, 0.15) !important;
}

.address-input :deep(.v-input--is-focused fieldset) {
  border-color: #00DFF3 !important;
  border-width: 1px !important;
}

/* ─── Handle resolved address ─── */
.resolved-address-text {
  white-space: normal;
  font-size: 11px;
  word-break: break-all;
  color: rgba(255, 255, 255, 0.5);
}

/* ─── Assets section ─── */
.assets-section {
  margin-top: 12px;
}

/* ─── Contacts dialog ─── */
.contacts-dialog-card {
  background: #0c0e12 !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 16px !important;
}

.contacts-dialog-header {
  font-size: 16px !important;
  font-weight: 600;
  padding: 16px 20px 8px !important;
}

.contacts-dialog-body {
  padding: 8px 12px 16px !important;
  max-height: 360px;
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.contact-item:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

.contact-item__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.contact-item__name {
  font-size: 13px;
  font-weight: 500;
  color: white;
}

.contact-item__address {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-family: monospace;
}

.contacts-empty {
  text-align: center;
  padding: 32px 16px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 13px;
}
</style>
