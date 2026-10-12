<template>
  <HelpCard id="help-x-title" :title="t('help.home.latestOnX')" class="xcard">
    <template #action>
      <!-- The segmented track is a control (accepted solid fills), like the chain pills. -->
      <div role="group" :aria-label="t('help.home.account')" class="x-toggle">
        <button v-for="choice in accounts" :key="choice.source" type="button" class="x-toggle__button" :aria-pressed="account === choice.source ? 'true' : 'false'" @click="account = choice.source">{{ choice.label }}</button>
      </div>
    </template>
    <article v-if="item" class="x-post">
      <div class="x-author">
        <HelpSourceBadge :source="account" class="x-avatar" />
        <div class="x-meta">
          <span class="x-name">{{ t('help.updateSource.' + account) }}</span>
          <span class="t-caption g-num">{{ t('help.postDate') }} · {{ date }}</span>
        </div>
      </div>
      <p class="t-body x-text" :lang="item.locale">{{ item.text || item.summary || item.title }}</p>
      <img v-if="image" :src="image.src" :alt="image.alt" class="x-media" loading="lazy" />
      <p v-if="failed" class="t-caption x-saved" role="status"><v-icon :size="14" color="var(--g-warning)" class="x-saved__icon">mdi-alert-outline</v-icon>{{ t('help.cachedUpdates') }}</p>
    </article>
    <p v-else class="t-body-sm x-status" role="status">{{ t(loading ? 'help.loadingUpdates' : failed ? 'help.updatesUnavailable' : 'help.noUpdates') }}</p>
    <GButton v-if="link" tier="tertiary" compact class="x-link" :href="link" target="_blank" rel="noopener noreferrer" @click="openPost()">
      {{ t('help.home.viewOnX') }}
      <v-icon :size="16">mdi-open-in-new</v-icon>
    </GButton>
  </HelpCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import i18n from '@/plugins/i18n';
import { helpLocale } from '@/api/help.api';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatHelpDate } from '../helpFormat';
import { useHelpNavigation } from '../helpNavigation';
import { updateImages, updateLink } from '../helpUpdates';
import { useHelpTracking } from '../useHelpTracking';
import { useHelpUpdates } from '../useHelpUpdates';
import HelpSourceBadge from '../HelpSourceBadge.vue';
import HelpCard from './HelpCard.vue';

const { t } = useTranslation();
const { chain } = useHelpNavigation();
const { home, updateOpened } = useHelpTracking();
type Account = 'gero-x' | 'nexus-x';
// Brand names, so they are not translated. Only the selected account is requested; the other loads on first toggle.
const accounts: { source: Account; label: string }[] = [{ source: 'gero-x', label: 'Gero' }, { source: 'nexus-x', label: 'Nexus' }];
const account = ref<Account>('gero-x');
const request = computed(() => ({ source: account.value, chain: chain.value, locale: helpLocale(i18n.locale), limit: 1 }));
const { page, loading, failed } = useHelpUpdates(request);
const item = computed(() => page.value?.items[0] ?? null);
const link = computed(() => item.value ? updateLink(item.value) : null);
const image = computed(() => item.value ? updateImages(item.value, import.meta.env['VITE_BACKEND_URL'])[0] ?? null : null);
function openPost(): void {
  home(account.value === 'gero-x' ? 'x_gero' : 'x_nexus');
  updateOpened(account.value);
}
const date = computed(() => formatHelpDate(item.value?.publishedAt, helpLocale(i18n.locale)) || t('help.dateUnknown'));
</script>

<style scoped>
.xcard { --source-badge-size: 36px; gap: 14px; }
.x-toggle { display: inline-flex; padding: 3px; gap: 2px; border-radius: var(--g-r-pill); background: var(--g-raised); border: 1px solid var(--g-hairline-1); }
.x-toggle__button {
  height: 30px; padding: 0 var(--g-s-3); border: 0; border-radius: var(--g-r-pill);
  background: transparent; color: var(--g-text-2); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);
}
.x-toggle__button[aria-pressed="true"] { background: var(--g-overlay); color: var(--g-text-1); font-weight: 550; }
.x-post { display: flex; flex-direction: column; gap: 10px; }
.x-author { display: flex; align-items: center; gap: 10px; }
.x-meta { display: flex; flex-direction: column; min-width: 0; }
.x-name { font-size: 14px; font-weight: 550; color: var(--g-text-1); }
.x-text { margin: 0; color: var(--g-text-1); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.x-media {
  display: block; width: 100%; height: auto;
  border-radius: var(--g-r-control); border: 1px solid var(--g-hairline-1); box-sizing: border-box;
}
.x-status { margin: 0; }
.x-saved { display: flex; align-items: flex-start; gap: 6px; margin: 0; }
.x-saved__icon { flex: none; margin-top: 1px; }
.x-link { align-self: flex-start; margin: auto 0 0 calc(-1 * var(--g-s-3)); }
.x-link .v-icon { margin-left: var(--g-s-1); }
@media (max-width: 640px) {
  .xcard { --source-badge-size: 32px; gap: var(--g-s-3); }
  .x-link { margin-top: 0; }
}
</style>
