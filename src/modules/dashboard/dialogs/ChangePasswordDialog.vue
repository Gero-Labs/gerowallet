<template>
  <BaseDialog
    :title="$t('dashboard.spendingSecuritySettings')"
    :subtitle="$t('dashboard.modifySecuritySettings')"
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
        <v-text-field
          :append-icon="show1 ? 'mdi-eye-off' : 'mdi-eye'"
          :type="show1 ? 'text' : 'password'"
          :label="$t('dashboard.currentPassword')"
          dense
          outlined
          v-model="currentPassword"
          :rules="[rules.required()]"
          @click:append="show1 = !show1"
          style="width: 350px"
        ></v-text-field>
        <v-divider class="mb-3"></v-divider>
        <h4 class="mb-3">{{ $t('wallet.spendingLockType') }}</h4>
        <v-btn-toggle class="mb-6" color="primary" dense v-model="spendingPasswordType" mandatory block>
          <v-btn value="password" class="px-5">
            <v-icon>mdi-form-textbox-password</v-icon>
          </v-btn>
          <v-btn disabled value="pin" class="px-5">
            <v-icon>mdi-numeric</v-icon>
          </v-btn>
          <v-btn disabled value="pattern" class="px-5">
            <v-icon>mdi-lock-pattern</v-icon>
          </v-btn>
        </v-btn-toggle>
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
import rules from '@/utils/rules';
import geroStoreDefault from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';

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
const spendingPasswordType = ref<string>('password');

const currentPassword = ref<string>('');
const newPassword = ref<string>('');
const confirmNewPassword = ref<string>('');

const vmProxy = getCurrentInstance()!.proxy as any

watch(() => props.isOpen, (newValue, _oldValue) => {
  if (!newValue) {
    resetDialog();
  }
});

const { loggedWallet } = toRefs(walletStore);

const updateSpendingPassword = async (): Promise<void> => {
  if (vmProxy.$refs.form.validate()) {
    try {
      await geroStoreDefault.updateSpendingPassword(loggedWallet.value.id, currentPassword.value, newPassword.value, spendingPasswordType.value)
      snackbar.fireSuccess(t('dashboard.spendingPasswordChanged'))
      emit('close')
    } catch (e) {
      snackbar.setError(t('common.wrongPassword'))
    }
  }
}

const resetDialog = (): void => {
  show1.value = false;
  show2.value = false;
  show3.value = false;
  valid.value = false;
  spendingPasswordType.value = 'password';
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
