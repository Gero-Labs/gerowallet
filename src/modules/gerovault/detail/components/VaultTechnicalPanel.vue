<template>
  <!-- Technical layer: what the vault is, byte for byte. Shown with the Details toggle or Alt. -->
  <section class="vault-technical glass-panel" data-test="vault-technical">
    <h2 class="t-label">{{ $t('gerovault.detail.technical.title') }}</h2>
    <dl class="vault-technical__rows">
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.vault.id') }}</dt>
        <dd><ChunkedValue :value="record.vaultId" copy testid="vault-technical-id" /></dd>
      </div>
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.network') }}</dt>
        <dd class="g-mono">{{ record.network }}</dd>
      </div>
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.paymentScriptHash') }}</dt>
        <dd><ChunkedValue :value="facts.payment.hash" copy testid="vault-technical-payment-hash" /></dd>
      </div>
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.paymentScript') }}</dt>
        <dd><ChunkedValue :value="facts.payment.cbor" copy testid="vault-technical-payment-cbor" /></dd>
      </div>
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.stakeScriptHash') }}</dt>
        <dd><ChunkedValue :value="facts.stake.hash" copy testid="vault-technical-stake-hash" /></dd>
      </div>
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.stakeScript') }}</dt>
        <dd><ChunkedValue :value="facts.stake.cbor" copy testid="vault-technical-stake-cbor" /></dd>
      </div>
      <div class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.rewardAddress') }}</dt>
        <dd><ChunkedValue :value="facts.addresses.reward" bech32 copy /></dd>
      </div>
      <div v-if="record.manifest" class="vault-technical__row">
        <dt class="t-caption">{{ $t('gerovault.detail.technical.manifest', { version: record.manifest.version }) }}</dt>
        <dd><ChunkedValue :value="record.manifest.hash" /></dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { VaultRecord } from '@/modules/gerovault/contracts';
import type { VaultFacts } from '@/modules/gerovault/detail/vaultFacts';
import ChunkedValue from './ChunkedValue.vue';

defineOptions({ name: 'VaultTechnicalPanel' });

defineProps<{ record: VaultRecord; facts: VaultFacts }>();
</script>

<style scoped>
.vault-technical {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.vault-technical h2,
.vault-technical__rows,
.vault-technical__rows dd {
  margin: 0;
}
.vault-technical__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.vault-technical__row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 4fr;
  gap: var(--g-s-3);
  align-items: baseline;
}
.vault-technical__row dd {
  min-width: 0;
}
@media (max-width: 600px) {
  .vault-technical__row {
    grid-template-columns: 1fr;
  }
}
</style>
