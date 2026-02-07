<template>
  <v-card
    flat
    :class="[
      'security-method-card',
      { 'security-method-card--selected': selected },
      { 'security-method-card--disabled': disabled }
    ]"
    :style="{ backgroundColor: '#00000080' }"
    @click="!disabled && $emit('select')"
  >
    <!-- Recommended badge -->
    <v-chip
      v-if="recommended"
      color="primary"
      small
      class="recommended-chip"
    >
      {{ $t('welcome.recommended') }}
    </v-chip>

    <!-- Icon and title -->
    <v-card-title class="justify-center flex-column">
      <v-avatar :color="iconColor" size="42" class="mb-3">
        <v-icon dark>{{ icon }}</v-icon>
      </v-avatar>
      <span class="text-h6">{{ title }}</span>
    </v-card-title>

    <!-- Description -->
    <v-card-subtitle class="text-center">
      {{ description }}
    </v-card-subtitle>

    <!-- Benefits list -->
    <v-card-text class="flex-grow-1">
      <div
        v-for="(benefit, index) in benefits"
        :key="index"
        class="d-flex align-center mb-1"
      >
        <v-icon small color="success" class="mr-2">mdi-check</v-icon>
        <span class="text-body-2">{{ benefit }}</span>
      </div>
    </v-card-text>

    <!-- Learn more expandable -->
    <v-expand-transition>
      <div v-show="expanded">
        <v-card-text class="pt-0 text-body-2 grey--text text--lighten-1">
          {{ learnMoreContent }}
        </v-card-text>
      </div>
    </v-expand-transition>

    <v-card-actions class="justify-center">
      <v-btn text small @click.stop="expanded = !expanded">
        {{ $t('welcome.learnMore') }}
        <v-icon small class="ml-1">
          {{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}
        </v-icon>
      </v-btn>
    </v-card-actions>

    <!-- Selection indicator -->
    <v-scroll-y-transition>
      <v-icon
        v-if="selected"
        color="primary"
        class="selection-check"
      >
        mdi-check-circle
      </v-icon>
    </v-scroll-y-transition>

    <!-- Disabled overlay -->
    <v-overlay
      v-if="disabled"
      absolute
      color="black"
      opacity="0.7"
    >
      <span class="text-caption">{{ disabledReason }}</span>
    </v-overlay>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface Props {
  title: string;
  description: string;
  icon: string;
  iconColor?: string;
  benefits: string[];
  learnMoreContent: string;
  selected?: boolean;
  recommended?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

withDefaults(defineProps<Props>(), {
  iconColor: 'primary',
  selected: false,
  recommended: false,
  disabled: false,
  disabledReason: '',
});

defineEmits(['select']);

const expanded = ref(false);
</script>

<style scoped lang="scss">
.security-method-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid transparent;
  border-radius: 12px !important;
  transition: border-color 0.2s ease, transform 0.2s ease, min-height 0.3s ease;
  cursor: pointer;
}

.security-method-card:hover:not(.security-method-card--disabled) {
  transform: translateY(-4px);
}

.security-method-card--selected {
  border-color: var(--v-primary-base);
}

.security-method-card--disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.recommended-chip {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
}

.selection-check {
  position: absolute;
  bottom: 12px;
  right: 12px;
}

// Smooth expand transition
::v-deep .v-card__text {
  transition: all 0.3s ease;
}

@media (max-width: 600px) {
  .security-method-card {
    min-height: auto;
  }
}
</style>
