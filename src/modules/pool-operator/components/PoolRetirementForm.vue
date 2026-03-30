<template>
  <div class="retire-form">
    <!-- Warning Banner -->
    <div class="retire-warning">
      <div class="warning-icon-wrap">
        <v-icon size="20" color="#FDA29B">mdi-alert-outline</v-icon>
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
            <span class="epoch-label">{{ $t('poolOperator.currentEpoch') }}</span>
            <span class="epoch-value">{{ currentEpoch }}</span>
          </div>
          <div class="epoch-row">
            <span class="epoch-label">{{ $t('poolOperator.allowedRange') }}</span>
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
        <v-icon x-small color="#75E0A7" class="mr-1">mdi-arrow-down-circle</v-icon>
        <span>{{ $t('poolOperator.depositReturn') }}</span>
      </div>

      <v-btn
        color="#FDA29B"
        block
        class="mt-4 black--text font-weight-bold"
        style="border-radius: 10px; text-transform: none; letter-spacing: normal"
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
import { networkStore } from '@/stores/networkStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { usePoolRetirement } from '@/shared/composables/usePoolRetirement';
import PoolConfirmDialog from '../dialogs/PoolConfirmDialog.vue';

const { tip, epochParams } = toRefs(networkStore);

const valid = ref(false);
const retirementEpoch = ref('');

const requiredRule = (v: string) => !!v || 'Required';
const minValue = (min: number) => (v: string) => !v || Number(v) >= min || `Min ${min}`;
const maxValue = (max: number) => (v: string) => !v || Number(v) <= max || `Max ${max}`;

const currentEpoch = computed(() => tip.value?.epoch || 0);
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
  background: rgba(253,162,155,0.06);
  border: 1px solid rgba(253,162,155,0.12);
  border-radius: 10px;
}

.warning-icon-wrap {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 8px;
  background: rgba(253,162,155,0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.warning-title {
  font-size: 12px;
  font-weight: 600;
  color: #FDA29B;
}

.warning-text {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  line-height: 1.5;
  margin-top: 2px;
}

.epoch-picker {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 10px;
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

.epoch-label {
  font-size: 10px;
  color: rgba(255,255,255,0.55);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.epoch-value {
  font-size: 16px;
  font-weight: 700;
  color: rgba(255,255,255,0.9);
  margin-top: 2px;
}

.return-info {
  font-size: 11px;
  color: #75E0A7;
  display: flex;
  align-items: center;
  justify-content: center;
}

.glass-input >>> .v-input__slot {
  background: rgba(255,255,255,0.04) !important;
  border-color: rgba(255,255,255,0.08) !important;
}
</style>
