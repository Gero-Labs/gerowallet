<template>
  <BaseDialog
    :isOpen="open"
    :title="view === 'pin' ? t('card.changePin') : t('card.manageCardTitle')"
    :subtitle="view === 'pin' ? t('card.changePinSubtitle') : t('card.manageCardSubtitleSecurely')"
    :width="600"
    :min-height="0"
    :loading="busy"
    @close="close"
  >
    <template #art>
      <IsoScene name="pin" />
    </template>

    <!-- Card controls -->
    <div v-if="view === 'controls'" class="card-controls">
      <div class="card-controls__card glass-tier">
        <img :src="assets.frontCardNoMcx2" alt="" class="card-controls__thumb" />
        <div class="card-controls__card-text">
          <span class="t-body-lg">{{ typeLabel }}</span>
          <span v-if="last4" class="t-caption g-num">•••• {{ last4 }}</span>
        </div>
        <CardChip :tone="isBlocked ? 'error' : 'success'">{{ isBlocked ? t('card.blocked') : t('card.active') }}</CardChip>
      </div>

      <section class="card-controls__section" aria-labelledby="card-controls-pin">
        <h3 id="card-controls-pin" class="t-label">{{ t('card.pin') }}</h3>
        <div class="card-controls__pin-row">
          <span class="card-controls__pin g-num" :aria-label="showPin ? t('card.pin') : t('card.pinHidden')">
            <span v-for="(digit, i) in pinDigits" :key="i" class="card-controls__pin-digit">{{ digit }}</span>
          </span>
          <div class="card-controls__pin-actions">
            <v-btn
              icon
              outlined
              class="card-controls__icon-btn"
              :loading="loadingPin"
              :aria-label="showPin ? t('card.hidePin') : t('card.showPin')"
              :aria-pressed="showPin ? 'true' : 'false'"
              @click="togglePinVisibility"
            >
              <v-icon>{{ showPin ? 'mdi-eye-off-outline' : 'mdi-eye-outline' }}</v-icon>
            </v-btn>
            <GButton tier="secondary" compact :disabled="!cardUuid" @click="openChangePin">{{ t('card.changePin') }}</GButton>
          </div>
        </div>
      </section>

      <hr class="card-controls__rule" />

      <section class="card-controls__section" aria-labelledby="card-controls-block">
        <h3 id="card-controls-block" class="t-label">{{ t('card.temporarilyBlockCard') }}</h3>
        <p class="t-body-sm">{{ t('card.blockingCardWarning') }}</p>
        <div>
          <GButton v-if="isBlocked" tier="secondary" :loading="blocking" @click="toggleBlock">
            <v-icon small left>mdi-lock-open-variant-outline</v-icon>
            {{ t('card.unblockCard') }}
          </GButton>
          <GButton v-else tier="destructive" :loading="blocking" @click="toggleBlock">
            <v-icon small left>mdi-lock-outline</v-icon>
            {{ t('card.blockCard') }}
          </GButton>
        </div>
      </section>

      <p class="t-caption card-controls__help">
        {{ t('card.needHelpContactSupport') }}
        <a :href="`mailto:${CARD_PROVIDER.supportEmail}`">{{ CARD_PROVIDER.supportEmail }}</a>
      </p>
    </div>

    <!-- Change PIN -->
    <form v-else class="card-controls" novalidate @submit.prevent="savePin">
      <div class="card-controls__field">
        <span id="card-new-pin" class="t-label">{{ t('card.newPin') }}</span>
        <div role="group" aria-labelledby="card-new-pin">
          <NumericOtpInput :value="newPin" :length="4" @input="newPin = $event" />
        </div>
      </div>
      <div class="card-controls__field">
        <span id="card-confirm-pin" class="t-label">{{ t('card.confirmNewPin') }}</span>
        <div role="group" aria-labelledby="card-confirm-pin">
          <NumericOtpInput :value="confirmPin" :length="4" @input="confirmPin = $event" />
        </div>
      </div>
      <p class="t-caption" :class="{ 'card-controls__error': pinError }" aria-live="polite">
        {{ pinError || t('card.pinWeak') }}
      </p>
      <div class="card-controls__actions">
        <GButton tier="secondary" :disabled="savingPin" @click="backToControls">{{ t('common.cancel') }}</GButton>
        <GButton tier="primary" type="submit" :loading="savingPin" :disabled="!canSavePin">{{ t('card.savePin') }}</GButton>
      </div>
    </form>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import NumericOtpInput from '@/shared/components/NumericOtpInput.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import cardStoreModule from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';
import assets from '@/utils/assets';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import { pinProblem } from '@/modules/wallet/utils/cardSecrets';
import CardChip from '../ui/CardChip.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();

const view = ref<'controls' | 'pin'>('controls');
const showPin = ref(false);
const loadingPin = ref(false);
const blocking = ref(false);
const savingPin = ref(false);
const newPin = ref('');
const confirmPin = ref('');

const selectedCard = computed(() => cardStoreModule.getSelectedCard());
const cardData = computed(() => selectedCard.value?.cardData);
const cardUuid = computed(() => cardData.value?.card_uuid || '');
const busy = computed(() => blocking.value || savingPin.value);

const isBlocked = computed(
  () => selectedCard.value?.cardBalance?.state === 'BLOCKED' || cardData.value?.card_status === 'TEMPORARY_BLOCKED',
);
const typeLabel = computed(() => (cardData.value?.own_type === 'physical' ? t('card.typePhysical') : t('card.typeVirtual')));
const last4 = computed(() => String(cardData.value?.pan ?? '').replace(/\D/g, '').slice(-4));

const pinDigits = computed(() => {
  const pin = showPin.value ? selectedCard.value?.cardPin?.pin || '' : '';
  return /^\d{4}$/.test(pin) ? pin.split('') : ['•', '•', '•', '•'];
});

async function togglePinVisibility(): Promise<void> {
  if (showPin.value) {
    showPin.value = false;
    return;
  }
  if (!selectedCard.value?.cardPin?.pin && cardUuid.value) {
    loadingPin.value = true;
    try {
      await cardStoreModule.fetchCardPin(cardUuid.value);
    } catch {
      snackbar.setError(t('card.pleaseTryAgain'));
      return;
    } finally {
      loadingPin.value = false;
    }
  }
  showPin.value = true;
}

async function toggleBlock(): Promise<void> {
  if (!cardUuid.value) return;
  blocking.value = true;
  const unblocking = isBlocked.value;
  try {
    if (unblocking) await cardStoreModule.unblockCard(cardUuid.value);
    else await cardStoreModule.blockCard(cardUuid.value);
    await cardStoreModule.fetchCardBalance(cardUuid.value).catch(() => undefined);
    snackbar.fireSuccess(unblocking ? t('card.cardUnblocked') : t('card.cardBlockedNotice'));
  } catch {
    snackbar.setError(t('card.pleaseTryAgain'));
  } finally {
    blocking.value = false;
  }
}

// Change PIN
const problem = computed(() => pinProblem(newPin.value, confirmPin.value));
const canSavePin = computed(() => !!cardUuid.value && problem.value === null);
const pinError = computed(() => {
  if (newPin.value.length < 4) return '';
  if (problem.value === 'weak') return t('card.pinWeak');
  if (problem.value === 'mismatch' && confirmPin.value.length === 4) return t('card.pinMismatch');
  return '';
});

function clearPinForm(): void {
  newPin.value = '';
  confirmPin.value = '';
}

function openChangePin(): void {
  clearPinForm();
  view.value = 'pin';
}

function backToControls(): void {
  clearPinForm();
  view.value = 'controls';
}

async function savePin(): Promise<void> {
  if (!canSavePin.value) return;
  savingPin.value = true;
  try {
    await cardStoreModule.changeCardPin(cardUuid.value, newPin.value);
    showPin.value = false;
    snackbar.fireSuccess(t('card.pinChanged'));
    backToControls();
  } catch {
    snackbar.setError(t('card.pinChangeFailed'));
  } finally {
    savingPin.value = false;
  }
}

function close(): void {
  emit('close');
}

// Never keep a revealed PIN or a half-typed new one around between openings.
watch(
  () => props.open,
  open => {
    if (!open) {
      showPin.value = false;
      backToControls();
    }
  },
);
</script>

<style lang="scss" scoped>
.card-controls {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-2) 0;

  p {
    margin: 0;
  }
}

.card-controls__card {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
}

.card-controls__thumb {
  width: 56px;
  border-radius: var(--g-r-chip);
}

.card-controls__card-text {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-controls__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);

  h3 {
    margin: 0;
  }
}

.card-controls__pin-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.card-controls__pin {
  display: flex;
  gap: var(--g-s-2);
}

/* Justified solid: PIN digits are control-scale value boxes. */
.card-controls__pin-digit {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-size: 20px;
}

.card-controls__pin-actions {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.card-controls__icon-btn {
  border-color: var(--g-hairline-2);

  .v-icon {
    color: var(--g-text-2);
  }
}

.card-controls__rule {
  border: 0;
  height: 1px;
  margin: 0;
  background: var(--g-hairline-1);
}

.card-controls__help a {
  color: var(--g-accent);
}

.card-controls__field {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  max-width: 280px;
}

.card-controls__error {
  color: var(--g-error);
}

.card-controls__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-3);
}
</style>
