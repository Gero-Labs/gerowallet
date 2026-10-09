<template>
  <div class="whelp" :class="{ 'whelp--phone': isPhone }">
    <!-- Phone only: tapping the dimmed welcome screen closes the sheet. A button, hidden from assistive tech and the tab order. -->
    <button v-if="isPhone" type="button" class="whelp-scrim" tabindex="-1" aria-hidden="true" data-test="scrim" @click="close()"></button>

    <component
      :is="isPhone ? 'section' : 'aside'"
      id="whelp-panel"
      ref="panel"
      :class="isPhone ? 'whelp-sheet' : 'whelp-panel glass-overlay'"
      :role="isPhone ? 'dialog' : undefined"
      :aria-modal="isPhone ? 'true' : undefined"
      :aria-labelledby="current ? 'whelp-answer-title' : 'whelp-title'"
      data-test="help-panel"
      @keydown="onKeydown"
    >
      <div v-if="isPhone" class="whelp-grabber" aria-hidden="true"></div>

      <!-- Answer view: swaps in for the list, no route change -->
      <template v-if="current">
        <div class="whelp-bar">
          <GButton class="whelp-back" tier="tertiary" compact :aria-label="t('help.welcome.backToHelp')" data-test="back" @click="backToList()">
            <v-icon left size="18" color="var(--g-text-2)">mdi-chevron-left</v-icon>{{ t('help.welcome.title') }}
          </GButton>
          <GButton class="whelp-close" tier="tertiary" compact :aria-label="t('help.welcome.close')" data-test="close" @click="close()">
            <v-icon :size="isPhone ? 20 : 18">mdi-close</v-icon>
          </GButton>
        </div>
        <WelcomeHelpAnswer
          :key="current.id"
          :answer="current"
          :related="related"
          :setup-open="started"
          :has-wallets="hasWallets"
          :phone="isPhone"
          @open="openAnswer"
        />
      </template>

      <!-- Home view -->
      <template v-else>
        <header class="whelp-head">
          <div class="whelp-head__row">
            <div class="whelp-head__copy">
              <h2 id="whelp-title" ref="heading" class="t-heading whelp-head__title" tabindex="-1">{{ t('help.welcome.title') }}</h2>
              <p v-if="!isPhone" class="t-body-sm whelp-head__sub">{{ t('help.welcome.subtitle') }}</p>
            </div>
            <IsoScene v-if="!isPhone" name="helpHero" class="whelp-head__scene" />
            <GButton class="whelp-close whelp-close--float" tier="tertiary" compact :aria-label="t('help.welcome.close')" data-test="close" @click="close()">
              <v-icon :size="isPhone ? 20 : 18">mdi-close</v-icon>
            </GButton>
          </div>
          <form class="whelp-search" role="search" @submit.prevent>
            <v-icon size="18" color="var(--g-text-3)">mdi-magnify</v-icon>
            <label class="sr-only" for="whelp-search">{{ t('help.search') }}</label>
            <input
              id="whelp-search"
              ref="searchInput"
              v-model="query"
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              :placeholder="t('help.search')"
              data-test="search"
            />
          </form>
        </header>

        <div ref="scroller" class="whelp-body" data-test="list-view">
          <p class="sr-only" role="status" data-test="results-status">{{ resultsStatus }}</p>

          <section v-if="searching" class="whelp-section" data-test="results">
            <h3 v-if="results.length" id="whelp-results-title" class="sr-only">{{ tc('help.count', results.length, { count: results.length }) }}</h3>
            <ul v-if="results.length" class="whelp-list" aria-labelledby="whelp-results-title">
              <WelcomeHelpRow v-for="item in results" :key="item.id" :answer="item" @open="openAnswer" />
            </ul>
            <div v-else class="whelp-empty" data-test="no-results">
              <p class="whelp-empty__title">{{ t('help.noResults') }}</p>
              <p class="t-body-sm">{{ t('help.welcome.noResultsBody') }}</p>
            </div>
          </section>

          <template v-else>
            <section v-for="section in visibleSections" :key="section.id" class="whelp-section" :aria-labelledby="`whelp-section-${section.id}`" :data-section="section.id">
              <h3 :id="`whelp-section-${section.id}`" class="t-label">{{ t(section.labelKey) }}</h3>
              <ul class="whelp-list">
                <WelcomeHelpRow v-for="item in section.answers" :key="item.id" :answer="item" @open="openAnswer" />
              </ul>
            </section>
          </template>

          <div class="whelp-note" role="note" data-test="safety-note">
            <v-icon size="18" color="var(--g-warning)">mdi-shield-outline</v-icon>
            <p>{{ t('help.welcome.safety') }}</p>
          </div>

          <WelcomeHelpSupport :has-wallets="hasWallets" :compact="isPhone" />

          <WelcomeHelpNews v-if="!isPhone" :suppressed="searching" @open="openTab" />
        </div>
      </template>

      <footer class="whelp-foot">
        <!-- A refused new tab is reported here, inside the panel, instead of replacing the welcome screen's own content. -->
        <div role="status">
          <p v-if="failedPath" class="t-body-sm whelp-foot__fail" data-test="open-failed">
            {{ t('help.openFailed') }}
            <a :href="`#${failedPath}`" target="_blank" rel="noopener noreferrer">{{ t('help.openNewTab') }}</a>
          </p>
        </div>
        <GButton tier="tertiary" compact :href="`#${footerPath}`" target="_blank" rel="noopener" data-test="open-full" @click.prevent="openTab(footerPath)">
          {{ t(current ? 'help.welcome.openArticle' : 'help.welcome.openFull') }}
          <v-icon right size="16">mdi-open-in-new</v-icon>
        </GButton>
      </footer>
    </component>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { HelpAnswer } from '@/modules/help/helpContent';
import { openWelcomeHelp } from '@/modules/navigation/helpAccess';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import WelcomeHelpAnswer from './WelcomeHelpAnswer.vue';
import WelcomeHelpNews from './WelcomeHelpNews.vue';
import WelcomeHelpRow from './WelcomeHelpRow.vue';
import WelcomeHelpSupport from './WelcomeHelpSupport.vue';
import {
  answerHelpPath,
  relatedWelcomeAnswers,
  searchWelcomeHelp,
  welcomeHelpSections,
  welcomeHelpState,
} from './welcomeHelpContent';

const props = defineProps<{
  /** The Get Started step is open on the welcome screen. */
  started: boolean;
  /** Saved wallets exist (the sign-in list is showing). */
  hasWallets: boolean;
  /** The Help button that opened the panel; focus goes back to it on close. */
  opener?: HTMLElement | null;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const PHONE_QUERY = '(max-width: 600px)';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const { t, tc } = useTranslation();

const panel = ref<HTMLElement | null>(null);
const heading = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const scroller = ref<HTMLElement | null>(null);

// The one switch between the floating panel and the modal bottom sheet.
const phoneMedia = typeof window !== 'undefined' ? window.matchMedia?.(PHONE_QUERY) : undefined;
const isPhone = ref(!!phoneMedia?.matches);
const onPhoneChange = (event: MediaQueryListEvent): void => { isPhone.value = event.matches; };

const query = ref('');
const current = ref<HelpAnswer | null>(null);
const failedPath = ref<string | null>(null);

const state = computed(() => welcomeHelpState(props.started, props.hasWallets));
const sections = computed(() => welcomeHelpSections(state.value));
// The sheet is short: it leads with the state's first list only.
const visibleSections = computed(() => isPhone.value ? sections.value.slice(0, 1) : sections.value);
const searching = computed(() => query.value.trim().length > 0);
const results = computed(() => searchWelcomeHelp(query.value));
const related = computed(() => current.value ? relatedWelcomeAnswers(state.value, current.value) : []);
const resultsStatus = computed(() => !searching.value ? '' : results.value.length ? tc('help.count', results.value.length, { count: results.value.length }) : t('help.noResults'));
const footerPath = computed(() => current.value ? answerHelpPath(current.value) : '/help');

// What had focus when the panel opened (the Help button), as a fallback for `opener`.
const openedFrom = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
let savedScroll = 0;
let lastOpenedId: string | null = null;

function close(): void {
  emit('close');
}

async function openTab(path: string): Promise<void> {
  failedPath.value = (await openWelcomeHelp(path)) ? null : path;
}

function openAnswer(answer: HelpAnswer): void {
  if (!current.value) {
    savedScroll = scroller.value?.scrollTop ?? 0;
    lastOpenedId = answer.id;
  }
  current.value = answer;
}

async function backToList(): Promise<void> {
  current.value = null;
  await nextTick();
  // The search text lives in `query`, so only the scroll position and focus need restoring.
  if (scroller.value) scroller.value.scrollTop = savedScroll;
  const row = lastOpenedId ? panel.value?.querySelector<HTMLElement>(`[data-answer-id="${lastOpenedId}"]`) : null;
  (row ?? searchInput.value)?.focus({ preventScroll: true });
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const target = event.target as Node | null;
  // Non-modal on desktop: Escape elsewhere on the page (a menu, a form field) is not ours.
  const ours = !!target && !!panel.value?.contains(target);
  const idle = !target || target === document.body || target === document.documentElement || target === (props.opener ?? openedFrom);
  if (isPhone.value || ours || idle) close();
}

// Modal sheet only: keep Tab inside it.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !isPhone.value || !panel.value) return;
  const nodes = Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!nodes.length) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel.value || !panel.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !panel.value.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown);
  phoneMedia?.addEventListener?.('change', onPhoneChange);
  // Desktop goes straight to the search box; on a phone that would raise the keyboard over the sheet.
  void nextTick(() => (isPhone.value ? heading.value : searchInput.value)?.focus({ preventScroll: true }));
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown);
  phoneMedia?.removeEventListener?.('change', onPhoneChange);
  const active = document.activeElement;
  const focusLost = !active || active === document.body || !!panel.value?.contains(active);
  const target = props.opener ?? openedFrom;
  if (focusLost && target?.isConnected) target.focus?.();
});
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

/* No scrim on desktop: the layer lets clicks through to the welcome screen. */
.whelp {
  position: fixed;
  inset: 0;
  z-index: var(--g-z-sheet);
  pointer-events: none;
}
.whelp > * { pointer-events: auto; }

/* ---- Desktop panel (material comes from the glass-overlay class) ---- */
.whelp-panel {
  position: absolute;
  top: 56px;
  right: var(--g-s-5);
  width: 384px;
  max-height: calc(100vh - 72px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---- Header ---- */
.whelp-head {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 20px var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}
.whelp-head__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding-right: 36px;
}
.whelp-head__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}
.whelp-head__title { margin: 0; }
.whelp-head__sub {
  margin: 0;
  line-height: 1.45;
}
.whelp-head__scene {
  flex: none;
  display: block;
  width: 104px;
  height: auto;
  margin: -10px 0 -12px;
}

/* Icon-only close: 36px square. */
.v-btn.g-btn.whelp-close:not(.v-btn--round) {
  --g-btn-fg: var(--g-text-2);
  min-width: 0;
  width: 36px;
  padding: 0;
}
.whelp-close--float {
  position: absolute;
  top: var(--g-s-3);
  right: var(--g-s-3);
}

/* Search is an input control, so the raised fill is the accepted solid. */
.whelp-search {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 40px;
  padding: 0 var(--g-s-3);
  box-sizing: border-box;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
}
.whelp-search input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font: inherit;
  font-size: 14px;
}
.whelp-search input::placeholder { color: var(--g-text-3); }

/* ---- List view body ---- */
.whelp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-3) var(--g-s-2) var(--g-s-4);
}
.whelp-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.whelp-section h3.t-label {
  margin: 0;
  padding: var(--g-s-1) var(--g-s-3) 6px;
}
.whelp-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.whelp-empty {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: 10px var(--g-s-3);
}
.whelp-empty p { margin: 0; }
.whelp-empty__title {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 500;
}

.whelp-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 var(--g-s-3);
  padding: var(--g-s-3) 14px;
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  background: var(--g-warning-fill);
}
.whelp-note .v-icon { flex: none; margin-top: 1px; }
.whelp-note p {
  margin: 0;
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.45;
}
.whelp-body .whelp-support { margin: 0 var(--g-s-3); }

/* ---- Answer view top bar ---- */
.whelp-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
  padding: 10px var(--g-s-3);
  border-bottom: 1px solid var(--g-hairline-1);
}
.v-btn.g-btn.whelp-back:not(.v-btn--round) {
  --g-btn-fg: var(--g-text-2);
  padding-left: 6px;
}

/* ---- Footer ---- */
.whelp-foot {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--g-s-2) var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}
.whelp-foot__fail {
  margin: var(--g-s-1) var(--g-s-1) var(--g-s-2);
  a { color: var(--g-accent); }
}

/* ---- Phone: modal bottom sheet ---- */
.whelp--phone {
  --whelp-row-min-h: 52px;
  --whelp-row-pad-y: 8px;
}
.whelp-scrim {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  background: rgba(0, 0, 0, 0.45);
  cursor: default;
}
.whelp-sheet {
  @include g-glass-overlay;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 556px;
  max-height: 90vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--g-r-sheet) var(--g-r-sheet) 0 0;
  border-bottom: 0;
  /* Same top-edge highlight and lift as the glass-overlay class. */
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), var(--g-shadow-sheet);
}
.whelp-grabber {
  flex: none;
  width: 36px;
  height: 4px;
  margin: var(--g-s-2) auto 0;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
}
.whelp--phone {
  .whelp-head {
    gap: var(--g-s-3);
    padding: var(--g-s-2) var(--g-s-4) var(--g-s-3);
  }
  .whelp-head__row {
    justify-content: space-between;
    padding-right: 0;
  }
  .whelp-close--float {
    position: static;
    margin-right: -10px;
  }
  .v-btn.g-btn.whelp-close:not(.v-btn--round) {
    width: 44px;
    height: 44px;
  }
  .whelp-search { height: 44px; }
  .whelp-search input { font-size: 16px; }
  .whelp-body {
    gap: 14px;
    padding: var(--g-s-3) var(--g-s-1);
  }
  .whelp-section h3.t-label { padding: 0 var(--g-s-3) var(--g-s-1); }
  .whelp-note {
    align-items: center;
    padding: 10px var(--g-s-3);
  }
  .whelp-note .v-icon { margin-top: 0; }
  .whelp-note p { line-height: 1.4; }
  .whelp-foot { padding: 6px var(--g-s-2) calc(10px + env(safe-area-inset-bottom, 0px)); }
  .whelp-foot .v-btn.g-btn:not(.v-btn--round),
  .whelp-bar .v-btn.g-btn:not(.v-btn--round) { height: 44px; }
}
</style>
