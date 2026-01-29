<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('staking.delegateYourStake')"
    :loading="loading"
    :min-height="639"
    :subtitle="t('staking.delegateSubtitle', { currency: networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network) })"
  >
    <v-card-text class="px-0 justify-center text-center" style="z-index: 1" v-if="pool">
      <v-alert border="left" color="primary" type="info" prominent class="text-left">
        <ul>
          <li>{{ $t('staking.youCanOnlyDelegateToOne') }}</li>
          <li>{{ $t('staking.canSwitchPools') }}</li>
          <li>{{ $t('staking.canCancelDelegation') }}</li>
        </ul>
      </v-alert>
      <v-list-item three-line class="px-0">
        <v-list-item-content class="text-left">
          <v-list-item-title class="text-h5 mb-1">
            {{ `[${pool.ticker}] ${pool.name}` }}
          </v-list-item-title>
          <v-list-item-subtitle>{{ pool.description }}</v-list-item-subtitle>
          <v-list-item-subtitle v-if="pool"
            >{{ filters.truncate(pool.pool_id_bech32)
            }}<CopyButton class="ml-1" :value="pool.pool_id_bech32" x-small></CopyButton
          ></v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar size="80" v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64">
          <img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" alt="" @error="fallbackImage" />
        </v-list-item-avatar>
      </v-list-item>
      <v-layout>
        <v-row no-gutters>
          <v-col cols="12" md="6" sm="6">
            <v-card-title class="pt-0" style="color: white">{{
              pool.block_count?.toLocaleString('en-US')
            }}</v-card-title>
            <v-card-subtitle class="text-left pb-2">{{ $t('staking.lifetimeBlocks') }}</v-card-subtitle>
          </v-col>
          <v-col cols="12" md="6" sm="6">
            <v-card-title class="pt-0" style="color: white">{{ pool.live_delegators }}</v-card-title>
            <v-card-subtitle class="text-left pb-2">{{ $t('staking.liveDelegators') }}</v-card-subtitle>
          </v-col>
          <v-col cols="12" md="6" sm="6">
            <v-card-title class="pt-0" style="color: white">{{
              filters.toCurrency(
                pool.live_stake,
                false,
                0,
                networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
              )
            }}</v-card-title>
            <v-card-subtitle class="text-left pb-2">{{ $t('staking.liveStake') }}</v-card-subtitle>
          </v-col>
          <v-col cols="12" md="6" sm="6">
            <v-card-title class="pt-0" style="color: white"
              >{{ pool.ros?.toLocaleString('en-US', { maximumFractionDigits: 2 }) }}%
            </v-card-title>
            <v-card-subtitle class="text-left pb-2">{{ $t('staking.ros') }}</v-card-subtitle>
          </v-col>
        </v-row>
      </v-layout>
      <v-card-title class="pt-0 px-0" style="color: white">
        <v-progress-linear
          rounded
          :color="filters.getColor(pool.live_saturation)"
          height="32"
          :value="pool.live_saturation"
          striped
        >
          <template v-slot:default="{ value }">
            <strong>{{ Math.ceil(value) }}%</strong>
          </template>
        </v-progress-linear>
      </v-card-title>
      <v-card-subtitle class="text-left pb-0 px-0">{{ $t('staking.liveSaturation') }}</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-0" v-if="pool && account" style="display: block">
      <v-form ref="formRef" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>
              <v-tooltip bottom content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on" class="underline-tooltip">{{ $t('staking.delegationAmt') }}</span>
                </template>
                <div>
                  {{ $t('staking.delegationAmtTooltip') }}
                </div>
              </v-tooltip>
            </h4>
            <h4>
              <strong>{{
                filters.toCurrency(
                  account.controlled_amount,
                  false,
                  0,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col :cols="cols">
            <h4>
              <v-tooltip bottom content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on" class="underline-tooltip">{{ $t('staking.epochYield') }}</span>
                </template>
                <div>
                  {{ $t('staking.epochYieldTooltip') }}
                </div>
              </v-tooltip>
            </h4>
            <h4>
              ~<strong>{{
                filters.toCurrency(
                  (Number(account?.controlled_amount) * pool.ros) / 100 / 73,
                  false,
                  2,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>
              <v-tooltip bottom content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on" class="underline-tooltip">{{ $t('staking.depositFee') }}</span>
                </template>
                <div>
                  <div>{{ $t('staking.depositFeeDesc1') }}</div>
                  <div>{{ $t('staking.depositFeeDesc2') }}</div>
                  <div>{{ $t('staking.depositFeeDesc3') }}</div>
                </div>
              </v-tooltip>
            </h4>
            <h4>
              <strong>{{
                filters.toCurrency(
                  depositFee,
                  false,
                  0,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col :cols="cols">
            <h4>
              <v-tooltip bottom content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <span v-bind="attrs" v-on="on" class="underline-tooltip">{{ $t('staking.txFee') }}</span>
                </template>
                <div>
                  {{ $t('staking.txFeeTooltip') }}
                </div>
              </v-tooltip>
            </h4>
            <h4>
              <strong>{{
                filters.toCurrency(
                  tx?.body?.fee?.toString() || '0',
                  false,
                  0,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: space-evenly">
            <!-- Transaction Authentication Section -->
            <TransactionAuthSection
              :wallet-type="loggedWallet.type"
              :is-prf-wallet="isPrfWallet"
              :is-signed="isSubmit"
              :loading="loading"
              :password="spendingPassword"
              @update:password="spendingPassword = $event"
              :password-label="t('staking.spendingPassword')"
              :password-rules="passwordRules"
              :submit-text="$t('staking.submitTransaction')"
              submit-color="primary"
              :submit-elevation="0"
              :show-bt-toggle="isBTSupported"
              :is-b-t="isBT"
              @update:isBT="isBT = $event"
              :usb-text="t('staking.usb')"
              :bluetooth-text="t('staking.bluetooth')"
              @passkey-success="handlePassKeyAuthSuccess"
              @passkey-error="handlePassKeyAuthError"
              @autofill-success="handlePassKeySuccess"
              @autofill-error="handlePassKeyError"
              @submit="signDelegationTx"
              @enter="signDelegationTx"
              @password-field-ref="setPasswordFieldRef"
            />
            <!-- Hide action button for PRF wallets (handled above), show for password/hardware wallets after signing -->
            <v-btn
              v-if="!isPrfWallet && isSubmit"
              color="primary"
              elevation="0"
              @click="signDelegationTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ $t('staking.submitTransaction') }}
            </v-btn>
            <!-- Sign button for password/hardware wallets before signing -->
            <v-btn
              v-else-if="!isPrfWallet && !isSubmit"
              color="primary"
              elevation="0"
              @click="signDelegationTx"
              height="40"
              :disabled="loading || !valid"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ $t('staking.signAndDelegate') }}
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
import { ref, toRefs, watch, computed } from 'vue';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  pool: {
    type: Object as () => any,
  },
  tx: {
    type: Object as () => Cardano.Tx,
    required: false,
    default: undefined,
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
  isBTSupported,
  handleSign,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
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
  successMessageKey: 'staking.delegationTxSubmitted',
  onClose: () => emit('close'),
});

const formRef = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

watch(
  () => props.isOpen,
  val => {
    if (val) {
      resetState();
      if (formRef.value) {
        formRef.value.resetValidation();
      }
    }
  }
);

const depositFee = computed(() => {
  if (!props.tx?.body) return 0;

  const registrationCert: any = props.tx.body.certificates?.find(
    cert =>
      cert.__typename === Cardano.CertificateType.StakeRegistration ||
      cert.__typename === Cardano.CertificateType.StakeRegistrationDelegation
  );

  return registrationCert && registrationCert.deposit ? Number(registrationCert?.deposit) : 0;
});

const cols = computed(() => {
  if (depositFee.value > 0) {
    return 3;
  } else {
    return 4;
  }
});

const signDelegationTx = async () => {
  await handleSign(formRef.value || undefined);
};

const poolExtendedInfo = (pool: any): any => {
  if (pool && pool.pool_extended_info) {
    return JSON.parse(pool.pool_extended_info);
  }
  return undefined;
};

const fallbackImage = (e: Event): void => {
  const target = e.target as HTMLImageElement;
  target.src = '';
};
</script>
<style scoped>
.underline-tooltip {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  transition: opacity 0.2s ease;
}

.underline-tooltip:hover {
  opacity: 0.8;
}
</style>
