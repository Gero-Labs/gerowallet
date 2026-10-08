<template>
  <v-dialog v-model="noticeOpen" max-width="480" :aria-label="t('help.contact')">
    <section class="help-notice glass-overlay" role="document">
      <p class="t-label">{{ t('help.supportLabel') }}</p>
      <h2 class="t-heading">{{ t('help.contact') }}</h2>
      <p class="t-body" data-test="support-notice">{{ noticeText }}</p>
      <p v-if="state === 'noWallets' || state === 'locked'" class="t-caption">{{ t('help.eligibility') }}</p>
      <a class="help-email" href="mailto:support@gerowallet.io">support@gerowallet.io</a>
      <div class="help-notice-actions">
        <GButton compact @click="copyEmail">{{ t(copied ? 'help.copied' : 'help.copyEmail') }}</GButton>
        <GButton v-if="state === 'locked'" compact :to="unlockPath" @click="noticeOpen = false">{{ t('help.unlock') }}</GButton>
        <GButton v-if="state === 'noWallets'" compact to="/welcome" @click="noticeOpen = false">{{ t('help.setup') }}</GButton>
        <GButton tier="tertiary" compact @click="noticeOpen = false">{{ t('common.close') }}</GButton>
      </div>
      <p v-if="copyFailed" role="status" class="t-caption">{{ t('help.copyFailed') }}</p>
    </section>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { helpUnlockPath } from '@/modules/navigation/helpAccess';
import { clearHelpSupport, helpSupportIntent, openWalletSupport, supportNoticeFor } from './supportIntent';
import { version } from '../../../package.json';

const { t } = useTranslation();
const route = useRoute();
const { hasWallets } = useAvailableWallets();
const noticeOpen = ref(false);
const copied = ref(false);
const copyFailed = ref(false);
const state = computed(() => supportNoticeFor({
  wallet: walletStore.loggedWallet, locked: walletStore.isLocked, syncing: walletStore.isSyncing,
  hasWallets: hasWallets.value, flagsReady: featureFlagsStore.state.isInitialized,
  liveChat: featureFlagsStore.isLiveChatEnabled(),
}));
const noticeText = computed(() => state.value === 'ineligible' ? t('support.unavailable.notice') : t(`help.notice.${state.value}`));
const unlockPath = computed(() => helpUnlockPath(route.fullPath));

watch(() => helpSupportIntent.request, request => {
  if (!request) return;
  helpSupportIntent.request = null;
  copied.value = false;
  copyFailed.value = false;
  if (state.value !== 'eligible') {
    noticeOpen.value = true;
    return;
  }
  const wallet = walletStore.loggedWallet;
  // All context is visible and editable in the composer before Send.
  const context = [
    request.articleId ? `${t('help.context.guide')}: ${request.articleId}` : '',
    `${t('help.context.chain')}: ${wallet.chain}`,
    `${t('help.context.network')}: ${wallet.network}`,
    `${t('help.context.version')}: ${version}`,
  ].filter(Boolean).join('\n');
  openWalletSupport(`${t('help.question')}\n\n${t('help.context.preview')}\n${context}`, wallet.id);
}, { immediate: true });

watch(() => [walletStore.loggedWallet?.id, walletStore.isLocked, walletStore.isSyncing], () => {
  clearHelpSupport();
  noticeOpen.value = false;
});
watch(state, value => {
  if (value !== 'eligible' && helpSupportIntent.active) {
    clearHelpSupport();
    noticeOpen.value = true;
  }
});
onBeforeUnmount(clearHelpSupport);

async function copyEmail(): Promise<void> {
  try { await navigator.clipboard.writeText('support@gerowallet.io'); copied.value = true; }
  catch { copyFailed.value = true; }
}
</script>

<style scoped>
.help-notice { padding: var(--g-s-6); color: var(--g-text-1); }
.help-notice h2 { margin: var(--g-s-3) 0; }
.help-notice p { margin-bottom: var(--g-s-4); }
.help-email { color: var(--g-accent); overflow-wrap: anywhere; }
.help-notice-actions { display: flex; flex-wrap: wrap; gap: var(--g-s-2); margin-top: var(--g-s-5); }
</style>
