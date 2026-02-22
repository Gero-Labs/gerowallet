<template>
  <v-dialog v-model="modelValue" max-width="480" @input="$emit('update:modelValue', $event)">
    <v-card v-if="collection">
      <v-card-title class="d-flex align-center">
        <v-icon color="primary" class="mr-2">mdi-cart-plus</v-icon>
        {{ $t('gomining.buyMiner') }}
        <v-spacer />
        <v-btn icon @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pt-4">
        <!-- Collection preview -->
        <div class="d-flex align-center mb-4" style="gap: 16px;">
          <v-img
            :src="collection.imageUrl"
            width="80"
            height="80"
            contain
            class="rounded"
          >
            <template #placeholder>
              <v-row class="fill-height ma-0" align="center" justify="center">
                <v-icon size="36" color="#F7931A40">mdi-pickaxe</v-icon>
              </v-row>
            </template>
          </v-img>
          <div>
            <div class="text-subtitle-1 font-weight-bold">{{ collection.name }}</div>
            <div class="text-caption text--secondary">
              {{ collection.hashrate }} TH/s · ${{ collection.efficiency.toFixed(2) }}/TH
            </div>
            <v-chip x-small color="success" class="mt-1">
              {{ collection.available }} {{ $t('gomining.available') }}
            </v-chip>
          </div>
        </div>

        <!-- Quantity -->
        <div class="mb-4">
          <div class="text-caption text--secondary mb-1">{{ $t('gomining.quantity') }}</div>
          <div class="d-flex align-center" style="gap: 12px;">
            <v-btn icon small outlined @click="quantity = Math.max(1, quantity - 1)">
              <v-icon small>mdi-minus</v-icon>
            </v-btn>
            <span class="text-h6 font-weight-bold" style="min-width: 32px; text-align: center;">
              {{ quantity }}
            </span>
            <v-btn
              icon
              small
              outlined
              @click="quantity = Math.min(collection.available, quantity + 1)"
            >
              <v-icon small>mdi-plus</v-icon>
            </v-btn>
          </div>
        </div>

        <v-divider class="mb-4" />

        <!-- Price summary -->
        <div class="d-flex justify-space-between text-body-2 mb-1">
          <span class="text--secondary">
            {{ quantity }} × {{ collection.price.toFixed(2) }} {{ collection.currency }}
          </span>
          <span>{{ totalPrice }} {{ collection.currency }}</span>
        </div>
        <div class="d-flex justify-space-between text-body-1 font-weight-bold">
          <span>{{ $t('gomining.totalCost') }}</span>
          <span class="primary--text">{{ totalPrice }} {{ collection.currency }}</span>
        </div>

        <!-- Info note -->
        <v-alert type="info" outlined dense class="mt-4 text-caption">
          {{ $t('gomining.buyRedirectNote') }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="pb-4 px-4">
        <v-btn outlined @click="close" :disabled="submitting">
          {{ $t('common.cancel') }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          :loading="submitting"
          @click="submit"
        >
          <v-icon left small>mdi-open-in-new</v-icon>
          {{ $t('gomining.proceedToCheckout') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import goMiningApi, { type GoMiningCollection } from '@/api/gomining-api';

const props = defineProps<{
  modelValue: boolean;
  userId: string;
  collection: GoMiningCollection | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const quantity = ref(1);
const submitting = ref(false);

const totalPrice = computed(() => {
  if (!props.collection) return '0.00';
  return (props.collection.price * quantity.value).toFixed(2);
});

function close() {
  quantity.value = 1;
  emit('update:modelValue', false);
}

async function submit() {
  if (!props.collection) return;
  submitting.value = true;
  try {
    const result = await goMiningApi.initPayment(props.userId, props.collection.id, quantity.value);
    // Open the GoMining checkout page in a new tab
    window.open(result.paymentUrl, '_blank');
    close();
  } catch (error) {
    console.error('⛏ GoMining: payment init failed', error);
  } finally {
    submitting.value = false;
  }
}
</script>