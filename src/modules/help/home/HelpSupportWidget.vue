<template>
  <section class="glass-panel support" aria-labelledby="help-support-title">
    <div class="support-head">
      <div class="support-title">
        <p class="t-label">{{ t('help.supportLabel') }}</p>
        <h2 id="help-support-title" class="t-heading">{{ t('help.stillNeedHelp') }}</h2>
      </div>
      <IsoScene name="helpSupport" class="support-scene" />
    </div>
    <p class="t-body-sm support-summary">{{ t('help.supportSummary') }}</p>
    <div class="glass-tier support-row">
      <v-icon :size="18" color="var(--g-text-2)" class="support-row__icon">mdi-lock-outline</v-icon>
      <div class="support-row__copy">
        <span class="support-row__title">{{ t('help.home.liveChat') }}</span>
        <span class="t-body-sm" data-test="live-chat-status">{{ t(widget.statusKey) }}</span>
      </div>
    </div>
    <div class="glass-tier support-row support-row--mail">
      <v-icon :size="18" color="var(--g-text-2)" class="support-row__icon">mdi-email-outline</v-icon>
      <a class="support-email" :href="'mailto:' + email" @click="track({ type: 'support_email', subject: 'widget' })">{{ email }}</a>
      <GButton tier="tertiary" compact class="support-copy" :aria-label="t('help.copyEmail')" @click="copyEmail()"><v-icon :size="18">mdi-content-copy</v-icon></GButton>
    </div>
    <p v-if="copyState" class="t-caption support-feedback" role="status">{{ t(copyState === 'copied' ? 'help.copied' : 'help.copyFailed') }}</p>
    <p class="t-caption support-eligibility">{{ t('help.eligibility') }}</p>
    <GButton v-if="widget.action === 'unlock'" tier="tertiary" compact class="support-action" :to="unlockPath">{{ t('help.unlock') }}</GButton>
    <GButton v-else-if="widget.action === 'setup'" tier="tertiary" compact class="support-action" to="/welcome">{{ t('help.setup') }}</GButton>
    <GButton v-else tier="tertiary" compact class="support-action" @click="openSupport()">{{ t('help.contact') }}</GButton>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import { helpUnlockPath } from '@/modules/navigation/helpAccess';
import { supportNoticeFor, openSupport } from '../supportIntent';
import { supportWidgetFor } from '../helpHome';
import { useHelpTracking } from '../useHelpTracking';

const email = 'support@gerowallet.io';
const { t } = useTranslation();
const route = useRoute();
const { hasWallets } = useAvailableWallets();
const { track } = useHelpTracking();
// Same inputs as HelpSupportAction, so the card and the dialog always agree on what is available.
const notice = computed(() => supportNoticeFor({
  wallet: walletStore.loggedWallet, locked: walletStore.isLocked, syncing: walletStore.isSyncing,
  hasWallets: hasWallets.value, flagsReady: featureFlagsStore.state.isInitialized,
  liveChat: featureFlagsStore.isLiveChatEnabled(),
}));
const widget = computed(() => supportWidgetFor(notice.value));
const unlockPath = computed(() => helpUnlockPath(route.fullPath));

const copyState = ref<'copied' | 'failed' | null>(null);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
async function copyEmail(): Promise<void> {
  clearTimeout(resetTimer);
  try { await navigator.clipboard.writeText(email); copyState.value = 'copied'; track({ type: 'support_email_copied', subject: 'widget' }); }
  catch { copyState.value = 'failed'; }
  resetTimer = setTimeout(() => { copyState.value = null; }, 4000);
}
onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<style scoped>
.support { display: flex; flex-direction: column; gap: var(--g-s-4); min-width: 0; padding: var(--g-s-5); }
.support-head { display: flex; align-items: flex-start; gap: var(--g-s-3); }
.support-title { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.support-title p, .support-title h2 { margin: 0; }
.support-scene { flex: none; width: 124px; height: auto; margin: -12px -12px -8px 0; }
.support-summary { margin: 0; line-height: 1.5; }
.support-row { display: flex; align-items: flex-start; gap: var(--g-s-3); padding: var(--g-s-3) 14px; }
.support-row--mail { align-items: center; padding: 6px 6px 6px 14px; }
.support-row__icon { flex: none; margin-top: 1px; }
.support-row--mail .support-row__icon { margin-top: 0; }
.support-row__copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.support-row__title { font-size: 14px; font-weight: 550; color: var(--g-text-1); }
.support-email {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--g-accent); font-size: 14px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px;
}
.support-email:hover { color: var(--g-grad-1); }
html .support .support-copy.v-btn.g-btn { --g-btn-fg: var(--g-text-2); min-width: 0; width: 40px; padding: 0; }
.support-feedback, .support-eligibility { margin: 0; line-height: 1.5; }
.support-action { align-self: flex-start; margin: auto 0 0 calc(-1 * var(--g-s-3)); }
@media (max-width: 640px) {
  .support { gap: var(--g-s-3); padding: 20px; }
  .support-title h2 { font-size: 18px; }
  .support-scene { width: 116px; margin: -10px -8px -8px 0; }
  .support-row--mail { padding: var(--g-s-1) var(--g-s-1) var(--g-s-1) 14px; }
  html .support .support-copy.v-btn.g-btn { width: 44px; height: 44px; }
  /* On a phone the closing action becomes a full-width secondary button. */
  html .support .support-action.v-btn.g-btn { --g-btn-fg: var(--g-text-1); align-self: stretch; height: var(--g-btn-h); margin: 0; border: 1px solid var(--g-hairline-2); }
}
</style>
