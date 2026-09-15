<template>
  <span class="anchor t-caption" :class="`anchor--${tone}`">
    <v-icon x-small :color="iconColor" class="mr-1">{{ icon }}</v-icon>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

/**
 * Why the hash check produced no verdict. `hashValid: null` on its own only
 * says "no verdict"; a reason turns that into something the user can act on.
 * Callers supply it only when they can actually tell the two apart.
 *
 * Kept local and re-declared at the call site rather than exported: this repo
 * ships no `*.vue` type shim, so importing a type across an SFC boundary is a
 * typecheck error.
 */
type AnchorFailureReason = 'fetchFailed';

// Runtime declaration — `boolean | null` compiles to a `[Boolean, null]`
// validator and warns on every render (null is not a constructor). hashValid is
// deliberately tri-state: null = the check did not run. See AsOf.vue.
const props = defineProps({
  hashValid: { type: Boolean as PropType<boolean | null>, default: null },
  hasAnchor: { type: Boolean, required: true },
  failureReason: { type: String as PropType<AnchorFailureReason | null>, default: null },
});
const { t } = useTranslation();

/**
 * Five named states, and the naming is the feature: "we could not fetch the
 * document" and "the document does not match its hash" are opposite facts, and
 * collapsing both into "not verified" hides a real mismatch behind what reads
 * like a network hiccup.
 *
 * `hashValid` stays TRI-STATE and drives four of the five on its own. The
 * reason only ever refines the null case, so a caller that supplies none gets
 * exactly the behaviour this badge had before: verified / mismatch / none /
 * unverified.
 */
const state = computed(() => {
  if (!props.hasAnchor) return 'none';
  if (props.hashValid === true) return 'verified';
  if (props.hashValid === false) return 'mismatch';
  if (props.failureReason === 'fetchFailed') return 'fetchFailed';
  return 'unverified';
});

const tone = computed(
  () =>
    ({
      verified: 'ok',
      mismatch: 'bad',
      fetchFailed: 'warn',
      unverified: 'unknown',
      none: 'none',
    })[state.value],
);

const icon = computed(
  () =>
    ({
      verified: 'mdi-shield-check-outline',
      mismatch: 'mdi-shield-alert-outline',
      fetchFailed: 'mdi-shield-off-outline',
      unverified: 'mdi-shield-outline',
      none: 'mdi-file-hidden',
    })[state.value],
);

const iconColor = computed(
  () =>
    ({
      ok: 'var(--g-success)',
      bad: 'var(--g-error)',
      warn: 'var(--g-warning)',
      unknown: 'var(--g-text-3)',
      none: 'var(--g-text-3)',
    })[tone.value],
);

const label = computed(() =>
  String(
    t(
      {
        verified: 'governance.anchorVerified',
        mismatch: 'governance.anchorMismatch',
        fetchFailed: 'governance.anchorFetchFailed',
        unverified: 'governance.anchorUnverified',
        none: 'governance.anchorNone',
      }[state.value],
    ),
  ),
);
</script>

<style scoped>
.anchor {
  display: inline-flex;
  align-items: center;
  border-radius: var(--g-r-chip);
  padding: 0 var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
}
.anchor--ok {
  color: var(--g-success);
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
}
.anchor--bad {
  color: var(--g-error);
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
}
.anchor--warn {
  color: var(--g-warning);
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
}
.anchor--unknown,
.anchor--none {
  color: var(--g-text-3);
}
</style>
