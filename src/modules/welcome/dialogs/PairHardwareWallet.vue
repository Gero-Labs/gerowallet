<template>
  <v-dialog content-class="rounded-xxl dialogStyle" v-model="dialogLocal" :persistent="persistent" scrollable max-width="850">
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
            Type
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
              :complete="step > 2"
              step="2"
          >
            Pairing
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step step="3">
            Confirm Phrase
          </v-stepper-step>
        </v-stepper-header>

        <v-stepper-items>
          <v-stepper-content step="1" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form" v-model="valid" style="padding-top: 12px; padding-bottom: 12px">
              <v-card flat class="transparent d-flex row fill-height" style="max-width: 526px; min-height: 591px">
                <v-card-text class="px-0 d-flex row justify-space-around mt-2">
                  <v-row
                      align="center"
                      justify="center"
                      no-gutters
                  >
                    <v-col>
                        <v-card flat class="fill-height transparent">
                          <v-alert
                              color="primary"
                              dense
                              outlined
                              type="info"
                              prominent
                              border="left"
                          >
                            Hardware wallets, a type of cold wallet, provide one of the most secure ways to keep cryptocurrencies. They work by storing your private keys in an external, physical device (usually a USB or Bluetooth device)
                          </v-alert>
                          <v-card-title class="justify-center" style="font-weight: 700; word-break: break-word">
                            What Type of Hardware Wallet Would You Like to Connect With?
                          </v-card-title>
                          <v-card-text class="text-center">
                            <v-item-group v-model="walletType" active-class="primary" class="pb-10">
                              <v-row no-gutters>
                                <v-col
                                    v-for="(item) in walletTypes"
                                    :key="item.name"
                                    cols="12"
                                    sm="6"
                                    xs="12"
                                    class="pa-2"
                                >
                                  <v-item v-slot="{ active, toggle }" :value="item.name">
                                    <v-hover>
                                      <template v-slot:default="{ hover }">
                                        <v-card
                                            flat
                                            height="150"
                                            class="justify-center text-center pa-4 shadow"
                                            :style="$vuetify.theme.isDark ? { backgroundColor: '#00000080', alignContent: 'center' } : { backgroundColor: '#ffffff80', alignContent: 'center'}"
                                            @click="toggle"
                                        >
                                          <div style="height: 90px; align-content: center;" >
                                            <img
                                                :src="$vuetify.theme.isDark ? item.icon : item.dark"
                                                style="margin: auto; width: 130px; filter: invert(100%) sepia(20%) saturate(2%) hue-rotate(213deg) brightness(112%) contrast(101%);"
                                                :alt="item.name"
                                            />
                                          </div>

                                          <v-card-subtitle class="pa-0">
                                            {{ item.support }}
                                          </v-card-subtitle>
                                          <v-scroll-y-transition>
                                            <v-icon color="white" style="position: absolute; right: 10px; bottom: 10px;" v-if="active">
                                              mdi-check-circle-outline
                                            </v-icon>
                                          </v-scroll-y-transition>
                                          <v-overlay
                                              v-if="hover"
                                              absolute
                                              color="#ffffff"
                                          >
                                          </v-overlay>

                                        </v-card>
                                      </template>
                                    </v-hover>
                                  </v-item>
                                </v-col>
                              </v-row>
                            </v-item-group>
                          </v-card-text>
                        </v-card>
                    </v-col>
                  </v-row>
                </v-card-text>
                <v-card-actions class="px-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn
                      color="primary"
                      @click="step = 2"
                      elevation="0"
                      :disabled="!valid"
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>

          <v-stepper-content step="2" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form" v-model="valid2" style="padding-top: 12px; padding-bottom: 12px">
              <v-card flat class="transparent d-flex row fill-height" style="max-width: 526px; min-height: 591px">
                <v-card-text class="px-0 d-flex row no-gutters justify-space-around mt-2">
                  <img v-if="walletType === 'Ledger'" :src="require('@/assets/svg/connect_ledger.svg')" alt="Connect Ledger">
                  <img v-if="walletType === 'Trezor'" :src="require('@/assets/svg/connect_trezor.svg')" alt="Connect Trezor">
                  <v-alert
                      color="white"
                      dense
                      outlined
                      type="info"
                      prominent
                      border="left"
                  >
                    <b>Instructions</b>
                    <ul class="text-left" style="line-height: 1.5">
                      <li>Setup your Ledger hardware wallet if it's new.</li>
                      <li>Install the Cardano app on your Ledger if you haven't already.</li>
                      <li>Unlock the hardware wallet by entering your pin code on the device.</li>
                      <li>Open the Cardano app on the hardware wallet.</li>
                    </ul>
                  </v-alert>
                  <div style="display: flex;">
                    <p class="mr-5 my-auto">USB <v-icon :color="isBluetooth ? '#ffffff' : 'primary'" small>mdi-usb</v-icon></p>
                    <v-switch
                        inset
                        dense
                        v-model="isBluetooth"
                        color="inherit"
                        hide-details
                        style="margin-top: 0; align-items: center;"
                        class="usbBluetoothSwitch"
                    ></v-switch>
                    <p class="my-auto"><v-icon :color="isBluetooth ? 'primary' : '#ffffff'" small>mdi-bluetooth</v-icon> Bluetooth</p>
                  </div>
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
                  >
                    Continue
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>
          <v-stepper-content step="3" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form3" v-model="valid3">
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
                      :loading="creatingWalletLoader"
                      color="primary"
                      @click="walletCreationStep3"
                      elevation="0"
                      :disabled="!valid3"
                      class=""
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
    <v-overlay v-show="hardwareLoading.loading" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="require('@/assets/output.webm')" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
        </video>
        <v-progress-linear
            buffer-value="0"
            color="primary"
            reverse
            stream
            value="0"
            style="color: cyan; width: 100px; text-align: center"
        ></v-progress-linear>
        <v-card-title v-if="hardwareLoading.text" v-html="hardwareLoading.text">
        </v-card-title>
      </v-card>

    </v-overlay>
  </v-dialog>
</template>
<script>
import rules from "@/plugins/rules";
import {Blockchain, Network, Theme} from "@/models/types"
import db from "@/db";
import ledger from "@/shared/utils/ledger";
import hardwareLoading from "@/plugins/hardwareLoading";
import {useStore} from "@/store";

export default {
  name: "PairHardwareWallet",
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    valid: {
      get() {
        return this.walletType !== undefined
      },
      set(val) {}
    },
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        this.$emit('dialogChange', value)
      },
    },
  },
  methods: {
    async walletCreationStep2() {
      console.log('ledger')
      this.persistent = true
      this.hardwareLoading.setText("Please follow the directions in the Cardano app on<br>your Ledger device to complete the pairing process.")
      this.hardwareLoading.setLoading(true)
      try {
        const coldWalletProps = await ledger.initLedger(this.isBluetooth)
        console.log(coldWalletProps)
        const isConnected = !!coldWalletProps
        if (isConnected) {
          this.newWallet.name = coldWalletProps.productName
          this.newWallet.publicKey = coldWalletProps.hwPublicKey
          this.step = 3
        }
        this.hardwareLoading.setLoading(false)
        this.persistent = false
      } catch (e) {
        this.hardwareLoading.setLoading(false)
        this.persistent = false
      }
    },
    async walletCreationStep3() {
      if (this.$refs.form3.validate()) {
        this.creatingWalletLoader = true
        const walletId = await db.createNewHardwareWallet(this.newWallet.name, this.newWallet.icon, this.walletType, Theme.GERO, Blockchain.CARDANO, Network.MAINNET, this.newWallet.publicKey)
        await this.store.login(walletId)
        this.dialogLocal = false
        this.resetDialog()
        await this.$router.push('/')
        this.creatingWalletLoader = false
      }
    },
    resetDialog() {
      this.newWallet = {
        name: '',
        termsChecked: false,
      }
      this.valid2 = false
      this.valid3 = false,
      this.creatingWalletLoader = false
    }
  },
  data: () => ({
    rules,
    db,
    step: 1,
    newWallet: {
      name: '',
      icon: '',
      publicKey: '',
      termsChecked: false,
    },
    valid2: false,
    valid3: false,
    creatingWalletLoader: false,
    walletTypes: [
      {name: 'Ledger', description: 'The Ledger cryptocurrency hardware wallet made by Ledger, a company headquartered in Paris, France.', enabled: true, icon: require('@/assets/ledger.svg'), support: 'Nano S, Nano S Plus, Nano X'},
      {name: 'Trezor', description: 'Trezor comes from SatoshiLabs, based in the Czech Republic.', enabled: true, icon: require('@/assets/trezor.svg'), support: 'Model T, Safe 3' },
    ],
    walletType: undefined,
    isBluetooth: false,
    hardwareLoading,
    persistent: false,
    store: useStore()
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
.usbBluetoothSwitch .v-input--switch__track {
  color: #ffffff2b !important;
  opacity: 1;
  border: 1px solid #ffffff12;
}
.usbBluetoothSwitch .v-input--switch__thumb {
  color: #2f9cac!important;
}
</style>