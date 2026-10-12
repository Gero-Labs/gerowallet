<template>
  <section class="hero" aria-labelledby="help-hero-title">
    <div class="hero-copy">
      <p class="t-label hero-kicker">{{ t('help.manual') }}</p>
      <h1 id="help-hero-title" class="t-display hero-title">{{ t('help.hero') }}</h1>
      <p class="t-body-lg hero-lede">{{ t('help.subtitle') }}</p>
      <HelpSearchForm variant="hero" input-id="help-query" class="hero-search" />
      <HelpChainPills />
    </div>
    <IsoScene name="helpHero" class="hero-scene" animated />
  </section>
</template>

<script setup lang="ts">
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import HelpChainPills from '../HelpChainPills.vue';
import HelpSearchForm from '../HelpSearchForm.vue';

const { t } = useTranslation();
</script>

<style scoped>
.hero { display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-2) var(--g-s-5); min-width: 0; }
.hero-copy { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: var(--g-s-4); padding: var(--g-s-2) 0; }
.hero-kicker { margin: 0; }
.hero-title { margin: 0; line-height: 1.15; }
.hero-lede { margin: 0; max-width: 480px; color: var(--g-text-2); font-weight: 400; line-height: 1.5; }
.hero-search { margin-top: var(--g-s-2); }
.hero-scene { flex: 0 1 auto; width: 320px; max-width: 100%; height: auto; display: block; margin: 0 auto; }
@media (max-width: 640px) {
  .hero { padding-bottom: var(--g-s-2); }
  .hero-scene { order: -1; width: 240px; }
  .hero-copy { gap: var(--g-s-3); }
  .hero-title { font-size: 28px; }
  .hero-lede { font-size: 14px; line-height: 1.55; }
  .hero-search { margin-top: var(--g-s-1); }
}
</style>
