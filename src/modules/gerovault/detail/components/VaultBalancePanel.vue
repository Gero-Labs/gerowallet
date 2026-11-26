<template>
  <section class="vault-balance glass-panel" data-test="vault-balance" :aria-busy="state === 'loading' ? 'true' : 'false'">
    <div class="vault-balance__head">
      <h2 class="t-label">{{ $t('gerovault.detail.balance.title') }}</h2>
      <InfoTooltip :label="$t('gerovault.detail.balance.aboutLabel')" :text="$t('gerovault.detail.balance.about')" />
    </div>

    <div v-if="state === 'loading' || state === 'idle'" class="g-skeleton vault-balance__skeleton" role="status" :aria-label="$t('common.loading')"></div>
    <p v-else-if="state === 'unavailable'" class="t-body-sm" data-test="vault-balance-unavailable">{{ $t('gerovault.detail.chainUnavailable') }}</p>
    <div v-else-if="state === 'error'" class="vault-balance__error" data-test="vault-balance-error">
      <p class="t-body-sm">{{ $t('gerovault.detail.balance.failed') }}</p>
      <GButton tier="secondary" compact @click="$emit('retry')">{{ $t('common.retry') }}</GButton>
    </div>
    <template v-else-if="balance">
      <p class="t-display g-num vault-balance__ada" data-test="vault-balance-ada">{{ $t('gerovault.detail.balance.ada', { amount: formatLovelaceAsAda(balance.lovelace) }) }}</p>
      <p class="t-caption">{{ $t('gerovault.detail.balance.utxos', { count: balance.utxoCount }) }}</p>

      <ul v-if="balance.assets.length > 0" class="vault-balance__assets" data-test="vault-balance-assets">
        <li v-for="asset in balance.assets" :key="asset.assetId" class="vault-balance__asset">
          <span class="t-body-sm vault-balance__asset-name">{{ asset.assetName ? displayLabel(assetNameText(asset.assetName)) : $t('gerovault.detail.balance.unnamedAsset') }}</span>
          <span class="t-body-sm g-num">{{ asset.quantity.toLocaleString('en-US') }}</span>
          <span v-if="detailsVisible" class="vault-balance__policy t-caption">
            {{ $t('gerovault.detail.balance.policy') }} <ChunkedValue :value="asset.policyId" />
          </span>
        </li>
      </ul>
      <p v-else class="t-caption" data-test="vault-balance-ada-only">{{ $t('gerovault.detail.balance.adaOnly') }}</p>

      <GNote v-if="balance.locked.length > 0" icon="mdi-lock-outline" role="status" data-test="vault-balance-locked">
        {{ $t('gerovault.detail.balance.locked', { count: balance.locked.length, amount: formatLovelaceAsAda(lockedLovelace(balance)) }) }}
        <ul v-if="detailsVisible" class="vault-balance__locked-list">
          <li v-for="u in balance.locked" :key="`${u.txId}#${u.index}`" class="t-caption">
            <ChunkedValue :value="`${u.txId}#${u.index}`" />
            <span class="vault-balance__datum">{{ $t('gerovault.detail.balance.datumHash') }} <ChunkedValue :value="u.datumHash" /></span>
          </li>
        </ul>
      </GNote>
    </template>
  </section>
</template>

<script setup lang="ts">
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { displayLabel } from '@/shared/gerovault';
import { assetNameText, lockedLovelace, type VaultBalance } from '@/modules/gerovault/detail/balance';
import type { ChainReadState } from '@/modules/gerovault/detail/useVaultChain';
import ChunkedValue from './ChunkedValue.vue';

defineOptions({ name: 'VaultBalancePanel' });

defineProps<{ state: ChainReadState; balance: VaultBalance | undefined; detailsVisible: boolean }>();
defineEmits<{ (e: 'retry'): void }>();
</script>

<style scoped>
.vault-balance {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  min-width: 0;
}
.vault-balance__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
}
.vault-balance__head h2,
.vault-balance p {
  margin: 0;
}
.vault-balance__skeleton {
  height: var(--g-btn-h);
}
.vault-balance__error {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  flex-wrap: wrap;
}
.vault-balance__ada {
  overflow-wrap: anywhere;
}
.vault-balance__assets,
.vault-balance__locked-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.vault-balance__asset {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.vault-balance__asset-name {
  overflow-wrap: anywhere;
  min-width: 0;
}
.vault-balance__policy,
.vault-balance__datum {
  flex-basis: 100%;
}
</style>
