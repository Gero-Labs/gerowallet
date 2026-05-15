<template>
  <BaseDialog
    :title="t('welcome.pairHardwareWallet')"
    :title-info="t('welcome.hardwareWalletDescription')"
    :subtitle="localNetwork ? localNetwork.title : ''"
    :is-open="props.dialog"
    @close="onClose"
    :persistent="persistent"
    :img="assets.pairSvg"
    :min-height="0"
    :width="600"
  >
    <v-card-text class="px-0 py-2">
      <v-stepper v-model="step" flat class="transparent">
        <v-stepper-items>

          <!-- ============================================ -->
          <!-- STEP 1: Hardware wallet type selection       -->
          <!-- ============================================ -->
          <v-stepper-content step="1" class="pt-0">
            <v-card flat class="transparent d-flex justify-center">
              <div style="max-width: 540px; width: 100%">
                <!-- Network — Mainnets -->
                <div class="step-section-label mb-2">{{ $t('common.selectNetwork') }}</div>
                <div class="network-grid mb-3">
                  <div
                    v-for="net in mainnetNetworks"
                    :key="net.blockchain + net.network"
                    class="network-tile"
                    :class="{ 'network-tile--active': isNetworkSelected(net) }"
                    @click="selectNetwork(net)"
                  >
                    <v-avatar size="22" class="network-tile__icon">
                      <v-img :src="net.icon" contain></v-img>
                    </v-avatar>
                    <span class="network-tile__label">{{ net.title }}</span>
                  </div>
                </div>

                <!-- Testnets — collapsed by default -->
                <div class="testnet-toggle mb-4" @click="showTestnets = !showTestnets">
                  <v-icon size="12" class="mr-1" style="color: inherit;">{{ showTestnets ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
                  <span>{{ $t('welcome.developerNetworks') }}</span>
                  <v-chip v-if="isTestnetSelected" x-small color="warning" class="ml-2" style="height: 14px; font-size: 9px;">{{ localNetwork.currencyTicker }}</v-chip>
                </div>
                <div v-if="showTestnets" class="network-grid mb-4">
                  <div
                    v-for="net in testnetNetworks"
                    :key="net.blockchain + net.network"
                    class="network-tile network-tile--testnet"
                    :class="{ 'network-tile--active': isNetworkSelected(net) }"
                    @click="selectNetwork(net)"
                  >
                    <v-avatar size="16" class="network-tile__icon">
                      <v-img :src="net.icon" contain></v-img>
                    </v-avatar>
                    <span class="network-tile__label">{{ net.title }}</span>
                  </div>
                </div>

                <div class="step-section-label mb-2 mt-4">{{ $t('welcome.hardwareWalletType') }}</div>
                <div class="hw-grid">
                  <div
                    v-for="item in walletTypes"
                    :key="item.name"
                    class="hw-tile"
                    :class="{
                      'hw-tile--active': walletType === item.name,
                      'hw-tile--disabled': !item.enabled
                    }"
                    @click="item.enabled && (walletType = item.name)"
                  >
                    <img
                      :src="item.icon"
                      class="hw-tile__logo"
                      :alt="item.name"
                    />
                    <span class="hw-tile__label">{{ item.name }}</span>
                    <v-chip v-if="!item.enabled" color="red" x-small style="height: 14px; font-size: 9px;">{{ $t('welcome.soon') }}</v-chip>
                  </div>
                </div>
              </div>
            </v-card>
          </v-stepper-content>

          <!-- ============================================ -->
          <!-- STEP 2: Pairing instructions                 -->
          <!-- ============================================ -->
          <v-stepper-content step="2" class="pt-0">
            <v-form ref="form2" v-model="valid2">
              <v-card flat class="transparent d-flex justify-center">
                <div style="max-width: 540px; width: 100%; text-align: -webkit-center;">
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
                    :alt="t('wallet.connectKeystone')"
                  >
                  <v-alert
                    color="white"
                    dense
                    outlined
                    type="info"
                    prominent
                    border="left"
                  >
                    <div v-if="walletType === WalletType.Ledger">
                      <ul class="text-left" style="line-height: 1.5">
                        <li>{{ $t('welcome.setupHardwareWallet', { walletType }) }}</li>
                        <li v-if="isBitcoin">{{ $t('welcome.installBitcoinApp', { walletType }) }}</li>
                        <li v-else>{{ $t('welcome.installCardanoApp', { walletType }) }}</li>
                        <li>{{ $t('welcome.unlockHardwareWallet') }}</li>
                        <li v-if="isBitcoin">{{ $t('welcome.openBitcoinApp') }}</li>
                        <li v-else>{{ $t('welcome.openCardanoApp') }}</li>
                      </ul>
                    </div>
                    <div v-if="walletType === WalletType.Trezor">
                      <ul class="text-left" style="line-height: 1.5">
                        <li>{{ $t('welcome.setupHardwareWallet', { walletType }) }}</li>
                        <li v-if="isBitcoin">{{ $t('welcome.installBitcoinApp', { walletType }) }}</li>
                        <li v-else>{{ $t('welcome.installCardanoApp', { walletType }) }}</li>
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
                  <div style="display: flex; justify-content: center;" v-if="walletType === WalletType.Ledger">
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
                </div>
              </v-card>
            </v-form>
          </v-stepper-content>

          <!-- ============================================ -->
          <!-- STEP 3: Wallet setup summary                 -->
          <!-- ============================================ -->
          <v-stepper-content step="3" class="pt-0">
            <v-form ref="form3" v-model="valid3">
              <v-card flat class="transparent d-flex justify-center" :disabled="creatingWalletLoader">
                <div style="max-width: 540px; width: 100%">
                  <div class="text-center mb-3">
                    <v-icon color="primary" size="28" class="mb-1">mdi-check-circle-outline</v-icon>
                    <h3 class="white--text mb-1 text-h6">{{ $t('welcome.almostDone') }}</h3>
                    <p class="grey--text text--lighten-1 mb-0">{{ $t('welcome.reviewYourChoices') }}</p>
                  </div>

                  <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
                    <v-card-text class="pa-3">
                      <div class="d-flex align-center mb-2">
                        <v-avatar size="32" class="mr-2">
                          <v-img :src="assets[`${newWallet.icon}Svg`]" cover></v-img>
                        </v-avatar>
                        <div>
                          <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.walletName') }}</div>
                          <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ newWallet.name || $t('welcome.walletNamePlaceholder') }}</div>
                        </div>
                      </div>
                      <v-divider class="my-2" style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
                      <v-row no-gutters>
                        <v-col cols="6" class="pr-3">
                          <div class="d-flex align-center">
                            <v-icon color="primary" size="20" class="mr-2">mdi-shield-lock-outline</v-icon>
                            <div>
                              <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.type') }}</div>
                              <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ walletType }}</div>
                            </div>
                          </div>
                        </v-col>
                        <v-divider vertical style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
                        <v-col cols="6" class="pl-3">
                          <div class="d-flex align-center">
                            <v-avatar size="20" class="mr-2">
                              <v-img :src="localNetwork ? localNetwork.icon : ''" contain></v-img>
                            </v-avatar>
                            <div>
                              <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('common.network') }}</div>
                              <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ localNetwork ? localNetwork.title : '' }}</div>
                            </div>
                          </div>
                        </v-col>
                      </v-row>
                    </v-card-text>
                  </v-card>

                  <v-checkbox
                    class="mt-0 mb-2"
                    hide-details
                    v-model="newWallet.termsChecked"
                    :rules="[(newWallet.termsChecked)]"
                    :disabled="creatingWalletLoader"
                  >
                    <template v-slot:label>
                      <span class="text-body-2">
                        {{ $t('welcome.agreeToTerms') }}
                        <a @click.stop href="https://gerowallet.io/legal/terms/" target="_blank">{{ $t('navigation.termsOfService') }}</a>.
                      </span>
                    </template>
                  </v-checkbox>
                </div>
              </v-card>
            </v-form>
          </v-stepper-content>

        </v-stepper-items>
      </v-stepper>
    </v-card-text>

    <!-- Action buttons -->
    <v-card-actions class="justify-space-between px-6 pb-4">
      <!-- Step 1: Continue -->
      <template v-if="step === 1">
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          :disabled="!valid"
          @click="nextStep"
          elevation="0"
        >
          {{ $t('welcome.continue') }}
        </v-btn>
      </template>

      <!-- Step 2: Back + Continue -->
      <template v-else-if="step === 2">
        <v-btn text @click="backToStepOne" elevation="0">
          {{ $t('welcome.back') }}
        </v-btn>
        <v-btn
          color="primary"
          @click="walletCreationStep2"
          elevation="0"
        >
          {{ $t('welcome.continue') }}
        </v-btn>
      </template>

      <!-- Step 3: Create wallet -->
      <template v-else>
        <v-spacer></v-spacer>
        <v-btn
          :loading="creatingWalletLoader"
          color="primary"
          @click="walletCreationStep3"
          elevation="0"
          :disabled="!valid3 || creatingWalletLoader"
        >
          {{ $t('welcome.continue') }}
        </v-btn>
      </template>
    </v-card-actions>

    <!-- Hardware loading overlay -->
    <v-overlay v-show="hardwareLoading.loading" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="assets.loadingAnimation" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;" />
        <v-progress-linear
          buffer-value="0"
          color="primary"
          reverse
          stream
          value="0"
          style="color: cyan; width: 100px; text-align: center"
        />
        <v-card-title v-if="hardwareLoading.text" v-html="hardwareLoading.text" />
      </v-card>
    </v-overlay>
  </BaseDialog>
</template>
<script setup lang="ts">
import { computed, ref, watch, getCurrentInstance, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Blockchain, coin_type, purpose, Theme, WalletType } from '@/models/types';
import ledger from "@/shared/utils/ledger";
import hardwareLoading from "@/plugins/hardwareLoading";
import { getKeystonePublicKeyUR, generateBitcoinSyncQR, parseBitcoinAccount } from '@/shared/utils/keystone';
import { CryptoMultiAccounts } from '@keystonehq/bc-ur-registry';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import networks, { NetworkInfo } from '@/utils/networks';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { Bip32PublicKey } from '@cardano-sdk/crypto';
import snackbar from '@/plugins/snackbar';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { bech32 } from 'bech32';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import { UR } from '@keystonehq/keystone-sdk';

const { t } = useTranslation();

interface Props {
  dialog: boolean;
  network?: NetworkInfo;
}

const props = withDefaults(defineProps<Props>(), {
  dialog: false,
});

const emit = defineEmits(['dialogChange']);
const vmProxy = getCurrentInstance()!.proxy
const router = vmProxy.$router;

// Network selection — exclude chains that don't support hardware wallets (e.g. Midnight)
const allNetworks = networks.networks.filter(n => n.supportedHardware !== false);
const mainnetNetworks = computed(() => allNetworks.filter(n => n.network === 'Mainnet'));
const testnetNetworks = computed(() => allNetworks.filter(n => n.network !== 'Mainnet'));
const isTestnetSelected = computed(() => localNetwork.value?.network !== 'Mainnet');
const showTestnets = ref(props.network?.network !== 'Mainnet' && props.network != null);
const localNetwork = ref<NetworkInfo>(props.network || networks.networks[0]);

const onNetworkChange = (net: NetworkInfo) => {
  newWallet.value.icon = networks.resolveIconColor(net.blockchain, net.network) || 'green';
  updateVuetifyTheme(net.blockchain, true);
};

const isNetworkSelected = (net: NetworkInfo) =>
  localNetwork.value?.blockchain === net.blockchain && localNetwork.value?.network === net.network;

const selectNetwork = (net: NetworkInfo) => {
  localNetwork.value = net;
  onNetworkChange(net);
};

const isBitcoin = computed(() => localNetwork.value?.blockchain === Blockchain.BITCOIN);

const step = ref(1);
const newWallet = ref({
  name: generateWalletName(),
  icon: props.network?.iconColor || networks.networks[0].iconColor || 'green',
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

const onClose = () => {
  emit('dialogChange', false);
  resetDialog();
};

watch(() => localNetwork.value?.iconColor, (color) => {
  newWallet.value.icon = color || 'green';
}, { immediate: true });

const onKeystoneScan = async (ur: { type: string; cbor: string }) => {
  try {
    console.log('[Keystone] QR code scanned:', ur);

    if (localNetwork.value?.blockchain === Blockchain.BITCOIN) {
      // Bitcoin flow - parse crypto-hdkey UR

      const bitcoinUR = UR.from(ur.cbor, 'hex');
      const bitcoinAccount = parseBitcoinAccount(bitcoinUR);

      newWallet.value.xfp = bitcoinAccount.xfp;
      newWallet.value.publicKey = bitcoinAccount.xpub;
      newWallet.value.keys = [{
        publicKey: bitcoinAccount.publicKey,
        chainCode: bitcoinAccount.chainCode,
        path: bitcoinAccount.path
      }];

      snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
      keystoneScan.value = false;
      step.value = 3;
      return;
    }

    // Cardano flow - parse crypto-multi-accounts UR
    const cborBuffer = Buffer.from(ur.cbor, 'hex');
    const cryptoMultiAccounts = CryptoMultiAccounts.fromCBOR(cborBuffer);
    console.log('[Keystone] Parsed CryptoMultiAccounts:', cryptoMultiAccounts);

    const device = cryptoMultiAccounts.getDevice();
    console.log('[Keystone] Device:', device);
    const version = cryptoMultiAccounts.getVersion();
    console.log('[Keystone] Version:', version);
    const keys = cryptoMultiAccounts.getKeys();
    const masterFingerprint = cryptoMultiAccounts.getMasterFingerprint();

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

    // Generate QR code based on blockchain
    let qrOptions;
    if (localNetwork.value?.blockchain === Blockchain.CARDANO) {
      qrOptions = getKeystonePublicKeyUR(purpose.hdwallet, 0);
    } else if (localNetwork.value?.blockchain === Blockchain.BITCOIN) {
      qrOptions = generateBitcoinSyncQR('segwit', 0);
    }

    qrCode.value = new QRCodeStyling(qrOptions);
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
      let coldWalletProps;
      const index = 0;

      if (localNetwork.value?.blockchain === Blockchain.CARDANO) {
        // Cardano wallet
        const path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/${index}'`;
        coldWalletProps = await ledger.initLedger(isBluetooth.value, path);
      } else if (localNetwork.value?.blockchain === Blockchain.BITCOIN) {
        // Bitcoin wallet - use default SegWit address type
        coldWalletProps = await ledger.initBitcoinLedger(isBluetooth.value, 'segwit', index, localNetwork.value.network);

        // Format Bitcoin response to match expected structure
        if (coldWalletProps) {
          const { xpub, ...rest } = coldWalletProps;
          // BIP44 coin type: 0 = mainnet, 1 = testnet
          const coinType = localNetwork.value.network === 'Mainnet' ? 0 : 1;
          coldWalletProps = {
            ...rest,
            hwPublicKey: xpub,
            keys: [{ publicKey: xpub, chainCode: '', path: `m/84'/${coinType}'/0'` }]
          };
        }
      }

      const isConnected = !!coldWalletProps;
      if (isConnected) {
        newWallet.value.publicKey = coldWalletProps.hwPublicKey;
        newWallet.value.keys = coldWalletProps.keys;
        newWallet.value.btSupported = coldWalletProps.btSupported;
        step.value = 3;
      }
    } catch (e) {
      console.log(e);
    }
  } else if (walletType.value === WalletType.Trezor) {
    persistent.value = true;
    hardwareLoading.setText(t('wallet.followHardwareInstructions', { walletType: walletType.value }) as string)
    hardwareLoading.setLoading(true)
    try {
      hardwareLoading.setText(t('wallet.connectingToTrezor') as string);
      const response: any = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.TREZOR,
        data: { method: 'initTrezor', chain: localNetwork.value?.blockchain, network: localNetwork.value?.network },
      })

      console.log('[TREZOR Dialog] Response:', response);

      if (response.data.success && response.data.coldWalletProps) {
        const coldWalletProps = response.data.coldWalletProps;
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
        chain: localNetwork.value?.blockchain,
        network: localNetwork.value?.network
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
    name: generateWalletName(),
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
<style scoped lang="scss">
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

// Stepper — no header, content only
::v-deep .v-stepper {
  box-shadow: none !important;
}

::v-deep .v-stepper__content {
  height: 350px;
  overflow-y: auto;
  padding: 0 16px;
}

::v-deep .v-stepper__wrapper {
  height: 350px !important;
  overflow-y: auto;
}

// Action buttons bar
::v-deep .v-card__actions {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  min-height: 68px;
}

// Terms link
.terms-link {
  color: var(--v-primary-base);
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
}

.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: white;
}

.network-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.network-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 8px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  min-height: 62px;
  gap: 5px;
  user-select: none;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: rgba(45, 240, 247, 0.55);
    background: rgba(45, 240, 247, 0.06);
    box-shadow: 0 0 14px rgba(45, 240, 247, 0.07);
  }

  &__label {
    font-size: 10.5px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    line-height: 1.3;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &--testnet {
    min-height: 46px;
    padding: 7px 8px 6px;
  }

  &--active &__label {
    color: rgba(255, 255, 255, 0.9);
  }
}

.hw-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.hw-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  min-height: 100px;
  gap: 8px;
  user-select: none;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: rgba(45, 240, 247, 0.55);
    background: rgba(45, 240, 247, 0.06);
    box-shadow: 0 0 14px rgba(45, 240, 247, 0.07);
  }

  &--disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &__logo {
    width: 100px;
    height: 32px;
    object-fit: contain;
    filter: invert(100%) sepia(20%) saturate(2%) hue-rotate(213deg) brightness(112%) contrast(101%);
  }

  &__label {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
  }

  &--active &__label {
    color: rgba(255, 255, 255, 0.9);
  }
}

.testnet-toggle {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: white;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;

  &:hover {
    color: rgba(255, 255, 255, 0.5);
  }
}

@media (max-width: 600px) {
  ::v-deep .v-stepper__content {
    height: auto;
    min-height: 380px;
  }
  ::v-deep .v-stepper__wrapper {
    height: auto !important;
  }
}
</style>
