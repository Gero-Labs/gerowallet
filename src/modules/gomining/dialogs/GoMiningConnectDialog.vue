<template>
  <BaseDialog
    size="sm"
    :isOpen="modelValue"
    :title="t('gomining.connectTitle')"
    :img="assts.gominingIcon"
    img-color="var(--g-accent)"
    :min-height="0"
    :loading="submitting"
    :persistent="submitting"
    @close="close()"
  >
    <v-card-text class="px-5 pt-1 pb-5 gm-connect">
      <p class="t-body gm-connect__lead">{{ $t('gomining.connectLead') }}</p>

      <!-- What linking does, said before anything is signed -->
      <ul class="gm-connect__points">
        <li v-for="point in points" :key="point.key" class="t-body-sm gm-connect__point">
          <v-icon size="small" class="gm-connect__point-icon">{{ point.icon }}</v-icon>
          <span>{{ point.text }}</span>
        </li>
      </ul>

      <!-- Password wallet -->
      <PassKeyPasswordField
        v-if="!isPrfWallet"
        :model-value="password"
        dense
        outlined
        hide-details="auto"
        :label="$t('wallet.spendingPassword')"
        :placeholder="$t('navigation.typeYourSpendingPassword')"
        :disabled="submitting"
        required
        @update:model-value="password = $event"
        @enter="submit()"
      />

      <div v-if="errorMessage" class="t-body-sm gm-notice gm-notice--error" role="alert">
        <v-icon size="small">mdi-alert-circle-outline</v-icon>
        <span class="gm-notice__text">{{ errorMessage }}</span>
      </div>

      <div class="gm-connect__nav">
        <GButton tier="secondary" :disabled="submitting" @click="close()">{{ $t('common.cancel') }}</GButton>
        <!-- PassKey wallet: the PassKey both unlocks and confirms -->
        <GButton v-if="isPrfWallet" tier="primary" :loading="submitting" :disabled="submitting" @click="connectWithPassKey()">
          <v-icon size="small" start>mdi-fingerprint</v-icon>
          {{ $t('common.connect') }}
        </GButton>
        <GButton v-else tier="primary" :loading="submitting" :disabled="!password || submitting" @click="submit()">
          <v-icon size="small" start>mdi-link-variant</v-icon>
          {{ $t('common.connect') }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import assts from '@/utils/assets';
import { goMiningErrorMessage, type GoMiningCredentials } from '../useGoMiningAccount';

const props = defineProps<{
  modelValue: boolean;
  /** The address being linked: GoMining's payout address once linked. */
  address: string;
  connect: (credentials: GoMiningCredentials) => Promise<void>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  connected: [];
}>();

const { t } = useTranslation();

const password = ref('');
const submitting = ref(false);
const errorMessage = ref('');

const isPrfWallet = computed(() => {
  const wallet = walletStore.loggedWallet;
  return wallet?.encryptionMethod === 'prf' || (!!wallet?.prfEncryptedPrivateKey && !!wallet?.webAuthnCredentialId);
});

const points = computed(() => [
  { key: 'account', icon: 'mdi-account-plus-outline', text: t('gomining.connectPointAccount') },
  { key: 'privacy', icon: 'mdi-shield-account-outline', text: t('gomining.connectPointPrivacy') },
  { key: 'payout', icon: 'mdi-bitcoin', text: t('gomining.connectPointPayout', { address: shortAddress(props.address) }) },
  { key: 'signature', icon: 'mdi-draw-pen', text: t('gomining.connectPointSignature') },
]);

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

async function run(credentials: GoMiningCredentials) {
  if (submitting.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    await props.connect(credentials);
    submitting.value = false;
    emit('connected');
    close();
  } catch (error) {
    errorMessage.value = goMiningErrorMessage(error, t);
  } finally {
    submitting.value = false;
  }
}

function submit() {
  if (!password.value) return;
  void run({ password: password.value });
}

/**
 * The Bitcoin signer decrypts the recovery phrase with the PassKey's raw PRF
 * output, as the Bitcoin send dialog passes it, so that is what is evaluated here.
 */
async function connectWithPassKey() {
  const wallet = walletStore.loggedWallet;
  if (!wallet?.webAuthnCredentialId) {
    errorMessage.value = t('security.passKeyNotConfigured');
    return;
  }
  let prfOutput: Uint8Array | null = null;
  try {
    const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
    prfOutput = new Uint8Array(await evaluateWalletPrf(wallet));
  } catch {
    errorMessage.value = t('security.passKeyAuthFailed');
    return;
  }
  try {
    await run({ privateKeyBytes: prfOutput });
  } finally {
    prfOutput.fill(0);
  }
}

function close() {
  if (submitting.value) return;
  password.value = '';
  errorMessage.value = '';
  emit('update:modelValue', false);
}
</script>

<style scoped lang="scss">
/* Sits above BaseDialog's decorative rings, which are positioned. */
.gm-connect {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.gm-connect__lead {
  margin: 0;
}

.gm-connect__points {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.gm-connect__point {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.gm-connect__point-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--g-accent);
}

.gm-notice {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.gm-notice--error {
  color: var(--g-error);
}

.gm-notice__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.gm-connect__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
