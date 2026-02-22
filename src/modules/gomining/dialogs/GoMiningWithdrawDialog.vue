<template>
  <v-dialog v-model="modelValue" max-width="480" @input="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon color="primary" class="mr-2">mdi-arrow-up-circle-outline</v-icon>
        {{ $t('gomining.withdrawEarnings') }}
        <v-spacer />
        <v-btn icon @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pt-4">
        <!-- Balance info -->
        <v-alert type="info" outlined dense class="mb-4">
          <div class="d-flex justify-space-between">
            <span>{{ $t('gomining.availableBalance') }}</span>
            <span class="font-weight-bold">{{ formatBtc(balance?.btc ?? 0) }} BTC</span>
          </div>
        </v-alert>

        <!-- Destination address -->
        <div class="mb-4">
          <div class="text-caption text--secondary mb-1">
            {{ $t('gomining.destinationAddress') }}
          </div>
          <v-text-field
            :value="btcAddress"
            readonly
            outlined
            dense
            hide-details
            class="monospace-field"
          >
            <template #prepend-inner>
              <v-icon small color="success" class="mr-1">mdi-check-circle</v-icon>
            </template>
          </v-text-field>
        </div>

        <!-- Amount -->
        <div class="mb-4">
          <div class="text-caption text--secondary mb-1">
            {{ $t('gomining.withdrawAmount') }}
          </div>
          <v-text-field
            v-model="amount"
            outlined
            dense
            type="number"
            :min="0"
            :max="balance?.btc ?? 0"
            :step="0.00001"
            hide-details="auto"
            :rules="[amountRule]"
            :suffix="'BTC'"
          >
            <template #append>
              <v-btn
                x-small
                text
                color="primary"
                @click="setMax"
              >
                MAX
              </v-btn>
            </template>
          </v-text-field>
        </div>

        <!-- Withdrawal type -->
        <div class="mb-4">
          <div class="text-caption text--secondary mb-2">{{ $t('gomining.withdrawalType') }}</div>
          <v-btn-toggle v-model="withdrawType" mandatory class="d-flex" style="gap: 8px;">
            <v-btn
              small
              outlined
              value="fast"
              style="flex: 1; border-radius: 8px !important;"
              :color="withdrawType === 'fast' ? 'primary' : ''"
            >
              <v-icon small left>mdi-lightning-bolt</v-icon>
              {{ $t('gomining.fastWithdrawal') }}
            </v-btn>
            <v-btn
              small
              outlined
              value="24h"
              style="flex: 1; border-radius: 8px !important;"
              :color="withdrawType === '24h' ? 'primary' : ''"
            >
              <v-icon small left>mdi-clock-outline</v-icon>
              {{ $t('gomining.standardWithdrawal') }}
            </v-btn>
          </v-btn-toggle>
          <div class="text-caption text--secondary mt-1">
            {{ withdrawType === 'fast' ? $t('gomining.fastWithdrawalNote') : $t('gomining.standardWithdrawalNote') }}
          </div>
        </div>

        <!-- Commission estimate -->
        <div v-if="commission && parseFloat(amount) > 0" class="mb-2">
          <v-divider class="mb-3" />
          <div class="d-flex justify-space-between text-caption mb-1">
            <span class="text--secondary">{{ $t('gomining.networkFee') }}</span>
            <span>{{ formatBtc(commission.commission) }} BTC</span>
          </div>
          <div class="d-flex justify-space-between text-body-2 font-weight-bold">
            <span>{{ $t('gomining.youWillReceive') }}</span>
            <span class="success--text">{{ formatBtc(commission.net) }} BTC</span>
          </div>
        </div>
      </v-card-text>

      <v-card-actions class="pb-4 px-4">
        <v-btn outlined @click="close" :disabled="submitting">
          {{ $t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          :loading="submitting"
          :disabled="!isValid || submitting"
          @click="submit"
        >
          <v-icon left small>mdi-arrow-up-circle-outline</v-icon>
          {{ $t('gomining.confirmWithdraw') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import goMiningApi, { type GoMiningBalance, type GoMiningCommission } from '@/api/gomining-api';

const props = defineProps<{
  modelValue: boolean;
  userId: string;
  btcAddress: string;
  balance: GoMiningBalance | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  success: [];
}>();

const amount = ref('');
const withdrawType = ref<'fast' | '24h'>('fast');
const commission = ref<GoMiningCommission | null>(null);
const submitting = ref(false);
let commissionTimeout: ReturnType<typeof setTimeout> | null = null;

const amountRule = (v: string) => {
  const n = parseFloat(v);
  if (!v || isNaN(n) || n <= 0) return 'Please enter a valid amount';
  if (n > (props.balance?.btc ?? 0)) return 'Exceeds available balance';
  return true;
};

const isValid = computed(() => {
  const n = parseFloat(amount.value);
  return !isNaN(n) && n > 0 && n <= (props.balance?.btc ?? 0);
});

function setMax() {
  amount.value = (props.balance?.btc ?? 0).toFixed(8);
}

function formatBtc(btc: number): string {
  return btc.toFixed(8);
}

function close() {
  emit('update:modelValue', false);
}

// Debounce commission fetch
watch([amount, withdrawType], () => {
  commission.value = null;
  if (commissionTimeout) clearTimeout(commissionTimeout);
  if (!isValid.value) return;

  commissionTimeout = setTimeout(async () => {
    try {
      commission.value = await goMiningApi.getCommission(
        props.userId,
        parseFloat(amount.value),
        'BTC',
      );
    } catch {
      // Non-critical, silently ignore
    }
  }, 500);
});

async function submit() {
  if (!isValid.value) return;
  submitting.value = true;
  try {
    const n = parseFloat(amount.value);
    if (withdrawType.value === 'fast') {
      await goMiningApi.withdrawFast(props.userId, n);
    } else {
      await goMiningApi.withdraw24h(props.userId, n);
    }
    emit('success');
    close();
  } catch (error) {
    console.error('⛏ GoMining: withdrawal failed', error);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.monospace-field :deep(input) {
  font-family: monospace;
  font-size: 12px;
}
</style>