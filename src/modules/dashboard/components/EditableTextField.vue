<template>
  <v-form ref="form" v-model="valid">
    <v-text-field
      v-click-outside="cancelEditing"
      v-model="value"
      :variant="props.outlined ? 'outlined' : 'filled'"
      :density="(props.dense) ? 'compact' : 'default'"
      :hide-details="hideDetails"
      :label="props.label"
      :placeholder="props.placeholder"
      :disabled="props.disabled || disabled"
      :readonly="props.readonly"
      :required="props.required"
      :rules="rules"
      :type="type"
      :min="props.min"
      :max="props.max"
    >
      <template #append-inner>
        <v-btn class="px-0" min-width="30" size="small" height="24" @click="enableEditing" v-show="disabled">
          <v-icon size="small">
            mdi-pencil
          </v-icon>
        </v-btn>
        <v-btn color="error" class="mr-1 px-0" min-width="30" size="small" height="24" @click="cancelEditing" v-show="!disabled">
          <v-icon size="small">
            mdi-close
          </v-icon>
        </v-btn>
        <v-btn
          color="primary"
          class="px-0"
          min-width="30"
          size="small"
          height="24"
          @click="saveEditing"
          v-show="!disabled"
          :disabled="!isValid || saving"
        >
          <v-icon size="small">
            mdi-check
          </v-icon>
        </v-btn>
      </template>
    </v-text-field>
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
const { t } = useTranslation();
import { ref, computed, watch } from 'vue';
import snackbar from '@/plugins/snackbar';
import type { VTextField, VForm } from 'vuetify/components';

interface Props {
  modelValue?: string;
  outlined?: boolean;
  dense?: boolean;
  hideDetails?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  rules?: InstanceType<typeof VTextField>['$props']['rules'];
  type?: string;
  min?: number;
  max?: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  onSave: [value: string];
  'update:modelValue': [value: string];
}>();

const disabled = ref(true)
const value = ref(props.modelValue ?? '')
let prevValue = ''
const form = ref<InstanceType<typeof VForm> | null>(null);
const saving = ref(false);
const valid = ref<boolean>(false)

const isValid = computed(() => valid.value)

// Profile data can arrive after this field mounts. Keep the saved name in sync
// without publishing an unfinished edit to the parent.
watch(() => props.modelValue, (name) => {
  value.value = name ?? '';
  disabled.value = true;
});

const enableEditing = () => {
  prevValue = structuredClone(value.value)
  disabled.value = false
}

const cancelEditing = () => {
  if (!disabled.value) {
    value.value = prevValue
    disabled.value = true
  }
}

const saveEditing = async () => {
  if (saving.value) return;
  saving.value = true;
  try {
  prevValue = value.value
  const isValid = (await form.value?.validate())?.valid
  if (!isValid) {
    return
  }
  emit('update:modelValue', value.value)
  emit('onSave', value.value)
  snackbar.fireSuccess(t('settings.walletNameUpdated'))
  disabled.value = true
  } finally { saving.value = false; }
}

</script>
<style scoped>

</style>
