<template>
  <v-dialog v-model="dialog" max-width="500px" persistent>
    <v-card>
      <v-card-title>
        {{ $t('poolOperator.importColdKey') }}
        <v-spacer />
        <v-btn icon @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text>
        <p class="text-body-2 grey--text">{{ $t(instructionsKey) }}</p>

        <!-- File Input -->
        <v-file-input
          v-model="coldKeyFile"
          :label="$t('poolOperator.coldKeyFile')"
          accept=".skey,.json"
          outlined
          dense
          prepend-icon="mdi-file-key"
          class="mt-4"
          @change="parseColdKey"
        />

        <!-- Parsed Info -->
        <div v-if="parsedKeyType" class="mt-2">
          <v-chip small color="success" outlined>{{ parsedKeyType }}</v-chip>
        </div>

        <!-- Encryption method selector (shown after file parsed) -->
        <template v-if="parsedKeyType">
          <!-- PassKey option (preferred, always shown if supported) -->
          <div v-if="prfSupported" class="mt-4">
            <p class="text-body-2 grey--text">{{ $t('poolOperator.coldKeyPrfEncryptionHint') }}</p>
          </div>

          <!-- Password fallback (only for normal software wallets, or if PRF not supported) -->
          <template v-if="!prfSupported || showPasswordFallback">
            <v-text-field
              v-model="password"
              :label="isNormalWallet ? $t('wallet.spendingPassword') : $t('poolOperator.coldKeyPassword')"
              type="password"
              outlined
              dense
              class="mt-4"
              :hint="isNormalWallet ? $t('poolOperator.coldKeyEncryptionHint') : $t('poolOperator.coldKeyPasswordHint')"
              persistent-hint
            />
            <v-text-field
              v-if="!isNormalWallet"
              v-model="passwordConfirm"
              :label="$t('poolOperator.confirmPassword')"
              type="password"
              outlined
              dense
              class="mt-2"
              :error-messages="passwordConfirm && password !== passwordConfirm ? [$t('welcome.passwordsMustMatch')] : []"
            />
          </template>
        </template>

        <v-alert v-if="error" type="error" dense outlined class="mt-4">
          {{ error }}
        </v-alert>
      </v-card-text>

      <v-card-actions class="flex-column pa-4" style="gap: 8px">
        <!-- PassKey button (primary, if supported) -->
        <v-btn
          v-if="parsedKeyType && prfSupported && !showPasswordFallback"
          color="primary"
          block
          :loading="importing"
          @click="importWithPassKey"
        >
          <v-icon left>mdi-fingerprint</v-icon>
          {{ $t('poolOperator.importWithPassKey') }}
        </v-btn>

        <!-- Password button (fallback) -->
        <v-btn
          v-if="parsedKeyType && (!prfSupported || showPasswordFallback)"
          color="primary"
          block
          :disabled="!password || (!isNormalWallet && password !== passwordConfirm)"
          :loading="importing"
          @click="importWithPassword"
        >
          {{ $t('poolOperator.importAndEncrypt') }}
        </v-btn>

        <!-- Toggle to password fallback -->
        <v-btn
          v-if="parsedKeyType && prfSupported && !showPasswordFallback"
          text
          x-small
          color="grey"
          @click="showPasswordFallback = true"
        >
          {{ $t('poolOperator.usePasswordInstead') }}
        </v-btn>

        <!-- Toggle back to PassKey -->
        <v-btn
          v-if="parsedKeyType && prfSupported && showPasswordFallback"
          text
          x-small
          color="grey"
          @click="showPasswordFallback = false"
        >
          {{ $t('poolOperator.usePassKeyInstead') }}
        </v-btn>

        <v-btn text block @click="close">{{ $t('common.cancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';

const { t } = useTranslation();

const props = defineProps<{ value: boolean }>();
const emit = defineEmits(['input', 'imported']);

const dialog = ref(props.value);
watch(() => props.value, (v) => { dialog.value = v; });
watch(dialog, (v) => { emit('input', v); });

const coldKeyFile = ref<File | null>(null);
const parsedKeyType = ref('');
const rawKeyBytes = ref<Uint8Array | null>(null);
const password = ref('');
const passwordConfirm = ref('');
const error = ref('');
const importing = ref(false);
const prfSupported = ref(false);
const showPasswordFallback = ref(false);

const isNormalWallet = computed(() => {
  const type = walletStore.loggedWallet?.type;
  return type === WalletType.Normal || type === WalletType.Google;
});

// Instruction text must match the encryption method actually used:
// PassKey (PRF), the wallet's spending password (normal software wallet),
// or a password the user sets (hardware / PassKey wallets falling back to password).
const instructionsKey = computed(() => {
  if (prfSupported.value && !showPasswordFallback.value) return 'poolOperator.importColdKeyInstructionsPasskey';
  if (isNormalWallet.value) return 'poolOperator.importColdKeyInstructions';
  return 'poolOperator.importColdKeyInstructionsCustom';
});

onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();
  } catch {
    prfSupported.value = false;
  }
});

async function parseColdKey() {
  parsedKeyType.value = '';
  rawKeyBytes.value = null;
  error.value = '';
  showPasswordFallback.value = false;

  if (!coldKeyFile.value) return;

  try {
    const text = await coldKeyFile.value.text();
    const envelope = JSON.parse(text);

    if (!envelope.type || !envelope.cborHex) {
      throw new Error('Not a valid Cardano key file (TextEnvelope format expected)');
    }

    if (!envelope.type.includes('StakePoolSigningKey') && !envelope.type.includes('Node')) {
      throw new Error(`Unexpected key type: ${envelope.type}. Expected StakePoolSigningKey.`);
    }

    parsedKeyType.value = envelope.type;

    const hex = envelope.cborHex;
    let keyHex: string;
    if (hex.startsWith('5820')) {
      keyHex = hex.slice(4);
    } else if (hex.startsWith('58')) {
      const lenByte = parseInt(hex.slice(2, 4), 16);
      keyHex = hex.slice(4, 4 + lenByte * 2);
    } else {
      keyHex = hex;
    }

    rawKeyBytes.value = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  } catch (e: any) {
    error.value = e.message || t('poolOperator.invalidColdKeyFile');
  }
}

async function derivePoolId(keyBytes: Uint8Array) {
  const { ed25519 } = await import('@noble/curves/ed25519');
  const pubKey = ed25519.getPublicKey(keyBytes);

  const blake2b = (await import('blake2b')).default;
  const keyHashBytes = blake2b(28).update(pubKey).digest();
  const coldKeyHash = Array.from(keyHashBytes as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');

  const { bech32 } = await import('bech32');
  const poolIdBech32 = bech32.encode('pool', bech32.toWords(keyHashBytes));

  return { coldKeyHash, poolIdBech32 };
}

async function saveColdKey(encrypted: string, coldKeyHash: string, poolIdBech32: string, encryptionMethod: 'password' | 'prf', credentialId?: string) {
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) throw new Error('No wallet logged in');

  const { setWalletConfiguration } = await import('@/db/wallet-db');
  await setWalletConfiguration(walletId, 'spo_encryptedColdKey', encrypted);
  await setWalletConfiguration(walletId, 'spo_coldKeyHash', coldKeyHash);
  await setWalletConfiguration(walletId, 'spo_coldKeySource', 'imported');
  await setWalletConfiguration(walletId, 'spo_poolId', poolIdBech32);
  await setWalletConfiguration(walletId, 'spo_coldKeyEncryption', encryptionMethod);
  if (credentialId) {
    await setWalletConfiguration(walletId, 'spo_coldKeyCredentialId', credentialId);
  }

  poolOperatorStore.coldKeySource = 'imported';
  poolOperatorStore.coldKeyHash = coldKeyHash;
  poolOperatorStore.poolId = poolIdBech32;
}

async function importWithPassKey() {
  if (!rawKeyBytes.value) return;
  importing.value = true;
  error.value = '';

  try {
    const wallet = walletStore.loggedWallet;
    if (!wallet) throw new Error('No wallet logged in');

    const { encryptPrivateKeyWithPrf, registerWebAuthnCredentialWithPrf } = await import('@/shared/utils/webauthn-prf');

    let credentialId: string;
    let prfOutput: ArrayBuffer | null = null;

    // Always register a fresh credential for cold key encryption
    // (wallet's credential may be on a different device/profile)
    console.log('[ColdKey] Registering new credential for cold key encryption');
    const registration = await registerWebAuthnCredentialWithPrf(
      `spo-${wallet.id}`,
      `${wallet.name || 'Gero Wallet'} - Pool Cold Key`
    );
    credentialId = registration.credentialId;
    prfOutput = registration.prfOutput;

    // Encrypt cold key with PRF-derived key
    const encrypted = await encryptPrivateKeyWithPrf(
      rawKeyBytes.value,
      credentialId,
      wallet.id.toString(),
      prfOutput || undefined  // Pass PRF output from registration to avoid double authentication
    );

    const { coldKeyHash, poolIdBech32 } = await derivePoolId(rawKeyBytes.value);
    await saveColdKey(encrypted, coldKeyHash, poolIdBech32, 'prf', credentialId);

    snackbar.fireSuccess(t('poolOperator.coldKeyImported'));
    emit('imported', { coldKeyHash, poolId: poolIdBech32 });
    close();
  } catch (e: any) {
    error.value = e.message || t('errors.unknownError');
  } finally {
    importing.value = false;
  }
}

async function importWithPassword() {
  if (!rawKeyBytes.value || !password.value) return;
  importing.value = true;
  error.value = '';

  try {
    // For normal wallets, verify spending password
    if (isNormalWallet.value) {
      const verification = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: password.value },
      }) as { data: { success: boolean; error?: string } };

      if (!verification.data.success) {
        error.value = t('errors.wrongPassword');
        return;
      }
    }

    const { encryptWithPassword } = await import('@/shared/utils/crypto');
    const encrypted = encryptWithPassword(password.value, rawKeyBytes.value);

    const { coldKeyHash, poolIdBech32 } = await derivePoolId(rawKeyBytes.value);
    await saveColdKey(encrypted, coldKeyHash, poolIdBech32, 'password');

    snackbar.fireSuccess(t('poolOperator.coldKeyImported'));
    emit('imported', { coldKeyHash, poolId: poolIdBech32 });
    close();
  } catch (e: any) {
    error.value = e.message || t('errors.unknownError');
  } finally {
    importing.value = false;
  }
}

function close() {
  dialog.value = false;
  coldKeyFile.value = null;
  parsedKeyType.value = '';
  rawKeyBytes.value = null;
  password.value = '';
  passwordConfirm.value = '';
  error.value = '';
  showPasswordFallback.value = false;
}
</script>
