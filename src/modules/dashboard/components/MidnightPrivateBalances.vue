<template>
  <section v-if="isStagenet" class="my-3">
    <div class="d-flex align-center">
      <span class="t-label">{{ t('midnight.privateBalances.title') }}</span>
      <v-spacer />
      <v-btn small text :loading="syncing" @click="open = true">
        {{ t('midnight.privateBalances.refresh') }}
      </v-btn>
    </div>
    <p class="t-caption text--secondary">{{ t('midnight.privateBalances.explanation') }}</p>
    <p v-if="midnightStore.privateSyncStatus !== 'synced'" class="t-caption">
      {{ t(syncing ? 'midnight.privateBalances.syncing' : 'midnight.privateBalances.locked') }}
    </p>
    <p v-else-if="!tokens.length" class="t-caption">{{ t('midnight.privateBalances.empty') }}</p>
    <div v-for="token in tokens" :key="token.color" class="d-flex justify-space-between t-caption g-num">
      <span>{{ token.label }}</span><span>{{ walletStore.config?.hideBalances ? '••••' : token.amount }} {{ t('midnight.privateBalances.baseUnits') }}</span>
    </div>
    <BaseDialog :isOpen="open" :title="t('midnight.privateBalances.refresh')" :loading="busy" @close="close">
      <p class="t-body">{{ t('midnight.privateBalances.unlock') }}</p>
      <TransactionAuthSection
        :wallet-type="wallet?.type"
        :is-prf-wallet="isPrf"
        :is-signed="false"
        :loading="busy"
        :password="password"
        :password-label="t('send.spendingPassword')"
        :submit-text="t('midnight.privateBalances.refresh')"
        @update:password="password = $event"
        @passkey-prf-output="start({ prfSecret: $event })"
        @passkey-error="error = $event.message"
        @submit="start({ password })"
      />
      <v-btn v-if="!isPrf" class="mt-3" :disabled="!password || busy" @click="start({ password })">
        {{ t('midnight.privateBalances.refresh') }}
      </v-btn>
      <p v-if="error" role="alert" class="error--text t-caption">{{ error }}</p>
    </BaseDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Network } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';
import { Messaging } from '@/chrome/messaging';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';

const { t } = useTranslation();
const wallet = computed(() => walletStore.loggedWallet);
const isStagenet = computed(() => wallet.value?.network === Network.STAGENET);
const isPrf = computed(() => wallet.value?.encryptionMethod === 'prf');
const syncing = computed(() => midnightStore.privateSyncStatus === 'syncing');
const tokens = computed(() => Object.entries(midnightStore.privateSyncStatus === 'synced'
  ? (midnightStore.balances.shieldedTokens ?? {}) : {}).map(([color, amount]) => ({
  color, label: midnightTokenMeta(color)?.symbol ?? `${color.slice(0, 8)}…${color.slice(-6)}`, amount: amount.toString(),
})));
const open = ref(false);
const busy = ref(false);
const password = ref('');
const error = ref('');
function close() {
  if (busy.value) return;
  open.value = false;
  password.value = '';
  error.value = '';
}
watch(() => [wallet.value?.id, wallet.value?.network], () => { open.value = false; password.value = ''; error.value = ''; });
async function start(credentials: { password?: string; prfSecret?: Uint8Array }) {
  busy.value = true;
  error.value = '';
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.START_MIDNIGHT_PRIVATE_SYNC,
      data: { password: credentials.password, prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined },
    }) as { data?: { success?: boolean; error?: string } };
    if (!response?.data?.success) throw new Error(response?.data?.error || t('midnight.privateBalances.failed') as string);
    open.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    password.value = '';
    credentials.prfSecret?.fill(0);
    busy.value = false;
  }
}
</script>
