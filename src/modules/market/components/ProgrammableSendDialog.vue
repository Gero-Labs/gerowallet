<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('programmableTokens.send.title', { token: tokenLabel })"
    :subtitle="t('programmableTokens.send.subtitle')"
    icon="mdi-send-lock-outline"
    size="sm"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text class="pt-2 px-5 pb-5">
      <!-- Keyed on the token so reopening for another token starts from a clean form. -->
      <ProgrammableSendFlow
        v-if="isOpen"
        :key="unit"
        :unit="unit"
        :ticker="ticker"
        :name="name"
        :decimals="decimals"
        @busy="busy = $event"
        @close="close()"
        @done="close()"
      />
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import ProgrammableSendFlow from '@/shared/components/ProgrammableSendFlow.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

/** Options page host for Gero's own Send of a CIP-113 token (TokenDetailPanel). */
const props = defineProps<{
  isOpen: boolean;
  unit: string;
  ticker?: string;
  name?: string;
  decimals?: number;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const busy = ref(false);
const tokenLabel = computed(() => props.ticker || props.name || '');

function close(): void {
  if (busy.value) return;
  emit('close');
}
</script>
