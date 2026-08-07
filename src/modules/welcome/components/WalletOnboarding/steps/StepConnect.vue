<template>
  <div class="step-connect" style="text-align: -webkit-center;">
    <div class="step-scroll">
    <img
      style="width: 400px; align-self: center;"
      v-if="walletType === WalletType.Ledger"
      :src="assets.connectLedgerSvg"
      :alt="t('wallet.connectLedger')"
    />
    <img
      style="width: 400px; align-self: center;"
      v-if="walletType === WalletType.Trezor"
      :src="assets.connectTrezorSvg"
      :alt="t('wallet.connectTrezor')"
    />
    <img
      v-if="walletType === WalletType.Keystone && !keystoneScan"
      :src="assets.connectKeystoneSvg"
      style="width: 230px; height: 126px; align-self: center;"
      :alt="t('wallet.connectKeystone')"
    />
    <v-alert color="primary" dense outlined type="info" border="left" class="connect-info text-left">
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
        :text-left="$t('dashboard.usb')"
        icon-left="mdi-usb"
        :text-right="$t('dashboard.bluetooth')"
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

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px; text-align: initial;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn color="primary" @click="walletCreationStep2()">{{ $t('common.continue') }}</v-btn>
    </div>

    <!-- Hardware loading overlay -->
    <v-overlay v-show="hardwareLoading.loading" opacity="0.9" style="text-align: center;">
      <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
        <video :src="assets.loadingAnimation" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;" />
        <v-progress-linear buffer-value="0" color="primary" reverse stream value="0" style="color: cyan; width: 100px; text-align: center" />
        <v-card-title v-if="hardwareLoading.text" v-html="hardwareLoading.text" />
      </v-card>
    </v-overlay>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Blockchain, coin_type, purpose, WalletType } from '@/models/types';
import ledger from '@/shared/utils/ledger';
import hardwareLoading from '@/plugins/hardwareLoading';
import { getKeystonePublicKeyUR, generateBitcoinSyncQR, parseBitcoinAccount } from '@/shared/utils/keystone';
import { CryptoMultiAccounts } from '@keystonehq/bc-ur-registry';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Bip32PublicKey } from '@cardano-sdk/crypto';
import snackbar from '@/plugins/snackbar';
import { bech32 } from 'bech32';
import { UR } from '@keystonehq/keystone-sdk';
import { debugLog } from '@/utils/debug';
import type { NetworkInfo } from '@/utils/networks';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';

interface ConnectionPayload {
  publicKey: string;
  keys: Array<{ publicKey: string; chainCode: string; path: string }>;
  btSupported: boolean;
  xfp?: string;
}

const { t } = useTranslation();

const props = defineProps<{
  network: NetworkInfo;
  walletType: string | undefined;
}>();

const emit = defineEmits<{
  (e: 'connected', payload: ConnectionPayload): void;
  (e: 'back'): void;
}>();

const isBluetooth = ref(false);
const keystoneScan = ref(false);
const qrCodeRef = ref<HTMLElement | null>(null);
const qrCode = ref<InstanceType<typeof QRCodeStyling> | undefined>(undefined);

const isBitcoin = computed(() => props.network?.blockchain === Blockchain.BITCOIN);

const initKeystoneQR = (): void => {
  if (props.walletType !== WalletType.Keystone) return;
  if (qrCode.value) {
    qrCode.value = undefined;
    if (qrCodeRef.value) qrCodeRef.value.innerHTML = '';
  }
  let qrOptions;
  if (props.network?.blockchain === Blockchain.CARDANO) {
    qrOptions = getKeystonePublicKeyUR(purpose.hdwallet, 0);
  } else if (props.network?.blockchain === Blockchain.BITCOIN) {
    qrOptions = generateBitcoinSyncQR('segwit', 0);
  }
  if (qrOptions) {
    qrCode.value = new QRCodeStyling(qrOptions);
    nextTick(() => {
      if (qrCodeRef.value) qrCode.value?.append(qrCodeRef.value);
    });
  }
};

onMounted(() => {
  initKeystoneQR();
});

const onKeystoneScan = async (ur: { type: string; cbor: string }): Promise<void> => {
  try {
    debugLog('[Keystone] QR code scanned', ur.type);

    if (props.network?.blockchain === Blockchain.BITCOIN) {
      const bitcoinUR = UR.from(ur.cbor, 'hex');
      const bitcoinAccount = parseBitcoinAccount(bitcoinUR);

      const payload: ConnectionPayload = {
        xfp: bitcoinAccount.xfp,
        publicKey: bitcoinAccount.xpub,
        keys: [{
          publicKey: bitcoinAccount.publicKey,
          chainCode: bitcoinAccount.chainCode,
          path: bitcoinAccount.path,
        }],
        btSupported: false,
      };

      snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
      keystoneScan.value = false;
      emit('connected', payload);
      return;
    }

    const cborBuffer = Buffer.from(ur.cbor, 'hex');
    const cryptoMultiAccounts = CryptoMultiAccounts.fromCBOR(cborBuffer);

    const device = cryptoMultiAccounts.getDevice();
    debugLog('[Keystone] Parsed device', device);
    const keys = cryptoMultiAccounts.getKeys();
    const masterFingerprint = cryptoMultiAccounts.getMasterFingerprint();

    const xfp = masterFingerprint.toString('hex');
    const firstKey = keys[0];
    const bip32PublicKey: Bip32PublicKey = Bip32PublicKey.fromHex(
      firstKey.getKey().toString('hex') + firstKey.getChainCode().toString('hex')
    );
    const words = bech32.toWords(bip32PublicKey.bytes());
    const publicKey = bech32.encode('xpub', words, 1023);
    const mappedKeys = keys.map(key => ({
      publicKey: key.getKey().toString('hex'),
      chainCode: key.getChainCode().toString('hex'),
      path: key.getOrigin().getPath(),
    }));

    const payload: ConnectionPayload = {
      publicKey,
      keys: mappedKeys,
      btSupported: false,
      xfp,
    };

    snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
    keystoneScan.value = false;
    emit('connected', payload);
  } catch (error) {
    console.error('[Keystone] Error processing QR code:', error);
    snackbar.setError(t('wallet.keystoneQRScanError') as string);
  }
};

const onKeystoneError = (error: string): void => {
  console.error('[Keystone] Scanner error:', error);
  snackbar.setError(t('wallet.keystoneQRScanError') as string);
};

const onKeystoneProgress = (progress: number): void => {
  debugLog('[Keystone] Scan progress', Math.round(progress * 100) + '%');
};

const walletCreationStep2 = async (): Promise<void> => {
  if (props.walletType === WalletType.Ledger) {
    hardwareLoading.setText(t('wallet.followHardwareInstructions', { walletType: props.walletType }) as string);
    hardwareLoading.setLoading(true);

    try {
      let coldWalletProps;
      const index = 0;

      if (props.network?.blockchain === Blockchain.CARDANO) {
        const path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/${index}'`;
        coldWalletProps = await ledger.initLedger(isBluetooth.value, path);
      } else if (props.network?.blockchain === Blockchain.BITCOIN) {
        coldWalletProps = await ledger.initBitcoinLedger(isBluetooth.value, 'segwit', index, props.network.network);

        if (coldWalletProps) {
          const { xpub, ...rest } = coldWalletProps;
          const coinType = props.network.network === 'Mainnet' ? 0 : 1;
          coldWalletProps = {
            ...rest,
            hwPublicKey: xpub,
            keys: [{ publicKey: xpub, chainCode: '', path: `m/84'/${coinType}'/0'` }],
          };
        }
      }

      if (coldWalletProps) {
        const payload: ConnectionPayload = {
          publicKey: coldWalletProps.hwPublicKey,
          keys: coldWalletProps.keys,
          btSupported: coldWalletProps.btSupported,
        };
        emit('connected', payload);
      }
    } catch (e) {
      console.error(e);
      snackbar.setError((e as Error)?.message || (t('welcome.hardwareConnectionFailed') as string));
    } finally {
      hardwareLoading.setLoading(false);
    }
  } else if (props.walletType === WalletType.Trezor) {
    hardwareLoading.setText(t('wallet.followHardwareInstructions', { walletType: props.walletType }) as string);
    hardwareLoading.setLoading(true);
    try {
      hardwareLoading.setText(t('wallet.connectingToTrezor') as string);
      const data = { method: 'initTrezor', chain: props.network?.blockchain, network: props.network?.network };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = featureFlagsStore.state.flags.isTrezorWebUsbEnabled
        ? await dispatchTrezor(data)
        : await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.TREZOR, data });

      debugLog('[TREZOR] init success', response?.data?.success);

      if (response.data.success && response.data.coldWalletProps) {
        const coldWalletProps = response.data.coldWalletProps;
        const payload: ConnectionPayload = {
          publicKey: coldWalletProps.hwPublicKey,
          keys: coldWalletProps.keys,
          btSupported: coldWalletProps.btSupported,
        };
        emit('connected', payload);
      } else {
        throw new Error(response.data.error || 'Failed to initialize Trezor');
      }
    } catch (e) {
      console.error(e);
      snackbar.setError((e as Error)?.message || (t('welcome.hardwareConnectionFailed') as string));
    } finally {
      hardwareLoading.setLoading(false);
    }
  } else if (props.walletType === WalletType.Keystone) {
    keystoneScan.value = true;
    if (qrCode.value) {
      qrCode.value = undefined;
      if (qrCodeRef.value) qrCodeRef.value.innerHTML = '';
    }
  }
};
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
</style>
