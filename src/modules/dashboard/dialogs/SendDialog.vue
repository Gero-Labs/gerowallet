<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Quick Send"
              subtitle="Send AP3X or other assets to another wallet.">
    <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
      <v-stepper-header>
        <template v-for="(item, index) in steps">
          <div
            class="custom-step"
            :key="item.name"
            :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }"
          >
            <div class="icon-container">
              <v-icon
                class="step-icon"
                :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'"
                size="20"
              >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
              </v-icon
              >
            </div>
            <span class="step-label">{{ item.label }}</span>
          </div>
          <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
               v-if="index < steps.length - 1"></div>
        </template>
      </v-stepper-header>
    </v-stepper>
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <CustomStepper :currentStep="currentStep" :steps="steps">
        <v-stepper-content step="1">
          <SendRecipientDetailsStep
            :sendData="sendData"
            @updateRecipientAddress="updateRecipientAddress"
          ></SendRecipientDetailsStep>
        </v-stepper-content>
        <v-stepper-content step="2">
          <AssetsToSendStep
            v-model="sendData"
            @select="selectCollectible"
          ></AssetsToSendStep>
        </v-stepper-content>
        <v-stepper-content step="3">
          <SummaryStep ref="summary" :sendData="sendData" :tx-data="txData" @next="signAndSubmitTx"
                       @prev="prevStep"></SummaryStep>
        </v-stepper-content>
      </CustomStepper>
    </v-card-text>
    <v-card-actions class="text-center justify-center" style="flex-flow: column;">
      <div class="" v-if="currentStep === 3">
        <v-tooltip
          v-model="tooltip.enabled"
          top
          color="red"
        >
          <template v-slot:activator="{ }">
            <v-text-field
              flat
              style="width: 295px"
              block
              dense
              v-model="spendingPassword"
              outlined
              label="Spending Password"
              :type="show1 ? 'text' : 'password'"
              :rules="[rules.required]"
              hide-details
              class="mb-2"
              required
              :disabled="txSubmitLoading"
            >
              <template v-slot:append>
                <v-icon @click="show1 = !show1" tabindex="-1">
                  {{ show1 ? 'mdi-eye' : 'mdi-eye-off' }}
                </v-icon>
              </template>
            </v-text-field>
          </template>
          <span>{{ tooltip.text }}</span>
        </v-tooltip>
      </div>
      <div>
        <v-btn
          text
          @click="prevStep"
          v-if="this.currentStep > 1"
          class="mr-2"
          :disabled="txSubmitLoading"
        >
          <v-icon small>mdi-arrow-left</v-icon>&nbsp;Back
        </v-btn>
        <v-btn
          class="continue-button"
          @click="nextStep"
          :disabled="!isValid || txSubmitLoading"
          :loading="txSubmitLoading"
        >{{ this.currentStep === 3 ? 'Sign and Confirm ' : 'Continue ' }}
          <v-icon style="color: black!important;" small v-if="currentStep !==3">mdi-arrow-right</v-icon>
        </v-btn>
      </div>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';
import { useStore } from '@/store';
import { mapState } from 'pinia';
import { assetsToValue, toUTxO } from '@/shared/utils/converter';
import { buildTx } from '@/shared/utils/builder';
import rules from '@/shared/utils/rules';
import { Network } from '@/models/types';
import { TransactionOutputs } from '@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib';
import {
  Address, Transaction,
  TransactionOutput,
  TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';

export default {
  name: 'SendDialog',
  components: { BaseDialog, CustomStepper, SendRecipientDetailsStep, AssetsToSendStep, SummaryStep },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'resolvedAssets', 'baseAddress', 'latestTip', 'utxos', 'addresses']),
    isValid() {
      if (this.currentStep === 1) {
        if (this.loggedWallet?.network !== Network.MAINNET) {
          return this.sendData.recipientAddress.startsWith('addr_test1');
        } else {
          return this.sendData.recipientAddress.startsWith('addr1');
        }
      } else if (this.currentStep === 2) {
        let found;
        if (this.sendData.selectedTokens) {
          found = this.sendData.selectedTokens.find(token => !token.quantity || Number(token.quantity) === 0);
        } else if (this.sendData.selectedCollectibles) {
          found = this.sendData.selectedCollectibles.find(collectible => Number(collectible.quantity) === 0);
        }
        return !found;
      } else if (this.currentStep === 3) {
        return !!this.spendingPassword;
      }
      return false;
    },
  },
  watch: {
    isOpen(val) {
      if (val) {
        this.resetData();
      }
    },
  },
  data: () => ({
    steps: [
      {
        name: 'recipientDetails',
        label: 'Recipient Details',
      },
      {
        name: 'assetsToSend',
        label: 'Assets to Send',
      },
      {
        name: 'summary',
        label: 'Summary',
      },
    ],
    currentStep: 1,
    tooltip: {
      enabled: false,
      text: 'Wrong Spending Password!',
    },
    txBody: undefined,
    txData: undefined,
    txSubmitLoading: false,
    spendingPassword: '',
    show1: false,
    rules,
    sendData: {
      selectedTokens: [
        {
          name: 'Cardano',
          ticker: 'ADA',
          img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAXgAAAFbCAYAAADfpZU+AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFGmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0NDYwLCAyMDIwLzA1LzEyLTE2OjA0OjE3ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMiAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjAtMDUtMjJUMTI6MTM6MDgrMDE6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDIwLTA2LTI5VDExOjI0OjExKzAxOjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDIwLTA2LTI5VDExOjI0OjExKzAxOjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgcGhvdG9zaG9wOklDQ1Byb2ZpbGU9InNSR0IgSUVDNjE5NjYtMi4xIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOmNkNjBjZWM1LTFlMmYt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',
          quantity: '0',
          balance: 0,
          decimals: 6,
        },
      ],
      selectedCollectibles: [],
      recipientAddress: '',
      selectedWallet: {},
    },
  }),
  methods: {
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    async signAndSubmitTx() {
      const wallet = useStore().getWallet;
      if (wallet.verifySpendingPassword(this.spendingPassword)) {
        const witness = await wallet.signTx(
          this.txData.to_hex(),
          false,
          this.spendingPassword,
          0,
          this.utxos,
          this.addresses,
        );
        const signedTx = Transaction.new(
          this.txBody,
          TransactionWitnessSet.from_bytes(Buffer.from(witness.witnesses, "hex")),
          undefined // TODO Transaction metadata
        );
        try {
          this.txSubmitLoading = true
          console.log(signedTx)
          await this.sleep(3000); // sleep for 3 seconds
          // const response = await wallet.submitTx(signedTx.to_hex().toString());
          // console.log(response)
          this.txSubmitLoading = false
          this.$emit('close')
        } catch (e) {
          console.log(e)
          this.txSubmitLoading = false
        }
      } else {
        this.enableToolTip()
      }
    },
    buildTx() {
      const recipientAddress = this.sendData.recipientAddress;
      const tokens = [];
      if (this.sendData.selectedTokens.length > 0) {
        this.sendData.selectedTokens.forEach(token => {
          if (token.ticker === 'ADA') {
            tokens.push({
              unit: 'lovelace',
              quantity: (Number(token.quantity) * Math.pow(10, token.decimals)).toString(),
            });
          } else {
            tokens.push({
              unit: token.unit,
              quantity: (Number(token.quantity) * Math.pow(10, token.decimals)).toString(),
            });
          }
        });
      }
      if (this.sendData.selectedCollectibles.length > 0) {
        this.sendData.selectedCollectibles.forEach(collectible => {
          tokens.push({
            unit: collectible.unit,
            quantity: collectible.quantity.toString(),
          });
        });
      }
      const outputs = TransactionOutputs.new();
      outputs.add(TransactionOutput.new(Address.from_bech32(recipientAddress), assetsToValue(tokens)));
      const transactionUnspentOutputs = TransactionUnspentOutputs.new();
      this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
      try {
        this.txBody = buildTx(this.sendData.selectedWallet, outputs, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, [], []);
        this.txData = Transaction.new(this.txBody, TransactionWitnessSet.new())
        this.$refs.summary.scanTx(this.txData);
        if (this.currentStep < this.steps.length) {
          this.currentStep++;
        }
      } catch (e) {
        console.log(e);
      }
    },
    nextStep() {
      if (this.currentStep <= this.steps.length) {
        if (this.currentStep === 1) {
          this.currentStep++;
        } else if (this.currentStep === 2) {
          this.buildTx();
        } else if (this.currentStep === 3) {
          this.signAndSubmitTx();
        }
      }
    },
    prevStep() {
      if (this.currentStep > 1) {
        this.currentStep--;
      }
    },
    updateRecipientAddress(address) {
      this.sendData.recipientAddress = address;
    },
    selectCollectible(collectible) {
      if (this.sendData.selectedCollectibles[collectible.name]) {
        this.$delete(this.sendData.selectedCollectibles, collectible.name);
      } else {
        this.$set(this.sendData.selectedCollectibles, collectible.name, collectible);
      }
    },
    resetData() {
      this.currentStep = 1;
      this.txSubmitLoading = false
      this.txBody = undefined
      this.txData = undefined
      this.sendData = {
        selectedTokens: [
          {
            name: 'Cardano',
            ticker: 'ADA',
            img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAXgAAAFbCAYAAADfpZU+AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFGmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0NDYwLCAyMDIwLzA1LzEyLTE2OjA0OjE3ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMiAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjAtMDUtMjJUMTI6MTM6MDgrMDE6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDIwLTA2LTI5VDExOjI0OjExKzAxOjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDIwLTA2LTI5VDExOjI0OjExKzAxOjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgcGhvdG9zaG9wOklDQ1Byb2ZpbGU9InNSR0IgSUVDNjE5NjYtMi4xIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOmNkNjBjZWM1LTFlMmYt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',
            quantity: '0',
            balance: 0,
            decimals: 6,
          },
        ],
        selectedCollectibles: [],
        recipientAddress: '',
        selectedWallet: this.loggedWallet,
      };
      const adaAssetFound = this.resolvedAssets.find(asset => asset.name === 'ADA');
      if (adaAssetFound) {
        this.sendData.selectedTokens.find(token => token.ticker === 'ADA').balance = adaAssetFound.quantity;
      }
    },
  },
  mounted() {
    const adaAssetFound = this.resolvedAssets.find(asset => asset.name === 'ADA');
    if (adaAssetFound) {
      this.sendData.selectedTokens.find(token => token.ticker === 'ADA').balance = adaAssetFound.quantity;
    }
  },
};
</script>

<style scoped>
.titles {
  align-items: center;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.arrow-left {
  cursor: pointer;
  position: absolute;
  top: 10px;
  left: 10px;
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black !important;
  }

}

.stepper-container {
  background-color: transparent;

  & .v-stepper__header {
    box-shadow: none;
  }

  .custom-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    padding: 5px;
    width: 150px;

    &.active .icon-container {
      box-shadow: 0 0 0 5px #00dff327;
    }

    &.next .icon-container {
      background-color: #292929;
    }

    .icon-container {
      background-color: #00dff3;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 24px;
      width: 24px;
      padding-left: 1px;
    }
  }

  .step-label {
    margin-top: 10px;
    font-size: 14px;
    line-height: 20px;
    text-align: center;
    font-weight: 600;
    color: #CECFD2;
  }

  .divider {
    flex: 1;
    height: 2px;
    width: 100%;
    margin-left: -75px;
    margin-right: -75px;
    margin-top: 16px;
    background-color: #292929;

    &.active-divider {
      background-color: #00dff3;
    }
  }
}
</style>
