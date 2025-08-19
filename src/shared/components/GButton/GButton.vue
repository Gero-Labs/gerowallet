<script setup lang="ts">

export interface GeroButtonProps{
  block?: boolean;
  outlined?: boolean;
  large?: boolean;
  color?: string;
  variant?: 'filled' | 'outlined' | 'text';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  text?: boolean;
  target?: string;
  ripple?: boolean;
};

const props = withDefaults(defineProps<GeroButtonProps>(), {
  block: false,
  outlined: false,
  large: false,
  color: 'primary',
  variant: 'filled',
  size: 'medium',
  disabled: false,
  loading: false
});

const emits = defineEmits<{
    (e:'click:button', event): void
}>();
</script>

<template>
  <v-btn
    :text="props.text"
    :color="props.color"
    :disabled="props.disabled"
    :loading="props.loading"
    :size="props.size"
    :variant="props.variant"
    :block="props.block"
    :target="props.target"
    :ripple="props.ripple"
    @click="$emit('click:button', $event)"
  >
    <slot />
  </v-btn>
</template>
