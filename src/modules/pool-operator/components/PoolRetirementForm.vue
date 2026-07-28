<template>
  <div class="retire-form">
    <!-- Warning Banner -->
    <div class="retire-warning">
      <div class="warning-icon-wrap">
        <v-icon size="20" color="error">mdi-alert-outline</v-icon>
      </div>
      <div>
        <div class="warning-title">{{ $t('poolOperator.irreversibleAction') }}</div>
        <div class="warning-text">{{ $t('poolOperator.retireWarning') }}</div>
      </div>
    </div>

    <!-- Epoch Selector -->
    <v-form ref="form" v-model="valid" class="mt-4">
      <div class="epoch-picker">
        <div class="epoch-info">
          <div class="epoch-row">
            <span class="t-label">{{ $t('poolOperator.currentEpoch') }}</span>
            <span class="epoch-value">{{ currentEpoch }}</span>
          </div>
          <div class="epoch-row">
            <span class="t-label">{{ $t('poolOperator.allowedRange') }}</span>
            <span class="epoch-value">{{ minEpoch }} - {{ maxEpoch }}</span>
          </div>
        </div>

        <v-text-field
          v-model="retirementEpoch"
          :label="$t('poolOperator.retirementEpoch')"
          :rules="[requiredRule, minValue(minEpoch), maxValue(maxEpoch)]"
          type="number"
          outlined dense dark hide-details="auto"
          class="glass-input mt-3"
        />
      </div>

      <!-- Deposit return info -->
      <div class="return-info mt-3">
        <v-icon x-small color="success" class="mr-1">mdi-arrow-down-circle</v-icon>
        <span>{{ $t('poolOperator.depositReturn') }}</span>
      </div>

      <v-btn
        color="error"
        block
        class="mt-4 black--text font-weight-bold"
        style="border-radius: var(--g-r-control); text-transform: none; letter-spacing: normal"
        :disabled="!valid"
        :loading="retLoading"
        @click="buildRetirement()"
      >
        <v-icon left small>mdi-power</v-icon>
        {{ $t('poolOperator.retirePool') }}
      </v-btn>
    </v-form>

    <PoolConfirmDialog
      v-model="isConfirmDialogOpen"
      :tx="txData"
      :is-update="false"
      @signed="onSigned"
      @close="closeConfirmDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import { networkStore, isBitcoinTip } from '@/stores/networkStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { usePoolRetirement } from '@/shared/composables/usePoolRetirement';
import PoolConfirmDialog from '../dialogs/PoolConfirmDialog.vue';

const { tip, epochParams } = toRefs(networkStore);

const valid = ref(false);
const retirementEpoch = ref('');

const requiredRule = (v: string) => !!v || 'Required';
const minValue = (min: number) => (v: string) => !v || Number(v) >= min || `Min ${min}`;
const maxValue = (max: number) => (v: string) => !v || Number(v) <= max || `Max ${max}`;

// epoch is Cardano-only; pool retirement never runs against a BTC tip.
const currentEpoch = computed(() => {
  const t = tip.value;
  return t && !isBitcoinTip(t) ? (t.epoch || 0) : 0;
});
const minEpoch = computed(() => currentEpoch.value + 1);
const maxEpoch = computed(() => currentEpoch.value + (epochParams.value?.poolRetirementEpochBound || 18));

const {
  txData,
  loading: retLoading,
  isConfirmDialogOpen,
  retirePool,
  closeConfirmDialog,
} = usePoolRetirement();

async function buildRetirement() {
  await retirePool(parseInt(retirementEpoch.value));
}

function onSigned() {
  closeConfirmDialog();
  poolOperatorStore.isRetiring = true;
  poolOperatorStore.retirementEpoch = parseInt(retirementEpoch.value);
}
</script>

<style scoped>
.retire-form {
  padding-top: 4px;
}

.retire-warning {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
}

.warning-icon-wrap {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  display: flex;
  align-items: center;
  justify-content: center;
}

.warning-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-error);
}

.warning-text {
  font-size: 11px;
  color: var(--g-text-3);
  line-height: 1.5;
  margin-top: 2px;
}

.epoch-picker {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 14px;
}

.epoch-info {
  display: flex;
  gap: 24px;
}

.epoch-row {
  display: flex;
  flex-direction: column;
}

.epoch-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--g-text-1);
  margin-top: 2px;
}

.return-info {
  font-size: 11px;
  color: var(--g-success);
  display: flex;
  align-items: center;
  justify-content: center;
}

.glass-input >>> .v-input__slot {
  background: var(--g-hairline-1) !important;
  border-color: var(--g-hairline-1) !important;
}
</style>
