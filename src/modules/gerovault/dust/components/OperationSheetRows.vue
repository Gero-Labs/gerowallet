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
      <!-- Until a preprod test shows otherwise, removing the registration may not stop generation. -->
      <div v-if="operation.kind === 'dust_deregister'" class="operation-rows__row" data-test="sheet-dust-keeps-going">
        <dd class="t-body-sm operation-rows__note">{{ $t('gerovault.dust.keepsGoing', { address: operation.dustAddress }) }}</dd>
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
      <dt class="t-body">{{ $t('gerovault.dust.sheet.collateral') }}</dt>
      <dd class="operation-rows__collateral">
        <span class="t-body-sm" data-test="sheet-collateral-text">{{ collateralText }}</span>
        <!-- Technical layer: the full addresses the collateral fields name. -->
        <dl v-if="details" class="operation-rows__details t-caption" data-test="sheet-collateral-details">
          <div>
            <dt>{{ $t('gerovault.dust.sheet.collateralInput') }}</dt>
            <dd class="g-mono">{{ collateral.input }}</dd>
            <dd><ChunkedAddress :address="collateral.address" /></dd>
          </div>
          <div>
            <dt>{{ $t('gerovault.dust.sheet.collateralTotal') }}</dt>
            <dd class="g-num">{{ ada(collateral.total) }}</dd>
          </div>
          <div v-if="collateral.returnAddress">
            <dt>{{ $t('gerovault.dust.sheet.collateralReturn') }}</dt>
            <dd class="g-num">{{ ada(collateral.returned) }}</dd>
            <dd><ChunkedAddress :address="collateral.returnAddress" /></dd>
          </div>
        </dl>
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

const props = withDefaults(defineProps<{
  operation: VaultOperation;
  /** The fee the transaction pays, from the vault. */
  fee: bigint;
  /** This wallet's own first address key hash, when known: the collateral is then this wallet's own. */
  ownCollateralKeyHash?: string | null;
  /** The name of the owner whose wallet gives the collateral, when a signature file has shown it. */
  collateralProvider?: string | null;
  /** The Details layer is on: the full collateral addresses. */
  details?: boolean;
}>(), { ownCollateralKeyHash: null, collateralProvider: null, details: false });

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
  const [input] = op.collateral.inputs;
  const back = op.collateral.collateralReturn;
  return {
    input: `${input.txId}#${input.index}`,
    address: input.output.address.bech32,
    total: op.collateral.totalCollateral ?? op.collateral.forfeitLovelace,
    returned: back?.value.lovelace ?? 0n,
    returnAddress: back?.address.bech32 ?? null,
    payer: op.collateral.payer.hash,
  };
});
const ownCollateral = computed(() => !!collateral.value && !!props.ownCollateralKeyHash && collateral.value.payer === props.ownCollateralKeyHash);
/** The proposer reads what they can lose; a co-owner reads that none of the vault's funds are at stake. */
const collateralText = computed(() => {
  const c = collateral.value;
  if (!c) return '';
  return ownCollateral.value
    ? t('gerovault.dust.sheet.collateralProposer', { total: adaText(c.total), amount: adaText(c.returned), fee: adaText(props.fee) })
    : t('gerovault.dust.sheet.collateralCosigner', { proposer: props.collateralProvider ?? t('gerovault.dust.sheet.theProposer') });
});
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
.operation-rows__note {
  margin: 0;
  color: var(--g-text-2);
  overflow-wrap: anywhere;
}
.operation-rows__details {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
}
.operation-rows__details dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--g-text-2);
}
.operation-rows__facts {
  margin: 0;
  padding-left: var(--g-s-4);
  color: var(--g-text-2);
}
</style>
