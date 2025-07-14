<template>
  <BaseDialog
    :isOpen="show"
    @close="close"
    :title="'Midnight Glacier Drop'"
    :subtitle="'Claim your $NIGHT tokens'"
    :width="600"
    :min-height="400"
  >
    <v-card-text class="stepper-background">
      <v-stepper v-model="step" class="elevation-0 transparent-stepper">
        <v-stepper-header>
          <v-stepper-step :complete="step > 1" step="1">
            Verify Claim
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="step > 2" step="2">
            Sign & Submit
          </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <!-- Step 1: Verify Claim -->
          <v-stepper-content step="1">
            <div class="py-4">
              <div class="mb-3 text-body-1">
                <strong>Verify Claim Eligibility</strong><br>
                We'll check your allocation and verify your destination address.
              </div>
              
              <v-text-field
                v-model="sourceAddress"
                label="Source Cardano address"
                placeholder="addr1..."
                hint="Auto-populated from your wallet"
                persistent-hint
                outlined
                class="mb-3"
                @input="resetVerification"
              ></v-text-field>

              <v-text-field
                v-model="destAddress"
                label="Destination Cardano address"
                placeholder="addr1..."
                hint="Where you want to receive your $NIGHT tokens"
                persistent-hint
                outlined
                @input="resetVerification"
              ></v-text-field>

              <v-alert
                v-if="verificationError"
                type="error"
                dense
                class="mb-3"
              >
                {{ verificationError }}
              </v-alert>

              <v-alert
                v-if="verificationSuccess"
                type="success"
                dense
                class="mb-3"
              >
                <div class="d-flex align-center">
                  <v-icon left>mdi-check-circle</v-icon>
                  <div>
                    <strong>Claim verified!</strong><br>
                    You can claim <strong>{{ allocation?.value?.toLocaleString() }} $NIGHT</strong> tokens to your destination address
                  </div>
                </div>
              </v-alert>
            </div>

            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn
                :disabled="!sourceAddress || !destAddress || verifyingClaim"
                :loading="verifyingClaim"
                color="primary"
                @click="verifyClaim"
              >
                Verify Claim
              </v-btn>
            </v-card-actions>
          </v-stepper-content>

          <!-- Step 2: Sign & Submit -->
          <v-stepper-content step="2">
            <div class="py-4">
              <h3 class="text-h6 mb-3">Ready to Claim</h3>
              
              <v-alert type="info" dense class="mb-3">
                <div class="d-flex align-center">
                  <v-icon left color="primary">mdi-coin</v-icon>
                  <div>
                    <strong>{{ allocation?.value?.toLocaleString() }} $NIGHT</strong> tokens
                  </div>
                </div>
              </v-alert>

              <v-alert
                v-if="claimError"
                type="error"
                dense
                class="mb-3"
              >
                {{ claimError }}
              </v-alert>

              <v-alert
                v-if="claimSuccess"
                type="success"
                dense
                class="mb-3"
              >
                <div class="d-flex align-center mb-2">
                  <v-icon left>mdi-check-circle</v-icon>
                  <span>Claim submitted successfully!</span>
                </div>
                <div class="mt-2">
                  <strong>Transaction ID:</strong><br>
                  <a 
                    :href="'https://cardanoscan.io/transaction/' + claimTxId" 
                    target="_blank" 
                    class="tx-link"
                  >
                    {{ claimTxId }}
                  </a>
                </div>
              </v-alert>

              <div v-if="messageToSign" class="mb-3">
                <v-card outlined>
                  <v-card-subtitle>Message to sign:</v-card-subtitle>
                  <v-card-text class="font-weight-mono">{{ messageToSign }}</v-card-text>
                </v-card>
              </div>

              <v-tooltip
                v-model="passwordTooltip.enabled"
                top
                color="red"
                v-if="loggedWallet?.type === WalletType.Normal"
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
                    :type="showPassword ? 'text' : 'password'"
                    :rules="[rules.required()]"
                    hide-details
                    class="mb-2"
                    required
                    :disabled="submittingClaim"
                    @keydown.enter.prevent="signAndSubmitClaim"
                  >
                    <template v-slot:append>
                      <v-icon @click="showPassword = !showPassword" tabindex="-1">
                        {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                      </v-icon>
                    </template>
                  </v-text-field>
                </template>
                <span>{{ passwordTooltip.text }}</span>
              </v-tooltip>
            </div>

            <v-card-actions>
              <v-btn text @click="step = 1">Back</v-btn>
              <v-spacer></v-spacer>
              <v-btn
                :disabled="submittingClaim || claimSuccess || (loggedWallet?.type === WalletType.Normal && !spendingPassword)"
                :loading="submittingClaim"
                color="primary"
                @click="signAndSubmitClaim"
              >
                {{ claimSuccess ? 'Claim Submitted' : 'Sign & Submit Claim' }}
              </v-btn>
            </v-card-actions>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card-text>
  </BaseDialog>
</template>

<script>
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { Api } from '@/api/api';
import { useStore } from '@/stores';
import { mapState } from 'pinia';
import { WalletType } from '@/models/types';
import rules from '@/utils/rules';

export default {
  name: 'ClaimDialog',
  components: {
    BaseDialog
  },
  props: {
    show: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      step: 1,
      sourceAddress: '',
      destAddress: '',
      allocation: null,
      verificationError: null,
      verificationSuccess: false,
      verifyingClaim: false,
      messageToSign: null,
      claimError: null,
      claimSuccess: false,
      claimTxId: null,
      submittingClaim: false,
      spendingPassword: '',
      showPassword: false,
      passwordTooltip: {
        enabled: false,
        text: 'Wrong Spending Password!'
      },
      termsHash: '6bf2adf825baa496729e2eac1e895ebc77973744bce67f44276bf6006f5c21de863ed121e11828d8fc0241773191e26dc1134803a681a9a98ba0ae812553db24',
      WalletType,
      rules
    };
  },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'baseAddress']),
    api() {
      return new Api(this.loggedWallet, 'BLOCKFROST');
    }
  },
  watch: {
    show(newVal) {
      console.log('ClaimDialog show prop changed to:', newVal);
      if (newVal) {
        this.populateWalletAddresses();
      }
    }
  },
  methods: {
    populateWalletAddresses() {
      // Auto-populate both addresses with user's Cardano address
      if (this.baseAddress) {
        if (!this.destAddress) {
          this.destAddress = this.baseAddress;
        }
        if (!this.sourceAddress) {
          this.sourceAddress = this.baseAddress;
        }
      }
    },
    close() {
      this.$emit('close');
      this.resetDialog();
    },
    resetDialog() {
      this.step = 1;
      this.sourceAddress = '';
      this.destAddress = '';
      this.allocation = null;
      this.verificationError = null;
      this.verificationSuccess = false;
      this.messageToSign = null;
      this.claimError = null;
      this.claimSuccess = false;
      this.claimTxId = null;
      this.spendingPassword = '';
      this.showPassword = false;
      this.passwordTooltip.enabled = false;
    },
    resetVerification() {
      this.allocation = null;
      this.verificationError = null;
      this.verificationSuccess = false;
    },
    async verifyClaim() {
      this.verifyingClaim = true;
      this.verificationError = null;
      this.verificationSuccess = false;
      
      try {
        // Simulate API call delay for both allocation and freshness check
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Mock different responses based on address for testing
        if (this.sourceAddress.includes('test') || this.sourceAddress.includes('demo')) {
          this.verificationError = 'No allocation found for this address';
          return;
        }
        
        if (this.destAddress.includes('used') || this.destAddress.includes('claimed')) {
          this.verificationError = 'This destination address has already been used for a claim';
          return;
        }
        
        // Mock successful verification (both allocation and freshness)
        const mockAllocation = {
          value: 125000, // 125,000 NIGHT tokens
          jitterStratum: 2 // Randomness tier
        };
        
        this.allocation = mockAllocation;
        this.verificationSuccess = true;
        this.generateMessage();
        this.step = 2;
        
      } catch (error) {
        this.verificationError = error.message || 'Failed to verify claim';
      } finally {
        this.verifyingClaim = false;
      }
    },
    generateMessage() {
      if (this.allocation && this.destAddress) {
        this.messageToSign = `STAR ${this.allocation.value} to ${this.destAddress} ${this.termsHash}`;
      }
    },
    async signAndSubmitClaim() {
      this.submittingClaim = true;
      this.claimError = null;
      
      try {
        // Verify spending password if wallet requires it
        if (this.loggedWallet?.type === this.WalletType.Normal) {
          // Mock password verification - replace with actual verification
          if (this.spendingPassword !== 'test') {
            this.enablePasswordTooltip();
            return;
          }
        }
        
        // This would involve signing the message with the appropriate wallet
        // For now, we'll simulate the process
        await this.signMessage();
        await this.submitClaim();
      } catch (error) {
        this.claimError = error.message || 'Failed to submit claim';
      } finally {
        this.submittingClaim = false;
      }
    },
    enablePasswordTooltip() {
      this.passwordTooltip.enabled = true;
      setTimeout(() => {
        this.passwordTooltip.enabled = false;
      }, 3000);
    },
    async signMessage() {
      // Mock signing - replace with actual wallet signing logic
      return new Promise((resolve) => {
        setTimeout(() => {
          // Mock realistic signature format
          const mockSignature = 'a40082825820' + Array(128).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
          resolve(mockSignature);
        }, 2000); // Longer delay to simulate wallet interaction
      });
    },
    async submitClaim() {
      try {
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 2500));
        
        const claimData = {
          address: this.sourceAddress,
          dest_address: this.destAddress,
          signature: 'mock-signature',
          amount: this.allocation.value,
          // Add Cardano-specific fields based on API docs
          cose_key: 'a401022001215820' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
          cose_sign1: '84582aa201276761646472657373' + Array(80).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
        };
        
        // Mock successful claim response based on API docs
        const mockResponse = {
          transaction_id: 'tx_' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
          status: 'submitted',
          message: 'Claim submitted successfully and is being processed'
        };
        
        this.claimSuccess = true;
        this.claimTxId = mockResponse.transaction_id;
        
        // Optionally simulate different outcomes for testing
        if (this.sourceAddress.includes('fail')) {
          throw new Error('Claim submission failed: Invalid signature');
        }
        
      } catch (error) {
        // Mock realistic error scenarios
        const mockErrors = [
          'Claim submission failed: Invalid signature',
          'Claim submission failed: Insufficient allocation',
          'Claim submission failed: Address already used',
          'Claim submission failed: Network congestion, please try again'
        ];
        
        throw new Error(mockErrors[Math.floor(Math.random() * mockErrors.length)]);
      }
    }
  }
};
</script>

<style scoped>
.font-weight-mono {
  font-family: 'Roboto Mono', monospace;
  font-size: 0.875rem;
}

.stepper-background {
  background-color: #191919 !important;
}

.transparent-stepper {
  background: transparent !important;
  box-shadow: none !important;
}

.transparent-stepper .v-stepper__header {
  background: transparent !important;
  box-shadow: none !important;
}

.transparent-stepper .v-stepper__content {
  background: transparent !important;
}

.highlight-address {
  color: #00c7f3 !important;
  font-weight: bold;
}

.address-text {
  word-break: break-all;
  word-wrap: break-word;
  white-space: pre-wrap;
  line-height: 1.4;
  max-width: 100%;
  overflow-wrap: break-word;
  display: block;
}

.tx-link {
  color: #1976d2 !important;
  text-decoration: none;
  word-break: break-all;
  word-wrap: break-word;
  white-space: pre-wrap;
  line-height: 1.4;
  max-width: 100%;
  overflow-wrap: break-word;
  display: block;
  font-family: 'Roboto Mono', monospace;
  font-size: 0.875rem;
}

.tx-link:hover {
  text-decoration: underline;
  color: #0d47a1 !important;
}
</style>