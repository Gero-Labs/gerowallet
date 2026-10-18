<template>
  <div class="step-restore-confirm" :style="creatingWalletLoader ? { pointerEvents: 'none', opacity: '0.7' } : {}">
    <div class="step-scroll">

    <!-- ===== PRF CONFIRMATION PATH ===== -->
    <template v-if="securityMethod === 'prf'">
      <!-- Wallet summary card -->
      <v-card class="mb-3" variant="outlined" style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
        <v-card-text class="pa-3">
          <div class="d-flex align-center mb-2">
            <v-avatar size="32" class="mr-2">
              <v-img :src="walletIconSrc" cover></v-img>
            </v-avatar>
            <div>
              <div class="summary-label t-caption">{{ $t('welcome.walletName') }}</div>
              <div class="summary-value t-body font-weight-medium">{{ name }}</div>
            </div>
          </div>
          <v-divider class="my-2" style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
          <v-row no-gutters>
            <v-col cols="6" class="pr-3">
              <div class="d-flex align-center">
                <v-icon color="primary" size="20" class="mr-2">mdi-shield-key</v-icon>
                <div>
                  <div class="summary-label t-caption">{{ $t('welcome.securityMethod') }}</div>
                  <div class="summary-value t-body font-weight-medium">{{ $t('welcome.passKeyMethod') }}</div>
                </div>
              </div>
            </v-col>
            <v-divider vertical style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
            <v-col cols="6" class="pl-3">
              <div class="d-flex align-center">
                <v-avatar size="20" class="mr-2">
                  <v-img :src="network ? network.icon : ''" ></v-img>
                </v-avatar>
                <div>
                  <div class="summary-label t-caption">{{ $t('common.network') }}</div>
                  <div class="summary-value t-body font-weight-medium">{{ network ? network.title : '' }}</div>
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
            <span class="t-body">{{ $t('welcome.understandPasswordRecovery') }}</span>
          </template>
        </v-checkbox>

        <v-checkbox
          v-model="acknowledgments.termsAccepted"
          :rules="[rules.required()]"
          hide-details
          class="mb-1 mt-0"
        >
          <template v-slot:label>
            <span class="t-body">
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
          density="compact"
          variant="filled"
          :label="$t('welcome.password')"
          :placeholder="$t('welcome.password')"
          :type="show1 ? 'text' : 'password'"
          :append-inner-icon="show1 ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append-inner="show1 = !show1"
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
          density="compact"
          variant="filled"
          :label="$t('welcome.confirmPassword')"
          :placeholder="$t('welcome.confirmPassword')"
          :type="show2 ? 'text' : 'password'"
          :append-inner-icon="show2 ? 'mdi-eye' : 'mdi-eye-off'"
          @click:append-inner="show2 = !show2"
          :rules="[
            rules.required(),
            (v) => v === password || $t('welcome.passwordsMustMatch')
          ]"
        ></v-text-field>

        <!-- No-recovery warning -->
        <v-alert
          color="warning"
          icon="mdi-alert-outline"
          variant="outlined"
          density="compact"
          border="start"
          class="mb-3"
        >
          <span class="t-body">{{ $t('welcome.passwordNoRecoveryWarning') }}</span>
        </v-alert>

        <!-- Password acknowledgments -->
        <v-checkbox
          v-model="acknowledgments.passwordRecovery"
          :rules="[rules.required()]"
          hide-details
          class="mb-1 mt-0"
        >
          <template v-slot:label>
            <span class="t-body">{{ $t('welcome.understandPasswordRecovery') }}</span>
          </template>
        </v-checkbox>

        <v-checkbox
          v-model="acknowledgments.termsAccepted"
          :rules="[rules.required()]"
          hide-details
          class="mb-1 mt-0"
        >
          <template v-slot:label>
            <span class="t-body">
              {{ $t('welcome.iHaveReadTerms') }}
              <a class="terms-link" @click.stop="openTerms()">{{ $t('navigation.termsOfService') }}</a>.
            </span>
          </template>
        </v-checkbox>
      </v-form>
    </template>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="$emit('back')" :disabled="creatingWalletLoader">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        tier="primary"
        :disabled="!canCreate"
        :loading="creatingWalletLoader"
        @click="walletCreationStep()"
        class="step-next"
      >
        {{ $t('welcome.restoreWallet') }}
      </GButton>
    </div>

    <!-- Existing Wallet Confirmation Dialog (exceptional re-login path — kept as modal) -->
    <v-dialog v-model="showConfirmDialog" max-width="500" persistent>
      <v-card class="rounded-xl">
        <v-card-title class="t-heading">
          {{ $t('welcome.walletAlreadyExists') }}
        </v-card-title>
        <v-card-text v-if="existingWalletInfo">
          <p class="t-body mb-2">
            {{ $t('welcome.walletExistsMessage', { name: existingWalletInfo.name }) }}
          </p>
          <p class="t-body mb-2">
            {{ $t('welcome.walletExistsOnNetwork', {
              chain: existingWalletInfo.chain,
              network: existingWalletInfo.network
            }) }}
          </p>
          <p class="t-body-sm">
            {{ $t('welcome.wouldYouLikeToLogin') }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <GButton tier="tertiary" @click="handleCancelLogin()">
            {{ $t('common.cancel') }}
          </GButton>
          <GButton tier="primary" @click="handleConfirmLogin()" :loading="creatingWalletLoader">
            {{ $t('wallet.login') }}
          </GButton>
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
import type { Wallet } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';
import GButton from '@/shared/components/GButton/GButton.vue';

interface Props {
  network: NetworkInfo;
  securityMethod: 'prf' | 'password';
  name: string;
  mnemonic: string[];
  /** Multi-account: the accounts chosen, account #0 among them; the others are added under it. */
  accounts?: AccountXpub[];
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
  const icon = assets[`${iconKey}Svg` as keyof typeof assets];
  return typeof icon === 'string' ? icon : '';
});

// ─── Seed phrase as string ────────────────────────────────────────────────────
const seedToStr = computed(() => props.mnemonic.join(' '));
const prfFormValid = ref(false);
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
const existingWalletInfo = ref<Wallet | null>(null);

const canCreate = computed(() => {
  if (props.securityMethod === 'prf') {
    return prfFormValid.value;
  }
  return passwordFormValid.value;
});

const openTerms = (): void => {
  window.open('https://gerowallet.io/legal/terms/', '_blank');
};

/** Stop the restore and offer to open the wallet that already holds this seed. */
const showExistingWallet = (existingWallet: Wallet): void => {
  existingWalletInfo.value = existingWallet;
  showConfirmDialog.value = true;
  creatingWalletLoader.value = false;
};

// ========================================================================
// WALLET RESTORE LOGIC — PRESERVED FROM RestoreWallet.vue VERBATIM (~640-769)
// ========================================================================
const walletCreationStep = async (): Promise<void> => {
  creatingWalletLoader.value = true;
  try {
    let wallet;

    const walletIcon = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');

    // Pre-derive Midnight bech32m addresses in this options context. See
    // StepCreateConfirm.vue / midnightKeyManager.ts for why this can't live in
    // the background service worker. Restore uses the user-entered mnemonic.
    // Derived before the duplicate check because the Midnight identity is read
    // from these addresses.
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
      const { deriveMidnightAddresses } = await import('@/chains/midnight/midnightKeyManager');
      // Addresses only; the derived secret keys are wiped inside (PRIV-01).
      midnightAddresses = await deriveMidnightAddresses(seedToStr.value, props.network.network);
    }

    // Refuse to restore a seed that already has a wallet on this chain+network.
    // The identity is the derived public key, so a rename doesn't hide a
    // duplicate and the same seed can still be restored on another chain or
    // network. Checked before anything is written — and, on the PRF path,
    // before the user is prompted to register a PassKey.
    const { deriveWalletPublicKey, findExistingWallet } = await import('@/db/gero-db');
    const candidatePublicKey = await deriveWalletPublicKey(
      seedToStr.value,
      props.network.blockchain,
      props.network.network,
      undefined,  // addressType - use default based on chain
      midnightAddresses
    );
    const existingWallet = await findExistingWallet({
      chain: props.network.blockchain,
      network: props.network.network,
      publicKey: candidatePublicKey,
    });

    if (existingWallet) {
      showExistingWallet(existingWallet);
      return;
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
        const { registerWebAuthnCredentialWithPrf, PrfUnsupportedError } = await import('@/shared/utils/webauthn-prf');
        const { credentialId, prfEnabled, prfOutput, transports } = await registerWebAuthnCredentialWithPrf(
          newWalletId.toString(),
          props.name
        );

        if (!prfEnabled) {
          // Registration succeeded but the authenticator didn't enable PRF — the
          // wallet could never unlock, so treat it as unsupported (see #655).
          throw new PrfUnsupportedError();
        }

        try {
          const prfOptions = {
            usePrf: true,
            credentialId,
            passwordUnlockEnabled: false,
            backupMnemonic: true,
            prfOutput,
            // Recorded once, here: an assertion cannot report where a credential
            // lives, so if this is not captured at registration the browser is
            // never told and offers its full picker at every later prompt.
            credentialTransports: transports,
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
        // Browser/device can't do PassKey wallets (e.g. Brave): show an actionable
        // message pointing to a password wallet, instead of a generic error (#655).
        if (error instanceof Error && error.name === 'PrfUnsupportedError') {
          creatingWalletLoader.value = false;
          vmProxy['$snackbar']?.setError(vmProxy.$t('security.passKeyUnsupportedBrowser') as string);
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

    await addChosenAccounts(wallet);
    await performLogin(wallet);
  } catch (error: unknown) {
    // Backstop: gero-db rejects duplicates too, in case a race let one slip past
    // the check above. Prompt rather than reporting an opaque failure.
    const { DuplicateWalletError } = await import('@/db/gero-db');
    if (error instanceof DuplicateWalletError) {
      showExistingWallet(error.existingWallet);
      return;
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Wallet restoration failed:', msg);
    vmProxy['$snackbar']?.setError(vmProxy.$t('errors.unknownError') as string);
    creatingWalletLoader.value = false;
  }
};

/**
 * The other accounts chosen join the wallet just restored (account #0). They hold
 * none of its secrets, so this asks for nothing more. Best-effort: the wallet is
 * restored either way, and an account missed here can be added later.
 */
const addChosenAccounts = async (wallet: Wallet | undefined): Promise<void> => {
  const others = (props.accounts ?? []).filter((account) => account.accountIndex > 0);
  if (!wallet?.id || !others.length) return;
  try {
    await GeroStore.addAccounts(wallet.id, others.map((account) => ({
      name: vmProxy.$t('accounts.label', { index: account.accountIndex }) as string,
      publicKey: account.publicKey,
      accountIndex: account.accountIndex,
    })));
  } catch (error) {
    console.error('Adding the other accounts failed:', error instanceof Error ? error.message : 'unknown');
    vmProxy['$snackbar']?.setError(vmProxy.$t('accounts.addLater') as string);
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
// Summary card: type comes from the ramp classes in the markup; these rules
// only set line height and lift each value to the primary tone.
.summary-label { line-height: 1.2; }
.summary-value { color: var(--g-text-1); line-height: 1.3; }

// Terms link
.terms-link {
  color: var(--g-accent);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}

// Remove checkbox hover highlight
:deep(.v-input--checkbox) {
  .v-input--selection-controls__ripple {
    display: none;
  }
}
</style>
