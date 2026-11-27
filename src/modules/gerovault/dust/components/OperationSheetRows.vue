<template>
  <!-- A stake or DUST operation in plain words, every figure read from the bytes being signed. -->
  <dl class="operation-rows">
    <div class="operation-rows__row operation-rows__row--lead" data-test="sheet-operation">
      <dt class="t-body">{{ $t('gerovault.dust.sheet.operation') }}</dt>
      <dd class="t-body operation-rows__name">{{ $t(nameKey) }}</dd>
    </div>

    <div v-if="operation.kind === 'stake_register'" class="operation-rows__row">
      <dt class="t-body">{{ $t('gerovault.dust.sheet.deposit') }}</dt>
      <dd class="t-body g-num operation-rows__value">{{ ada(operation.depositLovelace) }}</dd>
    </div>

    <template v-if="operation.kind === 'dust_register' || operation.kind === 'dust_deregister'">
      <div class="operation-rows__row operation-rows__row--stack" data-test="sheet-dust-address">
        <dt class="t-body">{{ $t(operation.kind === 'dust_register' ? 'gerovault.dust.sheet.dustAddress' : 'gerovault.dust.sheet.stopsFor') }}</dt>
        <dd><ChunkedAddress :address="operation.dustAddress" /></dd>
      </div>
      <div class="operation-rows__row">
        <dt class="t-body">{{ $t(operation.kind === 'dust_register' ? 'gerovault.dust.sheet.locked' : 'gerovault.dust.sheet.released') }}</dt>
        <dd class="t-body g-num operation-rows__value">{{ ada(operation.kind === 'dust_register' ? operation.lockedLovelace : operation.releasedLovelace) }}</dd>
      </div>
    </template>

    <div v-if="operation.kind === 'dust_deregister' && operation.stakeRefundLovelace !== null" class="operation-rows__row">
      <dt class="t-body">{{ $t('gerovault.dust.sheet.refund') }}</dt>
      <dd class="t-body g-num operation-rows__value">{{ ada(operation.stakeRefundLovelace) }}</dd>
    </div>
    <div v-if="operation.kind === 'stake_deregister'" class="operation-rows__row">
      <dt class="t-body">{{ $t('gerovault.dust.sheet.refund') }}</dt>
      <dd class="t-body g-num operation-rows__value">{{ ada(operation.refundLovelace) }}</dd>
    </div>

    <div v-if="withdrawal !== null" class="operation-rows__row">
      <dt class="t-body">{{ $t('gerovault.dust.sheet.withdrawal') }}</dt>
      <dd class="t-body g-num operation-rows__value">{{ ada(withdrawal) }}</dd>
    </div>

    <div v-if="collateral" class="operation-rows__row operation-rows__row--stack" data-test="sheet-collateral">
      <dt class="t-body">
        {{ ownCollateral ? $t('gerovault.dust.sheet.collateralOwn') : $t('gerovault.dust.sheet.collateral') }}
      </dt>
      <dd class="operation-rows__collateral">
        <ChunkedAddress :address="collateral.address" />
        <span class="t-caption">{{ $t('gerovault.dust.sheet.collateralLoss', { amount: ada(collateral.maxLoss) }) }}</span>
      </dd>
    </div>

    <div v-if="operation.kind === 'dust_register'" class="operation-rows__row operation-rows__row--stack">
      <dt class="t-body">{{ $t('gerovault.dust.sheet.before') }}</dt>
      <dd>
        <ul class="operation-rows__facts t-body-sm">
          <li>{{ $t('gerovault.dust.fact.key') }}</li>
          <li>{{ $t('gerovault.dust.fact.activation') }}</li>
          <li>{{ $t('gerovault.dust.fact.forks') }}</li>
        </ul>
      </dd>
    </div>
  </dl>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import ChunkedAddress from '@/modules/gerovault/spend/components/ChunkedAddress.vue';
import { adaText } from '@/modules/gerovault/spend/display';
import type { VaultOperation } from '../operations';

const props = defineProps<{
  operation: VaultOperation;
  /** This wallet's own first address key hash, when known: the collateral is then "your wallet". */
  ownCollateralKeyHash?: string | null;
}>();

const { t } = useTranslation();
const ada = (lovelace: bigint) => t('gerovault.spend.ada', { amount: adaText(lovelace) });

const nameKey = computed(() => {
  const op = props.operation;
  if (op.kind === 'dust_deregister' && op.stakeRefundLovelace !== null) return 'gerovault.dust.op.dustAndStakeDeregister';
  return {
    stake_register: 'gerovault.dust.op.stakeRegister',
    dust_register: 'gerovault.dust.op.dustRegister',
    dust_deregister: 'gerovault.dust.op.dustDeregister',
    stake_deregister: 'gerovault.dust.op.stakeDeregister',
  }[op.kind];
});

const withdrawal = computed<bigint | null>(() => {
  const op = props.operation;
  if (op.kind === 'stake_register') return null;
  if (op.kind === 'stake_deregister') return op.withdrawalLovelace > 0n ? op.withdrawalLovelace : null;
  return op.withdrawalLovelace;
});

const collateral = computed(() => {
  const op = props.operation;
  if (op.kind !== 'dust_register' && op.kind !== 'dust_deregister') return null;
  return { address: op.collateral.inputs[0].output.address.bech32, maxLoss: op.collateral.maxLossLovelace, payer: op.collateral.payer.hash };
});
const ownCollateral = computed(() => !!collateral.value && !!props.ownCollateralKeyHash && collateral.value.payer === props.ownCollateralKeyHash);
</script>

<style scoped>
.operation-rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
.operation-rows__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-4);
  padding: var(--g-s-3) var(--g-s-4);
}
.operation-rows__row + .operation-rows__row {
  border-top: 1px solid var(--g-hairline-1);
}
.operation-rows__row--lead {
  align-items: center;
}
.operation-rows__row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-2);
}
.operation-rows__row dt {
  flex: none;
}
.operation-rows__row dd {
  margin: 0;
  min-width: 0;
}
.operation-rows__name,
.operation-rows__value {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}
.operation-rows__collateral {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.operation-rows__facts {
  margin: 0;
  padding-left: var(--g-s-4);
  color: var(--g-text-2);
}
</style>
