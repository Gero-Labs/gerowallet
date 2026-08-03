<template>
  <v-btn class="px-1" :icon="!!!title" :text="!!title" :x-small="xSmall" :small="small" :large="large" :x-large="xLarge" :color="colorB" @click.stop="copy" :style="xSmall && !title ? { width: '16px', height: '16px', marginTop: '0px'} : {}">
    <v-avatar v-if="avatar" :size="size" style="margin-right: 2px">
      <v-img :src="avatar" :alt="$t('common.avatar')" contain />
    </v-avatar>
    <span v-if="title" class="mr-1" style="text-transform: none">{{title}}</span>
    <v-icon :x-small="xSmall" :small="small" :large="large" :x-large="xLarge">
      {{ icon }}
    </v-icon>
  </v-btn>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';



const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  xSmall: {
    type: Boolean,
    required: false,
    default: false,
  },
  small: {
    type: Boolean,
    required: false,
    default: false,
  },
  large: {
    type: Boolean,
    required: false,
    default: false,
  },
  xLarge: {
    type: Boolean,
    required: false,
    default: false,
  },
  color: {
    type: String,
    required: false,
  },
  title: {
    type: String,
    required: false,
  },
  avatar: {
    type: [Object, String],
    required: false,
  }
});

const icon = ref('mdi-content-copy');
const colorB = ref<string | undefined>(undefined);

const size = computed(() => {
  if (props.xSmall) return 12
  if (props.small) return 20
  if (props.large) return 32
  if (props.xLarge) return 40
  return 24
});

const copy = async () => {
  await navigator.clipboard.writeText(props.value)
  icon.value = 'mdi-check'
  colorB.value = 'green'
  setTimeout(() => {
    icon.value = 'mdi-content-copy'
    colorB.value = props.color
  }, 1000)
};

onMounted(() => {
  if (props.color) {
    colorB.value = props.color
  }
});
</script>
<style scoped>

</style>
