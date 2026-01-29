<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('governance.delegateToADRep')"
    :loading="loading"
    :min-height="660"
    :width="700"
    :subtitle="t('governance.delegatingYourCurrency', { currency: networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) })"
    :persistent="false"
  >
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1" v-if="drep">
      <v-alert border="left" color="primary" type="info" prominent class="text-left">
        <ul>
          <li>{{ $t('governance.youCanOnlyDelegateToOneDRep') }}</li>
          <li>{{ $t('governance.canSwitchDRepAnytime') }}</li>
          <li>{{ $t('governance.canCancelDRepDelegation') }}</li>
        </ul>
      </v-alert>
      <v-list-item three-line>
        <v-list-item-content class="text-left">
          <v-list-item-title class="text-h5 mb-1">
            {{ `${drep.name}` }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="drep"
            >{{ truncate(drep.id) }}<CopyButton class="ml-1" v-if="drep.id" :value="drep.id" x-small></CopyButton
          ></v-list-item-subtitle>
          <v-list-item-subtitle v-if="drep.links">
            <template v-for="(link, index) in drep.links">
              <v-btn
                icon
                x-small
                :key="index"
                :href="link.uri"
                target="_blank"
                v-if="link.uri && typeof link.uri === 'string'"
              >
                <v-avatar
                  tile
                  size="14"
                  v-if="String(link.uri).includes('https://x.com') || String(link.uri).includes('https://twitter.com')"
                >
                  <v-img :src="xLogo" alt="x"></v-img>
                </v-avatar>
                <v-avatar tile size="14" v-else-if="String(link.uri).includes('https://t.me')">
                  <v-img :src="telegramLogo" alt="x"></v-img>
                </v-avatar>
                <v-icon v-else>
                  {{ getIconByURI(link.uri) }}
                </v-icon>
              </v-btn>
            </template>
          </v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar rounded size="80" v-if="drep.image">
          <img :src="drep.image" alt="" @error="fallbackImage" />
        </v-list-item-avatar>
      </v-list-item>
      <v-card-title class="pt-0" style="color: white" v-if="drep.delegators">{{ drep.delegators }}</v-card-title>
      <v-card-subtitle class="text-left pb-2" v-if="drep.delegators">{{ $t('governance.delegators') }}</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white" v-if="drep.votes">{{ drep.votes }}</v-card-title>
      <v-card-subtitle class="text-left pb-2" v-if="drep.votes">{{ $t('governance.votes') }}</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white" v-if="drep.voting_power">{{
        toCurrency(
          drep.voting_power,
          false,
          0,
          networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
        )
      }}</v-card-title>
      <v-card-subtitle class="text-left pb-2" v-if="drep.voting_power">{{ $t('governance.votingPower') }}</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-3" v-if="drep && account" style="display: block">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>
              {{ $t('staking.delegationAmt') }}
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4>
              <strong>{{
                toCurrency(
                  account.controlled_amount,
                  false,
                  0,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>{{ $t('governance.depositFee') }}</h4>
            <h4>
              <strong>{{
                toCurrency(
                  depositFee,
                  false,
                  0,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col :cols="cols">
            <h4>{{ $t('governance.txFee') }}</h4>
            <h4>
              <strong>{{
                toCurrency(
                  tx?.body?.fee?.toString() || '0',
                  false,
                  0,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: center">
            <!-- Transaction Authentication Section -->
            <TransactionAuthSection
              :wallet-type="loggedWallet.type"
              :is-prf-wallet="isPrfWallet"
              :is-signed="isSubmit"
              :loading="loading"
              :password="spendingPassword"
              @update:password="spendingPassword = $event"
              :password-label="t('wallet.spendingPassword')"
              :password-rules="passwordRules"
              :submit-text="t('governance.submitTransaction')"
              submit-color="primary"
              :submit-elevation="0"
              :show-bt-toggle="loggedWallet.btSupported && !isSubmit"
              :is-b-t="isBT"
              @update:isBT="isBT = $event"
              :usb-text="t('governance.usb')"
              :bluetooth-text="t('governance.bluetooth')"
              @passkey-success="handlePassKeyAuthSuccess"
              @passkey-error="handlePassKeyAuthError"
              @autofill-success="handlePassKeySuccess"
              @autofill-error="handlePassKeyError"
              @submit="signAndSubmitDelegationTx"
              @enter="signAndSubmitDelegationTx"
              @password-field-ref="setPasswordFieldRef"
            />
            <!-- Hide action button for PRF wallets (handled above), show for password/hardware wallets -->
            <v-btn
              v-if="!isPrfWallet && isSubmit"
              color="primary"
              elevation="0"
              @click="signAndSubmitDelegationTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ t('governance.submitTransaction') }}
            </v-btn>
            <v-btn
              v-else-if="!isPrfWallet && !isSubmit"
              color="primary"
              elevation="0"
              @click="signAndSubmitDelegationTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ t('governance.signAndDelegate') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>

    <!-- Keystone Sign Dialog -->
    <KeystoneSignDialog
      :isOpen="overlay && loggedWallet.type === WalletType.Keystone"
      :keystoneType="keystoneType"
      :keystoneCbor="keystoneCbor"
      @close="overlay = false"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @progress="onKeystoneProgress"
    />
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
const { t } = useTranslation();
import { ref, computed, watch } from 'vue';
import { toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import { Cardano } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import assets from '@/utils/assets';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import { walletStore } from '@/stores/walletStore';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  drep: {
    type: Object as () => any,
    default: () => {},
  },
  tx: {
    type: Object as () => Cardano.Tx,
    default: () => {},
  },
});

const emit = defineEmits(['close']);

const { loggedWallet, account } = toRefs(walletStore);

// Use the transaction signing composable
const txRef = computed(() => props.tx);
const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  valid,
  passwordRules,
  isPrfWallet,
  handleSign,
  resetState,
  handlePassKeySuccess: composableHandlePassKeySuccess,
  handlePassKeyError: composableHandlePassKeyError,
  handlePassKeyAuthSuccess,
  handlePassKeyAuthError,
  setPasswordFieldRef,
  // Keystone state and methods
  overlay,
  keystoneType,
  keystoneCbor,
  onKeystoneScan,
  onKeystoneError,
  onKeystoneProgress,
} = useTransactionSigning({
  tx: txRef,
  successMessageKey: 'governance.drepDelegationTxSubmitted',
  onClose: () => emit('close'),
});

const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

const { toCurrency, truncate } = filters;

// Constants for template
const xLogo = assets.xSvg;
const telegramLogo = assets.telegramSvg;

const depositFee = computed(() => {
  if (!props.tx?.body) return 0;

  // Check for vote registration certificate with deposit
  const registrationCert: Cardano.Certificate = props.tx.body.certificates?.find(
    (cert: any) =>
      cert.__typename === Cardano.CertificateType.StakeVoteRegistrationDelegation ||
      cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation ||
      cert.__typename === Cardano.CertificateType.VoteDelegation
  );

  // For DRep delegation, check if there's a deposit required
  if (registrationCert && 'deposit' in registrationCert && registrationCert.deposit) {
    return Number(registrationCert.deposit);
  }

  // Also check for governance deposit in certificates
  const drepRegistration = props.tx.body.certificates?.find((cert: any) => cert.deposit && (cert.dRep || cert.anchor));

  if (drepRegistration && 'deposit' in drepRegistration && drepRegistration.deposit) {
    return Number(drepRegistration.deposit);
  }

  return 0;
});

const cols = computed(() => {
  if (depositFee.value > 0) {
    return 4;
  } else {
    return 6;
  }
});

const getIconByURI = (uri: string) => {
  if (String(uri).includes('https://github.com')) {
    return 'mdi-github';
  } else if (String(uri).includes('youtube.com') || String(uri).includes('youtu.be')) {
    return 'mdi-youtube';
  } else if (String(uri).includes('linkedin.com')) {
    return 'mdi-linkedin';
  } else if (String(uri).includes('instagram.com')) {
    return 'mdi-instagram';
  } else if (String(uri).includes('discord.com')) {
    return 'mdi-discord';
  }
  return 'mdi-link';
};

// Use composable's passkey handlers
const handlePassKeySuccess = () => {
  composableHandlePassKeySuccess();
};

const handlePassKeyError = (error: string) => {
  composableHandlePassKeyError(error);
};

// Simplified signing function that uses the composable
const signAndSubmitDelegationTx = async () => {
  await handleSign(form.value || undefined);
};

const fallbackImage = (e: any) => {
  e.target.src = assets.errorImage;
};

watch(
  () => props.isOpen,
  val => {
    if (val) {
      resetState();
      if (form.value) {
        form.value.resetValidation();
      }
    }
  }
);
</script>
<style scoped></style>
