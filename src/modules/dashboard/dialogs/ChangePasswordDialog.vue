<template>
  <BaseDialog
    :title="t('settings.spendingSecuritySettings')"
    :subtitle="t('settings.modifySpendingSecuritySettings')"
    icon="mdi-shield-key-outline"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="props.isOpen"
    @close="emit('close')"
    scrollable
    max-width="850"
    :width="500"
    :min-height="0"
    :persistent="persistent"
  >
    <v-card-text class="pt-2 pb-0 px-3 text-center justify-center" style="justify-items: center;">
      <v-form ref="form" v-model="valid">
        <PassKeyPasswordField
          ref="passwordField"
          :value="currentPassword"
          @input="currentPassword = $event"
          :label="t('dashboard.currentPassword')"
          dense
          outlined
          :rules="[rules.required()]"
          @passkey-autofill-error="handlePassKeyError"
          style="width: 350px"
        />
        <v-divider class="mb-3"></v-divider>
        <v-text-field
          :append-icon="show2 ? 'mdi-eye-off' : 'mdi-eye'"
          :type="show2 ? 'text' : 'password'"
          :label="$t('dashboard.newPassword')"
          dense
          outlined
          v-model="newPassword"
          :rules="[rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter, (newPassword !== currentPassword) || $t('dashboard.newPasswordMustDifferent')]"
          @click:append="show2 = !show2"
          style="width: 350px"
        ></v-text-field>
        <v-text-field
          :append-icon="show3 ? 'mdi-eye-off' : 'mdi-eye'"
          :type="show3 ? 'text' : 'password'"
          :label="$t('dashboard.confirmNewPassword')"
          dense
          outlined
          v-model="confirmNewPassword"
          :rules="[rules.required(), (newPassword === confirmNewPassword) || $t('dashboard.passwordsMustMatch')]"
          @click:append="show3 = !show3"
          style="width: 350px"
        ></v-text-field>
      </v-form>
    </v-card-text>
    <v-card-actions class="justify-center">
      <v-btn
        class="geroButton ml-2"
        style="color: black!important;"
        :disabled="!valid"
        @click="updateSpendingPassword"
      >
        {{ $t('dashboard.updatePassword') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
const { t } = useTranslation();
import { getCurrentInstance, nextTick, ref, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import rules from '@/utils/rules';
import geroStore from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';
import { getDb } from '@/db/wallet-db';
import { encryptSpendingPasswordWithPrf } from '@/shared/utils/webauthn-prf';

interface Props {
  isOpen: boolean;
}
const props = defineProps<Props>();

const emit = defineEmits(['close']);

const persistent = ref<boolean>(false);
const show1 = ref<boolean>(false);
const show2 = ref<boolean>(false);
const show3 = ref<boolean>(false);
const valid = ref<boolean>(false);

const currentPassword = ref<string>('');
const newPassword = ref<string>('');
const confirmNewPassword = ref<string>('');
const passwordField = ref<any>(null);

const vmProxy = getCurrentInstance()!.proxy as any

watch(() => props.isOpen, (newValue, _oldValue) => {
  if (!newValue) {
    resetDialog();
  }
});

const { loggedWallet } = toRefs(walletStore);

const handlePassKeyError = (error: string) => {
  console.error('PassKey autofill error in ChangePasswordDialog:', error);
  snackbar.setError(error || t('security.passKeyAuthFailed'));
};

const updateSpendingPassword = async (): Promise<void> => {
  if (vmProxy.$refs.form.validate()) {
    try {
      await geroStore.updateSpendingPassword(loggedWallet.value.id, currentPassword.value, newPassword.value)

      // Check if PassKey autofill is enabled and auto-update encrypted password
      try {
        const db = await getDb(loggedWallet.value.id);
        const configTable = db.table('config');

        // Check if PassKey autofill is enabled
        const passKeyAutofillConfig = await configTable.where({ key: 'passKeyForPasswordAutofill' }).first();
        const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

        if (passKeyAutofillConfig?.value && credentialConfig?.value) {
          // Re-encrypt new password with PassKey PRF
          const encryptedPassword = await encryptSpendingPasswordWithPrf(
            newPassword.value,
            credentialConfig.value,
            loggedWallet.value.id
          );

          // Update stored encrypted password
          await configTable.put({
            key: 'passKeyEncryptedSpendingPassword',
            value: encryptedPassword
          });
        }
      } catch (passKeyError) {
        // Log but don't fail the password change if PassKey update fails
        console.error('⚠️ Failed to update PassKey encrypted password:', passKeyError);
        snackbar.setError(t('security.passKeyPasswordUpdateFailed'));
      }

      snackbar.fireSuccess(t('dashboard.spendingPasswordChanged'))
      emit('close')
    } catch (e) {
      passwordField.value?.showError(t('common.wrongPassword'));
    }
  }
}

const resetDialog = (): void => {
  show1.value = false;
  show2.value = false;
  show3.value = false;
  valid.value = false;
  currentPassword.value = '';
  newPassword.value = '';
  confirmNewPassword.value = '';
  nextTick(() => {
    vmProxy.$refs.form.resetValidation();
  })
};
</script>
<style scoped>

</style>
