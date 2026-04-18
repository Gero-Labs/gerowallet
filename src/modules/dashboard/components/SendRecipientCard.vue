<template>
  <v-expansion-panels
    :value="isExpanded ? 0 : undefined"
    class="recipient-panel"
    flat
    :readonly="!canDelete"
    @change="onPanelChange"
  >
    <v-expansion-panel class="recipient-panel__panel">
      <!-- ─── Header ─── -->
      <v-expansion-panel-header class="recipient-panel__header" disable-icon-rotate>
        <div class="header-left">
          <span class="header-number">#{{ index + 1 }}</span>
          <span v-if="!isExpanded && displayAddress" class="collapsed-address ml-2">
            {{ displayAddress }}
          </span>
        </div>
        <template v-slot:actions>
          <v-chip v-if="!isExpanded && totalAdaDisplay" x-small color="#00DFF330" text-color="#00DFF3" class="mr-1">
            {{ totalAdaDisplay }}
          </v-chip>
          <!-- Action buttons (only when expanded) -->
          <v-tooltip v-if="isExpanded" bottom content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-btn icon x-small v-bind="attrs" v-on="on" @click.stop="$emit('duplicate')">
                <v-icon style="font-size: 13px;" color="rgba(255,255,255,0.3)">mdi-content-duplicate</v-icon>
              </v-btn>
            </template>
            <span>{{ $t('wallet.duplicateRecipient') }}</span>
          </v-tooltip>
          <v-tooltip v-if="isExpanded && canDelete" bottom content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-btn icon x-small v-bind="attrs" v-on="on" @click.stop="$emit('remove')">
                <v-icon style="font-size: 13px;" color="#F97066">mdi-trash-can-outline</v-icon>
              </v-btn>
            </template>
            <span>{{ $t('wallet.removeRecipient') }}</span>
          </v-tooltip>
          <v-icon v-if="!isExpanded" x-small style="opacity: 0.25;">mdi-chevron-down</v-icon>
        </template>
      </v-expansion-panel-header>

      <!-- ─── Body ─── -->
      <v-expansion-panel-content class="recipient-panel__content">
        <!-- Address row: [Address field] [Contacts] [QR] -->
        <div class="address-row">
          <!-- Address text field (single line) -->
          <v-text-field
            v-if="loggedWallet"
            v-model="localAddress"
            :placeholder="isMainnetCardano ? $t('wallet.enterRecipientOrHandle') : $t('wallet.enterRecipientAddress')"
            outlined
            dense
            hide-details
            class="address-input"
            :error="!!localAddress && !resolving && rules.recipientRules(loggedWallet.chain, loggedWallet.network)(localAddress) !== true"
            :loading="resolving"
            @input="resolveAddress"
          >
            <!-- Handle image prepended inside input when resolved -->
            <template v-slot:prepend-inner>
              <v-avatar v-if="handleAsset && handleAsset.img" size="20" class="mr-1" style="margin-top: -2px;">
                <v-img :src="handleAsset.img" contain />
              </v-avatar>
            </template>
            <template v-slot:append>
              <div class="address-append-icons">
                <!-- 1. Clear (always leftmost when visible) -->
                <v-icon
                  v-if="localAddress && !resolving"
                  color="white"
                  style="font-size: 14px; cursor: pointer; opacity: 0.6;"
                  @click="localAddress = ''; resolveAddress('')"
                >mdi-close</v-icon>
                <!-- 2. Status: loading or error -->
                <v-progress-circular v-if="resolving" color="white" size="14" width="2" indeterminate />
                <v-icon v-else-if="resolvedFailed" color="#F97066" style="font-size: 14px;">mdi-alert</v-icon>
                <!-- 3. Save to contacts (rightmost) -->
                <v-tooltip v-if="canSaveContact && !resolving" bottom content-class="custom-tooltip">
                  <template v-slot:activator="{ on, attrs }">
                    <v-icon
                      :color="isAlreadyContact ? '#00DFF3' : 'rgba(255,255,255,0.3)'"
                      style="font-size: 14px; cursor: pointer;"
                      v-bind="attrs"
                      v-on="on"
                      @click.stop="isAlreadyContact ? null : saveCurrentAsContact()"
                    >{{ isAlreadyContact ? 'mdi-bookmark' : 'mdi-bookmark-plus-outline' }}</v-icon>
                  </template>
                  <span>{{ isAlreadyContact ? $t('wallet.contactSaved') : $t('wallet.saveContact') }}</span>
                </v-tooltip>
              </div>
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
                <!-- Add contact form -->
                <div class="add-contact-form">
                  <v-text-field
                    v-model="newContactName"
                    :placeholder="$t('wallet.contactName')"
                    outlined dense hide-details
                    class="add-contact-input mr-2"
                  />
                  <v-text-field
                    v-model="newContactAddress"
                    :placeholder="$t('wallet.address')"
                    outlined dense hide-details
                    class="add-contact-input mr-2"
                  />
                  <v-btn
                    icon small
                    color="#00DFF3"
                    :disabled="!newContactName || !newContactAddress"
                    @click="addNewContact()"
                  >
                    <v-icon small>mdi-plus</v-icon>
                  </v-btn>
                </div>

                <v-divider class="my-2" style="border-color: rgba(255,255,255,0.06);" />

                <!-- Contact list -->
                <template v-if="contacts && Object.values(contacts).length > 0">
                  <div
                    v-for="contact in Object.values(contacts)"
                    :key="contact.address"
                    class="contact-item"
                  >
                    <div class="contact-item__info" @click="selectContact(contact)" style="flex: 1; cursor: pointer;">
                      <span class="contact-item__name">{{ contact.name || $t('wallet.unnamed') }}</span>
                      <span class="contact-item__address">{{ filters.truncate(contact.address, 20) }}</span>
                    </div>
                    <v-btn icon x-small @click.stop="deleteContact(contact.address)" class="ml-1">
                      <v-icon x-small color="#F97066">mdi-trash-can-outline</v-icon>
                    </v-btn>
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

        <!-- Duplicate address warning -->
        <div v-if="duplicateOfIndex !== undefined" class="duplicate-warning">
          <v-icon x-small color="#FEC84B" class="mr-1">mdi-alert-outline</v-icon>
          {{ $t('wallet.duplicateAddress', { n: duplicateOfIndex + 1 }) }}
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
      </v-expansion-panel-content>
    </v-expansion-panel>
  </v-expansion-panels>
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
import { addOrUpdateContact, removeContact } from '@/db/wallet-db';

interface Props {
  recipient: SendRecipient;
  index: number;
  isExpanded: boolean;
  canDelete: boolean;
  showHeader: boolean;
  availableTokens: (Token & { balance?: string | number; name?: string; img?: string })[];
  excludedCollectibleFingerprints?: Set<string>;
  duplicateOfIndex?: number;
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

const _isAddressValid = computed(() => {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lockedForTokens: (props.recipient as any).lockedForTokens || 0,
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

// ─── Contacts management ───

const newContactName = ref('');
const newContactAddress = ref('');

/** The resolved payment address for the current input */
const currentPaymentAddress = computed(() =>
  props.recipient.resolvedAddress || (isPaymentAddress(localAddress.value) ? localAddress.value : '')
);

/** Whether the address field has a valid address that can be saved */
const canSaveContact = computed(() => !!currentPaymentAddress.value);

/** Whether the current address is already in contacts */
const isAlreadyContact = computed(() =>
  !!currentPaymentAddress.value && !!contacts.value?.[currentPaymentAddress.value]
);

/** Save the current recipient address as a contact */
async function saveCurrentAsContact() {
  const addr = currentPaymentAddress.value;
  if (!addr || !loggedWallet.value) return;
  const handle = localAddress.value.startsWith('$') ? localAddress.value : undefined;
  const name = handleAsset.value?.name || '';
  const contact = { address: addr, name, handle };
  contacts.value[addr] = contact;
  await addOrUpdateContact(loggedWallet.value.id, contact);
}

/** Add a new contact from the dialog form */
async function addNewContact() {
  if (!newContactName.value || !newContactAddress.value || !loggedWallet.value) return;
  const contact = { address: newContactAddress.value, name: newContactName.value, handle: undefined };
  contacts.value[newContactAddress.value] = contact;
  await addOrUpdateContact(loggedWallet.value.id, contact);
  newContactName.value = '';
  newContactAddress.value = '';
}

/** Delete a contact */
async function deleteContact(address: string) {
  if (!loggedWallet.value) return;
  delete contacts.value[address];
  await removeContact(loggedWallet.value.id, address);
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

function onPanelChange(val: number | undefined) {
  if (val === 0 && !props.isExpanded) {
    emit('expand');
  } else if (val === undefined && props.isExpanded) {
    // Panel closed — but we let parent control this via isExpanded prop
    // Don't collapse on click — parent manages accordion
  }
}

defineExpose({ cardTotalAmounts });
</script>

<style scoped>
/* ─── Expansion panel ─── */
.recipient-panel {
  margin-bottom: 6px !important;
}

.recipient-panel__panel {
  background-color: rgba(255, 255, 255, 0.02) !important;
  border: 1px solid rgba(255, 255, 255, 0.06) !important;
  border-radius: 12px !important;
  transition: border-color 0.2s ease;
}

.recipient-panel :deep(.v-expansion-panel--active) {
  border-color: rgba(0, 223, 243, 0.12) !important;
}

.recipient-panel :deep(.v-expansion-panel::before) {
  box-shadow: none !important;
}

.recipient-panel__header {
  min-height: 40px !important;
  padding: 0 12px !important;
}

.recipient-panel__header :deep(.v-expansion-panel-header__icon) {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 0 !important;
}

.recipient-panel__content :deep(.v-expansion-panel-content__wrap) {
  padding: 0 12px 12px !important;
}

.header-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.header-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  border-radius: 6px;
  background: rgba(0, 223, 243, 0.1);
  color: #00DFF3;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.2px;
  margin-right: 6px;
}

.collapsed-address {
  color: rgba(255, 255, 255, 0.3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  background-color: #161B26 !important;
  border-radius: 10px;
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
  border-color: rgba(255, 255, 255, 0.1) !important;
}

.address-input.error--text :deep(fieldset) {
  border-color: #F97066 !important;
  border-width: 1px !important;
}

.address-append-icons {
  display: flex;
  align-items: center;
  gap: 4px;
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

/* ─── Duplicate address warning ─── */
.duplicate-warning {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: #FEC84B;
  padding: 4px 4px 0;
}

/* ─── Assets section ─── */
.assets-section {
  margin-top: 10px;
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

/* ─── Add contact form ─── */
.add-contact-form {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

.add-contact-input {
  flex: 1;
  min-width: 0;
}

.add-contact-input :deep(.v-input__slot) {
  background-color: #161B26 !important;
  border-radius: 8px;
  min-height: 32px !important;
  padding: 0 8px !important;
}

.add-contact-input :deep(input) {
  font-size: 12px;
}

.add-contact-input :deep(fieldset) {
  border-color: transparent !important;
}

/* ─── Save contact icon ─── */
.save-contact-icon {
  cursor: pointer;
  transition: color 0.15s ease;
}

.save-contact-icon:hover {
  color: #00DFF3 !important;
}
</style>
