<template>
  <form class="card-activate" novalidate @submit.prevent="submit">
    <div class="card-activate__head">
      <IsoScene name="activate" class="card-activate__art" />
      <div class="card-activate__title">
        <CardChip tone="accent" icon="mdi-truck-outline">{{ t('card.trackerDispatched') }}</CardChip>
        <h3 class="t-heading">{{ t('card.activateTitle') }}</h3>
      </div>
    </div>
    <p class="t-body">{{ t('card.activateDesc') }}</p>

    <!-- The number is only sent to the provider to confirm delivery; it is never stored or logged. -->
    <v-text-field
      :value="formatted"
      :label="t('card.cardNumber')"
      :hint="t('card.activateHint')"
      :error-messages="error"
      persistent-hint
      outlined
      dense
      inputmode="numeric"
      autocomplete="off"
      spellcheck="false"
      class="card-activate__input g-num"
      :disabled="submitting"
      @input="onInput"
      @blur="touched = true"
    />

    <GButton tier="primary" block type="submit" :loading="submitting" :disabled="!valid">
      {{ t('card.activateCard') }}
    </GButton>
    <p class="t-caption">{{ t('card.activateAutoCheck') }}</p>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import cardStore from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from '../ui/CardChip.vue';
import { formatPan, isValidPan, panDigits } from '@/modules/wallet/utils/cardSecrets';

const props = defineProps<{ orderUuid: string }>();
const emit = defineEmits<{ (e: 'activated', cardUuid: string | null): void }>();

const { t } = useTranslation();

const digits = ref('');
const touched = ref(false);
const submitting = ref(false);

const formatted = computed(() => formatPan(digits.value));
const valid = computed(() => isValidPan(digits.value));
const error = computed(() =>
  touched.value && digits.value.length >= 16 && !valid.value ? t('card.activateInvalidPan') : '',
);

function onInput(value: string): void {
  digits.value = panDigits(value || '');
}

async function submit(): Promise<void> {
  touched.value = true;
  if (!valid.value || submitting.value) return;
  submitting.value = true;
  try {
    const cardUuid = await cardStore.activatePhysicalCard(props.orderUuid, digits.value);
    digits.value = '';
    touched.value = false;
    snackbar.fireSuccess(t('card.activationStarted'));
    emit('activated', cardUuid);
  } catch {
    snackbar.setError(t('card.activationFailed'));
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.card-activate {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);

  p {
    margin: 0;
  }
}

.card-activate__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-4);
}

.card-activate__art {
  width: 112px;
  flex: none;
}

.card-activate__title {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);

  h3 {
    margin: 0;
  }
}

.card-activate__input :deep(input) {
  letter-spacing: 0.08em;
}
</style>
