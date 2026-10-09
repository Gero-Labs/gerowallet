<template>
  <v-dialog
    v-model="dialogOpen"
    max-width="520"
    transition="g-dialog-transition"
    overlay-color="var(--g-canvas)"
    overlay-opacity="0.6"
    content-class="help-support-dialog"
  >
    <section class="support-sheet glass-overlay" role="document" aria-labelledby="help-support-title">
      <div class="support-header">
        <h2 id="help-support-title" ref="titleEl" class="t-heading" tabindex="-1">{{ t('help.contact') }}</h2>
        <GButton
          tier="tertiary"
          compact
          class="support-close"
          :aria-label="t('common.close')"
          @click="closeDialog()"
        >
          <v-icon size="18">mdi-close</v-icon>
        </GButton>
      </div>

      <template v-if="showChat">
        <div role="status" class="support-status">
          <v-icon size="18" color="var(--g-success)">mdi-check-circle-outline</v-icon>
          <p>{{ t('help.notice.eligible') }}</p>
        </div>

        <div class="support-field">
          <label class="support-label" for="help-support-question">{{ t('help.supportDialog.question') }}</label>
          <textarea
            id="help-support-question"
            ref="questionEl"
            v-model="question"
            class="support-textarea"
            rows="3"
          />
        </div>

        <div v-if="showContext" class="support-field">
          <div class="support-field-head">
            <label id="help-support-context-label" class="support-label" for="help-support-context">{{ t('help.context.preview') }}</label>
            <GButton
              tier="tertiary"
              compact
              class="support-remove"
              aria-describedby="help-support-context-label"
              @click="removeContext()"
            >{{ t('common.remove') }}</GButton>
          </div>
          <textarea
            id="help-support-context"
            v-model="context"
            class="support-textarea support-textarea--context"
            rows="4"
          />
        </div>

        <p class="support-caption">
          <v-icon size="16" color="var(--g-text-2)">mdi-shield-outline</v-icon>
          {{ t('help.supportDialog.noRecoveryPhrase') }}
        </p>

        <div class="support-footer">
          <GButton @click="showEmail()">{{ t('help.supportDialog.emailInstead') }}</GButton>
          <GButton tier="primary" @click="startChat()">{{ t('help.supportDialog.startChat') }}</GButton>
        </div>
      </template>

      <template v-else>
        <p class="t-body support-notice" data-test="support-notice">{{ noticeText }}</p>

        <div class="glass-tier support-email">
          <span class="support-email-well" aria-hidden="true">
            <v-icon size="18" color="var(--g-text-2)">mdi-email-outline</v-icon>
          </span>
          <div class="support-email-text">
            <span class="t-caption">{{ t('help.supportDialog.emailSupport') }}</span>
            <a class="support-email-link" :href="mailto" @click="trackEmail()">{{ email }}</a>
          </div>
          <GButton compact @click="copyEmail()">
            <v-icon left size="16">mdi-content-copy</v-icon>{{ t(copied ? 'help.copied' : 'help.copyEmail') }}
          </GButton>
        </div>
        <p v-if="copyFailed" role="status" class="t-caption">{{ t('help.copyFailed') }}</p>

        <p v-if="state === 'noWallets' || state === 'locked'" class="support-caption support-caption--top">
          <v-icon size="16" color="var(--g-text-2)">mdi-information-outline</v-icon>
          {{ t('help.eligibility') }}
        </p>

        <div class="support-footer">
          <GButton v-if="state === 'noWallets'" to="/welcome" @click="closeDialog()">{{ t('help.setup') }}</GButton>
          <GButton v-if="state === 'locked'" :to="unlockPath" @click="closeDialog()">{{ t('help.unlock') }}</GButton>
          <GButton tier="primary" :href="mailto" @click="trackEmail()">{{ t('help.supportDialog.emailSupport') }}</GButton>
        </div>
      </template>
    </section>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { helpUnlockPath } from '@/modules/navigation/helpAccess';
import { clearHelpSupport, helpSupportIntent, openWalletSupport, supportNoticeFor } from './supportIntent';
import { useHelpTracking } from './useHelpTracking';
import { version } from '../../../package.json';

const email = 'support@gerowallet.io';
const mailto = `mailto:${email}`;

const { t } = useTranslation();
const route = useRoute();
const { hasWallets } = useAvailableWallets();
const { track } = useHelpTracking();
const dialogOpen = ref(false);
// 'chat' is only ever shown while the wallet is eligible; everything else is the email view.
const view = ref<'chat' | 'email'>('email');
const question = ref('');
const context = ref('');
const showContext = ref(false);
const copied = ref(false);
const copyFailed = ref(false);
const titleEl = ref<HTMLElement | null>(null);
const questionEl = ref<HTMLTextAreaElement | null>(null);
const state = computed(() => supportNoticeFor({
  wallet: walletStore.loggedWallet, locked: walletStore.isLocked, syncing: walletStore.isSyncing,
  hasWallets: hasWallets.value, flagsReady: featureFlagsStore.state.isInitialized,
  liveChat: featureFlagsStore.isLiveChatEnabled(),
}));
const showChat = computed(() => view.value === 'chat' && state.value === 'eligible');
const noticeText = computed(() => {
  // Reached from "Email instead" on an eligible wallet: no eligibility problem to explain.
  if (state.value === 'eligible') return t('help.supportDialog.emailAvailable');
  return state.value === 'ineligible' ? t('support.unavailable.notice') : t(`help.notice.${state.value}`);
});
const unlockPath = computed(() => helpUnlockPath(route.fullPath));

// The dialog counts anonymously when it opens, with the state it opens in (never who the person is).
function showDialog(): void {
  dialogOpen.value = true;
  track({ type: 'support_open', subject: state.value });
}
function trackEmail(): void {
  track({ type: 'support_email', subject: 'dialog' });
}

// Page-local, in-memory only: nothing is stored and nothing is sent until "Start live chat".
function openDialog(articleId?: string): void {
  copied.value = false;
  copyFailed.value = false;
  if (state.value === 'eligible') {
    const wallet = walletStore.loggedWallet;
    // All context is visible and editable before it reaches the chat composer.
    question.value = t('help.question');
    context.value = [
      articleId ? `${t('help.context.guide')}: ${articleId}` : '',
      `${t('help.context.chain')}: ${wallet.chain}`,
      `${t('help.context.network')}: ${wallet.network}`,
      `${t('help.context.version')}: ${version}`,
    ].filter(Boolean).join('\n');
    showContext.value = true;
    view.value = 'chat';
  } else {
    question.value = '';
    context.value = '';
    showContext.value = false;
    view.value = 'email';
  }
  showDialog();
}

watch(() => helpSupportIntent.request, request => {
  if (!request) return;
  helpSupportIntent.request = null;
  openDialog(request.articleId);
}, { immediate: true });

watch(() => [walletStore.loggedWallet?.id, walletStore.isLocked, walletStore.isSyncing], () => {
  clearHelpSupport();
  dialogOpen.value = false;
});
watch(state, value => {
  if (value !== 'eligible' && helpSupportIntent.active) {
    clearHelpSupport();
    copied.value = false;
    copyFailed.value = false;
    view.value = 'email';
    showDialog();
  }
});
onBeforeUnmount(clearHelpSupport);

function closeDialog(): void {
  dialogOpen.value = false;
}

function removeContext(): void {
  context.value = '';
  showContext.value = false;
  // The button that had focus is gone; keep keyboard users inside the dialog.
  void nextTick(() => questionEl.value?.focus());
}

function showEmail(): void {
  copied.value = false;
  copyFailed.value = false;
  view.value = 'email';
  void nextTick(() => titleEl.value?.focus());
}

function startChat(): void {
  const wallet = walletStore.loggedWallet;
  if (state.value !== 'eligible' || !wallet) return;
  const contextText = showContext.value ? context.value.trim() : '';
  const draft = [
    question.value.trim(),
    contextText ? `${t('help.context.preview')}\n${contextText}` : '',
  ].filter(Boolean).join('\n\n');
  openWalletSupport(draft, wallet.id);
  track({ type: 'support_chat_started' });
  dialogOpen.value = false;
}

async function copyEmail(): Promise<void> {
  copied.value = false;
  copyFailed.value = false;
  try { await navigator.clipboard.writeText(email); copied.value = true; track({ type: 'support_email_copied', subject: 'dialog' }); }
  catch { copyFailed.value = true; }
}
</script>

<style scoped>
.support-sheet {
  width: 100%;
  max-width: 520px;
  box-sizing: border-box;
  padding: var(--g-s-5);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  color: var(--g-text-1);
}
/* Vuetify gives every paragraph a bottom margin; the sheet spaces with gap. */
.support-sheet p { margin: 0; }

.support-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.support-header h2 { margin: 0; }
/* Qualified to 0,5,0 so these beat GButton's own 0,4,0 rules regardless of
   stylesheet order; the foreground goes through GButton's --g-btn-fg seam. */
.v-btn.g-btn.g-btn--tertiary.support-close {
  min-width: 0;
  width: 40px;
  padding: 0;
  margin-right: calc(-1 * var(--g-s-2));
  --g-btn-fg: var(--g-text-2);
}
.v-btn.g-btn.g-btn--tertiary.support-remove { margin-right: calc(-1 * var(--g-s-3)); }

.support-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--g-r-control);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
}
.support-status .v-icon { flex: none; }
.support-status p { font-size: 13.5px; color: var(--g-text-1); }

.support-field { display: flex; flex-direction: column; gap: 6px; }
.support-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.support-label { font-size: 13px; font-weight: 550; color: var(--g-text-1); }
/* Solid raised fill: text inputs are controls, not surfaces (glass baseline exception). */
.support-textarea {
  resize: vertical;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-1);
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.support-textarea--context { color: var(--g-text-2); font-size: 13px; line-height: 1.6; }

.support-caption {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  font-size: 12.5px;
  color: var(--g-text-2);
}
.support-caption .v-icon { flex: none; }
.support-caption--top { align-items: flex-start; line-height: 1.5; }
.support-caption--top .v-icon { margin-top: 1px; }

.support-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--g-s-2);
  padding-top: var(--g-s-1);
}

.support-notice { line-height: 1.55; }
.support-email {
  padding: var(--g-s-3) var(--g-s-3) var(--g-s-3) var(--g-s-4);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-3);
}
/* Solid raised fill: an icon well is a control-sized chip, not a surface. */
.support-email-well {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--g-text-2);
}
.support-email-text {
  flex: 1 1 180px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.support-email-link {
  font-size: 15px;
  font-weight: 550;
  color: var(--g-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
}
.support-email-link:hover { color: var(--g-grad-1); }
</style>

<style>
/* The sheet carries its own material and shadow; drop the dialog box's elevation behind it. */
.v-dialog.help-support-dialog { box-shadow: none; }
</style>
