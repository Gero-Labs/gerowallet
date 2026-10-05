<template>
  <aside class="card-partner-badge glass-panel" :aria-label="t('card.poweredByKaiserex')">
    <IsoScene name="bridge" class="card-partner-badge__art" />
    <div class="card-partner-badge__text">
      <span class="t-body-lg">{{ t('card.poweredByKaiserex') }}</span>
      <span class="t-caption">{{ t('card.licensedRegulated') }} · FSP {{ CARD_PROVIDER.fspNumber }}</span>
    </div>
    <GButton tier="tertiary" compact :href="CARD_PROVIDER.websiteUrl" target="_blank" rel="noopener noreferrer">
      {{ t('card.learnMoreKaiserex') }}
      <v-icon small right>mdi-open-in-new</v-icon>
    </GButton>
  </aside>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';

const { t } = useTranslation();
</script>

<style lang="scss" scoped>
.card-partner-badge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-4);
  padding: var(--g-s-3) var(--g-s-4);
  width: 100%;
}

.card-partner-badge__art {
  width: 120px;
  flex: none;
}

.card-partner-badge__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 200px;
}
</style>
