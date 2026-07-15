<template>
  <div class="reg-form">
    <v-form ref="form" v-model="valid">
      <!-- Core Parameters -->
      <div class="form-section">
        <div class="section-label t-label">
          <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-tune</v-icon>
          {{ $t('poolOperator.coreParameters') }}
        </div>
        <div class="param-grid">
          <v-text-field
            v-model="pledge"
            :label="$t('poolOperator.pledge')"
            suffix="ADA"
            :rules="[requiredRule, minValue(0)]"
            type="number"
            outlined dense dark hide-details="auto"
            class="glass-input"
          />
          <v-text-field
            v-model="cost"
            :label="$t('poolOperator.cost')"
            suffix="ADA"
            :rules="[requiredRule, minValue(170)]"
            type="number"
            outlined dense dark hide-details="auto"
            class="glass-input"
          />
          <v-text-field
            v-model="margin"
            :label="$t('poolOperator.margin')"
            suffix="%"
            :rules="[requiredRule, minValue(0), maxValue(100)]"
            type="number"
            step="0.01"
            outlined dense dark hide-details="auto"
            class="glass-input"
          />
        </div>
        <div class="param-hint">{{ $t('poolOperator.minCostHint') }}</div>
      </div>

      <!-- Metadata -->
      <div class="form-section">
        <div class="section-label t-label">
          <v-icon x-small color="var(--g-text-1)" class="mr-1">mdi-tag-text-outline</v-icon>
          {{ $t('poolOperator.poolMetadata') }}
        </div>
        <MetadataEditor v-model="metadata" />
      </div>

      <!-- Relays -->
      <div class="form-section">
        <div class="section-label t-label">
          <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-access-point-network</v-icon>
          {{ $t('poolOperator.relays') }}
        </div>
        <RelayEditor v-model="relays" />
      </div>

      <!-- Submit -->
      <v-btn
        color="var(--g-accent)"
        block
        class="mt-2 black--text font-weight-bold"
        style="border-radius: var(--g-r-control); text-transform: none; letter-spacing: normal"
        :disabled="!valid"
        :loading="regLoading"
        @click="buildTransaction()"
      >
        <v-icon left small>{{ isUpdate ? 'mdi-check-circle-outline' : 'mdi-rocket-launch-outline' }}</v-icon>
        {{ isUpdate ? $t('poolOperator.updatePool') : $t('poolOperator.registerPool') }}
      </v-btn>
      <div v-if="!isUpdate" class="deposit-note">
        <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-information-outline</v-icon>
        {{ $t('poolOperator.depositNote') }}
      </div>
    </v-form>

    <PoolConfirmDialog
      v-model="isConfirmDialogOpen"
      :tx="txData"
      :is-update="isUpdate"
      @signed="onSigned"
      @close="closeConfirmDialog"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { usePoolRegistration } from '@/shared/composables/usePoolRegistration';
import MetadataEditor from './MetadataEditor.vue';
import RelayEditor from './RelayEditor.vue';
import PoolConfirmDialog from '../dialogs/PoolConfirmDialog.vue';

const { isRegistered, registeredParams } = toRefs(poolOperatorStore);

const requiredRule = (v: string) => !!v || 'Required';
const minValue = (min: number) => (v: string) => !v || Number(v) >= min || `Min ${min}`;
const maxValue = (max: number) => (v: string) => !v || Number(v) <= max || `Max ${max}`;

const valid = ref(false);
const pledge = ref(registeredParams.value?.pledge ? String(Number(registeredParams.value.pledge) / 1_000_000) : '');
const cost = ref(registeredParams.value?.cost ? String(Number(registeredParams.value.cost) / 1_000_000) : '340');
const margin = ref(registeredParams.value?.margin
  ? String(((registeredParams.value.margin.numerator || 0) / (registeredParams.value.margin.denominator || 10000)) * 100)
  : '5');
const metadata = ref({
  url: registeredParams.value?.metadataUrl || '',
  hash: registeredParams.value?.metadataHash || '',
});
const relays = ref<any[]>(registeredParams.value?.relays?.length
  ? registeredParams.value.relays.map((r: any) => {
      if (r.dns || r.hostname || r.__typename === 'RelayByName') return { type: 'dns' as const, hostname: r.dns || r.hostname || '', port: r.port };
      if (r.ipv4 || r.__typename === 'RelayByAddress' && !r.ipv6) return { type: 'ipv4' as const, ip: r.ipv4 || r.ip || '', port: r.port };
      if (r.ipv6 || r.__typename === 'RelayByAddress' && r.ipv6) return { type: 'ipv6' as const, ip: r.ipv6 || r.ip || '', port: r.port };
      if (r.srv || r.dnsName || r.__typename === 'RelayByNameMultihost') return { type: 'srv' as const, dnsName: r.srv || r.dnsName || '' };
      return { type: 'dns' as const, hostname: r.dns || r.hostname || '', port: r.port };
    })
  : []);

const isUpdate = computed(() => isRegistered.value);

const {
  txData,
  loading: regLoading,
  isConfirmDialogOpen,
  registerPool,
  updatePool,
  closeConfirmDialog,
} = usePoolRegistration();

async function buildTransaction() {
  const params = {
    pledge: BigInt(Math.round(parseFloat(pledge.value) * 1_000_000)),
    cost: BigInt(Math.round(parseFloat(cost.value) * 1_000_000)),
    marginNumerator: Math.round(parseFloat(margin.value) * 100),
    marginDenominator: 10000,
    metadataUrl: metadata.value.url || undefined,
    metadataHash: metadata.value.hash || undefined,
    relays: relays.value,
  };

  if (isUpdate.value) {
    await updatePool(params);
  } else {
    await registerPool(params);
  }
}

function onSigned() {
  closeConfirmDialog();
  poolOperatorStore.isRegistered = true;
}
</script>

<style scoped>
.reg-form {
  padding-top: 4px;
}

.form-section {
  margin-bottom: 16px;
}

.section-label {
  margin-bottom: 10px;
  display: flex;
  align-items: center;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 500px) {
  .param-grid {
    grid-template-columns: 1fr;
  }
}

.param-hint {
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 6px;
}

.deposit-note {
  font-size: 11px;
  color: var(--g-text-3);
  text-align: center;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.glass-input >>> .v-input__slot {
  background: var(--g-raised) !important;
  border-color: var(--g-hairline-1) !important;
}

.glass-input >>> .v-input__slot:hover {
  border-color: var(--g-hairline-3) !important;
}

.glass-input >>> .v-text-field__suffix {
  color: var(--g-text-3);
  font-size: 12px;
}
</style>
