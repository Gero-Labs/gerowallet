<template>
  <BottomSheet :value="value" @input="onClose" :title="$t('miniGero.sendAda')" height="90%" persistent>
    <div class="send-sheet">
      <!-- Step 1: Address Input -->
      <div v-if="step === 1" class="step-content">
        <div class="text-caption grey--text mb-2">{{ $t('miniGero.recipientAddress') }}</div>
        <v-text-field
          v-model="address"
          :placeholder="$t('miniGero.pasteAddress')"
          outlined
          dense
          dark
          hide-details="auto"
          :error-messages="addressError"
          class="mini-input"
          append-icon="mdi-content-paste"
          @click:append="pasteFromClipboard"
        />

        <!-- Contacts list -->
        <div v-if="contactsList.length > 0" class="contacts-section mt-4">
          <div class="text-caption grey--text mb-2">{{ $t('miniGero.contacts') }}</div>
          <div
            v-for="contact in contactsList"
            :key="contact.address"
            class="contact-item"
            @click="selectContact(contact)"
          >
            <v-avatar size="32" color="#2a2a2a" class="mr-3">
              <v-icon size="16" color="#888">mdi-account</v-icon>
            </v-avatar>
            <div class="contact-info">
              <div class="white--text text-body-2">{{ contact.name }}</div>
              <div class="grey--text text-caption">{{ truncateAddr(contact.address) }}</div>
            </div>
          </div>
        </div>
        <div v-else class="text-center grey--text text-caption mt-4">
          {{ $t('miniGero.noContacts') }}
        </div>

        <v-spacer />
        <div class="step-actions">
          <v-btn block color="#00c7f3" class="black--text font-weight-bold" :disabled="!isAddressValid" @click="step = 2">
            {{ $t('miniGero.next') }}
          </v-btn>
        </div>
      </div>

      <!-- Step 2: Amount Input -->
      <div v-if="step === 2" class="step-content">
        <div class="text-caption grey--text mb-1">{{ $t('miniGero.enterAmount') }}</div>
        <div class="amount-input-wrapper">
          <v-text-field
            v-model="amountStr"
            type="number"
            outlined
            dense
            dark
            hide-details="auto"
            :error-messages="amountError"
            class="mini-input amount-field"
            prefix="₳"
            step="0.1"
            min="1"
          />
          <v-btn x-small text color="#00c7f3" class="max-btn" @click="setMax">
            {{ $t('miniGero.max') }}
          </v-btn>
        </div>
        <div class="text-caption grey--text mt-1">
          {{ $t('miniGero.available') }}: {{ availableAda }}
        </div>

        <v-spacer />
        <div class="step-actions">
          <v-btn text small color="#888" @click="step = 1" class="mr-2">
            {{ $t('miniGero.back') }}
          </v-btn>
          <v-btn color="#00c7f3" class="black--text font-weight-bold flex-grow-1" :disabled="!isAmountValid" @click="step = 3">
            {{ $t('miniGero.review') }}
          </v-btn>
        </div>
      </div>

      <!-- Step 3: Review -->
      <div v-if="step === 3" class="step-content">
        <div class="review-section">
          <div class="review-row">
            <span class="detail-label">{{ $t('miniGero.to') }}</span>
            <span class="detail-value">{{ truncateAddr(address) }}</span>
          </div>
          <div class="review-row">
            <span class="detail-label">{{ $t('miniGero.amount') }}</span>
            <span class="detail-value white--text">{{ amountDisplay }}</span>
          </div>
          <div class="review-row">
            <span class="detail-label">{{ $t('miniGero.estimatedFee') }}</span>
            <span class="detail-value fee-text">~0.17 - 0.20 ADA</span>
          </div>
        </div>

        <v-spacer />
        <div class="step-actions">
          <v-btn text small color="#888" @click="step = 2" class="mr-2">
            {{ $t('miniGero.back') }}
          </v-btn>
          <v-btn color="#00c7f3" class="black--text font-weight-bold flex-grow-1" @click="step = 4">
            {{ $t('miniGero.confirmSend') }}
          </v-btn>
        </div>
      </div>

      <!-- Step 4: Confirm via Dashboard -->
      <div v-if="step === 4" class="step-content">
        <div class="dashboard-send-section">
          <v-icon size="48" color="#00c7f3" class="mb-3">mdi-shield-check-outline</v-icon>
          <div class="text-body-1 white--text text-center mb-2">
            {{ $t('miniGero.confirmSend') }}
          </div>
          <div class="text-caption grey--text text-center mb-4">
            For security, transactions are signed in the full dashboard.
          </div>

          <div class="review-section mb-4">
            <div class="review-row">
              <span class="detail-label">{{ $t('miniGero.to') }}</span>
              <span class="detail-value">{{ truncateAddr(address) }}</span>
            </div>
            <div class="review-row">
              <span class="detail-label">{{ $t('miniGero.amount') }}</span>
              <span class="detail-value white--text">{{ amountDisplay }}</span>
            </div>
          </div>

          <v-btn
            block
            color="#00c7f3"
            class="black--text font-weight-bold"
            @click="openDashboardSend"
          >
            <v-icon left small>mdi-open-in-new</v-icon>
            {{ $t('miniGero.sendFromDashboard') }}
          </v-btn>

          <div class="step-actions mt-3">
            <v-btn text small color="#888" block @click="step = 3">
              {{ $t('miniGero.back') }}
            </v-btn>
          </div>
        </div>
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const props = defineProps<{
  value: boolean;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
}>();

const step = ref(1);
const address = ref('');
const amountStr = ref('');
const addressError = ref('');
const amountError = ref('');

// Reset state when sheet opens
watch(() => props.value, (val) => {
  if (val) {
    step.value = 1;
    address.value = '';
    amountStr.value = '';
    addressError.value = '';
    amountError.value = '';
  }
});

const contactsList = computed(() => {
  const contacts = walletStore.contacts;
  if (!contacts || typeof contacts !== 'object') return [];
  return Object.values(contacts).map((c: any) => ({
    name: c.name || c.label || 'Contact',
    address: c.address || c.addr || '',
  })).filter((c: any) => c.address);
});

const availableBalance = computed(() => {
  const account = walletStore.account;
  if (!account?.controlled_amount) return 0;
  return Number(account.controlled_amount);
});

const availableAda = computed(() => {
  return filters.toCurrency(availableBalance.value);
});

const isAddressValid = computed(() => {
  const addr = address.value.trim();
  if (!addr) return false;
  // Basic Cardano address validation
  return addr.startsWith('addr1') || addr.startsWith('addr_test1') || addr.startsWith('DdzFF') || addr.startsWith('$');
});

const isAmountValid = computed(() => {
  const amount = parseFloat(amountStr.value);
  if (isNaN(amount) || amount < 1) {
    return false;
  }
  const lovelace = amount * 1_000_000;
  return lovelace <= availableBalance.value;
});

const amountDisplay = computed(() => {
  const amount = parseFloat(amountStr.value);
  if (isNaN(amount)) return '0 ADA';
  return `${amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ADA`;
});

function truncateAddr(addr: string): string {
  return filters.truncate(addr);
}

function selectContact(contact: any) {
  address.value = contact.address;
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    address.value = text.trim();
  } catch (e) {
    console.warn('Could not paste from clipboard:', e);
  }
}

function setMax() {
  // Leave some for fee (~0.2 ADA)
  const maxLovelace = availableBalance.value - 200_000;
  if (maxLovelace <= 0) {
    amountStr.value = '0';
    return;
  }
  amountStr.value = (maxLovelace / 1_000_000).toFixed(6);
}

function onClose(val: boolean) {
  if (!val) {
    emit('input', false);
  }
}

function openDashboardSend() {
  const optionsUrl = chrome.runtime.getURL('index.html#/dashboard');
  window.open(optionsUrl, '_blank');
}
</script>

<style scoped>
.send-sheet {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.step-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.step-actions {
  display: flex;
  align-items: center;
  padding-top: 16px;
  margin-top: auto;
}

.step-actions .flex-grow-1 {
  flex: 1;
}

.mini-input >>> .v-input__slot {
  background: #141414 !important;
  border-color: #2a2a2a !important;
}

.mini-input >>> .v-text-field__slot input {
  color: #e0e0e0 !important;
}

.amount-input-wrapper {
  position: relative;
}

.max-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  min-width: auto !important;
  padding: 0 8px !important;
}

.amount-field >>> .v-text-field__slot input {
  font-size: 20px;
  font-weight: 600;
}

.contacts-section {
  max-height: 240px;
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
}

.contact-item:hover {
  background: #1a1a1a;
}

.contact-info {
  min-width: 0;
}

.review-section {
  background: #141414;
  border-radius: 12px;
  padding: 16px;
}

.review-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #1e1e1e;
}

.review-row:last-child {
  border-bottom: none;
}

.detail-label {
  color: #888;
  font-size: 13px;
}

.detail-value {
  color: #e0e0e0;
  font-size: 13px;
  text-align: right;
}

.fee-text {
  color: #ff8e8e;
}

.dashboard-send-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 16px;
}
</style>
