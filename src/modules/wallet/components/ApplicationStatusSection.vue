<template>
  <section class="application-status glass-panel" aria-labelledby="application-status-title">
    <IsoScene :name="isCardRejected ? 'attention' : 'review'" class="application-status__art" />

    <div class="application-status__copy">
      <CardChip :tone="isCardRejected ? 'error' : 'warning'" :icon="isCardRejected ? 'mdi-close' : 'mdi-clock-outline'">
        {{ isCardRejected ? t('card.rejected') : t('card.kycUnderReview') }}
      </CardChip>
      <h1 id="application-status-title" class="t-title">{{ title }}</h1>
      <p class="t-body">{{ description }}</p>

      <CardPhases v-if="!isCardRejected" :phases="phases" :current="1" />

      <hr class="application-status__rule" />
      <p class="t-body-sm">
        {{ t('card.pleaseContact') }}
        <a :href="`mailto:${CARD_PROVIDER.supportEmail}`">{{ CARD_PROVIDER.supportEmail }}</a>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from './ui/CardChip.vue';
import CardPhases from './ui/CardPhases.vue';

const props = withDefaults(defineProps<{
  kycStatus?: string;
  isCardRejected?: boolean;
}>(), {
  kycStatus: 'verification_started',
  isCardRejected: false,
});

const { t } = useTranslation();

const title = computed(() => {
  if (props.isCardRejected) return t('card.cardRejected');
  return props.kycStatus === 'verified' ? t('card.kycApprovalInProgress') : t('card.reviewingApplication');
});

const description = computed(() => {
  if (props.isCardRejected) return t('card.cardRejectedMessage');
  return props.kycStatus === 'verified' ? t('card.kycApprovalInProgressDesc') : t('card.reviewingApplicationDesc');
});

const phases = computed(() => [t('card.kycRegistered'), t('card.kycVerificationStarted'), t('card.orderYourCard')]);
</script>

<style lang="scss" scoped>
.application-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
  gap: var(--g-s-6);
  align-items: center;
  padding: var(--g-s-6);
}

.application-status__art {
  max-width: 380px;
  justify-self: center;
}

.application-status__copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-4);

  h1,
  p {
    margin: 0;
  }

  a {
    color: var(--g-accent);
  }
}

.application-status__rule {
  align-self: stretch;
  border: 0;
  height: 1px;
  margin: 0;
  background: var(--g-hairline-1);
}
</style>
