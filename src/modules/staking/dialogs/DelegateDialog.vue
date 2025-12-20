<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="$t('staking.delegateYourStake')"
    :loading="loading"
    :min-height="639"
    :subtitle="$t('staking.delegateSubtitle', { currency: networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network) })"
  >
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1" v-if="pool">
      <v-alert border="left" color="primary" type="info" prominent class="text-left">
        <ul>
          <li>{{ $t('staking.youCanOnlyDelegateToOne') }}</li>
          <li>{{ $t('staking.canSwitchPools') }}</li>
          <li>{{ $t('staking.canCancelDelegation') }}</li>
        </ul>
      </v-alert>
      <v-list-item three-line>
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
              >{{ pool.ros?.toLocaleString('en-US', { maximumFractionDigits: 2 }) }}%</v-card-title
            >
            <v-card-subtitle class="text-left pb-2">{{ $t('staking.ros') }}</v-card-subtitle>
          </v-col>
        </v-row>
      </v-layout>
      <v-card-title class="pt-0" style="color: white">
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
      <v-card-subtitle class="text-left pb-0">{{ $t('staking.liveSaturation') }}</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-3" v-if="pool && account" style="display: block">
      <v-form ref="formRef" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>
              <v-tooltip bottom>
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
              <v-tooltip bottom>
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
                  (account?.controlled_amount * pool.ros) / 100 / 73,
                  false,
                  2,
                  networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)
                )
              }}</strong>
            </h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>
              <v-tooltip bottom>
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
              <v-tooltip bottom>
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
            <!-- Show success state when transaction is signed -->
            <v-alert
              v-if="isSubmit"
              type="success"
              dense
              border="left"
              colored-border
              class="mb-0"
              style="width: 100%;"
            >
              <span>{{ $t('staking.transactionSigned') }}</span>
            </v-alert>
            <!-- Password input (hidden after signing) -->
            <PassKeyPasswordField
              ref="passwordField"
              v-if="loggedWallet.type === WalletType.Normal && !isSubmit"
              :value="spendingPassword"
              @input="spendingPassword = $event"
              outlined
              dense
              hide-details
              :label="$t('staking.spendingPassword')"
              :rules="passwordRules"
              :disabled="loading"
              required
              @enter="signDelegationTx"
              @passkey-autofill-success="handlePassKeySuccess"
              @passkey-autofill-error="handlePassKeyError"
              style="max-width: 295px"
            />
            <div v-else-if="loggedWallet.type === WalletType.Ledger && !isSubmit" class="py-0" style="align-content: center">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch
                  :text-left="$t('staking.usb')"
                  icon-left="mdi-usb"
                  :text-right="$t('staking.bluetooth')"
                  icon-right="mdi-bluetooth"
                  v-model="isBT"
                  :disabled="loading"
                />
              </v-card-subtitle>
            </div>
            <v-btn
              color="primary"
              elevation="0"
              @click="signDelegationTx"
              height="40"
              :disabled="loading || (!valid && !isSubmit)"
              :loading="loading"
              class="mx-2"
              style="margin-bottom: 1px"
            >
              {{ isSubmit ? $t('staking.submitTransaction') : $t('staking.signAndDelegate') }}
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { useTransactionSigning } from '@/shared/composables/useTransactionSigning';
import { ref, toRefs, watch, computed } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import filters from '@/shared/utils/filters';
import { Cardano } from '@cardano-sdk/core';
import rules from '@/utils/rules';


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

const { loggedWallet, utxos, account } = toRefs(walletStore);

// Use the transaction signing composable
const txRef = computed(() => props.tx);
const {
  loading,
  spendingPassword,
  isSubmit,
  isBT,
  valid,
  passwordRules,
  handleSign,
  resetState,
  handlePassKeySuccess,
  handlePassKeyError,
  setPasswordFieldRef,
} = useTransactionSigning({
  tx: txRef,
  successMessageKey: 'staking.delegationTxSubmitted',
  onClose: () => emit('close'),
});

const formRef = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);
const passwordField = ref<any>(null);

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

watch(spendingPassword, () => {
  passwordRules.value = [rules.required()];
});

watch(passwordField, (newVal) => {
  if (newVal) {
    setPasswordFieldRef(newVal);
  }
});

const depositFee = computed(() => {
  if (!props.tx?.body) return 0;

  let totalAdaOutput = 0;

  // Calculate input amounts
  if (props.tx.body.inputs) {
    for (const input of props.tx.body.inputs) {
      const utxo = utxos.value?.find(
        (utxo: Cardano.Utxo) => utxo[0].txId === input.txId && utxo[0].index === input.index
      );
      if (utxo) {
        totalAdaOutput -= Number(utxo[1].value.coins);
      }
    }
  }

  // Calculate output amounts
  if (props.tx.body.outputs) {
    for (const output of props.tx.body.outputs) {
      totalAdaOutput += Number(output.value.coins);
    }
  }
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
