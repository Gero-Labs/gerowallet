<template>
  <div class="step-join-accounts">
    <div class="step-scroll">
      <p class="join-accounts__text">{{ t('accounts.addingTo', { name: wallet.name }) }}</p>
      <p class="join-accounts__text">{{ t('accounts.reviewList', { list }) }}</p>
      <p class="join-accounts__hint">{{ t('accounts.joinExplanation', { name: wallet.name }) }}</p>
    </div>

    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn variant="text" :disabled="busy" @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn class="onb-continue" color="primary" :loading="busy" :disabled="!accounts.length" @click="add()">
        {{ tc('accounts.addSelected', accounts.length, { count: accounts.length }) }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
// Restoring a recovery phrase Gero already has: its account #0 is stored, so the
// accounts chosen join it. They hold no secrets of their own, so no password or
// PassKey is set up here; the wallet's own keep covering them.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { Wallet } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';
import { Messaging } from '@/chrome/messaging';
import GeroStore from '@/stores/geroStore';
import snackbar from '@/plugins/snackbar';
import type { AccountXpub } from '@/shared/utils/walletAccount';

const props = defineProps<{
  /** The stored account #0 of the recovery phrase. */
  wallet: Wallet;
  accounts: AccountXpub[];
}>();
defineEmits<{ (e: 'back'): void }>();

const { t, tc } = useTranslation();
const router = useRouter();
const busy = ref(false);

const list = computed(() => props.accounts.map((account) => t('accounts.label', { index: account.accountIndex })).join(', '));

async function add(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const created = await GeroStore.addAccounts(props.wallet.id, props.accounts.map((account) => ({
      name: t('accounts.label', { index: account.accountIndex }),
      publicKey: account.publicKey,
      accountIndex: account.accountIndex,
    })));
    const wallet = created[0] ?? props.wallet;
    await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet } });
    await router.push('/').catch(() => undefined);
  } catch (e) {
    console.error('Adding the accounts failed:', e instanceof Error ? e.message : 'unknown');
    snackbar.setError(t('errors.unknownError'));
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.join-accounts__text { color: var(--g-text-1); font-size: 14px; margin: 0 0 var(--g-s-2); text-align: left; }
.join-accounts__hint { color: var(--g-text-2); font-size: 13px; margin: var(--g-s-3) 0 0; text-align: left; }
</style>
