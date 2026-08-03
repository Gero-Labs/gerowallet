<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('governance.delegateToADRep')"
    icon="mdi-vote-outline"
    :loading="loading"
    :min-height="440"
    :width="560"
    :subtitle="t('governance.delegatingYourCurrency', { currency: networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) })"
    :persistent="false"
  >
    <v-card-text class="px-4 pt-2 pb-1" style="z-index: 1" v-if="drep">
      <!-- DRep Info - Compact horizontal card -->
      <v-card flat outlined class="rounded-lg pa-3 mb-3 drep-info-card">
        <div class="d-flex align-start">
          <v-avatar rounded size="48" v-if="drep.image" class="mr-3 flex-shrink-0">
            <img :src="drep.image" alt="" @error="fallbackImage" />
          </v-avatar>
          <div class="flex-grow-1" style="min-width: 0">
            <div class="d-flex align-center">
              <span class="text-subtitle-1 white--text font-weight-bold text-truncate">{{ drep.name }}</span>
              <template v-if="drep.links">
                <v-btn
                  icon
                  x-small
                  v-for="(link, index) in drep.links"
                  :key="index"
                  :href="link.uri"
                  target="_blank"
                  v-show="link.uri && typeof link.uri === 'string'"
                  class="ml-1"
                >
                  <v-avatar tile size="12" v-if="String(link.uri).includes('https://x.com') || String(link.uri).includes('https://twitter.com')">
                    <v-img :src="xLogo" alt="x"></v-img>
                  </v-avatar>
                  <v-avatar tile size="12" v-else-if="String(link.uri).includes('https://t.me')">
                    <v-img :src="telegramLogo" alt="x"></v-img>
                  </v-avatar>
                  <v-icon x-small v-else>{{ getIconByURI(link.uri) }}</v-icon>
                </v-btn>
              </template>
            </div>
            <div class="text-caption text--secondary mt-1" v-if="drep.id">
              {{ truncate(drep.id) }}<CopyButton class="ml-1" v-if="drep.id" :value="drep.id" x-small></CopyButton>
            </div>
            <!-- Inline stats row -->
            <div class="d-flex mt-2" style="gap: 12px">
              <div v-if="drep.delegators" class="drep-stat">
                <span class="drep-stat-value">{{ drep.delegators }}</span>
                <span class="drep-stat-label">{{ $t('governance.delegators') }}</span>
              </div>
              <div v-if="drep.votes" class="drep-stat">
                <span class="drep-stat-value">{{ drep.votes }}</span>
                <span class="drep-stat-label">{{ $t('governance.votes') }}</span>
              </div>
              <div v-if="drep.voting_power" class="drep-stat">
                <span class="drep-stat-value">{{ toCurrency(drep.voting_power, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true) }}</span>
                <span class="drep-stat-label">{{ $t('governance.votingPower') }}</span>
              </div>
            </div>
          </div>
        </div>
      </v-card>

      <!-- CIP-0149: Voluntary DRep Compensation -->
      <v-card v-if="showCompensationSection" flat class="liquid-glass rounded-lg pa-3 mb-2">
        <div class="d-flex align-center justify-space-between">
          <div class="d-flex align-center">
            <v-icon small color="primary" class="mr-2">mdi-gift-outline</v-icon>
            <span class="text-body-2 white--text font-weight-medium">{{ $t('governance.supportDrep') }}</span>
          </div>
          <v-switch
            v-model="compensationEnabled"
            color="primary"
            hide-details
            dense
            class="mt-0 pt-0"
          />
        </div>
        <v-expand-transition>
          <div v-if="compensationEnabled">
            <p class="text-caption text--secondary mt-1 mb-2">
              {{ $t('governance.supportDrepDesc') }}
            </p>
            <v-chip-group
              v-model="compensationPresetIndex"
              mandatory
              active-class="primary"
              class="mb-1"
            >
              <v-chip small outlined pill :value="0">0.5%</v-chip>
              <v-chip small outlined pill :value="1">1%</v-chip>
              <v-chip small outlined pill :value="2">5%</v-chip>
              <v-chip small outlined pill :value="3">10%</v-chip>
              <v-chip small outlined pill :value="4">{{ $t('governance.customPercent') }}</v-chip>
            </v-chip-group>
            <v-slider
              v-if="compensationPresetIndex === 4"
              v-model="compensationCustomBps"
              :min="1"
              :max="100"
              :step="1"
              thumb-label="always"
              color="primary"
              track-color="grey darken-3"
              class="mt-5 mb-0"
            >
              <template v-slot:thumb-label="{ value }">
                {{ (value / 10).toFixed(1) }}%
              </template>
            </v-slider>
            <div class="text-caption text--secondary mt-1" style="line-height: 1.3">
              <v-icon x-small color="info" class="mr-1">mdi-information-outline</v-icon>
              {{ $t('governance.estimatedEpochDonation', {
                amount: toCurrency(estimatedEpochDonation, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)),
                balance: toCurrency(account?.controlled_amount || '0', false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))
              }) }}
            </div>
          </div>
        </v-expand-transition>
      </v-card>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-4" v-if="drep && account" style="display: block">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters class="text-center mb-2">
          <v-col :cols="cols">
            <div class="text-caption text--secondary">{{ $t('staking.delegationAmt') }}</div>
            <div class="text-body-2 font-weight-bold white--text">{{
              toCurrency(account.controlled_amount, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))
            }}</div>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <div class="text-caption text--secondary">{{ $t('governance.depositFee') }}</div>
            <div class="text-body-2 font-weight-bold white--text">{{
              toCurrency(depositFee, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))
            }}</div>
          </v-col>
          <v-col :cols="cols" v-if="compensationEnabled && compensationBasisPoints > 0">
            <div class="text-caption text--secondary">{{ $t('governance.drepCompensation') }}</div>
            <div class="text-body-2 mt-1">
              <v-chip x-small color="primary" outlined>{{ compensationPercentDisplay }}</v-chip>
            </div>
          </v-col>
          <v-col :cols="cols">
            <div class="text-caption text--secondary">{{ $t('governance.txFee') }}</div>
            <div class="text-body-2 font-weight-bold white--text">{{
              toCurrency(tx?.body?.fee?.toString() || '0', false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))
            }}</div>
          </v-col>
          <v-col cols="12" class="pt-4" style="display: flex; justify-content: center">
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
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import assets from '@/utils/assets';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import { walletStore } from '@/stores/walletStore';
import { buildCip149AuxiliaryData } from '@/shared/utils/builder';
import governanceStoreActions from '@/stores/governanceStore';

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

// Use the transaction signing composable - inject CIP-0149 metadata when compensation is enabled
const txRef = computed(() => {
  if (!props.tx) return props.tx;
  if (compensationEnabled.value && compensationBasisPoints.value > 0) {
    const auxData = buildCip149AuxiliaryData(compensationBasisPoints.value);
    const auxDataHash = Cardano.computeAuxiliaryDataHash(auxData);
    return {
      ...props.tx,
      auxiliaryData: auxData,
      body: {
        ...props.tx.body,
        auxiliaryDataHash: auxDataHash,
      }
    };
  }
  return props.tx;
});
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
  onClose: () => {
    // CIP-0149: Update governance store with compensation status only after successful submission
    if (compensationEnabled.value && compensationBasisPoints.value > 0) {
      governanceStoreActions.setCompensationBps(compensationBasisPoints.value);
    } else {
      governanceStoreActions.setCompensationBps(null);
    }
    emit('close');
  },
});

const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

const { toCurrency, truncate } = filters;

// CIP-0149: Compensation state
const compensationEnabled = ref(false);
const compensationPresetIndex = ref(2); // Default to 5% (index 2)
const compensationCustomBps = ref(50); // Custom slider value in basis points

const PRESET_BPS = [5, 10, 50, 100]; // 0.5%, 1%, 5%, 10%

const compensationBasisPoints = computed(() => {
  if (!compensationEnabled.value) return 0;
  if (compensationPresetIndex.value === 4) return compensationCustomBps.value;
  return PRESET_BPS[compensationPresetIndex.value] || 50;
});

const compensationPercentDisplay = computed(() => {
  return (compensationBasisPoints.value / 10).toFixed(1) + '%';
});

const estimatedEpochDonation = computed(() => {
  if (!compensationBasisPoints.value || !account.value?.controlled_amount) return 0;
  const balance = Number(account.value.controlled_amount);
  const avgEpochRewardRate = 0.000479; // ~3.5% APY / ~73 epochs per year
  return Math.floor(balance * avgEpochRewardRate * (compensationBasisPoints.value / 1000));
});

// Show compensation section only for real DReps (not Abstain/No Confidence)
const showCompensationSection = computed(() => {
  return props.drep && props.drep.id &&
    props.drep.id !== 'drep_always_abstain' && props.drep.id !== 'drep_always_no_confidence';
});

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
  let sections = 2; // Delegation amount + Tx fee
  if (depositFee.value > 0) sections++;
  if (compensationEnabled.value && compensationBasisPoints.value > 0) sections++;
  return Math.floor(12 / sections);
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
      compensationEnabled.value = false;
      compensationPresetIndex.value = 2; // Default 5%
      compensationCustomBps.value = 50;
      if (form.value) {
        form.value.resetValidation();
      }
    }
  }
);
</script>
<style scoped>
.drep-info-card {
  border-color: rgba(255, 255, 255, 0.12) !important;
  background: rgba(255, 255, 255, 0.03);
}

.drep-stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.drep-stat-value {
  font-size: 14px;
  font-weight: 600;
  color: white;
  line-height: 1.2;
}

.drep-stat-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.3px;
}
</style>
