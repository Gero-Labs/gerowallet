<template>
  <header v-if="variant === 'public'" class="glass-chrome help-header">
    <div class="help-header__inner">
      <router-link :to="homeTo()" class="help-brand">
        <img :src="geroMark" alt="" width="27" height="24" class="help-brand__mark" />
        <span class="help-brand__name">Gero</span>
        <span class="help-brand__rule" aria-hidden="true"></span>
        <span class="help-brand__title">{{ t('help.title') }}</span>
      </router-link>
      <HelpTabs class="help-header__nav" />
      <div class="help-header__actions">
        <div class="help-lang"><LanguageSelector /></div>
        <GButton tier="secondary" compact @click="openSupport()">{{ t('help.contact') }}</GButton>
      </div>
    </div>
  </header>
  <div v-else class="help-embedded">
    <div class="help-embedded__inner">
      <HelpTabs class="help-header__nav" />
      <GButton tier="secondary" compact @click="openSupport()">{{ t('help.contact') }}</GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import LanguageSelector from '@/modules/navigation/components/LanguageSelector.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import geroMark from '@/assets/svg/gero-notext.svg';
import HelpTabs from './HelpTabs.vue';
import { useHelpNavigation } from './helpNavigation';
import { openSupport } from './supportIntent';

withDefaults(defineProps<{ variant?: 'public' | 'embedded' }>(), { variant: 'public' });
const { t } = useTranslation();
const { homeTo } = useHelpNavigation();
</script>

<style scoped>
.help-header { border-bottom: 1px solid var(--g-hairline-1); }
.help-header__inner, .help-embedded__inner {
  max-width: var(--g-content-max); margin: 0 auto; padding: var(--g-s-3) var(--g-s-6); box-sizing: border-box;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-3) var(--g-s-5);
}
.help-brand { display: flex; align-items: center; gap: 10px; color: var(--g-text-1); text-decoration: none; }
.help-brand__mark { display: block; width: 27px; height: 24px; }
.help-brand__name { font-size: 16px; font-weight: 620; letter-spacing: -0.01em; }
.help-brand__rule { width: 1px; height: 16px; background: var(--g-hairline-3); }
.help-brand__title { font-family: var(--g-font-ui); font-size: 14px; font-weight: 500; color: var(--g-text-2); }
.help-header__nav { flex: 1 1 auto; }
.help-header__actions { display: flex; align-items: center; gap: var(--g-s-2); margin-left: auto; }

/* The wallet shell supplies its own chrome, so only the tab row and Contact support come along. */
.help-embedded { border-bottom: 1px solid var(--g-hairline-1); }
.help-embedded__inner { padding-top: 0; padding-bottom: 0; }
.help-embedded__inner > .g-btn { margin-left: auto; }

/* LanguageSelector is a large plain button; here it sits like a compact tertiary one. */
html .help-lang :deep(.v-btn) { height: var(--g-btn-h-compact); padding: 0 var(--g-s-3); color: var(--g-text-2); font-size: 13.5px; font-weight: 600; letter-spacing: 0; text-transform: none; }

@media (max-width: 640px) {
  .help-header__inner { padding: var(--g-s-2) var(--g-s-4) 0; gap: 0 var(--g-s-2); }
  .help-embedded__inner { padding: 0 var(--g-s-4); gap: 0 var(--g-s-2); }
  .help-brand { margin-right: auto; }
  .help-brand__name, .help-brand__rule { display: none; }
  .help-brand__title { font-size: 15px; font-weight: 600; color: var(--g-text-1); }
  /* Tabs drop to their own scrolling row; the first label lines up with the 16px page gutter. */
  .help-header__nav { order: 3; width: calc(100% + 24px); margin: 0 -12px; overflow-x: auto; }
  /* The language control shrinks to its flag: the content box is cut to the flag, so label and chevron clip away. */
  html .help-lang :deep(.v-btn) { min-width: 0; max-width: 44px; padding: 0 var(--g-s-3); }
  .help-lang :deep(.v-btn__content) { flex: none; width: 20px; overflow: hidden; justify-content: flex-start; }
}
</style>
