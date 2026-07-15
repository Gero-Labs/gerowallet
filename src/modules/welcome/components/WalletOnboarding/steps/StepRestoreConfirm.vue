<template>
  <div class="step-restore-confirm" :style="creatingWalletLoader ? { pointerEvents: 'none', opacity: '0.7' } : {}">
    <div class="step-scroll">

    <!-- ===== PRF CONFIRMATION PATH ===== -->
    <template v-if="securityMethod === 'prf'">
      <!-- Wallet summary card -->
      <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
        <v-card-text class="pa-3">
          <div class="d-flex align-center mb-2">
            <v-avatar size="32" class="mr-2">
              <v-img :src="walletIconSrc" cover></v-img>
            </v-avatar>
            <div>
              <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.walletName') }}</div>
              <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ name }}</div>
            </div>
          </div>
          <v-divider class="my-2" style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
          <v-row no-gutters>
            <v-col cols="6" class="pr-3">
              <div class="d-flex align-center">
                <v-icon color="primary" size="20" class="mr-2">mdi-shield-key</v-icon>
                <div>
                  <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.securityMethod') }}</div>
                  <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ $t('welcome.passKeyMethod') }}</div>
                </div>
              </div>
            </v-col>
            <v-divider vertical style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
            <v-col cols="6" class="pl-3">
              <div class="d-flex align-center">
                <v-avatar size="20" class="mr-2">
                  <v-img :src="network ? network.icon : ''" contain></v-img>
                </v-avatar>
                <div>
                  <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('common.network') }}</div>
                  <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ network ? network.title : '' }}</div>
                </div>
              </div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- PRF acknowledgments -->
      <v-form ref="prfForm" v-model="prfFormValid">
        <v-checkbox
          v-model="acknowledgments.recoveryPhrase"
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
            <span class="text-body-2">
              {{ $t('welcome.iHaveReadTerms') }}
              <a class="terms-link" @click.stop="openTerms()">{{ $t('navigation.termsOfService') }}</a>.
            </span>
          </template>
        </v-checkbox>
      </v-form>
    </template>

    <!-- ===== PASSWORD CONFIRMATION PATH ===== -->
    <template v-else>

      <v-form ref="passwordForm" v-model="passwordFormValid">
        <v-text-field
          v-model="password"
          dense
          filled
          :label="$t('welcome.password')"
          :placeholder="$t('welcome.password')"
          :type="show1 ? 'text' : 'password'"
          :append-icon="show1 ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append="show1 = !show1"
          :rules="[
            rules.required(),
            rules.minCharacters(10),
            rules.oneOrMoreNumbers,
            rules.containCapital,
            rules.containLowerCase,
            rules.containSpecialCharacter,
            rules.spaceNotAllowed
          ]"
        ></v-text-field>

        <v-text-field
          v-model="confirmPassword"
          dense
          filled
          :label="$t('welcome.confirmPassword')"
          :placeholder="$t('welcome.confirmPassword')"
          :type="show2 ? 'text' : 'password'"
          :append-icon="show2 ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append="show2 = !show2"
          :rules="[
            rules.required(),
            (v) => v === password || $t('welcome.passwordsMustMatch')
          ]"
        ></v-text-field>

        <!-- No-recovery warning -->
        <v-alert
          color="warning"
          icon="mdi-alert-outline"
          outlined
          dense
          border="left"
          class="mb-3"
        >
          <span class="text-body-2">{{ $t('welcome.passwordNoRecoveryWarning') }}</span>
        </v-alert>

        <!-- Password acknowledgments -->
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
            <span class="text-body-2">
              {{ $t('welcome.iHaveReadTerms') }}
              <a class="terms-link" @click.stop="openTerms()">{{ $t('navigation.termsOfService') }}</a>.
            </span>
          </template>
        </v-checkbox>
      </v-form>
    </template>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')" :disabled="creatingWalletLoader">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn
        color="primary"
        :disabled="!canCreate"
        :loading="creatingWalletLoader"
        @click="walletCreationStep()"
      >
        {{ $t('welcome.restoreWallet') }}
      </v-btn>
    </div>

    <!-- Existing Wallet Confirmation Dialog (exceptional re-login path — kept as modal) -->
    <v-dialog v-model="showConfirmDialog" max-width="500" persistent>
      <v-card class="rounded-xl">
        <v-card-title class="text-h6">
          {{ $t('welcome.walletAlreadyExists') }}
        </v-card-title>
        <v-card-text v-if="existingWalletInfo">
          <p class="mb-2">
            {{ $t('welcome.walletExistsMessage', { name: existingWalletInfo.name }) }}
          </p>
          <p class="text--secondary">
            {{ $t('welcome.wouldYouLikeToLogin') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="handleCancelLogin()">
            {{ $t('common.cancel') }}
          </v-btn>
          <v-btn color="primary" @click="handleConfirmLogin()" :loading="creatingWalletLoader">
            {{ $t('wallet.login') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, getCurrentInstance } from 'vue';
import rules from '@/utils/rules';
import assets from '@/utils/assets';
import { Theme } from '@/models/types';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import networks, { NetworkInfo } from '@/utils/networks';

interface Props {
  network: NetworkInfo;
  securityMethod: 'prf' | 'password';
  name: string;
  mnemonic: string[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'created'): void;
}>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

// ─── Wallet icon derived from network ────────────────────────────────────────
const walletIconSrc = computed(() => {
  const iconKey = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
  return (assets as Record<string, string>)[`${iconKey}Svg`] || '';
});

// ─── Seed phrase as string ────────────────────────────────────────────────────
const seedToStr = computed(() => props.mnemonic.join(' '));

// ─── Form refs and validation ─────────────────────────────────────────────────
const prfForm = ref<{ resetValidation: () => void } | null>(null);
const prfFormValid = ref(false);
const passwordForm = ref<{ resetValidation: () => void } | null>(null);
const passwordFormValid = ref(false);

// ─── Password fields ──────────────────────────────────────────────────────────
const password = ref('');
const confirmPassword = ref('');
const show1 = ref(false);
const show2 = ref(false);

// ─── Creating state ───────────────────────────────────────────────────────────
const creatingWalletLoader = ref(false);

// ─── Acknowledgments ──────────────────────────────────────────────────────────
const acknowledgments = reactive({
  recoveryPhrase: false,
  passwordRecovery: false,
  termsAccepted: false,
});

// ─── Existing wallet confirm dialog ──────────────────────────────────────────
const showConfirmDialog = ref(false);
const existingWalletInfo = ref<{ name: string } | null>(null);

const canCreate = computed(() => {
  if (props.securityMethod === 'prf') {
    return prfFormValid.value;
  }
  return passwordFormValid.value;
});

const openTerms = (): void => {
  window.open('https://gerowallet.io/legal/terms/', '_blank');
};

// ========================================================================
// WALLET RESTORE LOGIC — PRESERVED FROM RestoreWallet.vue VERBATIM (~640-769)
// ========================================================================
const walletCreationStep = async (): Promise<void> => {
  creatingWalletLoader.value = true;
  try {
    // Midnight derives its wallet identity via the wallet-sdk-facade (not the
    // Cardano publicKey path), which isn't wired into the dedup helper yet.
    // Skip dedup on Midnight until the SDK lands. Re-restoring the same Midnight
    // mnemonic will create a separate wallet record for now.
    if (props.network.blockchain !== 'Midnight') {
      // Check if wallet with same mnemonic already exists
      const { derivePublicKeyFromMnemonic, getWalletByPublicKey } = await import('@/db/gero-db');
      const publicKey = await derivePublicKeyFromMnemonic(seedToStr.value);
      const existingWallet = await getWalletByPublicKey(publicKey);

      if (existingWallet) {
        existingWalletInfo.value = existingWallet;
        showConfirmDialog.value = true;
        creatingWalletLoader.value = false;
        return;
      }
    }

    let wallet;

    const walletIcon = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');

    // Pre-derive Midnight bech32m addresses in this options context. See
    // StepCreateConfirm.vue / midnightKeyManager.ts for why this can't live in
    // the background service worker. Restore uses the user-entered mnemonic.
    let midnightAddresses: {
      unshielded: string;
      shielded: string;
      dust: string;
      publicKeyHex?: string;
      addressHex?: string;
      cardanoXpub?: string;
      cardanoBaseAddress?: string;
      cardanoStakeAddress?: string;
      cardanoPaymentKeyHashHex?: string;
    } | undefined;
    if (props.network.blockchain === 'Midnight') {
      const { deriveMidnightKeys } = await import('@/chains/midnight/midnightKeyManager');
      const derived = await deriveMidnightKeys(seedToStr.value, props.network.network);
      midnightAddresses = derived.addresses;
    }

    if (props.securityMethod === 'prf') {
      // ========================================================================
      // PRF WALLET RESTORATION (PURE PRF MODE - NO PASSWORD)
      // ========================================================================

      try {
        // Step 1: Get next wallet ID from single source of truth
        const { getNextWalletId } = await import('@/db/gero-db');
        const newWalletId = await getNextWalletId();

        // Step 2: Register credential AND evaluate PRF in one prompt
        const { registerWebAuthnCredentialWithPrf } = await import('@/shared/utils/webauthn-prf');
        const { credentialId, prfEnabled, prfOutput } = await registerWebAuthnCredentialWithPrf(
          newWalletId.toString(),
          props.name
        );

        if (!prfEnabled) {
          throw new Error(vmProxy.$t('security.passKeyPrfNotSupported') as string);
        }

        try {
          const prfOptions = {
            usePrf: true,
            credentialId,
            passwordUnlockEnabled: false,
            backupMnemonic: true,
            prfOutput,
            walletId: newWalletId, // CRITICAL: Must match ID used for PRF salt
            ...(midnightAddresses ? { midnightAddresses } : {}),
          };

          wallet = await GeroStore.createNewWallet(
            props.name,
            walletIcon,
            Theme.GERO,
            seedToStr.value,
            'temp-password',
            props.network.blockchain,
            props.network.network,
            undefined,  // addressType - use default based on chain
            prfOptions
          );
        } finally {
          if (prfOutput) {
            new Uint8Array(prfOutput).fill(0);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isDOMException = error instanceof DOMException && error.name === 'NotAllowedError';
        if (message.includes('cancelled') || isDOMException) {
          creatingWalletLoader.value = false;
          return;
        }
        throw error;
      }
    } else {
      // ========================================================================
      // PASSWORD WALLET RESTORATION
      // ========================================================================
      wallet = await GeroStore.createNewWallet(
        props.name,
        walletIcon,
        Theme.GERO,
        seedToStr.value,
        password.value,
        props.network.blockchain,
        props.network.network,
        undefined,  // addressType - use default based on chain
        midnightAddresses ? { midnightAddresses } : undefined
      );
    }

    await performLogin(wallet);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Wallet restoration failed:', msg);
    vmProxy['$snackbar']?.setError(vmProxy.$t('errors.unknownError') as string);
    creatingWalletLoader.value = false;
  }
};

const performLogin = async (wallet: unknown) => {
  try {
    emit('created');
    showConfirmDialog.value = false;

    // Retry LOGIN if background service worker restarted (connection lost during wallet creation)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      });
      const hasError = response && typeof response === 'object' && 'error' in response;
      if (!hasError) break;
      console.warn(`Login attempt ${attempt} failed, retrying in 1s...`);
      await new Promise(r => setTimeout(r, 1000));
    }

    // LOGIN awaits full sync — by now isSyncing=false and it's safe to navigate
    vmProxy.$nextTick(() => {
      router.push('/').catch((err: Error) => {
        if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
          console.warn('Navigation error:', err);
        }
      });
    });
  } catch (error) {
    console.error('Error during login:', error);
  } finally {
    creatingWalletLoader.value = false;
  }
};

const handleConfirmLogin = async (): Promise<void> => {
  if (existingWalletInfo.value) {
    creatingWalletLoader.value = true;
    await performLogin(existingWalletInfo.value);
  }
};

const handleCancelLogin = (): void => {
  showConfirmDialog.value = false;
  existingWalletInfo.value = null;
};
</script>

<style scoped lang="scss">
// Terms link
.terms-link {
  color: var(--v-primary-base);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}

// Remove checkbox hover highlight
::v-deep .v-input--checkbox {
  .v-input--selection-controls__ripple {
    display: none;
  }
}
</style>
