<template>
  <!-- A Stagenet wallet: Stagenet is being retired and the wallet will move to
       Preview, a new chain, so nothing on it carries over. Said before the move,
       with the faucet for new tNIGHT. Renders nothing for any other wallet, so a
       parent's spacing class lands only on the banner. -->
  <div v-if="isStagenet" class="stagenet-notice" role="note" data-test="midnight-stagenet-notice">
    <v-icon size="20" color="warning" class="stagenet-notice__icon" aria-hidden="true">mdi-alert-circle-outline</v-icon>
    <p class="stagenet-notice__text t-body-sm">
      {{ sentence.before }}<a
        class="stagenet-notice__link"
        :href="MIDNIGHT_PREVIEW_FAUCET_URL"
        target="_blank"
        rel="noopener noreferrer"
        data-test="midnight-stagenet-faucet"
      >{{ t('midnight.stagenet.faucetLink') }}<v-icon size="13" class="stagenet-notice__external" aria-hidden="true">mdi-open-in-new</v-icon><span class="g-sr-only">{{ t('midnight.stagenet.opensNewTab') }}</span></a>{{ sentence.after }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { MIDNIGHT_PREVIEW_FAUCET_URL } from '@/chains/midnight/midnightConfig';
import { isMidnightStagenetWallet } from './midnightStagenet';

const { t } = useTranslation();

const isStagenet = computed(() => isMidnightStagenetWallet(walletStore.loggedWallet));

/**
 * The sentence around the link. The link text is its own key and the sentence
 * carries `{faucet}` where it goes, so each language places it where its grammar
 * needs it, and the sentence is never cut into pieces for translators.
 */
const FAUCET_MARK = '@@faucet@@';
const sentence = computed(() => {
  const text = String(t('midnight.stagenet.retiring', { faucet: FAUCET_MARK }));
  const at = text.indexOf(FAUCET_MARK);
  return at < 0
    ? { before: `${text} `, after: '' }
    : { before: text.slice(0, at), after: text.slice(at + FAUCET_MARK.length) };
});
</script>

<style scoped lang="scss">
/* A banner: the warning glyph on the muted warning pair (fill and line), per the design system. */
.stagenet-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-card);
}

/* Same offset as the sibling banners in the notice slot. */
.stagenet-notice__icon {
  margin-top: 2px;
}

.stagenet-notice__text {
  flex: 1;
  min-width: 0;
  max-width: 72ch;
  margin: 0;
  color: var(--g-text-1);
}

/* A link inside prose: underlined always, the accent alone is not a cue. */
.stagenet-notice__link {
  color: var(--g-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.stagenet-notice__link:hover {
  text-decoration-thickness: 2px;
}

.stagenet-notice__external {
  margin-left: 2px;
  vertical-align: -1px;
}
</style>
