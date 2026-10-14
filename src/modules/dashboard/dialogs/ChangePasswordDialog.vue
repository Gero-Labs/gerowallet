<template>
  <BaseDialog
    :title="t('settings.spendingSecuritySettings')"
    :subtitle="t('settings.modifySpendingSecuritySettings')"
    icon="mdi-shield-key-outline"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="props.isOpen"
    @close="approval.invalidate(); emit('close')"
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
          :model-value="currentPassword"
          @update:model-value="currentPassword = $event"
          :label="t('dashboard.currentPassword')"
          dense
          outlined
          :rules="[rules.required()]"
          @passkey-autofill-error="handlePassKeyError"
          style="width: 350px"
        />
        <v-divider class="mb-3"></v-divider>
        <v-text-field
          :append-inner-icon="show2 ? 'mdi-eye-off' : 'mdi-eye'"
          :type="show2 ? 'text' : 'password'"
          :label="$t('dashboard.newPassword')"
          density="compact"
          variant="outlined"
          v-model="newPassword"
          :rules="[rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter, (newPassword !== currentPassword) || $t('dashboard.newPasswordMustDifferent')]"
          @click:append-inner="show2 = !show2"
          style="width: 350px"
        ></v-text-field>
        <v-text-field
          :append-inner-icon="show3 ? 'mdi-eye-off' : 'mdi-eye'"
          :type="show3 ? 'text' : 'password'"
          :label="$t('dashboard.confirmNewPassword')"
          density="compact"
          variant="outlined"
          v-model="confirmNewPassword"
          :rules="[rules.required(), (newPassword === confirmNewPassword) || $t('dashboard.passwordsMustMatch')]"
          @click:append-inner="show3 = !show3"
          style="width: 350px"
        ></v-text-field>
      </v-form>
    </v-card-text>
    <v-card-actions class="justify-center">
      <v-btn
        class="geroButton ml-2"
        style="color: black!important;"
        :disabled="!valid || updating"
        :loading="updating"
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
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useApprovalFreshness } from '@/shared/composables/useApprovalFreshness';

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
const updating = ref(false);

const currentPassword = ref<string>('');
const newPassword = ref<string>('');
const confirmNewPassword = ref<string>('');
const passwordField = ref<{ showError: (message: string) => void } | null>(null);

const vmProxy = getCurrentInstance()!.proxy as unknown as {
  $refs: { form: { validate: () => Promise<{ valid: boolean }>; resetValidation: () => void } };
};

watch(() => props.isOpen, (newValue, _oldValue) => {
  if (!newValue) {
    resetDialog();
  }
});

const { loggedWallet } = toRefs(walletStore);
const approval = useApprovalFreshness(
  () => [loggedWallet.value?.id, loggedWallet.value?.chain, loggedWallet.value?.network, walletStore.isLocked],
  () => props.isOpen,
  () => resetDialog(),
);

const handlePassKeyError = (error: string) => {
  console.error('PassKey autofill error in ChangePasswordDialog:', error);
  snackbar.setError(error || t('security.passKeyAuthFailed'));
};

const updateSpendingPassword = (): Promise<void> => approval.run(async () => {
  const current = approval.capture();
  const walletId = loggedWallet.value?.id;
  const oldPassword = currentPassword.value;
  const replacementPassword = newPassword.value;
  const confirmation = confirmNewPassword.value;
  updating.value = true;
  try {
    const validation = await vmProxy.$refs.form.validate();
    if (!validation.valid || !current() || walletId == null || oldPassword !== currentPassword.value ||
        replacementPassword !== newPassword.value || confirmation !== confirmNewPassword.value) return;
    try {
      await geroStore.updateSpendingPassword(walletId, oldPassword, replacementPassword);

      // SECURITY: the DB ciphertext is now rotated, but the in-memory copies still
      // hold the OLD blob the OLD password can decrypt — the background WalletBg
      // (used to sign) and walletStore.loggedWallet (used to reveal the seed).
      // Refresh them from disk so the old password stops working immediately,
      // without forcing a re-login.
      try {
        await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.REFRESH_LOGGED_WALLET_SECRET,
          data: { walletId },
        });
      } catch (refreshErr) {
        console.error('Failed to refresh in-memory wallet secret after password change:', refreshErr);
      }

      // Check if PassKey autofill is enabled and auto-update encrypted password
      try {
        const db = await getDb(walletId);
        const configTable = db.table('config');

        // Check if PassKey autofill is enabled
        const passKeyAutofillConfig = await configTable.where({ key: 'passKeyForPasswordAutofill' }).first();
        const credentialConfig = await configTable.where({ key: 'webAuthnCredentialId' }).first();

        if (current() && passKeyAutofillConfig?.value && credentialConfig?.value) {
          // Re-encrypt new password with PassKey PRF
          const encryptedPassword = await encryptSpendingPasswordWithPrf(
            replacementPassword,
            credentialConfig.value,
            walletId
          );

          // Update stored encrypted password
          await configTable.put({
            key: 'passKeyEncryptedSpendingPassword',
            value: encryptedPassword
          });
        } else {
          // Autofill is off: no PassKey copy of the (old) password may remain.
          await configTable.where({ key: 'passKeyEncryptedSpendingPassword' }).delete();
        }
      } catch (passKeyError) {
        // A copy that could not be re-encrypted still holds the OLD password: drop it,
        // so autofill asks for the password again instead of offering a stale one.
        try {
          const db = await getDb(walletId);
          await db.table('config').where({ key: 'passKeyEncryptedSpendingPassword' }).delete();
        } catch {
          // The snackbar below already tells the user PassKey autofill needs attention.
        }
        // Log but don't fail the password change if PassKey update fails
        console.error('⚠️ Failed to update PassKey encrypted password:', passKeyError);
        if (current()) snackbar.setError(t('security.passKeyPasswordUpdateFailed'));
      }

      if (current()) {
        snackbar.fireSuccess(t('dashboard.spendingPasswordChanged'));
        emit('close');
      }
    } catch (e) {
      if (current()) passwordField.value?.showError(t('errors.wrongPassword'));
    }
  } finally {
    updating.value = false;
  }
});

const resetDialog = (): void => {
  show1.value = false;
  show2.value = false;
  show3.value = false;
  valid.value = false;
  currentPassword.value = '';
  newPassword.value = '';
  confirmNewPassword.value = '';
  nextTick(() => {
    vmProxy.$refs.form?.resetValidation();
  })
};
</script>
<style scoped>

</style>
