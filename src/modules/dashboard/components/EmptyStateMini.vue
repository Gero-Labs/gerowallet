<template>
  <v-card 
    flat 
    :outlined="outlined"
    :class="[
      'empty-state-mini',
      transparent ? 'simple-transparent-card' : 'liquid-glass',
      (primaryAction && clickable) ? 'clickable-card' : ''
    ]"
    :style="{ minHeight: minHeight }"
    @click="(primaryAction && clickable) ? $emit('primary-action') : null"
  >
    <v-card-text class="d-flex flex-column align-center justify-center pa-4">
      <!-- Icon -->
      <v-icon 
        :size="iconSize" 
        :color="iconColor || primaryColor"
        class="mb-3 empty-state-icon"
      >
        {{ icon }}
      </v-icon>

      <!-- Title -->
      <h3 class="empty-state-title mb-1">{{ title }}</h3>

      <!-- Description -->
      <p class="empty-state-description text-center mb-3">
        {{ description }}
      </p>

      <!-- Primary Action -->
      <v-btn
        v-if="primaryAction"
        :color="primaryColor"
        :small="!large"
        :large="large"
        class="mb-1"
        @click="clickable ? $event.stopPropagation() : null; $emit('primary-action')"
      >
        <v-icon left small>{{ primaryAction.icon }}</v-icon>
        {{ primaryAction.label }}
      </v-btn>

      <!-- Secondary Action -->
      <v-btn
        v-if="secondaryAction"
        text
        :small="!large"
        @click="$emit('secondary-action')"
        class="secondary-action-btn"
      >
        {{ secondaryAction.label }}
      </v-btn>

      <!-- Custom slot for additional content -->
      <slot name="extra"></slot>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface ActionConfig {
  label: string;
  icon?: string;
}

interface Props {
  icon: string;
  iconSize?: number;
  iconColor?: string;
  title: string;
  description: string;
  primaryAction?: ActionConfig;
  secondaryAction?: ActionConfig;
  minHeight?: string;
  outlined?: boolean;
  large?: boolean;
  transparent?: boolean;
  clickable?: boolean;
}

withDefaults(defineProps<Props>(), {
  iconSize: 64,
  minHeight: '200px',
  outlined: true,
  large: false,
  transparent: false,
  clickable: true
});

defineEmits(['primary-action', 'secondary-action']);

// Chain accent (teal for Apex Prime, orange for Vector, cyan for Cardano, …)
// comes from the single --g-accent source, set per chain by useChainAccent.
const primaryColor = computed(() => 'var(--g-accent)');
</script>

<style scoped>
.empty-state-mini {
  position: relative;
  overflow: hidden;
}

/* Simple transparent card - minimal overrides */
.empty-state-mini.simple-transparent-card {
  background-color: rgba(0, 0, 0, 0.6) !important;
  border: 1px solid var(--g-hairline-3) !important;
}

/* Disable any pseudo-elements that might cause visual effects */
.empty-state-mini.simple-transparent-card::before,
.empty-state-mini.simple-transparent-card::after {
  display: none !important;
}

/* Clickable card styles */
.empty-state-mini.clickable-card {
  cursor: pointer;
  transition: transform var(--g-dur-slow) ease, box-shadow var(--g-dur-slow) ease;
}

.empty-state-mini.clickable-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--g-shadow-menu);
}

.empty-state-icon {
  opacity: 0.8;
  transition: opacity var(--g-dur-slow) ease, transform var(--g-dur-slow) ease;
}

.empty-state-mini:hover .empty-state-icon {
  opacity: 1;
  transform: scale(1.1);
}

.empty-state-title {
  font-size: 1.25rem !important;
  font-weight: 600 !important;
  color: var(--g-text-1) !important;
}

.empty-state-description {
  font-size: 0.875rem !important;
  color: var(--g-text-2) !important;
  max-width: 300px;
  line-height: 1.5 !important;
}

.secondary-action-btn {
  color: var(--g-text-2) !important;
  text-transform: none !important;
}

.secondary-action-btn:hover {
  color: var(--g-text-1) !important;
}
</style>