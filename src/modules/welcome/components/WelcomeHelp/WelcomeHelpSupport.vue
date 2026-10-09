<template>
  <section class="whelp-support glass-tier" :class="{ 'whelp-support--compact': compact }" aria-labelledby="whelp-support-title">
    <h3 id="whelp-support-title" :class="compact ? 'sr-only' : 't-label'">{{ t('help.supportLabel') }}</h3>
    <p class="whelp-support__text" :class="compact ? 't-caption' : 't-body-sm'">{{ notice }}</p>
    <div class="whelp-support__mail">
      <v-icon v-if="!compact" size="18" color="var(--g-text-2)">mdi-email-outline</v-icon>
      <a class="whelp-support__link" :href="`mailto:${SUPPORT_EMAIL}`" @click="track('support_email')">{{ SUPPORT_EMAIL }}</a>
      <GButton
        class="whelp-support__copy"
        tier="tertiary"
        :compact="!compact"
        :aria-label="t('help.copyEmail')"
        data-test="copy-email"
        @click="copyEmail()"
      >
        <v-icon size="18" :color="copied ? 'var(--g-success)' : undefined">{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
      </GButton>
    </div>
    <!-- Always mounted so assistive tech announces the text when it appears; only a failed copy shows it. -->
    <p class="whelp-support__status t-caption" :class="{ 'sr-only': !copyFailed }" role="status" data-test="copy-status">{{ status }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { trackHelp } from '@/modules/help/helpAnalytics';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const props = defineProps<{
  hasWallets: boolean;
  /** Phone layout: no mail icon, tighter copy, 44px copy target, heading visually hidden. */
  compact?: boolean;
}>();

const SUPPORT_EMAIL = 'support@gerowallet.io';
const COPIED_MS = 2000;

const { t } = useTranslation();
const copied = ref(false);
const copyFailed = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

// Anonymous usage counts: which support email action was used, nothing about the person.
function track(type: 'support_email' | 'support_email_copied'): void {
  trackHelp({ type, subject: 'welcome', surface: 'welcome', chain: 'all' });
}

const notice = computed(() => t(props.hasWallets ? 'help.notice.locked' : 'help.notice.noWallets'));
const status = computed(() => copyFailed.value ? t('help.copyFailed') : copied.value ? t('help.copied') : '');

async function copyEmail(): Promise<void> {
  clearTimeout(resetTimer);
  try {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    copied.value = true;
    track('support_email_copied');
    copyFailed.value = false;
    resetTimer = setTimeout(() => { copied.value = false; }, COPIED_MS);
  } catch {
    copied.value = false;
    copyFailed.value = true;
  }
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<style scoped lang="scss">
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Material comes from the glass-tier class; this block only lays out its content. */
.whelp-support {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}
.whelp-support h3,
.whelp-support p { margin: 0; }
.whelp-support__text { line-height: 1.5; }

.whelp-support__mail {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  /* Pulls the copy button's hit area into the card's padding, as drawn. */
  margin: -2px -6px -6px 0;
}
.whelp-support__link {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--g-accent);
  font-size: 14px;
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
  transition: color var(--g-dur-fast) var(--g-ease);
}
.whelp-support__link:hover { color: var(--g-text-1); }

/* Icon-only copy button: 36px square (44px in the compact phone layout). */
.v-btn.g-btn.whelp-support__copy:not(.v-btn--round) {
  --g-btn-fg: var(--g-text-2);
  min-width: 0;
  width: 36px;
  padding: 0;
}

.whelp-support--compact {
  gap: 6px;
  padding: var(--g-s-3) 6px 6px 14px;
}
.whelp-support--compact .whelp-support__text {
  padding-right: var(--g-s-2);
}
.whelp-support--compact .whelp-support__mail { margin: 0; }
.whelp-support--compact .v-btn.g-btn.whelp-support__copy:not(.v-btn--round) {
  width: 44px;
  height: 44px;
}
</style>
