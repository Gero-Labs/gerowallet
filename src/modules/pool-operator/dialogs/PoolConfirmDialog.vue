<template>
  <v-dialog v-model="dialog" max-width="550px" persistent>
    <v-card>
      <v-card-title>
        {{ isUpdate ? $t('poolOperator.updatePool') : $t('poolOperator.registerPool') }}
        <v-spacer />
        <v-btn icon @click="close" :disabled="signing.loading.value">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <!-- Transaction Summary -->
        <v-card outlined class="mb-4 pa-3">
          <div class="text-caption grey--text mb-2">{{ $t('poolOperator.poolId') }}</div>
          <div class="monospace-text text-body-2 mb-3">{{ poolOperatorStore.poolId }}</div>

          <div v-if="tx" class="d-flex justify-space-between text-body-2 mb-1">
            <span class="grey--text">{{ $t('common.fee') }}</span>
            <span>{{ formatFee }} ADA</span>
          </div>
          <div v-if="!isUpdate" class="d-flex justify-space-between text-body-2">
            <span class="grey--text">{{ $t('poolOperator.deposit') }}</span>
            <span>500 ADA</span>
          </div>
        </v-card>

        <!-- Signing Section -->
        <div v-if="!signing.isSubmit.value">
          <!-- Password input for normal wallets -->
          <v-text-field
            v-if="!signing.isPrfWallet.value"
            v-model="signing.spendingPassword.value"
            :label="$t('wallet.spendingPassword')"
            type="password"
            outlined
            dense
            hide-details
            class="mb-4"
            @keydown.enter="handleSign"
          />

          <v-btn
            color="primary"
            block
            :disabled="!signing.isPrfWallet.value && !signing.spendingPassword.value"
            :loading="signing.loading.value"
            @click="handleSign"
          >
            {{ $t('common.confirm') }}
          </v-btn>
        </div>

        <!-- Success -->
        <div v-else class="text-center py-4">
          <v-icon size="48" color="success">mdi-check-circle</v-icon>
          <h4 class="mt-3">{{ $t('common.success') }}</h4>
          <v-btn color="primary" text class="mt-3" @click="close">
            {{ $t('common.close') }}
          </v-btn>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRef } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { usePoolSigning } from '@/shared/composables/usePoolSigning';

const props = defineProps<{
  value: boolean;
  tx: Cardano.Tx | null;
  isUpdate: boolean;
}>();

const emit = defineEmits(['input', 'signed', 'close']);

const dialog = ref(props.value);
watch(() => props.value, (v) => { dialog.value = v; });
watch(dialog, (v) => { emit('input', v); });

const txRef = toRef(props, 'tx');

const signing = usePoolSigning({
  tx: txRef,
  successMessageKey: props.isUpdate ? 'poolOperator.updatePool' : 'poolOperator.registerPool',
  onSuccess: () => {
    emit('signed');
  },
});

const formatFee = computed(() => {
  if (!props.tx?.body?.fee) return '0';
  return (Number(props.tx.body.fee) / 1_000_000).toFixed(6);
});

async function handleSign() {
  await signing.handleSign();
}

function close() {
  signing.resetState();
  dialog.value = false;
  emit('close');
}
</script>
