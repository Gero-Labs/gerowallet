<template>
  <v-card flat class="transparent" style="max-width: 540px;">
    <v-card-title class="justify-center py-2 px-0">
      <span class="text-h6">{{ $t('welcome.confirmUnderstanding') }}</span>
    </v-card-title>

    <v-card-text class="pt-2 px-0">
      <v-form ref="form" v-model="valid">
        <!-- PRF Wallet Acknowledgments (4 checkboxes) -->
        <template v-if="isPrfMode">
          <v-checkbox
            v-model="acknowledgments.deviceSecurity"
            :rules="[rules.required()]"
            hide-details
            class="mb-1 mt-0"
          >
            <template v-slot:label>
              <span class="text-body-2">{{ $t('welcome.ackDeviceSecurity') }}</span>
            </template>
          </v-checkbox>

          <v-checkbox
            v-model="acknowledgments.recoveryPhrase"
            :rules="[rules.required()]"
            hide-details
            class="mb-1 mt-0"
          >
            <template v-slot:label>
              <span class="text-body-2">{{ $t('welcome.ackRecoveryPhrase') }}</span>
            </template>
          </v-checkbox>

          <v-checkbox
            v-model="acknowledgments.termsAccepted"
            :rules="[rules.required()]"
            hide-details
            class="mb-1 mt-0"
          >
            <template v-slot:label>
              <span class="text-body-2">
                {{ $t('welcome.iHaveReadTerms') }}
                <a @click.stop="openTerms" target="_blank">
                  {{ $t('welcome.termsOfService') }}
                </a>.
              </span>
            </template>
          </v-checkbox>
        </template>

        <!-- Password Wallet Acknowledgments (2 checkboxes) -->
        <template v-else>
          <v-checkbox
            v-model="acknowledgments.passwordRecovery"
            :rules="[rules.required()]"
            hide-details
            class="mb-1 mt-0"
          >
            <template v-slot:label>
              <span class="text-body-2">{{ $t('welcome.understandPasswordRecovery') }}</span>
            </template>
          </v-checkbox>

          <v-checkbox
            v-model="acknowledgments.termsAccepted"
            :rules="[rules.required()]"
            hide-details
            class="mb-1 mt-0"
          >
            <template v-slot:label>
              <div>
                {{ $t('welcome.iHaveReadTerms') }}
                <a @click.stop="openTerms" target="_blank">
                  {{ $t('welcome.termsOfService') }}
                </a>.
              </div>
            </template>
          </v-checkbox>
        </template>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import rules from '@/utils/rules';

interface Props {
  isPrfMode: boolean;
}

const props = defineProps<Props>();

const form = ref(null);
const valid = ref(false);

const acknowledgments = reactive({
  deviceSecurity: false,
  recoveryPhrase: false,
  passwordRecovery: false,
  termsAccepted: false,
});

// Watch for validity changes and emit
watch(valid, (newValid) => {
  emit('update:valid', newValid);
});

// Reset acknowledgments when mode changes
watch(() => props.isPrfMode, () => {
  acknowledgments.deviceSecurity = false;
  acknowledgments.recoveryPhrase = false;
  acknowledgments.passwordRecovery = false;
  acknowledgments.termsAccepted = false;
});

const emit = defineEmits(['update:valid']);

const openTerms = () => {
  window.open('https://gerowallet.io/terms', '_blank');
};

defineExpose({
  form,
  valid,
  acknowledgments,
});
</script>

<style scoped lang="scss">
// Link styling
a {
  color: var(--v-primary-base);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}
</style>
