<template>
  <div class="step-create-confirm">

    <!-- ===== PRF PATH ===== -->
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

    <!-- ===== PASSWORD PATH ===== -->
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

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn
        color="primary"
        :disabled="!canCreate"
        :loading="creatingWalletLoader"
        @click="walletCreationStep()"
      >
        {{ $t('common.create') }}
      </v-btn>
    </div>
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
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'created'): void;
}>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

// Wallet icon derived from network
const walletIconSrc = computed(() => {
  const iconKey = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
  return (assets as Record<string, string>)[`${iconKey}Svg`] || '';
});

// Form refs and validation
const prfForm = ref<{ resetValidation: () => void } | null>(null);
const prfFormValid = ref(false);
const passwordForm = ref<{ resetValidation: () => void } | null>(null);
const passwordFormValid = ref(false);

// Password fields
const password = ref('');
const confirmPassword = ref('');
const show1 = ref(false);
const show2 = ref(false);

// Creating state
const creatingWalletLoader = ref(false);

// Acknowledgments
const acknowledgments = reactive({
  recoveryPhrase: false,
  passwordRecovery: false,
  termsAccepted: false,
});

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
// WALLET CREATION LOGIC — PRESERVED FROM CreateWallet.vue VERBATIM
// ========================================================================
const walletCreationStep = async (): Promise<void> => {
  creatingWalletLoader.value = true;
  try {
    let wallet;

    const walletIcon = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');

    // For Midnight, pre-derive the 3 role-specific bech32m addresses in this
    // (options) context. The SDK can't run in the background service worker
    // (ledger-v8 WASM + effect runtime are too heavy), so we derive here and
    // hand the addresses to gero-db as a JSON-stringified field. Generate the
    // mnemonic up-front so derivation and storage see the same one.
    let preGeneratedMnemonic: string | null = null;
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
      const bip39 = await import('bip39');
      const { deriveMidnightKeys } = await import('@/chains/midnight/midnightKeyManager');
      preGeneratedMnemonic = bip39.generateMnemonic(256);
      const derived = await deriveMidnightKeys(preGeneratedMnemonic, props.network.network);
      midnightAddresses = derived.addresses;
    }

    if (props.securityMethod === 'prf') {
      // ========================================================================
      // PRF WALLET CREATION (PURE PRF MODE - NO PASSWORD)
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
            preGeneratedMnemonic, // null for non-Midnight (gero-db generates inline)
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
          return;
        }
        throw error;
      }
    } else {
      // ========================================================================
      // PASSWORD WALLET CREATION
      // ========================================================================
      wallet = await GeroStore.createNewWallet(
        props.name,
        walletIcon,
        Theme.GERO,
        preGeneratedMnemonic, // null for non-Midnight (gero-db generates inline)
        password.value,
        props.network.blockchain,
        props.network.network,
        undefined,  // addressType - use default based on chain
        midnightAddresses ? { midnightAddresses } : undefined
      );
    }

    emit('created');

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    const hasError = response && typeof response === 'object' && 'error' in response;
    if (response && !hasError) {
      vmProxy.$nextTick(() => {
        router.push('/').catch((err: Error) => {
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.warn('Navigation error:', err);
          }
        });
      });
    } else if (hasError) {
      console.warn('Login response contained error, proceeding anyway');
      vmProxy.$nextTick(() => {
        router.push('/').catch(() => {});
      });
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Wallet creation failed:', msg);
    vmProxy['$snackbar']?.setError(vmProxy.$t('errors.unknownError') as string);
  } finally {
    creatingWalletLoader.value = false;
  }
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
