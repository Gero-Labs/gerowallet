<template>
  <v-card flat class="summary-step transparent">
    <!-- From wallet -->
    <div class="summary-section">
      <div class="section-label">{{ $t('wallet.from') }}</div>
      <div class="from-wallet">
        <v-avatar size="28" color="#161B26">
          <v-icon size="18" color="#00DFF3">mdi-wallet-outline</v-icon>
        </v-avatar>
        <span class="wallet-name">{{ loggedWallet?.name || '' }}</span>
      </div>
    </div>

    <div class="flow-arrow">
      <v-icon color="rgba(255,255,255,0.4)" size="20">mdi-arrow-down-thin</v-icon>
    </div>

    <!-- Recipients -->
    <div
      v-for="(r, idx) in recipients"
      :key="r.id"
      class="summary-section"
    >
      <div
        v-if="recipients.length > 1"
        class="recipient-label"
      >
        {{ $t('wallet.recipient') }} {{ idx + 1 }}
      </div>
      <DappAddress
        :address="r.resolvedAddress || r.address"
        :risk="idx === 0 ? risks && risks.addressRisk : undefined"
      />
    </div>

    <div class="flow-arrow">
      <v-icon color="rgba(255,255,255,0.4)" size="20">mdi-arrow-down-thin</v-icon>
    </div>

    <!-- You're giving -->
    <div class="summary-section">
      <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true">
        {{ $t('wallet.youreGiving') }}
        <v-tooltip bottom content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
              mdi-information-outline
            </v-icon>
          </template>
          <div>
            <span v-if="loggedWallet">{{ networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network) }} {{ $t('common.andOrTokensShownHere') }}<br></span>
            <span style="color: #FF7777">{{ $t('common.sentFromYourWallet') }}<br></span>
            <span>{{ $t('common.toTheAddressListedAbove') }}<br /><br />{{ $t('common.onceSignedIrreversible') }}</span>
          </div>
        </v-tooltip>
      </TransactionCard>
    </div>

    <!-- Transaction Risk -->
    <div class="summary-section risk-section">
      <TransactionRisk :risk="risks?.score" :loading="loading" />
    </div>

    <!-- Copy CBOR -->
    <div v-if="tx" class="summary-section cbor-section">
      <CopyButton x-small :value="getCborHex()" :title="t('wallet.copyCBOR')"></CopyButton>
    </div>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { toRefs, computed, ref } from 'vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import networks from '@/utils/networks';
import cardanoShieldApi from '@/api/cardano-shield-api';
import CopyButton from '@/shared/components/CopyButton.vue';
import { walletStore } from '@/stores/walletStore';
import { Cardano } from '@cardano-sdk/core';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';

const { t } = useTranslation();

import type { SendRecipient } from '@/models/send-flow.types';

interface Props {
  recipients: SendRecipient[];
  txData?: Cardano.Tx;
}

const props = defineProps<Props>();
defineExpose({
  scanTx,
});
const loading = ref<boolean>(false);
const tx = ref<Cardano.Tx | undefined>(undefined);
const risks = ref<{ score?: unknown; addressRisk?: string }>({
  score: undefined
});

const { loggedWallet, utxos } = toRefs(walletStore);

const changeAddress = computed(() => {
  return loggedWallet.value?.baseAddress;
});

const primaryRecipientAddress = computed(() =>
  props.recipients[0]?.resolvedAddress ?? props.recipients[0]?.address ?? ''
);

const recipient = computed(() => {
  if (tx.value && tx.value.body.outputs) {
    for (const output of tx.value.body.outputs) {
      const outputAddress = output.address;
      if (changeAddress.value !== outputAddress) {
        return outputAddress;
      }
    }
  }
  return changeAddress.value;
});

const swapDetails = computed(() => {
  if (!tx.value || !utxos.value || utxos.value.length === 0) {
    return null;
  }

  const txBody = tx.value.body;

  // Calculate input value from UTXOs
  let inputCoins = BigInt(0);
  const inputAssets = new Map<Cardano.AssetId, bigint>();

  for (const input of txBody.inputs) {
    const utxo = utxos.value.find((utxo: Cardano.Utxo) =>
      input.txId === utxo[0].txId && input.index === utxo[0].index
    );
    if (utxo) {
      inputCoins += BigInt(utxo[1].value.coins);
      if (utxo[1].value.assets) {
        Object.entries(utxo[1].value.assets).forEach(([assetId, amount]) => {
          const currentAmount = inputAssets.get(assetId) || BigInt(0);
          inputAssets.set(assetId, currentAmount + BigInt(amount));
        });
      }
    }
  }

  // Calculate change output value (what stays in our wallet)
  let changeCoins = BigInt(0);
  const changeAssets = new Map<Cardano.AssetId, bigint>();

  for (const output of txBody.outputs) {
    if (output.address === changeAddress.value) {
      changeCoins += BigInt(output.value.coins);
      if (output.value.assets) {
        output.value.assets.forEach((amount, assetId) => {
          const currentAmount = changeAssets.get(assetId) || BigInt(0);
          changeAssets.set(assetId, currentAmount + BigInt(amount));
        });
      }
    }
  }

  // Calculate what we're giving away (input - change - fee)
  const fee = BigInt(txBody.fee);
  const giveCoins = inputCoins - changeCoins - fee;

  const giveAssets: Array<{amount: string, currency: string, id: string}> = [];
  inputAssets.forEach((inputAmount, assetId) => {
    const changeAmount = changeAssets.get(assetId) || BigInt(0);
    const giveAmount = inputAmount - changeAmount;
    if (giveAmount > BigInt(0)) {
      giveAssets.push({
        amount: giveAmount.toString(),
        currency: assetId,
        id: assetId
      });
    }
  });

  const swapDetails = {
    give: {
      total: Number(giveCoins),
      txFee: fee.toString(),
      provider: networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
      assets: giveAssets,
    },
    receive: {
      total: 0, // For send transactions, we don't receive anything
      provider: networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
      assets: [],
    },
    recipient: recipient.value,
    txMetadata: tx.value.auxiliaryData,
  };

  console.log('SwapDetails (Cardano JS SDK):', swapDetails);
  return swapDetails;
})

// Helper function to get CBOR hex from Cardano.Tx
const getCborHex = (): string => {
  if (!tx.value) return '';
  try {
    return serializeCardanoJsSdkTx(tx.value);
  } catch (error) {
    console.error('Error serializing transaction to CBOR:', error);
    return '';
  }
};

async function scanTx(txData: Cardano.Tx) {
  risks.value.score = undefined;
  loading.value = true;
  tx.value = txData;

  const cborHex = getCborHex();

  // Make Cardano Shield scan non-blocking with 5-second timeout
  // Don't block the UI if the scan is slow or fails
  const toAddress = primaryRecipientAddress.value;
  const scanWithTimeout = Promise.race([
    cardanoShieldApi.scanTx({
      cborHex,
      toAddress,
      fromAddress: changeAddress.value,
      url: 'https://gerowallet.io',
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Cardano Shield scan timeout')), 5000)
    )
  ]);

  try {
    risks.value = await scanWithTimeout;
  } catch (e) {
    console.warn('Cardano Shield scan failed or timed out:', e);
    risks.value = {
      addressRisk: 'unknown',
    };
  } finally {
    // Set loading to false after scan completes (success or failure)
    loading.value = false;
  }
}
</script>

<style scoped>
.summary-step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
}

.summary-section {
  width: 100%;
}

.section-label {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 4px;
}

.from-wallet {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background-color: #161B26;
  border-radius: 10px;
  border: 1px solid #272930;
}

.wallet-name {
  color: white;
  font-size: 14px;
  font-weight: 500;
}

.flow-arrow {
  display: flex;
  justify-content: center;
  padding: 2px 0;
}

.recipient-label {
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-weight: 400;
  margin-bottom: 4px;
}

.risk-section {
  margin-top: 8px;
  text-align: center;
}

.cbor-section {
  display: flex;
  justify-content: center;
}
</style>
