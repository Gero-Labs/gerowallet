<template>
  <v-card flat class="transparent">
    <v-row no-gutters>
      <v-col cols="6">
        <v-card flat class="transparent">
          <v-card-title class="text-left">
            <Select
              :value="sendData.selectedWallet"
              :items="[sendData.selectedWallet]"
              :label="t('wallet.from')"
              :readonly="true"
            ></Select>
          </v-card-title>
          <v-card-text>
            <v-icon>mdi-arrow-down-thin</v-icon>
            <DappAddress class="mb-4" :address="sendData.recipientAddress" :risk="risks?.addressRisk" :with-bg="false" />
            <v-icon>mdi-arrow-down-thin</v-icon>
            <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true" :with-bg="false">
              {{ $t('wallet.youreGiving') }}
              <v-tooltip bottom>
                <template v-slot:activator="{ on, attrs }">
                  <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                    mdi-information-outline
                  </v-icon>
                </template>
                <div>
                  <span v-if="loggedWallet">{{networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network)}} {{ $t('common.andOrTokensShownHere') }}<br></span>
                  <span style="color: #FF7777">{{ $t('common.sentFromYourWallet') }}<br></span>
                  <span> {{ $t('common.toTheAddressListedAbove') }}<br /><br />{{ $t('common.onceSignedIrreversible') }}</span>
                </div>
              </v-tooltip>
            </TransactionCard>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" style="align-content: center">
        <TransactionRisk class="pb-8" :risk="risks?.score" :loading="loading" />
        <div style="flex-flow: row; display: flex; justify-content: center;">
          <CopyButton v-if="tx" x-small :value="getCborHex()" :title="t('wallet.copyCBOR')"></CopyButton>
        </div>
      </v-col>
    </v-row>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { toRefs, computed, ref } from 'vue';
import Select from '@/shared/components/Select.vue';
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

interface Props {
  sendData: any;
  txData?: Cardano.Tx;
}

const props = defineProps<Props>();
defineExpose({
  scanTx,
});
const loading = ref<boolean>(false);
const tx = ref<Cardano.Tx | undefined>(undefined);
const risks = ref<any>({
  score: undefined
});

const { loggedWallet, utxos } = toRefs(walletStore);

const changeAddress = computed(() => {
  return loggedWallet.value?.baseAddress;
});

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
  const scanWithTimeout = Promise.race([
    cardanoShieldApi.scanTx({
      cborHex,
      toAddress: props.sendData.recipientAddress,
      fromAddress: changeAddress.value,
      url: 'https://gerowallet.io',
    }),
    new Promise<any>((_, reject) =>
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
.recipient-box {
  display: flex;
  gap: 10px;
  padding: 10px;
  word-break: break-all;
  font-size: 12px;
  background: linear-gradient(to right, #005d65, #0000003d);
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black!important;

  &:disabled {
    opacity: 0.5;
    color: black!important;
  }

}

.v-tooltip__content {
  background: rgba(15, 19, 21, 1);
  border:1px solid #C4C4C4;
  line-height: 18px;
  padding: 10px;
  font-size: 14px;
}
.v-tooltip__content.menuable__content__active {
  opacity: 1;
}
</style>
