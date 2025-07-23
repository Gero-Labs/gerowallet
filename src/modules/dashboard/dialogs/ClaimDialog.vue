<template>
  <BaseDialog
    :isOpen="show"
    @close="close"
    :title="'Midnight Glacier Drop'"
    :subtitle="'Claim your $NIGHT tokens'"
    :width="650"
    :min-height="600"
    class="claim-dialog"
  >
    <v-card-text class="stepper-background">
      <v-stepper v-model="step" class="elevation-0 transparent-stepper">
        <v-stepper-header>
          <v-stepper-step :complete="step > 1" step="1">
            Verify Claim
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="step > 2" step="2">
            Terms & Conditions
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step :complete="step > 3" step="3">
            Sign & Submit
          </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <!-- Step 1: Verify Claim -->
          <v-stepper-content step="1">
            <div class="py-4">
              <div class="mb-4 text-center">
                <h3 class="text-h6 mb-2 primary--text">Welcome to the Midnight Glacier Drop!</h3>
                <p class="text-body-2 mb-3">
                  We're excited to announce the upcoming free, multi-phase distribution of NIGHT tokens designed to empower a vibrant and diverse community in building the future of the Midnight network together.
                </p>
                <a href="https://www.midnight.gd/" target="_blank" class="primary--text text-decoration-none">
                  <v-icon small color="primary">mdi-open-in-new</v-icon>
                  Read more about Midnight and the Glacier Drop
                </a>
              </div>

              <v-divider class="mb-4"></v-divider>

              <div class="mb-3 text-body-1 d-flex align-center" style="opacity: 0.5; color: #888888;">
                <div>
                  <strong>Verify Claim Eligibility</strong><br>
                  We'll check your allocation and verify your address.
                </div>
                <v-tooltip bottom max-width="300">
                  <template v-slot:activator="{ on, attrs }">
                    <v-icon 
                      v-bind="attrs" 
                      v-on="on" 
                      color="primary" 
                      class="ml-2"
                      small
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  <span>We'll verify your Cardano address has an allocation for the Midnight Glacier Drop and ensure your destination address is eligible to receive NIGHT tokens.</span>
                </v-tooltip>
              </div>
              
              <!-- Single Address Mode -->
              <div v-if="useSameAddress" style="opacity: 0.5;">
                <v-text-field
                  :value="truncateAddress(sourceAddress)"
                  label="Cardano address"
                  hint="Your connected wallet address (used for allocation check and receiving tokens)"
                  persistent-hint
                  outlined
                  readonly
                  disabled
                  class="mb-3"
                >
                </v-text-field>
              </div>

              <!-- Separate Address Mode -->
              <div v-else style="opacity: 0.5;">
                <div class="d-flex align-center mb-2">
                  <span class="text-body-2">Using separate addresses</span>
                  <v-btn 
                    text 
                    x-small 
                    color="primary" 
                    @click="useSameAddressForBoth" 
                    class="ml-2"
                    disabled
                  >
                    Use same address
                  </v-btn>
                </div>
                
                <v-text-field
                  :value="truncateAddress(sourceAddress)"
                  label="Source Cardano address"
                  hint="Your connected wallet address (used to check allocation)"
                  persistent-hint
                  outlined
                  readonly
                  disabled
                  class="mb-3"
                ></v-text-field>

                <v-text-field
                  v-model="destAddress"
                  label="Destination Cardano address"
                  placeholder="addr1..."
                  hint="Address to receive your NIGHT tokens"
                  persistent-hint
                  outlined
                  disabled
                  @input="resetVerification"
                ></v-text-field>
              </div>

              <v-alert
                v-if="verificationError"
                type="error"
                dense
                class="mb-3"
              >
                {{ verificationError }}
              </v-alert>

              <v-alert
                type="warning"
                dense
                outlined
                class="mb-3"
              >
                <div>
                  <strong>Claim functionality coming soon!</strong><br>
                  <span class="text-body-2">The claim process is currently under development. Check back later for updates.</span>
                </div>
              </v-alert>

            </div>

            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn
                disabled
                color="primary"
                style="opacity: 0.5;"
              >
                <v-icon left small>mdi-clock-outline</v-icon>
                Coming Soon
              </v-btn>
            </v-card-actions>
          </v-stepper-content>

          <!-- Step 2: Terms & Conditions -->
          <v-stepper-content step="2">
            <div class="py-4">
              <h3 class="text-h6 mb-3 d-flex align-center">
                Terms & Conditions
                <v-tooltip top max-width="400">
                  <template v-slot:activator="{ on, attrs }">
                    <v-icon 
                      v-bind="attrs" 
                      v-on="on" 
                      color="primary" 
                      class="ml-2"
                      small
                    >
                      mdi-help-circle-outline
                    </v-icon>
                  </template>
                  <span>You must accept the NIGHT token distribution terms to participate in the glacier drop claim process. These terms outline the conditions for receiving and using NIGHT tokens.</span>
                </v-tooltip>
              </h3>
              
              <div class="mb-4 text-body-1">
                <strong>NIGHT Token Distribution Agreement</strong><br>
                Please review and accept the terms to continue.
              </div>

              <v-card outlined class="mb-4" style="max-height: 200px; overflow-y: auto;">
                <v-card-text class="text-body-2">
                  <p><strong>NIGHT Token Distribution Terms & Conditions</strong></p>
                  <p>By participating in the Midnight Glacier Drop, you acknowledge and agree to the following:</p>
                  <ul>
                    <li>NIGHT tokens are distributed as part of the Midnight blockchain ecosystem</li>
                    <li>Tokens are provided "as-is" without warranty of any kind</li>
                    <li>You are responsible for the security of your destination wallet</li>
                    <li>Claims must be made within the specified timeframe</li>
                    <li>Only one claim per eligible address is permitted</li>
                    <li>The distribution is subject to network availability and processing times</li>
                    <li>You understand the experimental nature of blockchain technology</li>
                  </ul>
                  <p>For complete terms, visit the official Midnight documentation.</p>
                </v-card-text>
              </v-card>

              <v-checkbox
                v-model="acceptedTerms"
                color="primary"
                class="mb-3"
              >
                <template v-slot:label>
                  <div class="text-body-2">
                    I have read and accept the 
                    <a href="https://www.midnight.gd/terms" target="_blank" class="primary--text">
                      NIGHT Token Distribution Terms & Conditions
                    </a>
                  </div>
                </template>
              </v-checkbox>

              <v-alert
                v-if="!acceptedTerms && termsError"
                type="error"
                dense
                class="mb-3"
              >
                You must accept the terms and conditions to continue.
              </v-alert>
            </div>

            <v-card-actions>
              <v-btn text @click="goBackToStep1">Back</v-btn>
              <v-spacer></v-spacer>
              <v-btn
                :disabled="!acceptedTerms"
                color="primary"
                @click="proceedToSubmit"
              >
                Continue
              </v-btn>
            </v-card-actions>
          </v-stepper-content>

          <!-- Step 3: Sign & Submit -->
          <v-stepper-content step="3">
            <div class="py-4">
              <!-- Show success content when claim is successful -->
              <div v-if="claimSuccess">
                <h3 class="text-h6 mb-3">Claim Submitted Successfully!</h3>
                
                <v-alert
                  type="success"
                  dense
                  class="mb-3"
                >
                  <div class="d-flex align-center mb-2">
                    <span>Claim submitted successfully!</span>
                  </div>
                  <div class="mt-2 d-flex align-center">
                    <span class="text-body-2 mr-2">Transaction:</span>
                    <v-tooltip bottom>
                      <template v-slot:activator="{ on, attrs }">
                        <v-btn
                          v-bind="attrs" 
                          v-on="on"
                          :href="'https://cardanoscan.io/transaction/' + claimTxId" 
                          target="_blank"
                          color="primary"
                          small
                          outlined
                        >
                          View on CardanoScan
                          <v-icon small right>mdi-open-in-new</v-icon>
                        </v-btn>
                      </template>
                      <span>View transaction details</span>
                    </v-tooltip>
                  </div>
                </v-alert>

                <!-- What's Next Section -->
                <v-card outlined class="mb-4 whats-next-card">
                  <v-card-title class="text-h6 pb-2">
                    <v-icon left color="primary">mdi-timeline-clock-outline</v-icon>
                    What's Next?
                  </v-card-title>
                  <v-card-text class="pt-0 whats-next-content">
                    <v-timeline dense class="pa-0">
                      <v-timeline-item small color="success">
                        <template v-slot:icon>
                          <span class="timeline-number">1</span>
                        </template>
                        <div class="text-body-2">
                          <strong>Claim Submitted</strong><br>
                          Your claim has been successfully recorded and tokens are allocated
                        </div>
                      </v-timeline-item>
                      <v-timeline-item small color="orange">
                        <template v-slot:icon>
                          <span class="timeline-number">2</span>
                        </template>
                        <div class="text-body-2">
                          <strong>Allocation Thaws (360 days)</strong><br>
                          Tokens unlock in 4 installments of 25% each, starting randomly between days 1-90
                        </div>
                      </v-timeline-item>
                      <v-timeline-item small color="primary">
                        <template v-slot:icon>
                          <span class="timeline-number">3</span>
                        </template>
                        <div class="text-body-2">
                          <strong>Redeem Tokens</strong><br>
                          Transfer thawed tokens to your wallet during the redemption period
                        </div>
                      </v-timeline-item>
                      <v-timeline-item small color="primary">
                        <template v-slot:icon>
                          <span class="timeline-number">4</span>
                        </template>
                        <div class="text-body-2">
                          <strong>Use NIGHT Tokens</strong><br>
                          Participate in the Midnight ecosystem and governance
                        </div>
                      </v-timeline-item>
                    </v-timeline>
                    
                    <v-divider class="my-3"></v-divider>
                    
                    <div class="text-center">
                      <v-btn 
                        color="primary" 
                        outlined 
                        small 
                        href="https://www.midnight.gd/how-to-get-night" 
                        target="_blank"
                      >
                        <v-icon left x-small>mdi-information-outline</v-icon>
                        Learn More About NIGHT
                      </v-btn>
                    </div>
                  </v-card-text>
                </v-card>
              </div>

              <!-- Show claim form when not yet successful -->
              <div v-else>
                <h3 class="text-h6 mb-3">Ready to Claim</h3>
                
                <div class="mb-4 text-body-1">
                  You're about to claim <strong>{{ allocation?.value?.toLocaleString() }} $NIGHT</strong> tokens
                </div>

                <v-alert
                  v-if="claimError"
                  type="error"
                  dense
                  class="mb-3"
                >
                  {{ claimError }}
                </v-alert>

                <v-expansion-panels v-if="messageToSign" class="mb-3" flat>
                  <v-expansion-panel>
                    <v-expansion-panel-header class="text-body-2 py-2 expansion-header">
                      <div class="d-flex align-center">
                        <v-icon left small>mdi-file-document-outline</v-icon>
                        <span>View message to sign</span>
                      </div>
                    </v-expansion-panel-header>
                    <v-expansion-panel-content>
                      <div class="font-weight-mono text-body-2 pa-3" style="background-color: #0f0f0f; color: #ffffff; border-radius: 4px;">
                        {{ messageToSign }}
                      </div>
                    </v-expansion-panel-content>
                  </v-expansion-panel>
                </v-expansion-panels>

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
            </div>

            <v-card-actions>
              <v-btn v-if="!claimSuccess" text @click="step = 2">Back</v-btn>
              <v-spacer></v-spacer>
              <v-btn
                v-if="claimSuccess"
                color="primary"
                @click="close"
              >
                Done
              </v-btn>
              <v-btn
                v-else
                :disabled="submittingClaim || (loggedWallet?.type === WalletType.Normal && !spendingPassword)"
                :loading="submittingClaim"
                color="primary"
                @click="signAndSubmitClaim"
              >
                Sign & Submit Claim
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
import { walletStore } from '@/stores/walletStore';
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
      useSameAddress: true,
      acceptedTerms: false,
      termsError: false,
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
    loggedWallet() {
      return walletStore.loggedWallet;
    },
    baseAddress() {
      return walletStore.loggedWallet?.baseAddress;
    },
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
      // Auto-populate addresses with user's Cardano address
      if (this.baseAddress) {
        if (!this.sourceAddress) {
          this.sourceAddress = this.baseAddress;
        }
        if (this.useSameAddress) {
          this.destAddress = this.sourceAddress;
        } else if (!this.destAddress) {
          this.destAddress = this.baseAddress;
        }
      }
    },
    useSameAddressForBoth() {
      this.useSameAddress = true;
      this.destAddress = this.sourceAddress;
      this.resetVerification();
    },
    proceedToSubmit() {
      if (!this.acceptedTerms) {
        this.termsError = true;
        return;
      }
      this.termsError = false;
      this.generateMessage();
      this.step = 3;
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
      this.useSameAddress = true;
      this.acceptedTerms = false;
      this.termsError = false;
    },
    resetVerification() {
      this.allocation = null;
      this.verificationError = null;
      this.verificationSuccess = false;
    },
    goBackToStep1() {
      this.step = 1;
      this.resetVerification();
      this.acceptedTerms = false;
      this.termsError = false;
    },
    async verifyClaim() {
      this.verifyingClaim = true;
      this.verificationError = null;
      this.verificationSuccess = false;
      this.allocation = null;
      
      // Set destination address if using same address
      if (this.useSameAddress) {
        this.destAddress = this.sourceAddress;
      }
      
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
    truncateAddress(address) {
      if (!address) return '';
      if (address.length <= 20) return address;
      return `${address.slice(0, 8)}...${address.slice(-8)}`;
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

.claim-dialog .v-dialog {
  height: 600px !important;
  max-height: 600px !important;
}

.claim-dialog .v-card {
  height: 600px !important;
  max-height: 600px !important;
  display: flex !important;
  flex-direction: column !important;
}

.stepper-background {
  background-color: #191919 !important;
  height: 100% !important;
  min-height: 500px !important;
  flex: 1 !important;
  display: flex !important;
  flex-direction: column !important;
}

.transparent-stepper {
  background: transparent !important;
  box-shadow: none !important;
  height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
}

.transparent-stepper .v-stepper__header {
  background: transparent !important;
  box-shadow: none !important;
}

.transparent-stepper .v-stepper__content {
  background: transparent !important;
  min-height: 350px;
  display: flex;
  flex-direction: column;
}

.transparent-stepper .v-stepper__wrapper {
  min-height: 350px;
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

.night-logo {
  height: 1.5em;
  width: auto;
  vertical-align: middle;
  display: inline-block;
}

.v-input--selection-controls .v-input__slot {
  margin-bottom: 0;
}

.v-input--selection-controls .v-input__slot > .v-label {
  margin-bottom: 0;
}

.v-input--selection-controls .v-input--selection-controls__ripple {
  display: none !important;
}

.v-input--selection-controls .v-ripple__container {
  display: none !important;
}

.v-input--checkbox .v-input--selection-controls__ripple {
  display: none !important;
}

.v-input--checkbox .v-ripple__container {
  display: none !important;
}

.v-input--checkbox .v-input__control .v-input__slot::before {
  display: none !important;
}

.v-input--checkbox .v-input__control .v-input__slot:hover::before {
  display: none !important;
}

.whats-next-card {
  border: 2px solid #333 !important;
  background: #0f0f0f !important;
}

.whats-next-card .v-card__title {
  background: transparent !important;
  color: #00dff3 !important;
}

.whats-next-card .v-card-text {
  color: #ffffff !important;
}

.whats-next-content {
  max-height: 200px !important;
  overflow-y: auto !important;
}

.timeline-number {
  background: #00dff3 !important;
  color: #0f0f0f !important;
  border-radius: 50% !important;
  width: 24px !important;
  height: 24px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-weight: bold !important;
  font-size: 0.875rem !important;
  min-width: 24px !important;
  max-width: 24px !important;
  min-height: 24px !important;
  max-height: 24px !important;
}

.whats-next-card .v-timeline-item__dot {
  box-shadow: none !important;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  margin: 0 !important;
  width: 24px !important;
  height: 24px !important;
}

.expansion-header {
  pointer-events: auto !important;
}

.expansion-header .d-flex {
  width: 100%;
  align-items: center;
}

.v-expansion-panel-header {
  min-height: 48px !important;
  padding: 12px 16px !important;
}

.v-expansion-panel-header .v-icon {
  margin-right: 8px !important;
}
</style>