<template>
  <section class="vault-address glass-panel" data-test="vault-address">
    <div class="vault-address__head">
      <h2 class="t-label">{{ $t('gerovault.detail.address.title') }}</h2>
      <GButton tier="tertiary" compact :aria-expanded="qrOpen ? 'true' : 'false'" data-test="vault-address-qr-toggle" @click="qrOpen = !qrOpen">
        <v-icon size="small" start aria-hidden="true">mdi-qrcode</v-icon>{{ qrOpen ? $t('gerovault.detail.address.hideQr') : $t('gerovault.detail.address.showQr') }}
      </GButton>
    </div>
    <ChunkedValue :value="address" bech32 copy :copy-label="$t('gerovault.detail.address.copy')" testid="vault-address-value" />
    <div v-if="qrOpen" class="vault-address__qr">
      <VaultQr :value="address" :label="$t('gerovault.detail.address.qrLabel')" />
    </div>
    <p class="t-caption vault-address__note">{{ $t('gerovault.detail.address.note') }}</p>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import ChunkedValue from './ChunkedValue.vue';
import VaultQr from './VaultQr.vue';

defineOptions({ name: 'VaultAddressPanel' });

defineProps<{ address: string }>();
const qrOpen = ref(false);
</script>

<style scoped>
.vault-address {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  min-width: 0;
}
.vault-address__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}
.vault-address__head h2 {
  margin: 0;
}
.vault-address__qr {
  display: flex;
  justify-content: center;
  padding-top: var(--g-s-2);
}
.vault-address__note {
  margin: 0;
}
</style>
