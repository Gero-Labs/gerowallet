<template>
  <v-dialog content-class="rounded-xxl dialogStyle" v-model="dialogLocal" scrollable
            max-width="850"
            min-height="742"
            :persistent="persistent"
  >
    <v-card
        class="py-0 rounded-xxl transparent fill-height"
    >
      <v-stepper
          v-model="step"
          flat
          style="background-color: transparent; height:100%"
          non-linear
      >
        <v-stepper-header style="box-shadow: none">
          <v-stepper-step
              :complete="step > 1"
              step="1"
              editable
          >
            Recovery Phrase
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
              :complete="step > 2"
              step="2"
              editable
          >
            Wallet Setup
          </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <v-stepper-content step="1" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form" v-model="valid">
              <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 534px; min-height: 591px">
                <v-card-text class="px-0 pb-0 justify-space-around no-gutters">
                  <v-alert
                      color="primary"
                      dense
                      outlined
                      type="info"
                      prominent
                      border="left"
                      class="mb-2"
                  >
                    Enter your wallet recovery phrase word for word.<br>Make sure you enter the words in the correct order.
                    Also ensure nobody is looking at your screen.
                  </v-alert>
                  <v-row no-gutters class="pb-2">
                    <strong style="align-content: center; color: white">Choose recovery phrase length</strong>
                    <v-spacer></v-spacer>
                    <v-btn-toggle color="primary" v-model="seedPhraseLength" mandatory>
                      <v-btn small value="12">
                        <v-icon style="right: -5px;">mdi-numeric-1</v-icon>
                        <v-icon style="left: -5px;">mdi-numeric-2</v-icon>
                      </v-btn>
                      <v-btn small value="15">
                        <v-icon style="right: -5px;">mdi-numeric-1</v-icon>
                        <v-icon style="left: -5px;">mdi-numeric-5</v-icon>
                      </v-btn>
                      <v-btn small value="24">
                        <v-icon style="right: -5px;">mdi-numeric-2</v-icon>
                        <v-icon style="left: -5px;">mdi-numeric-4</v-icon>
                      </v-btn>
                    </v-btn-toggle>
                  </v-row>
                  <v-card flat outlined class="mb-4 pa-1" style="background-color: black">
                    <v-row no-gutters>
                      <v-col class="pa-1" cols="12" :md="4" v-for="index in recoverySeedPhraseLength" :key="index">
                        <mnemonic-autocomplete v-model="recoverySeedPhrase[index-1]" :index="index"></mnemonic-autocomplete>
                      </v-col>
                    </v-row>
                  </v-card>
                </v-card-text>
                <v-card-actions class="pa-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn
                      color="primary"
                      @click="walletCreationStep1"
                      elevation="0"
                      :disabled="!valid"
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
            {{seedToStr}}
          </v-stepper-content>

          <v-stepper-content step="2" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form2" v-model="valid2">
              <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 534px; min-height: 591px">
                <v-card-text class="px-0 d-flex row justify-space-around no-gutters">
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your wallet name</h2>
                  <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">Choose a name to help you identify your wallet.
                  </h3>
                  <v-text-field
                      style="width: 100%"
                      v-model="newWallet.name"
                      dense
                      filled
                      label="Wallet Name"
                      placeholder="e.g. My New Wallet"
                      :rules="[rules.required, rules.minCharacters(3), rules.maxCharacters(40)]"
                  ></v-text-field>
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Wallet Icon</h2>
                  <v-radio-group v-model="newWallet.icon" row mandatory class="no-gutters mt-2 mb-2" hide-details>
                    <v-radio value="green">
                      <template v-slot:label>
                        <v-avatar size="32"  >
                          <v-img :src="require('@/assets/svg/green.svg')" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="purple">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="require('@/assets/svg/purple.svg')" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="pink">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="require('@/assets/svg/pink.svg')" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="orange">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="require('@/assets/svg/orange.svg')" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="blue">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="require('@/assets/svg/blue.svg')" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="grey">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="require('@/assets/svg/grey.svg')" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                  </v-radio-group>
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your spending password</h2>
                  <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">You'll use this to log into your wallet and make transactions.
                  </h3>
                  <v-text-field
                      style="width: 100%"
                      block
                      dense
                      v-model="newWallet.password"
                      filled label="Spending Password"
                      :type="show1 ? 'text' : 'password'"
                      :append-icon="show1 ? 'mdi-eye' : 'mdi-eye-off'"
                      @click:append="show1 = !show1"
                      :rules="[rules.required, rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter]"
                  ></v-text-field>
                  <v-text-field
                      style="width: 100%"
                      dense
                      v-model="newWallet.confirmPassword"
                      filled
                      label="Confirm Password"
                      :type="show2 ? 'text' : 'password'"
                      :append-icon="show2 ? 'mdi-eye' : 'mdi-eye-off'"
                      @click:append="show2 = !show2"
                      :rules="[rules.required, (newWallet.password === newWallet.confirmPassword) || 'Password must match']"
                  ></v-text-field>
                  <v-checkbox
                      style="width: 100%"
                      class="mt-0 text-left"
                      hide-details
                      v-model="newWallet.recoverPasswordChecked"
                      label="I understand that GeroWallet cannot recover this password for me."
                      :rules="[(newWallet.recoverPasswordChecked)]"
                  ></v-checkbox>
                  <v-checkbox
                      style="width: 100%"
                      class="mt-0 mb-2"
                      hide-details
                      v-model="newWallet.termsChecked"
                      :rules="[(newWallet.termsChecked)]"
                  >
                    <template v-slot:label>
                      <div>
                        I have read and agree to the
                        <a @click.stop href="https://gerowallet.io/assets/downloads/UserAgreement.pdf" target="_blank">Terms of Service</a>.
                      </div>
                    </template>
                  </v-checkbox>
                </v-card-text>
                <v-card-actions class="px-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn
                      text
                      @click="step = 1"
                      elevation="0"
                  >
                    Back
                  </v-btn>
                  <v-btn
                      color="primary"
                      @click="walletCreationStep2"
                      elevation="0"
                      :disabled="!valid2"
                      :loading="creatingWalletLoader"
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>
        </v-stepper-items>
      </v-stepper>
    </v-card>
  </v-dialog>
</template>
<script>
import * as bip39 from "bip39";
import rules from "@/plugins/rules";
import {WalletType, Theme, Blockchain, Network} from "@/models/types"
import db from "@/db";
import { useStore } from "@/store";
import MnemonicAutocomplete from "@/modules/welcome/components/MnemonicAutocomplete.vue";

export default {
  name: "RestoreWallet",
  components: {MnemonicAutocomplete},
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    seedToStr() {
      return this.computedRecoverySeedPhrase.join(' ')
    },
    computedRecoverySeedPhrase() {
      return this.recoverySeedPhrase.filter((item, index) => item && index < this.recoverySeedPhraseLength)
    },
    recoverySeedPhraseLength() {
      return Number(this.seedPhraseLength)
    },
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        this.$emit('dialogChange', value)
      },
    },
    valid: {
      get() {
        return this.computedRecoverySeedPhrase.length === Number(this.seedPhraseLength) && bip39.validateMnemonic(this.computedRecoverySeedPhrase.join(' '))
      },
      set(value) {}
    },
  },
  methods: {
    walletCreationStep1() {
      if (this.$refs.form.validate()) {
        this.step = 2
        this.persistent = true
      }
    },
    async walletCreationStep2() {
      if (this.$refs.form2.validate()) {
        this.creatingWalletLoader = true
        try {
          const network = this.store.getNetwork
          const walletId = await db.createNewWallet(this.newWallet.name, this.newWallet.icon, Theme.GERO, this.seedToStr, this.newWallet.password, network.blockchain, network.network)
          await this.store.login(walletId)
          this.dialogLocal = false
          this.resetDialog()
          await this.$router.push('/')
          this.creatingWalletLoader = false
        } catch (e) {
          console.log(e)
          this.creatingWalletLoader = false
        }
      }
    },
    resetDialog() {
      this.newWallet = {
        name: '',
        password: '',
        confirmPassword: '',
        termsChecked: false,
        recoverPasswordChecked: false,
        recoverSeedChecked: false,
      }
      this.valid2 = false
      this.creatingWalletLoader = false
      this.recoverySeedPhrase = undefined
      this.persistent = false
    }
  },
  data: () => ({
    rules,
    db,
    step: 1,
    show1: false,
    show2: false,
    newWallet: {
      name: '',
      icon: '',
      password: '',
      confirmPassword: '',
      termsChecked: false,
      recoverPasswordChecked: false,
      recoverSeedChecked: false,
    },
    valid2: false,
    creatingWalletLoader: false,
    persistent: false,
    store: useStore(),
    seedPhraseLength: '24',
    recoverySeedPhrase: ['','','','','','','','','','','','','','','','','','','','','','','',''],
  })
}
</script>
<style>
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}
</style>