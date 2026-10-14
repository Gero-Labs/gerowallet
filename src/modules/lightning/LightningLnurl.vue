<template>
  <v-container fluid class="pa-4" style="max-width: 640px; margin: auto;">
    <!-- Header -->
    <div class="d-flex align-center mb-6" style="gap: 12px;">
      <v-avatar size="44" color="#9B59B620" class="flex-shrink-0">
        <v-icon color="#9B59B6" size="24">mdi-lightning-bolt</v-icon>
      </v-avatar>
      <div>
        <div class="text-h6 font-weight-bold">{{ $t('lightning.title') }}</div>
        <div class="text-caption text--secondary">{{ $t('lightning.subtitle') }}</div>
      </div>
    </div>

    <!-- Input -->
    <v-card variant="outlined" class="pa-4 mb-4">
      <div class="text-subtitle-2 font-weight-bold mb-3">{{ $t('lightning.resolve') }}</div>
      <v-text-field
        v-model="input"
        variant="outlined"
        density="compact"
        :placeholder="$t('lightning.inputPlaceholder')"
        hide-details="auto"
        clearable
        :loading="resolving"
        @keydown.enter="resolve"
        @click:clear="clear"
      >
        <template #prepend-inner>
          <v-icon size="small" :color="inputTypeColor" class="mr-1">{{ inputTypeIcon }}</v-icon>
        </template>
      </v-text-field>
      <div class="text-caption text--secondary mt-1">
        {{ $t('lightning.inputHint') }}
      </div>
      <v-btn color="primary" class="mt-3" :loading="resolving" :disabled="!input.trim()" @click="resolve">
        <v-icon start size="small">mdi-magnify</v-icon>
        {{ $t('lightning.resolveBtn') }}
      </v-btn>
    </v-card>

    <!-- Error -->
    <v-alert v-if="error" type="error" variant="outlined" closable class="mb-4" @update:model-value="error = null">
      {{ error }}
    </v-alert>

    <!-- LNURL-pay Result -->
    <v-card v-if="lnurlEndpoint" variant="outlined" class="pa-4 mb-4">
      <div class="d-flex align-center mb-3" style="gap: 12px;">
        <v-avatar v-if="metadataImage" size="48" rounded>
          <img :src="metadataImage" style="width: 100%; height: 100%; object-fit: contain;" />
        </v-avatar>
        <v-avatar v-else size="48" color="#9B59B620" rounded>
          <v-icon color="#9B59B6">mdi-lightning-bolt</v-icon>
        </v-avatar>
        <div>
          <div class="font-weight-bold">{{ metadataDescription || $t('lightning.lnurlPay') }}</div>
          <div class="text-caption text--secondary">
            {{ formatMsats(lnurlEndpoint.minSendable) }} – {{ formatMsats(lnurlEndpoint.maxSendable) }}
          </div>
        </div>
      </div>

      <v-divider class="mb-3" />

      <!-- Amount input -->
      <div class="mb-3">
        <div class="text-caption text--secondary mb-1">{{ $t('lightning.payAmount') }}</div>
        <v-text-field
          v-model="payAmount"
          variant="outlined"
          density="compact"
          type="number"
          suffix="sats"
          :min="minSats"
          :max="maxSats"
          hide-details="auto"
          :hint="`Min: ${minSats.toLocaleString()} · Max: ${maxSats.toLocaleString()}`"
          persistent-hint
          :rules="[amountRule]"
        />
      </div>

      <!-- Comment (if allowed) -->
      <div v-if="lnurlEndpoint.commentAllowed" class="mb-3">
        <div class="text-caption text--secondary mb-1">{{ $t('lightning.comment') }}</div>
        <v-text-field
          v-model="comment"
          variant="outlined"
          density="compact"
          :maxlength="lnurlEndpoint.commentAllowed"
          :counter="lnurlEndpoint.commentAllowed"
          :placeholder="$t('lightning.optionalComment')"
          hide-details="auto"
        />
      </div>

      <!-- Submarine swap note -->
      <v-alert type="info" variant="outlined" density="compact" class="text-caption mb-3">
        {{ $t('lightning.submarineNote') }}
      </v-alert>

      <div class="d-flex" style="gap: 8px;">
        <v-btn color="primary" :loading="requestingInvoice" :disabled="!isPayAmountValid" @click="requestInvoice">
          <v-icon start size="small">mdi-lightning-bolt</v-icon>
          {{ $t('lightning.getInvoice') }}
        </v-btn>
        <v-btn variant="outlined" @click="openBoltz">
          <v-icon start size="small">mdi-open-in-new</v-icon>
          {{ $t('lightning.openBoltz') }}
        </v-btn>
      </div>
    </v-card>

    <!-- BOLT11 Invoice Result -->
    <v-card v-if="bolt11" variant="outlined" class="pa-4 mb-4">
      <div class="d-flex align-center mb-2" style="gap: 8px;">
        <v-icon color="#9B59B6">mdi-qrcode</v-icon>
        <div class="font-weight-bold">{{ $t('lightning.bolt11Invoice') }}</div>
      </div>
      <v-divider class="mb-3" />

      <v-list density="compact">
        <v-list-item v-if="bolt11.amount">
          <div class="g-list-content">
            <v-list-item-subtitle>{{ $t('lightning.amount') }}</v-list-item-subtitle>
            <v-list-item-title>{{ formatMsats(bolt11.amount) }}</v-list-item-title>
          </div>
        </v-list-item>
        <v-list-item>
          <div class="g-list-content">
            <v-list-item-subtitle>{{ $t('lightning.network') }}</v-list-item-subtitle>
            <v-list-item-title>{{ bolt11.network }}</v-list-item-title>
          </div>
        </v-list-item>
        <v-list-item v-if="bolt11.expiry">
          <div class="g-list-content">
            <v-list-item-subtitle>{{ $t('lightning.expiry') }}</v-list-item-subtitle>
            <v-list-item-title>{{ bolt11.expiry / 60 }} {{ $t('lightning.minutes') }}</v-list-item-title>
          </div>
        </v-list-item>
      </v-list>

      <v-alert type="info" variant="outlined" density="compact" class="text-caption mt-3">
        {{ $t('lightning.submarineNote') }}
      </v-alert>

      <v-btn class="mt-3" variant="outlined" @click="openBoltz">
        <v-icon start size="small">mdi-open-in-new</v-icon>
        {{ $t('lightning.payViaBoltz') }}
      </v-btn>
    </v-card>

    <!-- Generated invoice display -->
    <v-card v-if="generatedInvoice" variant="outlined" class="pa-4 mb-4">
      <div class="font-weight-bold mb-2">{{ $t('lightning.paymentRequest') }}</div>
      <v-textarea
        :model-value="generatedInvoice"
        readonly
        variant="outlined"
        density="compact"
        rows="4"
        style="font-family: monospace; font-size: 11px;"
        hide-details
      />
      <div class="d-flex mt-2" style="gap: 8px;">
        <v-btn variant="outlined" size="small" @click="copyInvoice">
          <v-icon start size="x-small">mdi-content-copy</v-icon>
          {{ $t('common.copy') }}
        </v-btn>
        <v-btn variant="outlined" size="small" color="primary" @click="openBoltzWithInvoice(generatedInvoice)">
          <v-icon start size="x-small">mdi-open-in-new</v-icon>
          {{ $t('lightning.payViaBoltz') }}
        </v-btn>
      </div>
    </v-card>

    <!-- Info about Lightning -->
    <v-expansion-panels flat>
      <v-expansion-panel>
        <v-expansion-panel-title class="text-caption font-weight-medium pa-0">
          {{ $t('lightning.whatIsLightning') }}
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="text-caption text--secondary">
            {{ $t('lightning.lightningExplainer') }}
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import lightningApi, { type LnurlPayEndpoint, type Bolt11Decoded } from '@/api/lightning-api';

const input = ref('');
const resolving = ref(false);
const requestingInvoice = ref(false);
const error = ref<string | null>(null);

const lnurlEndpoint = ref<LnurlPayEndpoint | null>(null);
const bolt11 = ref<Partial<Bolt11Decoded> | null>(null);
const payAmount = ref('');
const comment = ref('');
const generatedInvoice = ref<string | null>(null);

const inputType = computed(() => lightningApi.detectInputType(input.value.trim()));

const inputTypeIcon = computed(() => {
  switch (inputType.value) {
    case 'lnaddress': return 'mdi-email-outline';
    case 'lnurl': return 'mdi-link-variant';
    case 'bolt11': return 'mdi-qrcode';
    default: return 'mdi-lightning-bolt-outline';
  }
});

const inputTypeColor = computed(() => {
  switch (inputType.value) {
    case 'lnaddress':
    case 'lnurl':
    case 'bolt11': return '#9B59B6';
    default: return 'grey';
  }
});

const metadataDescription = computed(() => {
  if (!lnurlEndpoint.value) return '';
  return lightningApi.parseMetadata(lnurlEndpoint.value.metadata).description;
});

const metadataImage = computed(() => {
  if (!lnurlEndpoint.value) return null;
  return lightningApi.parseMetadata(lnurlEndpoint.value.metadata).image;
});

const minSats = computed(() => lnurlEndpoint.value ? lnurlEndpoint.value.minSendable / 1000 : 0);
const maxSats = computed(() => lnurlEndpoint.value ? lnurlEndpoint.value.maxSendable / 1000 : 0);

const isPayAmountValid = computed(() => {
  const n = parseFloat(payAmount.value);
  return !isNaN(n) && n >= minSats.value && n <= maxSats.value;
});

const amountRule = (v: string) => {
  const n = parseFloat(v);
  if (!v || isNaN(n) || n <= 0) return 'Enter a valid amount';
  if (n < minSats.value) return `Minimum is ${minSats.value.toLocaleString()} sats`;
  if (n > maxSats.value) return `Maximum is ${maxSats.value.toLocaleString()} sats`;
  return true;
};

function formatMsats(msats: number): string {
  return lightningApi.formatMsats(msats);
}

function clear() {
  lnurlEndpoint.value = null;
  bolt11.value = null;
  generatedInvoice.value = null;
  error.value = null;
  payAmount.value = '';
  comment.value = '';
}

async function resolve() {
  if (!input.value.trim()) return;
  resolving.value = true;
  clear();
  try {
    const result = await lightningApi.resolve(input.value.trim());
    if (result.error) {
      error.value = result.error;
    } else if (result.lnurlEndpoint) {
      lnurlEndpoint.value = result.lnurlEndpoint;
      payAmount.value = String(Math.floor(lnurlEndpoint.value.minSendable / 1000));
    } else if (result.bolt11) {
      bolt11.value = result.bolt11;
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to resolve';
  } finally {
    resolving.value = false;
  }
}

async function requestInvoice() {
  if (!lnurlEndpoint.value || !isPayAmountValid.value) return;
  requestingInvoice.value = true;
  generatedInvoice.value = null;
  try {
    const amountMsats = parseFloat(payAmount.value) * 1000;
    const result = await lightningApi.requestInvoice(
      lnurlEndpoint.value,
      amountMsats,
      comment.value || undefined,
    );
    generatedInvoice.value = result.pr;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to get invoice';
  } finally {
    requestingInvoice.value = false;
  }
}

function openBoltz() {
  window.open('https://boltz.exchange', '_blank');
}

function openBoltzWithInvoice(invoice: string) {
  window.open(`https://boltz.exchange?invoice=${encodeURIComponent(invoice)}`, '_blank');
}

async function copyInvoice() {
  if (generatedInvoice.value) {
    await navigator.clipboard.writeText(generatedInvoice.value);
  }
}
</script>
