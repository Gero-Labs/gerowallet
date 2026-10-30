<template>
  <v-btn class="px-1" :icon="!title" variant="text" :size="buttonSize" :color="colorB" :aria-label="iconOnlyName" :title="iconOnlyName" @click.stop="copy" :style="xSmall && !title ? { width: '16px', height: '16px', marginTop: '0px'} : {}">
    <v-avatar v-if="avatar" :size="size" style="margin-right: 2px">
      <v-img :src="avatar" :alt="$t('common.avatar')"  />
    </v-avatar>
    <span v-if="title" class="mr-1" style="text-transform: none">{{title}}</span>
    <v-icon :size="iconSize">
      {{ icon }}
    </v-icon>
  </v-btn>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

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
    type: String,
    required: false,
  },
  /** What an icon-only button is announced as and shows on hover ("Copy to clipboard" when omitted). A titled button is named by its title. */
  label: {
    type: String,
    required: false,
  },
});

const { t } = useTranslation();
const copied = ref(false);
const icon = computed(() => (copied.value ? 'mdi-check' : 'mdi-content-copy'));
const colorB = ref<string | undefined>(undefined);

// An icon has no text for a screen reader to read, so the button needs a name; it says "Copied" while the check mark shows.
const iconOnlyName = computed(() => {
  if (props.title) return undefined;
  if (copied.value) return t('common.copied');
  return props.label || t('common.copyToClipboard');
});

const buttonSize = computed(() => {
  if (props.xSmall) return 'x-small';
  if (props.small) return 'small';
  if (props.large) return 'large';
  if (props.xLarge) return 'x-large';
  return 'default';
});

const iconSize = computed(() => {
  if (props.xSmall) return 12;
  if (props.small) return 16;
  if (props.large) return 36;
  if (props.xLarge) return 40;
  return 24;
});

const size = computed(() => {
  if (props.xSmall) return 12
  if (props.small) return 20
  if (props.large) return 32
  if (props.xLarge) return 40
  return 24
});

const copy = async () => {
  await navigator.clipboard.writeText(props.value)
  copied.value = true
  colorB.value = 'green'
  setTimeout(() => {
    copied.value = false
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
