<template>
  <v-dialog content-class="rounded-xxl dialogStyle" v-model="dialogLocal" scrollable max-width="850" :persistent="persistent">
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
          >
            Wallet Creation
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
              :complete="step > 2"
              step="2"
          >
            Seed Phrase
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
              step="3"
          >
            Confirm Phrase
          </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <v-stepper-content step="1" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form" v-model="valid">
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
                      color="primary"
                      @click="walletCreationStep1"
                      elevation="0"
                      :disabled="!valid"
                      class=""
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>

          <v-stepper-content step="2" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form2" v-model="valid2">
              <v-card flat class="transparent" style="max-width: 534px; min-height: 591px">
                <v-card-text class="px-0">
                  <v-alert
                      color="primary"
                      dense
                      outlined
                      type="info"
                      prominent
                      border="left"
                  >
                    Write down or copy these words in the following order.<br>You will need
                    these to back up and restore your wallet.
                  </v-alert>
                  <v-hover v-slot="{ hover }">
                    <v-card flat outlined class="mb-4"
                            :style="overlay ? {backgroundColor: 'black'} : {backgroundColor: 'transparent'}">
                      <v-row no-gutters>
                        <v-col class="pa-2" cols="12" md="3" sm="4" v-for="(item,index) in seedPhrase" :key="index">
                          <v-chip color="#5553" large style="width: 100%; height: 30px"><span
                              style="color: #2f9cac">{{ (index + 1) + '.' }}</span>&nbsp;&nbsp;{{ item }}
                          </v-chip>
                        </v-col>
                      </v-row>
                      <v-overlay
                          :absolute="true"
                          :opacity="hover ? 0.4 : 1"
                          :style=" hover && overlay ? { backdropFilter: 'blur(6px)' } : {}"
                          color="black"
                          :value="overlay"
                      >
                        <v-btn
                            color="primary"
                            @click="overlay = false"
                        >
                          <v-icon>mdi-key</v-icon>&nbsp;
                          Unlock
                        </v-btn>
                      </v-overlay>
                    </v-card>
                  </v-hover>
                  <v-alert
                      dense
                      type="error"
                      prominent
                      border="left"
                      class="text-left"
                  >
                    Save the seed phrase somewhere safe and never share it with anyone.
                  </v-alert>
                  <v-checkbox
                      class="mt-0"
                      hide-details
                      v-model="newWallet.recoverSeedChecked"
                      label="I understand that if I lose my secret backup phrase, I will not be able to access my funds."
                      :rules="[(newWallet.recoverSeedChecked)]"
                  >
                  </v-checkbox>
                </v-card-text>
                <v-card-actions class="px-0 pt-4">
                  <v-spacer></v-spacer>
                  <v-btn
                      color="primary"
                      @click="walletCreationStep2"
                      elevation="0"
                      :disabled="overlay || !valid2"
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>

          <v-stepper-content step="3" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form" v-model="valid3" style="padding-top: 12px; padding-bottom: 12px">
              <v-card flat class="transparent d-flex row fill-height" style="max-width: 534px; min-height: 591px">
                <v-card-text class="px-0 d-flex row justify-space-around mt-2">
                  <v-card-text class="pa-0">
                    <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Please click on each word in the correct order.</h2>
                    <v-card flat class="mt-3" style="background-color: transparent">
                      <v-row no-gutters>
                        <v-col class="pa-2" cols="12" md="3" sm="3" v-for="(item,index) in seedPhraseReplaced" :key="index">
                          <v-chip :color="item.state ? '#2f9cac' : '#5553'" class="justify-center" large style="width: 100%; height: 30px" @click="fillNext(index)" :disabled="!item.state">
                            <span :style="!item.state ? {color: '#515151'} : {color: 'inherit'}">{{ item.word }}</span>
                          </v-chip>
                        </v-col>
                      </v-row>
                    </v-card>
                  </v-card-text>
                  <v-card flat outlined class="mb-4" style="background-color: transparent">
                    <v-row no-gutters>
                      <v-col class="pa-2 px-1" cols="12" md="3" sm="4" v-for="(item,index) in seedPhraseToConfirm" :key="index">
                        <div style="display: flex; line-height: 2.14">
                          <span style="color: #2f9cac; min-width: 22px">
                            {{ (index + 1) }}&nbsp;
                          </span>
                          <v-chip v-if="typeof item === 'object'" color="#2f9cac" style="width: 100%; height: 30px" @click="removeWord(item, index)">
                            {{ item.word }}
                          </v-chip>
                          <v-chip  v-else :color="isNextToFill(index) ? '#898989' : '#5553'" large :outlined="item === ''" style="width: 100%; height: 30px">
                            {{ item }}
                          </v-chip>
                        </div>
                      </v-col>
                    </v-row>
                  </v-card>
                  <div style="width: 100%" class="text-right">
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text plain @click="reset">
                      <v-icon small>
                        mdi-reload
                      </v-icon>
                      Reset
                    </v-btn>
                  </div>
                </v-card-text>
                <v-card-actions class="px-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn
                      color="primary"
                      @click="walletCreationStep3"
                      elevation="0"
                      :disabled="!valid3 || creatingWalletLoader"
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
import {Theme} from "@/models/types"
import db from "@/db";
import { useStore } from "@/store";

export default {
  name: "CreateWallet",
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        this.$emit('dialogChange', value)
      },
    },
    valid3: {
      get() {
        return this.seedPhraseToConfirm && this.seedPhraseToConfirm.indexOf("") === -1 && bip39.validateMnemonic(this.seedToStr())
      },
      set(value) {}
    },
  },
  methods: {
    isNextToFill(index) {
      return index === this.seedPhraseToConfirm.indexOf("")
    },
    fillNext(index) {
      this.seedPhraseToConfirm[this.seedPhraseToConfirm.indexOf("")] = this.seedPhraseReplaced[index]
      this.seedPhraseReplaced[index].state = false
      this.seedPhraseToConfirm = JSON.parse(JSON.stringify(this.seedPhraseToConfirm))
    },
    removeWord(item, index) {
      this.seedPhraseToConfirm[index] = ''
      item.state = false
      const found = this.seedPhraseReplaced.find(value => value.word === item.word)
      found.state = true
    },
    reset() {
      this.seedPhraseToConfirm = this.seedPhraseToConfirm.map(value => {
        if (typeof value === 'object') {
          const found = this.seedPhraseReplaced.find(val => val.word === value.word)
          found.state = true
          return ''
        }
        return value
      })
    },
    walletCreationStep1() {
      if (this.$refs.form.validate()) {
        this.seedPhrase = bip39.generateMnemonic(256).split(" ");
        [this.seedPhraseToConfirm, this.seedPhraseReplaced] = this.randomReplace(this.seedPhrase, 4);
        this.step = 2
        this.persistent = true
      }
    },
    walletCreationStep2() {
      if (this.$refs.form2.validate()) {
        this.step = 3
        this.seedPhrase = null
      }
    },
    async walletCreationStep3() {
      this.creatingWalletLoader = true
      const network = this.store.getNetwork
      const walletId = await db.createNewWallet(this.newWallet.name, this.newWallet.icon, Theme.GERO, this.seedToStr(), this.newWallet.password, network.blockchain, network.network)
      await this.store.login(walletId)
      this.dialogLocal = false
      this.resetDialog()
      await this.$router.push('/')
    },
    randomReplace(array, count) {
      const replaced = [];
      const indices = new Set();
      do {
        indices.add(Math.floor(Math.random() * array.length));
      } while (indices.size < count)
      const res = array.map((v, i) => {
        if (indices.has(i)) {
          replaced.push({ word: v, state: true })
          return ''
        }
        return v
      });
      return [res, this.shuffleArray(replaced)]
    },
    shuffleArray(array) {
      let len = array.length,
          currentIndex;
      for (currentIndex = len - 1; currentIndex > 0; currentIndex--) {
        let randIndex = Math.floor(Math.random() * (currentIndex + 1) );
        const temp = array[currentIndex];
        array[currentIndex] = array[randIndex];
        array[randIndex] = temp;
      }
      return array
    },
    seedToStr() {
      let str = ''
      this.seedPhraseToConfirm.forEach(value => {
        if (typeof value === 'object') {
          str += value.word
        } else {
          str += value
        }
        str += ' '
      })
      return str.substring(0, str.length-1)
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
      this.valid = false
      this.valid2 = false
      this.creatingWalletLoader = false
      this.seedPhrase = undefined
      this.seedPhraseToConfirm = undefined
      this.seedPhraseReplaced = undefined
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
    valid: false,
    valid2: false,
    creatingWalletLoader: false,
    seedPhrase: undefined,
    seedPhraseToConfirm: undefined,
    seedPhraseReplaced: undefined,
    overlay: true,
    opacity: 0.8,
    persistent: false,
    store: useStore()
  }),
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