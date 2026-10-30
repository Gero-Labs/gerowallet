<template>
  <!-- A WalletConnect peer names its own domain. Say so, with what WalletConnect's
       Verify API found, so a claimed domain never reads like a browser-stamped
       site origin. Shown in the side panel and on the popup approvals. -->
  <div v-if="verification" class="wc-verify" :role="verification.state === 'verified' ? undefined : 'alert'" data-testid="wc-verify-notice">
    <div class="wc-verify-row">
      <v-icon size="13" class="mr-1" :color="verification.state === 'verified' ? 'success' : 'warning'">
        {{ verification.state === 'verified' ? 'mdi-shield-check-outline' : 'mdi-shield-alert-outline' }}
      </v-icon>
      <span class="text-caption grey--text">{{ $t('walletConnect.verify.via') }}</span>
      <span v-if="verification.state === 'verified'" class="text-caption success--text ml-1">· {{ $t('walletConnect.verify.verified') }}</span>
    </div>
    <div v-if="verification.state === 'unverified'" class="text-caption warning--text">
      {{ $t('walletConnect.verify.unverified') }}
    </div>
    <div v-else-if="verification.state === 'mismatch'" class="text-caption error--text" data-testid="wc-verify-mismatch">
      {{ verification.origin
        ? $t('walletConnect.verify.mismatch', { origin: verification.origin })
        : $t('walletConnect.verify.mismatchNoOrigin') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { readWcVerification } from '@/services/walletConnect/verifyContext';

const props = defineProps<{
  /** `wcVerify` from the background-built request; anything else renders nothing. */
  verification?: unknown;
}>();

const verification = computed(() => readWcVerification(props.verification));
</script>

<style scoped lang="scss">
.wc-verify {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
  text-align: left;
}

.wc-verify-row {
  display: flex;
  align-items: center;
}
</style>
