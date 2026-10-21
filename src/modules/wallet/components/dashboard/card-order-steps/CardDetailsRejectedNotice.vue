<template>
  <!-- Zione refused the order and only Zione support can help: it refuses characters in
       details it already holds (it never overwrites a stored value), or it needs details
       whose form could not be loaded. -->
  <section class="details-rejected" role="alert" aria-labelledby="details-rejected-title">
    <v-icon class="details-rejected__icon" size="small">mdi-alert-circle-outline</v-icon>
    <div class="details-rejected__body">
      <h3 id="details-rejected-title" class="t-body-lg">{{ t(copy.title) }}</h3>
      <p class="t-body-sm">{{ t(copy.body) }}</p>
      <p v-if="reason" class="t-caption">{{ t('card.details.rejectedReason', { reason }) }}</p>
      <div>
        <GButton tier="secondary" :href="supportHref">
          <v-icon size="small" start>mdi-email-outline</v-icon>
          {{ t('card.details.emailSupport') }}
        </GButton>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import type { OrderRefusalKind } from '@/modules/wallet/utils/cardOrder';

const props = withDefaults(defineProps<{
  kind?: OrderRefusalKind;
  /** Zione's message, quoted so support can see exactly what was refused. */
  reason?: string;
}>(), { kind: 'characters', reason: '' });

const { t } = useTranslation();

const COPY: Record<OrderRefusalKind, { title: string; body: string; subject: string }> = {
  characters: { title: 'card.details.rejectedTitle', body: 'card.details.rejectedBody', subject: 'card.details.supportSubject' },
  missing: { title: 'card.details.unavailableTitle', body: 'card.details.unavailableBody', subject: 'card.details.unavailableSubject' },
};

const copy = computed(() => COPY[props.kind]);

const supportHref = computed(
  () => `mailto:${CARD_PROVIDER.supportEmail}?subject=${encodeURIComponent(t(copy.value.subject))}`,
);
</script>

<style lang="scss" scoped>
.details-rejected {
  @include g-glass-tier;
  display: flex;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-color: var(--g-warning-line);
}

.details-rejected__icon {
  flex: none;
  margin-top: 2px;
  color: var(--g-warning);
}

.details-rejected__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  min-width: 0;

  h3,
  p {
    margin: 0;
  }
}
</style>
