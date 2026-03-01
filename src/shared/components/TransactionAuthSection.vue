<template>
  <div class="transaction-auth-section">
    <!-- PRF Wallet: PassKey Button or Submit Button -->
    <template v-if="isPrfWallet">
      <PassKeyAuthButton
        v-if="!isSigned"
        :disabled="loading"
        @success="$emit('passkey-success', $event)"
        @error="$emit('passkey-error', $event)"
        :style="buttonStyle"
        :class="buttonClass"
      />
      <v-btn
        v-else
        :color="submitColor"
        :elevation="submitElevation"
        @click="$emit('submit')"
        :height="buttonHeight"
        :disabled="loading"
        :loading="loading"
        :outlined="submitOutlined"
        :class="buttonClass"
        :style="buttonStyle"
      >
        {{ submitText }}
      </v-btn>
    </template>

    <!-- Password Wallet: Password Field -->
    <PassKeyPasswordField
      v-else-if="isPasswordWallet && !isSigned"
      :ref="el => $emit('password-field-ref', el)"
      :value="password"
      @input="$emit('update:password', $event)"
      outlined
      dense
      hide-details
      :label="passwordLabel"
      :rules="passwordRules"
      :disabled="loading"
      required
      @enter="$emit('submit')"
      @passkey-autofill-success="$emit('autofill-success')"
      @passkey-autofill-error="$emit('autofill-error', $event)"
      :style="buttonStyle"
    />

    <!-- Hardware Wallet: BT Toggle -->
    <div v-else-if="showBtToggle" class="py-0" style="align-content: center;">
      <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
        <ToggleSwitch
          :text-left="usbText"
          icon-left="mdi-usb"
          :text-right="bluetoothText"
          icon-right="mdi-bluetooth"
          :value="isBT"
          @input="$emit('update:isBT', $event)"
          :disabled="loading"
        />
      </v-card-subtitle>
    </div>

    <!-- Default slot for additional content -->
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { WalletType } from '@/models/types';
import PassKeyAuthButton from './PassKeyAuthButton.vue';
import PassKeyPasswordField from './PassKeyPasswordField.vue';
import ToggleSwitch from './ToggleSwitch.vue';

interface Props {
  walletType: WalletType;
  isPrfWallet: boolean;
  isSigned: boolean;
  loading: boolean;
  password?: string;
  passwordLabel?: string;
  passwordRules?: any[];
  submitText: string;
  submitColor?: string;
  submitElevation?: number;
  submitOutlined?: boolean;
  buttonHeight?: number | string;
  buttonStyle?: string;
  buttonClass?: string;
  showBtToggle?: boolean;
  isBT?: boolean;
  usbText?: string;
  bluetoothText?: string;
}

const props = withDefaults(defineProps<Props>(), {
  submitColor: 'primary',
  submitElevation: 0,
  submitOutlined: false,
  buttonHeight: 40,
  buttonStyle: 'max-width: 295px; margin-bottom: 1px;',
  buttonClass: 'mb-2',
  showBtToggle: false,
  isBT: false,
  usbText: 'USB',
  bluetoothText: 'Bluetooth',
  password: '',
  passwordLabel: '',
  passwordRules: () => [],
});

defineEmits<{
  (e: 'passkey-success', bytes: Uint8Array): void;
  (e: 'passkey-error', error: Error): void;
  (e: 'autofill-success'): void;
  (e: 'autofill-error', error: string): void;
  (e: 'submit'): void;
  (e: 'update:password', value: string): void;
  (e: 'update:isBT', value: boolean): void;
  (e: 'password-field-ref', ref: any): void;
}>();

const isPasswordWallet = computed(() =>
  props.walletType === WalletType.Normal && !props.isPrfWallet
);
</script>

<style scoped>
.transaction-auth-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}
</style>
