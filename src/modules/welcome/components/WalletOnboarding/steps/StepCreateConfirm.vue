<template>
  <div class="step-create-confirm">
    <div class="step-scroll">

    <!-- ===== PRF PATH ===== -->
    <template v-if="securityMethod === 'prf'">
      <!-- Wallet summary card -->
      <v-card class="glass-tier mb-3" flat>
        <v-card-text class="pa-3">
          <div class="d-flex align-center mb-2">
            <v-avatar size="32" class="mr-2">
              <v-img :src="walletIconSrc" cover></v-img>
            </v-avatar>
            <div>
              <div class="summary-label t-caption">{{ $t('welcome.walletName') }}</div>
              <div class="summary-value t-body font-weight-medium">{{ name }}</div>
              <div v-if="accountCount > 1" class="summary-label t-caption">{{ tc('accounts.count', accountCount, { count: accountCount }) }}</div>
            </div>
          </div>
          <v-divider class="my-2" style="border-color: var(--g-hairline-2);"></v-divider>
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
            <v-divider vertical style="border-color: var(--g-hairline-2);"></v-divider>
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

    <!-- ===== PASSWORD PATH ===== -->
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
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        tier="primary"
        :disabled="!canCreate"
        :loading="creatingWalletLoader"
        @click="walletCreationStep()"
        class="step-next"
      >
        {{ $t('common.create') }}
      </GButton>
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
import type { Wallet } from '@/models/types';
import type { AccountXpub } from '@/shared/utils/walletAccount';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';

interface Props {
  network: NetworkInfo;
  securityMethod: 'prf' | 'password';
  name: string;
  /** Multi-account: how many accounts to start with, #0 among them. */
  accountCount?: number;
}

const props = withDefaults(defineProps<Props>(), { accountCount: 1 });
const { tc } = useTranslation();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'created'): void;
}>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

// Wallet icon derived from network
const walletIconSrc = computed(() => {
  const iconKey = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
  const icon = assets[`${iconKey}Svg` as keyof typeof assets];
  return typeof icon === 'string' ? icon : '';
});
const prfFormValid = ref(false);
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
      const { deriveMidnightAddresses } = await import('@/chains/midnight/midnightKeyManager');
      preGeneratedMnemonic = bip39.generateMnemonic(256);
      // Addresses only; the derived secret keys are wiped inside (PRIV-01).
      midnightAddresses = await deriveMidnightAddresses(preGeneratedMnemonic, props.network.network);
    }

    // More than one account: generate the phrase here, as a restore types it, and
    // read the accounts' public keys from it before anything is written or the
    // PassKey is registered. gero-db is told the phrase is new, so it still asks
    // for a backup.
    let accounts: AccountXpub[] = [];
    if (props.accountCount > 1 && !preGeneratedMnemonic) {
      const bip39 = await import('bip39');
      const { deriveAccountXpubsFromMnemonic } = await import('@/shared/utils/softwareAccounts');
      preGeneratedMnemonic = bip39.generateMnemonic(256);
      accounts = await deriveAccountXpubsFromMnemonic(
        preGeneratedMnemonic,
        Array.from({ length: props.accountCount }, (_, index) => index),
        { chain: props.network.blockchain, network: props.network.network },
      );
    }
    const newPhrase = accounts.length ? { generatedMnemonic: true } : {};

    if (props.securityMethod === 'prf') {
      // ========================================================================
      // PRF WALLET CREATION (PURE PRF MODE - NO PASSWORD)
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
            ...newPhrase,
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
        // Browser/device can't do PassKey wallets (e.g. Brave): show an actionable
        // message pointing to a password wallet, instead of a generic error (#655).
        if (error instanceof Error && error.name === 'PrfUnsupportedError') {
          vmProxy['$snackbar']?.setError(vmProxy.$t('security.passKeyUnsupportedBrowser') as string);
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
        { ...(midnightAddresses ? { midnightAddresses } : {}), ...newPhrase }
      );
    }

    await addCreatedAccounts(wallet, accounts);
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

/**
 * The other accounts join the wallet just created (account #0), as a restore adds
 * the ones chosen. They hold none of its secrets, so this asks for nothing more.
 * Only when account #0 is the key the wallet stored, so a phrase mix-up adds
 * nothing. Best-effort: the wallet exists either way, and an account missed here
 * can be added later.
 */
const addCreatedAccounts = async (wallet: Wallet | undefined, accounts: AccountXpub[]): Promise<void> => {
  const others = accounts.filter((account) => account.accountIndex > 0);
  if (!wallet?.id || !others.length) return;
  try {
    if (accounts[0]?.publicKey !== wallet.publicKey) throw new Error('account #0 mismatch');
    await GeroStore.addAccounts(wallet.id, others.map((account) => ({
      name: vmProxy.$t('accounts.label', { index: account.accountIndex }) as string,
      publicKey: account.publicKey,
      accountIndex: account.accountIndex,
    })));
  } catch (error) {
    console.error('Adding the other accounts failed:', error instanceof Error ? error.message : 'unknown');
    vmProxy['$snackbar']?.setError(vmProxy.$t('accounts.addLaterCreate') as string);
  }
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
