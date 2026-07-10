<template>
  <v-dialog
    v-model="isDialogOpen"
    :persistent="persistent || loading"
    :width="resolvedWidth"
    :scrollable="scrollable"
    transition="g-dialog-transition"
    overlay-color="#000000"
    overlay-opacity="0.6"
  >
    <v-card class="pa-5 liquid-glass-dialog" :min-height="minHeight" :max-height="height" :disabled="loading">
      <div class="rings-container">
        <div class="rings"></div>
        <div class="rings"></div>
        <div class="rings"></div>
        <div class="rings"></div>
      </div>
      <v-card-title class="pa-0 pb-0">
        <v-list-item class="px-0" :two-line="!!subtitle" style="z-index: 1;">
          <v-list-item-avatar class="ml-5 mr-3 my-4" v-if="img" :size="imgSize" tile>
            <v-img :src="img" contain :style="imgStyle"></v-img>
          </v-list-item-avatar>
          <v-list-item-icon class="ml-5 mr-3 my-4" v-if="icon">
            <v-icon style="font-size: 56px">{{icon}}</v-icon>
          </v-list-item-icon>
          <v-list-item-content>
            <v-list-item-title class="t-heading" style="max-width: 90%; display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
              {{ title }}
              <v-tooltip v-if="titleInfo" bottom max-width="300" content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <v-icon
                    small
                    color="primary"
                    v-bind="attrs"
                    v-on="on"
                    class="ml-1"
                  >
                    mdi-information-outline
                  </v-icon>
                </template>
                <span>{{ titleInfo }}</span>
              </v-tooltip>
            </v-list-item-title>
            <v-list-item-subtitle style="white-space: normal; word-break: break-word">
              {{subtitle}}
            </v-list-item-subtitle>
            <v-list-item-subtitle style="white-space: normal;" v-if="subtitle2">
              {{ truncate(subtitle2) }}<CopyButton x-small :value="subtitle2" class="ml-1" />
            </v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>
      </v-card-title>
      <slot></slot>
      <!-- z-index 1, not 999: this only has to sit above the card's own content,
           and it shares a stacking context with .close-button, which uses 1. -->
      <v-progress-linear v-show="loading" indeterminate width="3" style="position: absolute; top: 0; left: 0; z-index: 1;"/>
      <v-btn icon @click="$emit('close')" class="close-button" :disabled="loading">
        <v-icon color="var(--g-text-2)">mdi-window-close</v-icon>
      </v-btn>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  img: {
    type: String,
  },
  imgStyle: {
    type: [String, Object],
  },
  imgSize: {
    type: [Number, String],
    default: 54,
  },
  icon: {
    type: String,
  },
  title: {
    type: String,
  },
  titleInfo: {
    type: String,
  },
  subtitle: {
    type: String
  },
  subtitle2: {
    type: String
  },
  height: {
    type: Number,
    default: 800
  },
  minHeight: {
    type: Number,
    default: 800
  },
  /** Token widths. `width` still wins when passed, for the transition. */
  size: {
    type: String,
    default: 'md',
    validator: (v: string) => ['sm', 'md', 'lg', 'xl'].includes(v),
  },
  width: {
    type: Number,
    default: undefined,
  },
  loading: {
    type: Boolean,
    default: false
  },
  /**
   * Escape and scrim-click close the dialog by default. Pass `persistent` only
   * where dismissing would lose real mid-flight state (an in-progress signing
   * flow, a displayed seed phrase) or defeat a security gate. A dialog
   * auto-persists while `loading` is true regardless.
   */
  persistent: {
    type: Boolean,
    default: false
  },
  scrollable: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['close']);

const { truncate } = filters;

const SIZE_WIDTHS: Record<string, number> = { sm: 420, md: 560, lg: 720, xl: 960 };
/** Explicit `width` wins; otherwise the size token decides. */
const resolvedWidth = computed(() => props.width ?? SIZE_WIDTHS[props.size] ?? SIZE_WIDTHS['md']);

const isDialogOpen = computed({
  get() {
    return props.isOpen;
  },
  set(val: boolean) {
    if (!val) {
      emit('close');
    }
  }
});
</script>
<style scoped>
.close-button {
  position: absolute;
  top: 26px;
  right: 20px;
  z-index: 1;
}

.dialog-children-container {
  position: relative;
  z-index: 1;
  height: 100%;
}

.rings-container {
  position: absolute;
  top: -7px;
  left: -7px;
  width: 150px;
  height: 150px;
  display: flex;
  justify-content: center;
  align-items: center;

  .rings {
    border: 1px solid var(--g-hairline-1);
    border-radius: 50%;
    position: absolute;
    z-index: 0;

    &:first-child {
      width: 90px;
      height: 90px;
      opacity: 0.8;
    }

    &:nth-child(2) {
      width: 120px;
      height: 120px;
      opacity: 0.6;
    }

    &:nth-child(3) {
      width: 150px;
      height: 150px;
      opacity: 0.4;
    }

    &:last-child {
      width: 180px;
      height: 180px;
      opacity: 0.2;
    }
  }
}


</style>
