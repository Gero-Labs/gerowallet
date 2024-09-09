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
            Wallet Setup
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
                                    sm="4"
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
                                            :disabled="!item.enabled"
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
                                          <v-card-subtitle v-if="!item.enabled">
                                            <v-chip color="red">Soon</v-chip>
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
                      @click="nextStep"
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
                  <img v-if="walletType === WalletType.Ledger" :src="require('@/assets/svg/connect_ledger.svg')" alt="Connect Ledger">
                  <img v-if="walletType === WalletType.Trezor" :src="require('@/assets/svg/connect_trezor.svg')" alt="Connect Trezor">
                  <img v-if="walletType === WalletType.Keystone && !keystoneScan" :src="require('@/assets/svg/connect_keystone.svg')" style="width: 230px; height: 126px" alt="Connect Keystone">
                  <v-alert
                      color="white"
                      dense
                      outlined
                      type="info"
                      prominent
                      border="left"
                  >
                    <b>Instructions</b>
                    <div v-if="walletType === WalletType.Ledger">
                      <ul class="text-left" style="line-height: 1.5" >
                        <li>Setup your {{walletType}} hardware wallet if it's new.</li>
                        <li>Install the Cardano app on your {{walletType}} if you haven't already.</li>
                        <li>Unlock the hardware wallet by entering your pin code on the device.</li>
                        <li>Open the Cardano app on the hardware wallet.</li>
                      </ul>
                    </div>
                    <div v-else-if="walletType === WalletType.Keystone && !keystoneScan">
                      <ul class="text-left" style="line-height: 1.5">
                        <li>Unlock your Keystone device.</li>
                        <li>Select the option to scan a QR code. <v-icon small>mdi-line-scan</v-icon></li>
                        <li>Use your Keystone device to scan the QR code.</li>
                        <li>Approve on the Keystone device and then click 'Next' to scan it with Gero.</li>
                      </ul>
                    </div>
                    <div v-else-if="walletType === WalletType.Keystone && keystoneScan">
                      <ul class="text-left" style="line-height: 1.5">
                        <li>Adjust the distance and, if needed, tap on the Keystone QR code to enhance scanning</li>
                        <li>Use a low density setting for animated QR codes if required.</li>
                      </ul>
                    </div>
                  </v-alert>
                  <div style="display: flex;" v-if="walletType === WalletType.Ledger">
                    <USBBluetoothSwitch v-model="isBluetooth" />
                  </div>
                  <div id="qr-code" ref="qrCode" v-else-if="walletType === WalletType.Keystone && !keystoneScan"> </div>
                  <div class="qr-scanner" v-else-if="walletType === WalletType.Keystone && keystoneScan">
                    <QrcodeStream @decode="onDecode" @init="onInit">
                      <div id="qr-shaded-region" style="position: absolute; border-width: 74px 163px; border-style: solid; border-color: rgba(0, 0, 0, 0.48); box-sizing: border-box; inset: 0;">
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; left: 0;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; top: -5px; right: 0;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; left: 0;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 40px; height: 5px; bottom: -5px; right: 0;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; left: -5px;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; left: -5px;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; top: -5px; right: -5px;"></div>
                        <div style="position: absolute; background-color: rgb(255, 255, 255); width: 5px; height: 45px; bottom: -5px; right: -5px;"></div>
                      </div>
                    </QrcodeStream>
                  </div>
                </v-card-text>
                <v-card-actions class="px-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn
                      text
                      @click="backToStepOne"
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
              <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 534px; min-height: 591px" :disabled="creatingWalletLoader">
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
                      :disabled="creatingWalletLoader"
                  ></v-text-field>
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Wallet Icon</h2>
                  <v-radio-group v-model="newWallet.icon" row mandatory class="no-gutters mt-2 mb-2" hide-details :disabled="creatingWalletLoader">
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
                      :disabled="!valid3 || creatingWalletLoader"
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
import { QrcodeStream } from "vue-qrcode-reader";
import rules from "@/shared/utils/rules";
import { Blockchain, Network, purpose, Theme, WalletType } from '@/models/types';
import db from "@/db";
import ledger from "@/shared/utils/ledger";
import hardwareLoading from "@/plugins/hardwareLoading";
import { getKeystonePublicKeyUR, parseMultiAccounts } from '@/shared/utils/keystone';
import { mapActions } from 'pinia';
import { useStore } from '@/store';
import QRCodeStyling from 'qr-code-styling';
import Vue from 'vue';
import { Bip32PublicKey } from '@emurgo/cardano-serialization-lib-browser';
import snackbar from '@/plugins/snackbar';
import USBBluetoothSwitch from '@/shared/components/USBBluetoothSwitch.vue';

export default {
  name: "PairHardwareWallet",
  components: {
    USBBluetoothSwitch,
    QrcodeStream,
  },
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    WalletType() {
      return WalletType
    },
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
        if (!value) {
          this.resetDialog()
        }
      },
    },
  },
  methods: {
    ...mapActions(useStore, ['login']),
    onDecode(result) {
      const multiAccounts = parseMultiAccounts(result);
      this.newWallet.name = multiAccounts.device
      this.newWallet.publicKey = Bip32PublicKey.from_hex(multiAccounts.keys[0].publicKey + multiAccounts.keys[0].chainCode).to_bech32();
      snackbar.fireSuccess("Keystone QR code successfully scanned.")
      this.step++;
      this.keystoneScan = false
    },
    onInit(promise) {
      promise.then(() => {
          console.log("Camera initialized successfully");
        })
        .catch((error) => {
          console.error("Camera initialization failed:", error);
        });
    },
    nextStep() {
      if (this.walletType === WalletType.Keystone) {
        if (this.qrCode) {
          this.qrCode = null; // Clear the QRCode instance
          // Clear the QR Code container content
          if (this.$refs.qrCode)
            this.$refs.qrCode.innerHTML = '';
        }

        this.qrCode = new QRCodeStyling(getKeystonePublicKeyUR(purpose.hdwallet, 0));
        Vue.nextTick(() => {
          this.qrCode.append(this.$refs.qrCode);
        });
      }
      this.step++
    },
    backToStepOne() {
      this.step = 1
      this.keystoneScan = false
    },
    async walletCreationStep2() {
      if (this.walletType === WalletType.Ledger) {
        console.log('ledger')
        this.persistent = true
        this.hardwareLoading.setText("Please follow the instructions in the Cardano app on<br>your "+this.walletType+" device to complete the pairing process.")
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
        } catch (e) {
          console.log(e)
        }
      } else if (this.walletType === WalletType.Keystone) {
        this.keystoneScan = true
        if (this.qrCode) {
          this.qrCode = null; // Clear the QRCode instance
          // Clear the QR Code container content
          if (this.$refs.qrCode)
            this.$refs.qrCode.innerHTML = '';

        }
        //TODO
      }
      this.hardwareLoading.setLoading(false)
      this.persistent = false
    },
    async walletCreationStep3() {
      if (this.$refs.form3.validate()) {
        this.creatingWalletLoader = true
        const walletId = await db.createNewHardwareWallet(this.newWallet.name, this.newWallet.icon, this.walletType, Theme.GERO, Blockchain.CARDANO, Network.MAINNET, this.newWallet.publicKey)
        this.dialogLocal = false
        this.resetDialog()
        await this.login(walletId)
        await this.$router.push('/')
        this.creatingWalletLoader = false
      }
    },
    resetDialog() {
      this.step = 1
      this.walletType = undefined
      if (this.qrCode) {
        this.qrCode = null;
        if (this.$refs.qrCode)
          this.$refs.qrCode.innerHTML = '';
      }
      this.newWallet = {
        name: '',
        termsChecked: false,
      }
      this.valid2 = false
      this.valid3 = false
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
      {
        name: 'Ledger',
        description: 'The Ledger cryptocurrency hardware wallet made by Ledger, a company headquartered in Paris, France.',
        enabled: true,
        icon: require('@/assets/ledger.svg'),
        support: 'Nano S, Nano S Plus, Nano X'
      },
      {
        name: 'Trezor',
        description: 'Trezor comes from SatoshiLabs, based in the Czech Republic.',
        enabled: false,
        icon: require('@/assets/trezor.svg'),
        support: 'Model T, Safe 3'
      },
      {
        name: 'Keystone',
        description: 'A Hong Kong-based firm provides a completely air-gapped, open-source QR code communication hardware wallet featuring a 4-inch touchscreen and a fingerprint scanner.',
        enabled: true,
        icon: require('@/assets/svg/keystone-3-pro.svg'),
        support: '3 Pro'
      },
    ],
    walletType: undefined,
    isBluetooth: false,
    isQrCode: false,
    hardwareLoading,
    persistent: false,
    qrCode: undefined,
    keystoneScan: false,
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
#qr-code > svg {
  border-radius: 10px;
}
.qr-scanner {
  height: 334px;
  text-align: center;
  border: 1px solid white;
  border-radius: 4px;
  width: 100%;
}

.qrcode-stream-camera {
  border-radius: 4px !important;
}

.overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  color: white;
  font-size: 1.5em;
}

.qr-result {
  margin-top: 20px;
}
</style>
