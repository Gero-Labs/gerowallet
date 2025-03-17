<template>
  <v-dialog
    v-model="isDialogOpen"
    :persistent="persistent"
    :width="width"
    scrollable overlay-color="#1f242f"
    overlay-opacity="0.7"
  >
    <v-card class="pa-7" :min-height="minHeight" :max-height="height" style="background-color: #141414!important;" :disabled="loading">
      <div class="rings-container">
        <div class="rings"></div>
        <div class="rings"></div>
        <div class="rings"></div>
        <div class="rings"></div>
      </div>
      <v-card-title class="pa-0 px-3 pb-0">
        <v-list-item class="px-0" two-line style="z-index: 1;">
          <v-list-item-avatar v-if="img" size="54" tile>
            <v-img :src="img" contain></v-img>
          </v-list-item-avatar>
          <v-list-item-content>
            <v-list-item-title style="font-size: 18px; max-width: 90%; display: -webkit-box; -webkit-line-clamp: 1;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;white-space: normal;">
              {{ title }}
            </v-list-item-title>
            <v-list-item-subtitle style="white-space: normal;">
              {{subtitle}}
            </v-list-item-subtitle>
            <v-list-item-subtitle style="white-space: normal;" v-if="subtitle2">
              {{subtitle2 | truncate}}<CopyButton x-small :value="subtitle2" class="ml-1"></CopyButton>
            </v-list-item-subtitle>
          </v-list-item-content>
        </v-list-item>
      </v-card-title>
      <slot></slot>
      <v-btn icon @click="$emit('close')" class="close-button" :disabled="loading">
        <v-icon color="#cecfd2">mdi-window-close</v-icon>
      </v-btn>
    </v-card>
  </v-dialog>
</template>
<script>
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';

export default {
  name: "baseDialog",
  components: { CopyButton },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    img: {
      type: String,
    },
    title: {
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
    width: {
      type: Number,
      default: 850
    },
    loading: {
      type: Boolean,
      default: false
    },
    persistent: {
      type: Boolean,
      default: true
    }
  },
  filters,
  watch: {

  },
  computed: {
    isDialogOpen: {
      get() {
        return this.isOpen;
      },
      set(val) {
        if (!val) {
          this.$emit('close');
        }
      }
    },
  },
};
</script>
<style scoped>
.close-button {
  position: absolute;
  top: 35px;
  right: 35px;
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
    border: 1px solid #1d212a;
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
