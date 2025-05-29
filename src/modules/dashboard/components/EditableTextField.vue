<template>
  <v-form ref="form" v-model="valid">
    <v-text-field
      v-click-outside="cancelEditing"
      v-model="value"
      :outlined="props.outlined"
      :dense="props.dense"
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
      <template #append>
        <v-btn class="px-0" min-width="30" small height="24" @click="enableEditing" v-show="disabled">
          <v-icon small>
            mdi-pencil
          </v-icon>
        </v-btn>
        <v-btn color="error" class="mr-1 px-0" min-width="30" small height="24" @click="cancelEditing" v-show="!disabled">
          <v-icon small>
            mdi-close
          </v-icon>
        </v-btn>
        <v-btn
          color="primary"
          class="px-0"
          min-width="30"
          small
          height="24"
          @click="saveEditing"
          v-show="!disabled"
          :disabled="!isValid"
        >
          <v-icon small>
            mdi-check
          </v-icon>
        </v-btn>
      </template>
    </v-text-field>
  </v-form>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import snackbar from '@/plugins/snackbar';

interface Props {
  value?: string;
  outlined?: boolean;
  dense?: boolean;
  hideDetails?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  rules?: any[];
  type?: string;
  min?: number;
  max?: number;
}

const props = defineProps<Props>();
const emit = defineEmits(['onSave'])

const disabled = ref(true)
let value = ref(props.value)
let prevValue = ''
const valid = ref<boolean>(false)

const isValid = computed(() => valid.value)

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

const saveEditing = () => {
  prevValue = value.value
  const isValid = props.rules.every(rule => rule(value.value))
  if (!isValid) {
    return
  }
  emit('onSave', value.value)
  snackbar.fireSuccess("Wallet name updated successfully.")
  disabled.value = true
}


</script>
<style scoped>

</style>
