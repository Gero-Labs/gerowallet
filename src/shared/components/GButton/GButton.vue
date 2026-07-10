<template>
  <v-btn
    :class="['g-btn', `g-btn--${tier}`, { 'g-btn--compact': compact }]"
    :disabled="disabled || loading"
    :loading="loading"
    :block="block"
    depressed
    v-bind="$attrs"
    v-on="$listeners"
  >
    <slot />
  </v-btn>
</template>

<script lang="ts">
// inheritAttrs: false + v-bind="$attrs" is required on Vue 2. GButton's root is
// itself a component (v-btn), so inherited attrs would land on v-btn's root DOM
// node instead of being read as v-btn PROPS -- href/target/ripple would silently
// stop working. `class` and `style` are not part of $attrs and still merge onto
// the root as usual.
export default { inheritAttrs: false };
</script>

<script setup lang="ts">
withDefaults(defineProps<{
  /** primary: THE one gradient CTA per screen. secondary: outlined neutral.
      tertiary: text-only accent. destructive: error-tinted. */
  tier?: 'primary' | 'secondary' | 'tertiary' | 'destructive';
  compact?: boolean;
  block?: boolean;
  disabled?: boolean;
  loading?: boolean;
}>(), { tier: 'secondary', compact: false, block: false, disabled: false, loading: false });
</script>

<style scoped>
/* For the ENABLED states, no override flags: Vuetify's competing rules
   `.theme--dark.v-btn.v-btn--has-bg` and
   `.v-btn:not(.v-btn--round).v-size--default` are (0,3,0) and carry no flag, so
   the rules below -- (0,4,0) or better once the scoped [data-v] attribute is
   appended -- win outright without joining the specificity arms race this design
   system exists to end.

   The DISABLED state is the exception, and it is not optional. Vuetify ships
   `.theme--dark.v-btn.v-btn--disabled` (0,3,0, color) and
   `.theme--dark.v-btn.v-btn--disabled.v-btn--has-bg` (0,4,0, background-color),
   and BOTH carry the override flag. A flagged declaration beats an unflagged one
   at ANY specificity, so an unflagged rule here -- however specific -- loses, and
   every disabled GButton would render Vuetify's translucent grey instead of the
   raised surface. Every tier is has-bg (no tier passes text/plain/outlined/icon).

   Consumers that need a different foreground override the --g-btn-fg seam
   custom property rather than out-specify these rules. */
.v-btn.g-btn:not(.v-btn--round) {
  height: var(--g-btn-h);
  border-radius: var(--g-r-control);
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  padding: 0 var(--g-s-4);
}
.v-btn.g-btn.g-btn--compact:not(.v-btn--round) { height: var(--g-btn-h-compact); }

.v-btn.g-btn.g-btn--primary {
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2));
  color: var(--g-btn-fg, var(--g-on-grad));
}
.v-btn.g-btn.g-btn--secondary {
  background: transparent;
  border: 1px solid var(--g-hairline-2);
  color: var(--g-btn-fg, var(--g-text-1));
}
.v-btn.g-btn.g-btn--secondary:hover {
  border-color: var(--g-hairline-3);
  background: rgba(255, 255, 255, 0.03);
}
.v-btn.g-btn.g-btn--tertiary {
  background: transparent;
  color: var(--g-btn-fg, var(--g-accent));
  padding: 0 var(--g-s-3);
}
.v-btn.g-btn.g-btn--destructive {
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  color: var(--g-btn-fg, var(--g-error));
}
.v-btn.g-btn.v-btn--disabled:not(.v-btn--loading) {
  background: var(--g-raised) !important;
  color: var(--g-text-3) !important;
  /* Vuetify sets no border-color on disabled, so this one needs no flag. */
  border-color: var(--g-hairline-1);
}
</style>
