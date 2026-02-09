<template>
  <v-card
    flat
    :class="[
      'security-method-card',
      { 'security-method-card--selected': selected }
    ]"
    :style="{ backgroundColor: '#00000080' }"
    @click="$emit('select')"
  >
    <!-- Icon + Title as list-item row -->
    <v-list-item class="px-4 pt-0" :class="benefits && benefits.length ? 'pb-1' : 'pb-3'" style="background: transparent;">
      <v-avatar :color="iconColor" size="24" class="mr-3 my-0 align-self-center">
        <v-icon dark small>{{ icon }}</v-icon>
      </v-avatar>
      <v-list-item-content class="py-0">
        <v-list-item-title class="text-subtitle-1 white--text font-weight-medium d-flex align-center" style="white-space: normal;">
          {{ title }}
          <v-tooltip v-if="learnMoreContent" bottom max-width="300" content-class="custom-tooltip">
            <template v-slot:activator="{ on }">
              <v-icon x-small class="ml-1 info-icon" color="grey lighten-1" v-on="on" @click.stop>mdi-information-outline</v-icon>
            </template>
            <span class="text-body-2">{{ learnMoreContent }}</span>
          </v-tooltip>
        </v-list-item-title>
        <v-list-item-subtitle v-if="description" class="text-body-2" style="white-space: normal;">
          {{ description }}
        </v-list-item-subtitle>
      </v-list-item-content>
      <v-chip v-if="recommended" color="primary" x-small class="ml-2 align-self-center">
        {{ $t('welcome.recommended') }}
      </v-chip>
    </v-list-item>

    <!-- Benefits list -->
    <v-card-text v-if="benefits && benefits.length > 0" class="flex-grow-1 pt-0 pb-3">
      <div
        v-for="(benefit, index) in benefits"
        :key="index"
        class="d-flex align-center mb-1"
      >
        <v-icon small color="success" class="mr-2">mdi-check</v-icon>
        <span class="text-body-2">{{ benefit }}</span>
      </div>
    </v-card-text>

    <!-- Selection checkmark — bottom right -->
    <v-icon v-if="selected" color="primary" class="selection-check">mdi-check-circle</v-icon>
  </v-card>
</template>

<script setup lang="ts">
interface Props {
  title: string;
  description?: string;
  icon: string;
  iconColor?: string;
  benefits: string[];
  learnMoreContent?: string;
  selected?: boolean;
  recommended?: boolean;
}

withDefaults(defineProps<Props>(), {
  description: '',
  iconColor: 'primary',
  learnMoreContent: '',
  selected: false,
  recommended: false,
});

defineEmits(['select']);
</script>

<style scoped lang="scss">
.security-method-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid transparent;
  border-radius: 12px !important;
  transition: border-color 0.2s ease, transform 0.2s ease;
  cursor: pointer;
}

.security-method-card:hover {
  transform: translateY(-2px);
}

.security-method-card--selected {
  border-color: var(--v-primary-base);
}

.selection-check {
  position: absolute;
  bottom: 12px;
  right: 12px;
}

.info-icon {
  cursor: help;
  opacity: 0.7;
  &:hover {
    opacity: 1;
  }
}

@media (max-width: 600px) {
  .security-method-card {
    min-height: auto;
  }
}
</style>
