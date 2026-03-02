<template>
  <v-dialog
    content-class="rounded-xxl dialogStyle darken"
    v-model="dialogLocal"
    :persistent="persistent"
    scrollable max-width="850"
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
          >
            {{ $t('welcome.type') }}
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step
            :complete="step > 2"
            step="2"
          >
            {{ $t('welcome.pairing') }}
          </v-stepper-step>
          <v-divider></v-divider>
          <v-stepper-step step="3">
            {{ $t('welcome.walletSetup') }}
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
                          {{ $t('welcome.hardwareWalletDescription') }}
                        </v-alert>
                        <v-card-title class="justify-center" style="font-weight: 700; word-break: break-word">
                          {{ $t('welcome.hardwareWalletType') }}
                        </v-card-title>
                        <v-card-text class="text-center px-0">
                          <v-item-group v-model="walletType" active-class="primary" class="pb-10">
                            <v-row no-gutters>
                              <v-col
                                v-for="(item) in walletTypes"
                                :key="item.name"
                                cols="12"
                                sm="4"
                                xs="12"
                                class="pa-1"
                              >
                                <v-item v-slot="{ active, toggle }" :value="item.name">
                                  <v-hover>
                                    <template v-slot:default="{ hover }">
                                      <v-card
                                        flat
                                        height="150"
                                        class="justify-center text-center pa-4 shadow"
                                        :style="{ backgroundColor: '#00000080', alignContent: 'center' }"
                                        @click="toggle"
                                        :disabled="!item.enabled"
                                      >
                                        <div style="align-content: center;" >
                                          <img
                                            :src="item.icon"
                                            style="margin: auto; width: 130px; height: 50px; filter: invert(100%) sepia(20%) saturate(2%) hue-rotate(213deg) brightness(112%) contrast(101%);"
                                            :alt="item.name"
                                          />
                                        </div>
                                        <v-card-subtitle class="pt-1 pb-1">
                                          {{ item.support }}
                                        </v-card-subtitle>
                                        <v-card-subtitle class="pa-0">
                                          <v-chip color="red" small v-if="!item.enabled">{{ $t('welcome.soon') }}</v-chip>
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
                    {{ $t('welcome.continue') }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>

          <v-stepper-content step="2" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form" v-model="valid2" style="padding-top: 12px; padding-bottom: 12px">
              <v-card flat class="transparent d-flex row fill-height" style="max-width: 526px; min-height: 591px">
                <v-card-text class="px-0 d-flex row no-gutters justify-space-around mt-2">
                  <img
                    v-if="walletType === WalletType.Ledger"
                    :src="assets.connectLedgerSvg"
                    :alt="t('wallet.connectLedger')"
                  >
                  <img
                    v-if="walletType === WalletType.Trezor"
                    :src="assets.connectTrezorSvg"
                    :alt="t('wallet.connectTrezor')"
                  >
                  <img
                    v-if="walletType === WalletType.Keystone && !keystoneScan"
                    :src="assets.connectKeystoneSvg"
                    style="width: 230px; height: 126px"
                    :alt="t('wallet.connectKeystone')">
                  <v-alert
                    color="white"
                    dense
                    outlined
                    type="info"
                    prominent
                    border="left"
                  >
                    <b>{{ $t('welcome.instructions') }}</b>
                    <div v-if="walletType === WalletType.Ledger">
                      <ul class="text-left" style="line-height: 1.5" >
                        <li>{{ $t('welcome.setupHardwareWallet', { walletType }) }}</li>
                        <li>{{ $t('welcome.installCardanoApp', { walletType }) }}</li>
                        <li>{{ $t('welcome.unlockHardwareWallet') }}</li>
                        <li>{{ $t('welcome.openCardanoApp') }}</li>
                      </ul>
                    </div>
                    <div v-if="walletType === WalletType.Trezor">
                      <ul class="text-left" style="line-height: 1.5" >
                        <li>{{ $t('welcome.setupHardwareWallet', { walletType }) }}</li>
                        <li>{{ $t('welcome.installCardanoApp', { walletType }) }}</li>
                        <li>{{ $t('welcome.unlockHardwareWallet') }}</li>
                      </ul>
                    </div>
                    <div v-else-if="walletType === WalletType.Keystone && !keystoneScan">
                      <ul class="text-left" style="line-height: 1.5">
                        <li>{{ $t('welcome.unlockKeystone') }}</li>
                        <li>{{ $t('welcome.selectScanQR') }} <v-icon small>mdi-line-scan</v-icon></li>
                        <li>{{ $t('welcome.scanQRWithKeystone') }}</li>
                        <li>{{ $t('welcome.approveOnKeystone') }}</li>
                      </ul>
                    </div>
                    <div v-else-if="walletType === WalletType.Keystone && keystoneScan">
                      <ul class="text-left" style="line-height: 1.5">
                        <li>{{ $t('welcome.adjustDistance') }}</li>
                        <li>{{ $t('welcome.lowDensitySetting') }}</li>
                      </ul>
                    </div>
                  </v-alert>
                  <div style="display: flex;" v-if="walletType === WalletType.Ledger">
                    <ToggleSwitch
                      :text-left="t('dashboard.usb')"
                      icon-left="mdi-usb"
                      :text-right="t('dashboard.bluetooth')"
                      icon-right="mdi-bluetooth"
                      v-model="isBluetooth"
                    />
                  </div>
                  <div id="qr-code" ref="qrCodeRef" v-else-if="walletType === WalletType.Keystone && !keystoneScan" />
                  <div class="qr-scanner" v-else-if="walletType === WalletType.Keystone && keystoneScan" style="height: 334px; width: 100%">
                    <AnimatedQRScanner
                      purpose="sync"
                      :urTypes="['crypto-multi-accounts']"
                      width="100%"
                      height="334px"
                      @scan="onKeystoneScan"
                      @error="onKeystoneError"
                      @progress="onKeystoneProgress"
                    />
                  </div>
                </v-card-text>
                <v-card-actions class="px-0 align-self-end" style="width: 100%">
                  <v-spacer></v-spacer>
                  <v-btn
                    text
                    @click="backToStepOne"
                    elevation="0"
                  >
                    {{ $t('welcome.back') }}
                  </v-btn>
                  <v-btn
                    color="primary"
                    @click="walletCreationStep2"
                    elevation="0"
                  >
                    {{ $t('welcome.continue') }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-stepper-content>
          <v-stepper-content step="3" style="text-align: -webkit-center;" class="pt-0">
            <v-form ref="form3" v-model="valid3">
              <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 534px; min-height: 591px" :disabled="creatingWalletLoader">
                <v-card-text class="px-0 d-flex row justify-space-around no-gutters">
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.setUpWalletName') }}</h2>
                  <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">{{ $t('welcome.chooseNameToIdentify') }}
                  </h3>
                  <v-text-field
                    style="width: 100%"
                    v-model="newWallet.name"
                    dense
                    filled
                    :label="$t('welcome.walletName')"
                    :placeholder="$t('welcome.walletNamePlaceholder')"
                    :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
                    :disabled="creatingWalletLoader"
                  ></v-text-field>
                  <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">{{ $t('welcome.walletIcon') }}</h2>
                  <v-radio-group v-model="newWallet.icon" row mandatory class="no-gutters mt-2 mb-2" hide-details :disabled="creatingWalletLoader">
                    <v-radio value="green">
                      <template v-slot:label>
                        <v-avatar size="32"  >
                          <v-img :src="assets.greenSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="purple">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="assets.purpleSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="pink">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="assets.pinkSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="orange">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="assets.orangeSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="blue">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="assets.blueSvg" cover></v-img>
                        </v-avatar>
                      </template>
                    </v-radio>
                    <v-radio value="grey">
                      <template v-slot:label>
                        <v-avatar size="32" >
                          <v-img :src="assets.greySvg" cover></v-img>
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
                        {{ $t('welcome.agreeToTerms') }}
                        <a @click.stop href="https://gerowallet.io/legal/terms/" target="_blank">{{ $t('welcome.termsOfService') }}</a>.
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
                    {{ $t('welcome.continue') }}
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
        <video :src="assets.loadingAnimation" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
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
<script setup lang="ts">
import { computed, ref, getCurrentInstance, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import rules from "@/utils/rules";
import { Blockchain, coin_type, purpose, Theme, WalletType } from '@/models/types';
import ledger from "@/shared/utils/ledger";
import hardwareLoading from "@/plugins/hardwareLoading";
import { getKeystonePublicKeyUR } from '@/shared/utils/keystone';
import { CryptoMultiAccounts } from '@keystonehq/bc-ur-registry';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { NetworkInfo } from '@/utils/networks';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { Bip32PublicKey } from '@cardano-sdk/crypto';
import snackbar from '@/plugins/snackbar';
import { bech32 } from 'bech32';

const { t } = useTranslation();

interface Props {
  dialog: boolean;
  network: NetworkInfo;
}

const props = withDefaults(defineProps<Props>(), {
  dialog: false,
});

const emit = defineEmits(['dialogChange']);
const vmProxy = getCurrentInstance()!.proxy
const router = vmProxy.$router;

const step = ref(1);
const newWallet = ref({
  name: '',
  icon: '',
  publicKey: '',
  termsChecked: false,
  keys: [],
  btSupported: false,
  xfp: undefined as string | undefined,
});
const valid2 = ref(false);
const valid3 = ref(false);
const creatingWalletLoader = ref(false);
const walletType = ref(undefined);
const isBluetooth = ref(false);
const persistent = ref(false);
const qrCode = ref(undefined);
const keystoneScan = ref(false);
const qrCodeRef = ref(null);
const form3 = ref(null);

const walletTypes = [
  {
    name: t('wallet.ledger'),
    description: t('wallet.ledgerDescription'),
    enabled: true,
    icon: assets.ledgerLogoSvg,
    support: t('wallet.ledgerSupport')
  },
  {
    name: t('wallet.trezor'),
    description: t('wallet.trezorDescription'),
    enabled: true,
    icon: assets.trezorLogoSvg,
    support: t('wallet.trezorSupport')
  },
  {
    name: t('wallet.keystone'),
    description: t('wallet.keystoneDescription'),
    enabled: true,
    icon: assets.keystoneLogoSvg,
    support: t('wallet.keystoneSupport')
  },
];

const valid = computed({
  get() {
    return walletType.value !== undefined
  },
  set(_val) {}
});

const dialogLocal = computed({
  get() {
    return props.dialog
  },
  set(value) {
    emit('dialogChange', value)
    if (!value) {
      resetDialog()
    }
  },
});

const onKeystoneScan = (ur: { type: string; cbor: string }) => {
  try {
    console.log('[Keystone] QR code scanned:', ur);
    // Convert hex CBOR string to Buffer
    const cborBuffer = Buffer.from(ur.cbor, 'hex');
    // Parse CBOR directly using CryptoMultiAccounts
    const cryptoMultiAccounts = CryptoMultiAccounts.fromCBOR(cborBuffer);
    console.log('[Keystone] Parsed CryptoMultiAccounts:', cryptoMultiAccounts);

    // Extract data using getter methods
    const device = cryptoMultiAccounts.getDevice();
    console.log('[Keystone] Device:', device);
    const version = cryptoMultiAccounts.getVersion();
    console.log('[Keystone] Version:', version);
    const keys = cryptoMultiAccounts.getKeys();
    const masterFingerprint = cryptoMultiAccounts.getMasterFingerprint();

    newWallet.value.name = device;
    newWallet.value.xfp = masterFingerprint.toString('hex');
    const firstKey = keys[0];
    const bip32PublicKey: Bip32PublicKey = Bip32PublicKey.fromHex(
      firstKey.getKey().toString('hex') + firstKey.getChainCode().toString('hex')
    );
    const words = bech32.toWords(bip32PublicKey.bytes());
    newWallet.value.publicKey = bech32.encode('xpub', words, 1023);
    newWallet.value.btSupported = false;
    // Convert CryptoHDKey objects to plain objects for storage
    newWallet.value.keys = keys.map(key => ({
      publicKey: key.getKey().toString('hex'),
      chainCode: key.getChainCode().toString('hex'),
      path: key.getOrigin().getPath()
    }));
    snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
    keystoneScan.value = false;
    step.value = 3;
  } catch (error) {
    console.error('[Keystone] Error processing QR code:', error);
    snackbar.setError(t('wallet.keystoneQRScanError') as string);
  }
};

const onKeystoneError = (error: string) => {
  console.error('[Keystone] Scanner error:', error);
  snackbar.setError(t('wallet.keystoneQRScanError') as string);
};

const onKeystoneProgress = (progress: number) => {
  console.log('[Keystone] Scan progress:', Math.round(progress * 100) + '%');
};

const nextStep = () => {
  if (walletType.value === WalletType.Keystone) {
    if (qrCode.value) {
      qrCode.value = null;
      if (qrCodeRef.value)
        qrCodeRef.value.innerHTML = '';
    }

    qrCode.value = new QRCodeStyling(getKeystonePublicKeyUR(purpose.hdwallet, 0));
    nextTick(() => {
      qrCode.value.append(qrCodeRef.value);
    });
  }
  step.value++
};

const backToStepOne = () => {
  step.value = 1
  keystoneScan.value = false
};

const walletCreationStep2 = async () => {
  if (walletType.value === WalletType.Ledger) {
    persistent.value = true
    hardwareLoading.setText(t('wallet.followHardwareInstructions', { walletType: walletType.value }) as string)
    hardwareLoading.setLoading(true)

    try {
      let path;
      const index = 0
      if (props.network.blockchain === Blockchain.CARDANO) {
        path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/${index}'`
      }
      const coldWalletProps = await ledger.initLedger(isBluetooth.value, path)
      const isConnected = !!coldWalletProps
      if (isConnected) {
        newWallet.value.name = coldWalletProps.productName
        newWallet.value.publicKey = coldWalletProps.hwPublicKey
        newWallet.value.keys = coldWalletProps.keys
        newWallet.value.btSupported = coldWalletProps.btSupported
        step.value = 3
      }
    } catch (e) {
      console.log(e)
    }
  } else if (walletType.value === WalletType.Trezor) {
    persistent.value = true;
    hardwareLoading.setText(t('wallet.followHardwareInstructions', { walletType: walletType.value }) as string)
    hardwareLoading.setLoading(true)
    try {
      hardwareLoading.setText(t('wallet.connectingToTrezor') as string);
      const response: any = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.TREZOR,
        data: { method: 'initTrezor', chain: props.network.blockchain, network: props.network.network },
      })

      console.log('[TREZOR Dialog] Response:', response);

      if (response.data.success && response.data.coldWalletProps) {
        const coldWalletProps = response.data.coldWalletProps;
        newWallet.value.name = coldWalletProps.productName;
        newWallet.value.publicKey = coldWalletProps.hwPublicKey;
        newWallet.value.keys = coldWalletProps.keys;
        newWallet.value.btSupported = coldWalletProps.btSupported;
        step.value = 3;
      } else {
        throw new Error(response.data.error || 'Failed to initialize Trezor');
      }
    } catch (e) {
      console.log(e)
    }
  } else if (walletType.value === WalletType.Keystone) {
    keystoneScan.value = true
    if (qrCode.value) {
      qrCode.value = null;
      if (qrCodeRef.value)
        qrCodeRef.value.innerHTML = '';
    }
  }
  hardwareLoading.setLoading(false)
  persistent.value = false
};

const walletCreationStep3 = async () => {
  try {
    if (form3.value.validate()) {
      creatingWalletLoader.value = true
      const wallet = await GeroStore.createNewHardwareWallet({
        ...newWallet.value,
        type: walletType.value,
        theme: Theme.GERO,
        chain: props.network.blockchain,
        network: props.network.network
      })
      dialogLocal.value = false
      const response: any = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      });

      if (response && !response.error) {
        nextTick(() => {
          resetDialog();
          router.push('/').catch(err => {
            if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
              console.error('Navigation error:', err);
            }
          });
        });
      } else if (response?.error) {
        console.warn('Login response error:', response.error);
        nextTick(() => {
          resetDialog();
          router.push('/').catch(() => {});
        });
      }
    }
  } catch (e: any) {
    console.error('Error creating wallet:', e);
  } finally {
    creatingWalletLoader.value = false
  }
};

const resetDialog = () => {
  step.value = 1
  walletType.value = undefined
  if (qrCode.value) {
    qrCode.value = null;
    if (qrCodeRef.value)
      qrCodeRef.value.innerHTML = '';
  }
  newWallet.value = {
    name: '',
    icon: '',
    publicKey: '',
    termsChecked: false,
    keys: [],
    btSupported: false,
    xfp: '',
  }
  valid2.value = false
  valid3.value = false
  creatingWalletLoader.value = false
}
</script>
<style scoped>
#qr-code > svg {
  border-radius: 10px;
}
.qr-scanner {
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

.v-dialog__content--active {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
</style>
