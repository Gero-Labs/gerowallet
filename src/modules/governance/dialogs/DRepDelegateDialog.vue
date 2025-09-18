<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Delegate to a DRep" :loading="loading" :min-height="660" :width="700"
              :subtitle="`Delegating your ${networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network)} to a Delegated Representative.`">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1" v-if="drep">
      <v-alert
        border="left"
        color="primary"
        type="info"
        prominent
        class="text-left"
      >
        <ul>
          <li>You can only delegate to one DRep at a time</li>
          <li>You can switch to delegate to a different DRep at any time</li>
          <li>You can cancel your delegation at any time</li>
        </ul>
      </v-alert>
      <v-list-item three-line>
        <v-list-item-content class="text-left">
          <v-list-item-title class="text-h5 mb-1">
            {{ `${drep.name}` }}
          </v-list-item-title>
          <v-list-item-subtitle v-if="drep">{{ truncate(drep.id) }}<CopyButton class="ml-1" :value="drep.id" x-small></CopyButton></v-list-item-subtitle>
          <v-list-item-subtitle v-if="drep.links">
            <template v-for="(link, index) in drep.links">
              <v-btn icon x-small  :key="index" :href="link.uri" target="_blank" v-if="link.uri && typeof link.uri === 'string'">
                <v-avatar tile size="14" v-if="String(link.uri).includes('https://x.com') || String(link.uri).includes('https://twitter.com')">
                  <v-img :src="xLogo" alt="x"></v-img>
                </v-avatar>
                <v-avatar tile size="14" v-else-if="String(link.uri).includes('https://t.me')">
                  <v-img :src="telegramLogo" alt="x"></v-img>
                </v-avatar>
                <v-icon v-else>
                  {{ getIconByURI(link.uri)}}
                </v-icon>
              </v-btn>
            </template>
          </v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar
          rounded
          size="80"
          v-if="drep.image"
        >
          <img :src="drep.image" alt="" @error="fallbackImage"/>
        </v-list-item-avatar>
      </v-list-item>
      <v-card-title class="pt-0" style="color: white">{{ drep.delegators }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Delegators</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ drep.votes }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Votes</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ toCurrency(drep.voting_power, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))}}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Voting Power</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center pt-0 px-3" v-if="drep && account" style="display: block;">
      <v-form ref="form" v-model="valid">
        <v-row no-gutters>
          <v-col :cols="cols">
            <h4>Delegation Amt.
              <v-btn x-small icon>
                <v-icon small>mdi-information-outline</v-icon>
              </v-btn>
            </h4>
            <h4><strong>{{ toCurrency(account.controlled_amount, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network))}}</strong></h4>
          </v-col>
          <v-col :cols="cols" v-if="depositFee > 0">
            <h4>Deposit Fee</h4>
            <h4><strong>{{ toCurrency(depositFee, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col :cols="cols">
            <h4>Tx Fee</h4>
            <h4><strong>{{ toCurrency(tx?.body?.fee?.toString() || '0', false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</strong></h4>
          </v-col>
          <v-col cols="12" class="pt-6" style="display: flex; justify-content: center;">
            <v-tooltip
              v-model="tooltip.enabled"
              top
              color="red"
              v-if="loggedWallet.type === WalletType.Normal"
            >
              <template v-slot:activator="{ }">
                <v-text-field
                  flat
                  style="max-width: 295px;"
                  block
                  dense
                  v-model="spendingPassword"
                  outlined
                  label="Spending Password"
                  :type="showPassword ? 'text' : 'password'"
                  :rules="passwordRules"
                  hide-details
                  required
                  :disabled="loading"
                  @keydown.enter.prevent="signAndSubmitDelegationTx"
                >
                  <template v-slot:append>
                    <v-icon @click="showPassword = !showPassword" tabindex="-1">
                      {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                    </v-icon>
                  </template>
                </v-text-field>
              </template>
              <span>{{ tooltip.text }}</span>
            </v-tooltip>
            <div v-else-if="loggedWallet.type === WalletType.Ledger" class="py-0" style="align-content: center;">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch text-left="USB" icon-left="mdi-usb" text-right="Bluetooth" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
              </v-card-subtitle>
            </div>
            <v-btn color="primary" elevation="0" @click="signAndSubmitDelegationTx" height="40" :disabled="loading || !valid" :loading="loading" class="mx-2" style="margin-bottom: 1px">
              {{ isSubmit ? 'Submit' : 'Delegate' }}
            </v-btn>
          </v-col>
        </v-row>
      </v-form>
    </v-card-actions>
    <!-- TODO: Keystone hardware wallet overlay UI - currently disabled -->
    <!-- This overlay shows QR codes for Keystone device interaction -->
    <!-- When re-enabling, uncomment the v-overlay section below and restore related functionality -->
    <!--
    <v-overlay
      :absolute="true"
      opacity="0.99"
      :value="overlay"
      class="hardwareOverlay"
    >
      ...
    </v-overlay>
    -->
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import rules from '@/utils/rules';
import networks from "@/utils/networks";
import snackbar from '@/plugins/snackbar';
import { WalletType } from '@/models/types';
// TODO: Keystone support needs to be reimplemented with Cardano JS SDK
// import { createKeystoneSignRequest, parseSignature, qrCodeOptions } from '@/shared/utils/keystone';
// import { UREncoder } from '@keystonehq/keystone-sdk';
// import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { MessageTypes } from '@/models/MessageTypes';
import ledgerUtils from '@/shared/utils/ledger';

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
  }
});

const emit = defineEmits(['close']);

const { loggedWallet, utxos, account, keys, config } = toRefs(walletStore);

const loading = ref(false);
const spendingPassword = ref('');
const showPassword = ref(false);
const tooltip = ref({
  enabled: false,
  text: 'Wrong Spending Password!',
});
const valid = ref(false);
const passwordRules = ref([rules.required()]);
const isBT = ref(false);
const txCbor = ref<string>('');
const txWitnesses = ref(null);
const isSubmit = ref(false);
// TODO: Keystone hardware wallet state - currently disabled
// const overlay = ref(false);
// const type = ref<string | undefined>(undefined);
// const cbor = ref<string | undefined>(undefined);
// const keystoneScan = ref(false);
// const isInit = ref(false);
// const qrCode = ref<any>(null);
// const qrCodeRef = ref<HTMLElement | null>(null);
const form = ref<{ validate: () => boolean; resetValidation: () => void } | null>(null);

const { toCurrency, truncate } = filters;

// Constants for template
const xLogo = assets.xSvg;
const telegramLogo = assets.telegramSvg;

const depositFee = computed(() => {
  if (!props.tx?.body) return 0;

  // Check for vote registration certificate with deposit
  const registrationCert: Cardano.Certificate
    = props.tx.body.certificates?.find(
    (cert: any) => cert.__typename === Cardano.CertificateType.StakeVoteRegistrationDelegation ||
            cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation ||
            cert.__typename === Cardano.CertificateType.VoteDelegation
  );

  // For DRep delegation, check if there's a deposit required
  if (registrationCert && 'deposit' in registrationCert && registrationCert.deposit) {
    return Number(registrationCert.deposit);
  }

  // Also check for governance deposit in certificates
  const drepRegistration = props.tx.body.certificates?.find(
    (cert: any) => cert.deposit && (cert.dRep || cert.anchor)
  );

  if (drepRegistration && 'deposit' in drepRegistration && drepRegistration.deposit) {
    return Number(drepRegistration.deposit);
  }

  return 0;
});

const cols = computed(() => {
  if (depositFee.value > 0) {
    return 4
  } else {
    return 6
  }
});

const getIconByURI = (uri: string) => {
  if (String(uri).includes('https://github.com')) {
    return 'mdi-github'
  } else if (String(uri).includes('youtube.com') || String(uri).includes('youtu.be')) {
    return 'mdi-youtube'
  } else if (String(uri).includes('linkedin.com')) {
    return 'mdi-linkedin'
  } else if (String(uri).includes('instagram.com')) {
    return 'mdi-instagram'
  } else if (String(uri).includes('discord.com')) {
    return 'mdi-discord'
  }
  return 'mdi-link'
};

// TODO: Keystone QR code functionality - currently disabled
// Keystone wallet support needs to be reimplemented with Cardano JS SDK
// This includes QR code generation, scanning, and signature parsing

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
};

const signTx = async (): Promise<boolean> => {
  loading.value = true
  try {
    console.log('Signing Cardano JS SDK DRep delegation transaction');
    console.log('Transaction:', props.tx);

    // First, verify password via a background message
    const passwordVerification = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: spendingPassword.value }
    }) as { data: { isValid: boolean; error?: string } };

    if (!passwordVerification.data.isValid) {
      enableToolTip();
      loading.value = false;
      return false;
    }

    // Serialize the Cardano.Tx to CBOR for Chrome messaging
    txCbor.value = serializeCardanoJsSdkTx(props.tx);
    console.log('Serialized transaction CBOR:', txCbor.value);

    // Sign the transaction via a background message
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: txCbor.value, // Pass serialized CBOR instead of the object
        partialSign: false,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value, // Address mappings
        mergeWitnesses: false,
      }
    }) as { data: { witnesses?: any; error?: string } };

    console.log('Transaction signed successfully:', witnessResult);

    if (witnessResult.data.error) {
      throw new Error(witnessResult.data.error);
    }

    console.log('Signed transaction witness:', witnessResult.data.witnesses);
    txWitnesses.value = witnessResult.data.witnesses;
    return true;
  } catch (e) {
    console.error('Error signing DRep delegation transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : 'Unknown error')
    return false;
  } finally {
    loading.value = false
  }
};

const signLedgerTx = async () => {
  loading.value = true;
  try {
    if (!props.tx) {
      throw new Error('No transaction to sign');
    }
    txCbor.value = serializeCardanoJsSdkTx(props.tx);
    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      props.tx,
      keys.value,
      utxos.value,
      !isBT.value, // isUsb flag (inverted from isBT)
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
    );
    const transactionWitnessSet: Serialization.TransactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({
      signatures,
    })
    console.log('[LEDGER-SIGN] signing successful:', transactionWitnessSet.toCbor());
    txWitnesses.value = transactionWitnessSet.toCbor();
    return true;
  } catch (e) {
    ledgerUtils.ledgerErrorHandling(e)
    return false;
  } finally {
    loading.value = false;
  }
};

const submitTx = async () => {
  try {
    loading.value = true
    console.log('Submitting Cardano JS SDK DRep delegation transaction');
    const submitResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SUBMIT_TX,
      data: {
        txCbor: txCbor.value,
        witnessHex: txWitnesses.value,
        utxos: utxos.value
      }
    }) as { data: { txId?: string; error?: string } };

    if (submitResult.data.error) {
      throw new Error(submitResult.data.error);
    }

    snackbar.fireSuccess(`DRep Delegation Tx Submitted Successfully. Tx ID: ${submitResult.data.txId}`)
    emit('close')
  } catch (e) {
    console.error('Error submitting DRep delegation transaction:', e);
    snackbar.setError(e instanceof Error ? e.message : 'Unknown error')
  } finally {
    loading.value = false
  }
};

const signAndSubmitDelegationTx = async () => {
  if (loggedWallet.value?.type === WalletType.Normal) {
    if (form.value?.validate()) {
      if (!isSubmit.value) {
        // Sign the transaction
        const success = await signTx();
        if (!success) {
          return;
        }
        if (config.value?.txAutoSubmit) {
          await submitTx();
        } else {
          isSubmit.value = true;
        }
      } else {
        // Submit the transaction
        await submitTx();
      }
    }
  } else if (loggedWallet.value?.type === WalletType.Keystone) {
    // TODO: Keystone hardware wallet support needs reimplementation with Cardano JS SDK
    snackbar.setError('Keystone wallet support is coming soon for DRep delegation');
  } else if (loggedWallet.value?.type === WalletType.Ledger) {
    if (!isSubmit.value) {
      const success = await signLedgerTx();
      if (!success) {
        return;
      }
      if (config.value?.txAutoSubmit) {
        await submitTx();
      } else {
        isSubmit.value = true;
      }
    } else {
      await submitTx();
    }
  }
};

const fallbackImage = (e: any) => {
  e.target.src = assets.errorImage
};

watch(() => props.isOpen, (val) => {
  if (val) {
    spendingPassword.value = ''
    showPassword.value = false
    isSubmit.value = false
    if (form.value) {
      form.value.resetValidation()
    }
  }
});

watch(spendingPassword, () => {
  passwordRules.value = [
    rules.required()
  ]
});
</script>
<style scoped>

</style>
