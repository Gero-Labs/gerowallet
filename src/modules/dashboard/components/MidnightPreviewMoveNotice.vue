<template>
  <!-- A wallet the update moved from the retired Stagenet to Preview, said once:
       Preview is a new chain, so nothing on Stagenet carried over, with the
       faucet for new tNIGHT. Stays until dismissed (the per-wallet config flag,
       midnightPreviewMoveNotice.ts). Renders nothing for any other wallet, so a
       parent's spacing class lands only on the banner. -->
  <div v-if="shown" class="preview-move-notice" role="note" data-test="midnight-preview-move-notice">
    <v-icon size="20" color="warning" class="preview-move-notice__icon" aria-hidden="true">mdi-alert-circle-outline</v-icon>
    <p class="preview-move-notice__text t-body-sm">
      {{ sentence.before }}<a
        class="preview-move-notice__link"
        :href="MIDNIGHT_PREVIEW_FAUCET_URL"
        target="_blank"
        rel="noopener noreferrer"
        data-test="midnight-preview-move-faucet"
      >{{ t('midnight.previewMove.faucetLink') }}<v-icon size="13" class="preview-move-notice__external" aria-hidden="true">mdi-open-in-new</v-icon><span class="g-sr-only">{{ t('midnight.previewMove.opensNewTab') }}</span></a>{{ sentence.after }}
    </p>
    <GButton tier="tertiary" compact :disabled="dismissing" data-test="midnight-preview-move-dismiss" @click="dismiss()">
      {{ t('midnight.pending.dismiss') }}
    </GButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { setWalletConfiguration } from '@/db/wallet-db';
import { MIDNIGHT_PREVIEW_FAUCET_URL } from '@/chains/midnight/midnightConfig';
import { PREVIEW_MOVE_NOTICE_CONFIG_KEY } from '@/chains/midnight/midnightPreviewMove';
import { showsPreviewMoveNotice } from './midnightPreviewMoveNotice';

const { t } = useTranslation();

const dismissing = ref(false);
// Hidden here at once; other pages follow when the config loader brings the row back.
const dismissedHere = ref<number | null>(null);
const shown = computed(() => dismissedHere.value !== walletStore.loggedWallet?.id
  && showsPreviewMoveNotice(walletStore.loggedWallet, walletStore.config));

/**
 * The sentence around the link. The link text is its own key and the sentence
 * carries `{faucet}` where it goes, so each language places it where its grammar
 * needs it, and the sentence is never cut into pieces for translators.
 */
const FAUCET_MARK = '@@faucet@@';
const sentence = computed(() => {
  const text = String(t('midnight.previewMove.moved', { faucet: FAUCET_MARK }));
  const at = text.indexOf(FAUCET_MARK);
  return at < 0
    ? { before: `${text} `, after: '' }
    : { before: text.slice(0, at), after: text.slice(at + FAUCET_MARK.length) };
});

/**
 * Dismissal is the wallet's own config row, written to its database: the
 * background's config loader brings it back to every open page, and it
 * survives restarts. Nothing here is security-relevant.
 */
async function dismiss(): Promise<void> {
  const id = walletStore.loggedWallet?.id;
  if (typeof id !== 'number' || dismissing.value) return;
  dismissing.value = true;
  try {
    await setWalletConfiguration(id, PREVIEW_MOVE_NOTICE_CONFIG_KEY, false);
    dismissedHere.value = id;
  } catch {
    // Not saved: the notice stays, and Dismiss can be pressed again.
  } finally {
    dismissing.value = false;
  }
}
</script>

<style scoped lang="scss">
/* A banner: the warning glyph on the muted warning pair (fill and line), per the design system. */
.preview-move-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-card);
}

/* Same offset as the sibling banners in the notice slot. */
.preview-move-notice__icon {
  margin-top: 2px;
}

.preview-move-notice__text {
  flex: 1;
  min-width: 0;
  max-width: 72ch;
  margin: 0;
  color: var(--g-text-1);
}

/* A link inside prose: underlined always, the accent alone is not a cue. */
.preview-move-notice__link {
  color: var(--g-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.preview-move-notice__link:hover {
  text-decoration-thickness: 2px;
}

.preview-move-notice__external {
  margin-left: 2px;
  vertical-align: -1px;
}
</style>
