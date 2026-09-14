<template>
  <BaseDialog
    :isOpen="isOpen"
    :title="t('governance.rationaleDialogTitle')"
    :subtitle="subtitle || undefined"
    icon="mdi-message-text-outline"
    size="lg"
    :min-height="RATIONALE_DIALOG_HEIGHT"
    :height="RATIONALE_DIALOG_HEIGHT"
    @close="$emit('close')"
  >
    <!-- One fixed box, whatever is inside it. A rationale arrives from someone
         else's host, so the skeleton is on screen long enough to be its own
         layout: sizing the dialog to its content meant opening small, then
         lurching taller when the document landed. The height is bound inline
         because Vuetify detaches the card to [data-app], out of reach of a
         scoped selector. -->
    <div class="rationale-dialog" :style="{ height: `${RATIONALE_BODY_HEIGHT}px` }">
      <div class="rationale-dialog__content">
        <!-- Looking. The document is on someone else's host, so this can be slow. -->
        <div v-if="loading" class="rationale-dialog__loading">
          <span class="g-skeleton rationale-dialog__ghost--label"></span>
          <span class="g-skeleton rationale-dialog__ghost--line"></span>
          <span class="g-skeleton rationale-dialog__ghost--line rationale-dialog__ghost--short"></span>
          <span class="g-skeleton rationale-dialog__ghost--line"></span>
          <span class="t-caption rationale-dialog__note">{{ $t('governance.rationaleFetching') }}</span>
        </div>

        <template v-else-if="shown">
          <!-- The banner is the trust statement. Green: these bytes hash to what
               the vote recorded. Amber: the words are shown, but the wallet does
               not vouch for them — and says why. -->
          <div
            class="rationale-dialog__banner"
            :class="verified ? 'rationale-dialog__banner--verified' : 'rationale-dialog__banner--doubt'"
          >
            <v-icon size="16" :color="verified ? 'var(--g-success)' : 'var(--g-warning)'">
              {{ verified ? 'mdi-shield-check-outline' : 'mdi-alert-outline' }}
            </v-icon>
            <span class="t-body-sm rationale-dialog__banner-text">
              {{ $t(bannerTitleKey) }}
              <span class="rationale-dialog__banner-note">{{ $t(bannerNoteKey) }}</span>
            </span>
          </div>

          <!-- v-html is safe here and ONLY here: every prose section goes
               through renderMarkdown, which HTML-escapes the author's bytes
               before it applies a single markdown rule. A json section is
               interpolated as text. Nothing fetched reaches the DOM as markup.
               See renderMarkdown's header before changing this. -->
          <section v-for="(section, i) in shown.sections" :key="i" class="rationale-dialog__section">
            <span v-if="section.labelKey" class="t-label">{{ $t(section.labelKey) }}</span>
            <pre v-if="section.kind === 'json'" class="rationale-dialog__json g-mono t-caption">{{ section.text }}</pre>
            <div v-else class="g-prose" v-html="rendered[i]"></div>
          </section>
        </template>

        <!-- Nothing arrived worth rendering. The reader gets the reason and a
             way to read the document themselves, in their own browser. -->
        <div v-else class="rationale-dialog__problem">
          <span class="rationale-dialog__problem-glyph">
            <v-icon size="20">mdi-file-question-outline</v-icon>
          </span>
          <span class="t-heading">{{ $t(problemTitleKey) }}</span>
          <p class="t-body-sm rationale-dialog__problem-body">{{ $t(problemBodyKey) }}</p>
        </div>
      </div>

      <!-- Outside the scroll area: the way out of a document that failed to
           verify must not be something the reader has to scroll to find. -->
      <div class="rationale-dialog__foot">
        <a
          v-if="externalHref"
          class="t-body-sm rationale-dialog__link"
          :href="externalHref"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ $t('governance.openDocument') }}<v-icon x-small class="ml-1">mdi-open-in-new</v-icon>
        </a>
        <p class="t-caption rationale-dialog__note">{{ $t('governance.rationaleExternalNote') }}</p>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
/**
 * A vote's published rationale, read-only and hash-checked.
 *
 * The wallet fetches the CIP-136 anchor, hashes the RAW BYTES, and renders the
 * document under a banner that says whether that hash equals the one recorded
 * on chain with the vote. Verified is green; a mismatch or a missing hash keeps
 * the text on screen under an amber banner that says the wallet cannot vouch
 * for it. An oversized response, an empty file or a host the extension cannot
 * reach renders NO content and offers the link instead. `loadRationale` owns
 * that decision table; this component owns the copy.
 *
 * The one `v-html` in here is fed exclusively by `renderMarkdown`, which escapes
 * every author byte before applying any markdown rule; the JSON fallback is
 * text-interpolated. That ordering is the whole safety argument for showing a
 * document nobody in this codebase wrote, whatever the hash said about it.
 */
import { computed, ref, watch } from 'vue';

import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { renderMarkdown } from '@/shared/utils/renderMarkdown';
import { toExternalHref } from '@/modules/governance/utils/govAnchor';
import { loadRationale, type RationaleResult } from '@/modules/governance/dialogs/rationaleDoc';

/**
 * The dialog's one size, in px, whatever state it is in.
 *
 * Passed as BOTH `min-height` and `height` so the card cannot grow or shrink:
 * BaseDialog maps them to the v-card's `min-height` and `max-height`, and giving
 * them different values is exactly what let the box resize when the document
 * landed.
 */
const RATIONALE_DIALOG_HEIGHT = 640;
/** Title, close button and the card's own padding, measured. */
const RATIONALE_DIALOG_CHROME = 152;
const RATIONALE_BODY_HEIGHT = RATIONALE_DIALOG_HEIGHT - RATIONALE_DIALOG_CHROME;

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  /** The vote's `meta_url` — the CIP-136 anchor. */
  url: {
    type: String,
    default: null,
  },
  /** The vote's `meta_hash`, as recorded on chain. */
  hash: {
    type: String,
    default: null,
  },
  /** Whose rationale, or on what: the action title or the voter's name. */
  subtitle: {
    type: String,
    default: null,
  },
});

defineEmits(['close']);

const { t } = useTranslation();

const loading = ref(false);
const result = ref<RationaleResult | null>(null);

/** Always available, whatever the fetch did: the reader can open it themselves. */
const externalHref = computed(() => toExternalHref(props.url));

/** The document on screen, verified or not; null while loading or failed. */
const shown = computed(() =>
  result.value && result.value.status !== 'failed' ? result.value : null,
);

const verified = computed(() => shown.value?.status === 'verified');

const rendered = computed(() =>
  // `emphasis: true` — a rationale is prose, and authors use `_word_` freely.
  // See renderMarkdown's word-boundary guard for why this stays safe. A json
  // section is never rendered as markdown; its slot here is simply unused.
  (shown.value?.sections ?? []).map(section =>
    section.kind === 'prose' ? renderMarkdown(section.text, { emphasis: true }) : '',
  ),
);

/**
 * A mismatch is a warning about the DOCUMENT, not about the voter: an author's
 * host may simply have been re-deployed. The banner is amber, and the text is
 * shown beneath it so the reader can weigh it for themselves.
 */
const DOUBT_TITLE_KEYS: Record<string, string> = {
  mismatch: 'governance.anchorMismatch',
  unverifiable: 'governance.rationaleNoHash',
};

const DOUBT_NOTE_KEYS: Record<string, string> = {
  mismatch: 'governance.rationaleMismatchNote',
  unverifiable: 'governance.rationaleNoHashNote',
};

const bannerTitleKey = computed(() =>
  shown.value?.status === 'unverified'
    ? DOUBT_TITLE_KEYS[shown.value.reason]
    : 'governance.anchorVerified',
);

const bannerNoteKey = computed(() =>
  shown.value?.status === 'unverified'
    ? DOUBT_NOTE_KEYS[shown.value.reason]
    : 'governance.rationaleVerifiedNote',
);

const failure = computed(() => (result.value?.status === 'failed' ? result.value.reason : null));

const TITLE_KEYS: Record<string, string> = {
  oversize: 'governance.rationaleTooLarge',
  network: 'governance.anchorFetchFailed',
  empty: 'governance.rationaleEmpty',
};

const BODY_KEYS: Record<string, string> = {
  oversize: 'governance.rationaleTooLargeBody',
  network: 'governance.rationaleFetchFailedBody',
  empty: 'governance.rationaleEmptyBody',
};

const problemTitleKey = computed(() => TITLE_KEYS[failure.value ?? 'network'] ?? TITLE_KEYS['network']);
const problemBodyKey = computed(() => BODY_KEYS[failure.value ?? 'network'] ?? BODY_KEYS['network']);

/**
 * One fetch per opening, and none at all while closed: the request leaves the
 * user's machine, so it happens because they asked for this document, never
 * because a row carrying one happened to render.
 */
async function load(): Promise<void> {
  result.value = null;
  if (!props.isOpen || !props.url) return;
  loading.value = true;
  try {
    result.value = await loadRationale({ url: props.url, hash: props.hash });
  } finally {
    loading.value = false;
  }
}

watch(() => [props.isOpen, props.url, props.hash], () => void load(), { immediate: true });
</script>

<style scoped>
.rationale-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-4) var(--g-s-4);
  /* Height comes in inline. The box is fixed; only the content inside it moves. */
  overflow: hidden;
}
/* Rationales are documents: they routinely outgrow the dialog, and the
   BaseDialog card does not scroll its slot, so the content scrolls itself
   WITHIN the fixed box rather than resizing it. */
.rationale-dialog__content {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.rationale-dialog__loading {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
/* Shaped like the document that is coming: a section label, then prose. The
   shimmer itself is `.g-skeleton` from baseline — the one sanctioned loading
   pulse, so reduced-motion is already handled there and no second animation is
   introduced. */
.rationale-dialog__ghost--label {
  width: 88px;
  height: 10px;
  margin-bottom: var(--g-s-1);
}
.rationale-dialog__ghost--line {
  width: 100%;
  height: 14px;
}
.rationale-dialog__ghost--short {
  width: 62%;
}

.rationale-dialog__banner {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}
.rationale-dialog__banner--verified {
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.rationale-dialog__banner--doubt {
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.rationale-dialog__banner-text {
  color: var(--g-text-1);
  min-width: 0;
}
.rationale-dialog__banner-note {
  color: var(--g-text-2);
}

.rationale-dialog__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
/* The document as published, when it carries no CIP-136 prose to lift out.
   Same box as the action detail's raw JSON, so the two read as one thing. */
.rationale-dialog__json {
  margin: 0;
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  color: var(--g-text-2);
  overflow-x: auto;
  white-space: pre;
}

.rationale-dialog__problem {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: var(--g-s-5);
  border-radius: var(--g-r-card);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}
.rationale-dialog__problem-glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--g-btn-h-compact);
  height: var(--g-btn-h-compact);
  border-radius: var(--g-r-control);
  background: var(--g-overlay);
  color: var(--g-text-3);
}
.rationale-dialog__problem-glyph .v-icon {
  color: inherit;
}
.rationale-dialog__problem-body {
  margin: 0;
  color: var(--g-text-2);
}

.rationale-dialog__foot {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  /* Pinned below the scroll area, never scrolled with it. */
  flex: none;
  padding-top: var(--g-s-3);
  border-top: 1px solid var(--g-hairline-1);
}
.rationale-dialog__link {
  color: var(--g-accent);
}
.rationale-dialog__note {
  margin: 0;
  color: var(--g-text-3);
}
</style>
