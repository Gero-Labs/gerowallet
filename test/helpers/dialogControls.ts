import { defineComponent, h } from 'vue';

/** Small control contracts for testing authorization boundaries, not form rules. */
export const DialogShell = defineComponent({
  name: 'DialogShell',
  emits: ['close'],
  setup(_props, { slots }) { return () => h('section', slots['default']?.()); },
});
export const PasswordInput = defineComponent({
  name: 'PasswordInput',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  methods: { showError() {} },
  template: '<input data-testid="current-password" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
export function dialogControls(validate: () => Promise<{ valid: boolean; errors: unknown[] }>) {
  const slot = { template: '<div><slot /></div>' };
  return {
    ...Object.fromEntries(['v-card', 'v-card-title', 'v-card-text', 'v-card-actions', 'v-alert', 'v-row', 'v-col',
      'v-stepper', 'v-stepper-header', 'v-stepper-item', 'v-stepper-window', 'v-stepper-window-item',
      'v-list-item', 'v-list-item-title', 'v-list-item-subtitle', 'v-chip'].map(name => [name, slot])),
    // Like Vuetify 4, only write the model once an input has registered; a form
    // without inputs leaves the parent's initial `valid` untouched.
    'v-form': defineComponent({
      emits: ['update:modelValue'],
      mounted() { this.reportValidity(); },
      updated() { this.reportValidity(); },
      methods: {
        validate,
        resetValidation() {},
        reportValidity() {
          if ((this.$el as HTMLElement).querySelector('input, textarea, select')) this.$emit('update:modelValue', true);
        },
      },
      template: '<form><slot /></form>',
    }),
    'v-btn': { props: ['disabled'], emits: ['click'], template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
    'v-text-field': {
      props: ['modelValue', 'label'], emits: ['update:modelValue'],
      template: '<input :data-label="label" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    },
    'v-hover': { template: '<div><slot :hover="false" :is-hovering="false" :props="{}" /></div>' },
    'v-overlay': { props: ['modelValue'], template: '<div data-testid="seed-overlay" :data-protected="String(modelValue)"><slot /></div>' },
    'v-icon': true, 'v-checkbox': true, 'v-divider': true, 'v-spacer': true,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
