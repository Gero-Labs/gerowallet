<template>
  <div class="step-connect" style="text-align: -webkit-center;">
    <div class="step-scroll" :class="{ 'step-scroll--center': isKeystone }">
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
    <!-- Keystone, both stages: the device and its steps beside the QR it scans,
         then beside the camera that scans its answer. -->
    <div v-if="isKeystone" class="keystone-pair">
      <div class="keystone-pair__guide">
        <img class="keystone-pair__device" :src="assets.connectKeystoneSvg" :alt="t('wallet.connectKeystone')" />
        <NumberedSteps :steps="keystoneScan ? keystoneScanSteps : keystoneShowSteps" />
      </div>
      <div v-if="!keystoneScan" id="qr-code" ref="qrCodeRef" class="keystone-pair__qr" />
      <QrViewfinder v-else :size="PAIRING_QR_SIZE + 16">
        <AnimatedQRScanner
          purpose="sync"
          :urTypes="['crypto-multi-accounts']"
          width="100%"
          height="100%"
          @scan="onKeystoneScan"
          @error="onKeystoneError"
          @progress="onKeystoneProgress"
        />
      </QrViewfinder>
    </div>
    <template v-else>
    <v-alert color="primary" density="compact" variant="outlined" type="info" border="start" class="connect-info text-left">
      <div v-if="walletType === WalletType.Ledger">
        <ul class="connect-steps t-body">
          <li>{{ $t('welcome.setupHardwareWallet', { walletType }) }}</li>
          <li v-if="isBitcoin">{{ $t('welcome.installBitcoinApp', { walletType }) }}</li>
          <li v-else-if="isSolana">{{ $t('welcome.installSolanaApp', { walletType }) }}</li>
          <li v-else>{{ $t('welcome.installCardanoApp', { walletType }) }}</li>
          <li>{{ $t('welcome.unlockHardwareWallet') }}</li>
          <li v-if="isBitcoin">{{ $t('welcome.openBitcoinApp') }}</li>
          <li v-else-if="isSolana">{{ $t('welcome.openSolanaApp') }}</li>
          <li v-else>{{ $t('welcome.openCardanoApp') }}</li>
        </ul>
      </div>
      <div v-if="walletType === WalletType.Trezor">
        <ul class="connect-steps t-body">
          <li>{{ $t('welcome.setupHardwareWallet', { walletType }) }}</li>
          <li>{{ $t('welcome.unlockHardwareWallet') }}</li>
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
    </template>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="text-align: initial;">
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton tier="primary" @click="walletCreationStep2()" class="step-next">{{ $t('common.continue') }}</GButton>
    </div>

    <!-- The device prompt is mounted globally in options/App.vue and driven by
         the hardwareLoading singleton this step writes to. -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Blockchain, coin_type, purpose, WalletType } from '@/models/types';
import ledger from '@/shared/utils/ledger';
import hardwareLoading from '@/plugins/hardwareLoading';
import {
  getKeystoneAccountsUR, getKeystonePublicKeyUR, generateBitcoinSyncQR, parseBitcoinAccount, parseKeystoneAccounts,
} from '@/shared/utils/keystone';
import type { AccountXpub } from '@/shared/utils/walletAccount';
import { getKeystoneSolanaAccountsUR, parseKeystoneSolanaAccounts } from '@/shared/utils/solanaKeystone';
import QRCodeStyling from 'qr-code-styling';
import assets from '@/utils/assets';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import NumberedSteps, { type NumberedStep } from '@/shared/components/NumberedSteps.vue';
import QrViewfinder from '@/shared/components/QrViewfinder.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import snackbar from '@/plugins/snackbar';
import { UR } from '@keystonehq/keystone-sdk';
import { debugLog } from '@/utils/debug';
import type { NetworkInfo } from '@/utils/networks';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import GButton from '@/shared/components/GButton/GButton.vue';

interface ConnectionPayload {
  publicKey: string;
  keys: Array<{ publicKey: string; chainCode: string; path: string }>;
  btSupported: boolean;
  xfp?: string;
  /** Keystone: the firmware version its pairing answer reported, when it reports one. */
  firmwareVersion?: string;
  /** Multi-account pairing: every account the device exported, by index. */
  accounts?: AccountXpub[];
}

const { t } = useTranslation();

const props = defineProps<{
  network: NetworkInfo;
  walletType: string | undefined;
  /** Accounts to ask the device for. Set only for multi-account pairing (Cardano and Solana). */
  accountIndices?: number[];
}>();

const multiAccount = computed(() => props.network?.blockchain === Blockchain.CARDANO && !!props.accountIndices?.length);

// Solana (Ledger, Trezor, Keystone): the device exports addresses at m/44'/501'/n'/0'. Without
// the multi-account step only account #0 is asked for, and the payload is single-account.
const isSolana = computed(() => props.network?.blockchain === Blockchain.SOLANA);
const solanaMultiAccount = computed(() => isSolana.value && !!props.accountIndices?.length);
const solanaIndices = (): number[] => (solanaMultiAccount.value ? props.accountIndices! : [0]);
const solanaPayload = (accounts: AccountXpub[], btSupported: boolean, xfp?: string, firmwareVersion?: string): ConnectionPayload =>
  solanaMultiAccount.value
    ? accountsPayload(accounts, btSupported, xfp, firmwareVersion)
    : {
      publicKey: accounts[0].publicKey,
      keys: accounts[0].keys,
      btSupported,
      ...(xfp ? { xfp } : {}),
      ...(firmwareVersion ? { firmwareVersion } : {}),
    };

/** The payload for a multi-account export; the record fields come from each account. */
const accountsPayload = (accounts: AccountXpub[], btSupported: boolean, xfp?: string, firmwareVersion?: string): ConnectionPayload => ({
  publicKey: accounts[0].publicKey,
  keys: accounts[0].keys,
  btSupported,
  ...(xfp ? { xfp } : {}),
  ...(firmwareVersion ? { firmwareVersion } : {}),
  accounts,
});

const emit = defineEmits<{
  (e: 'connected', payload: ConnectionPayload): void;
  (e: 'back'): void;
}>();

const isBluetooth = ref(false);
const keystoneScan = ref(false);
const qrCodeRef = ref<HTMLElement | null>(null);
const qrCode = ref<InstanceType<typeof QRCodeStyling> | undefined>(undefined);

const isBitcoin = computed(() => props.network?.blockchain === Blockchain.BITCOIN);
/** Keystone's two stages (the QR it scans, then the camera for its answer) share one card. */
const isKeystone = computed(() => props.walletType === WalletType.Keystone);
const keystoneShowSteps = computed<NumberedStep[]>(() => [
  { text: t('welcome.unlockKeystone') },
  { text: t('welcome.selectScanQR'), icon: 'mdi-line-scan' },
  { text: t('welcome.scanQRWithKeystone') },
  { text: t('welcome.approveOnKeystone') },
]);
const keystoneScanSteps = computed<NumberedStep[]>(() => [
  { text: t('welcome.adjustDistance') },
  { text: t('welcome.lowDensitySetting') },
]);

/** The pairing QR has the right half of the Keystone card to itself, so it is drawn larger than the signing QRs (190). */
const PAIRING_QR_SIZE = 230;

const initKeystoneQR = (): void => {
  if (props.walletType !== WalletType.Keystone) return;
  if (qrCode.value) {
    qrCode.value = undefined;
    if (qrCodeRef.value) qrCodeRef.value.innerHTML = '';
  }
  let qrOptions;
  if (isSolana.value) {
    qrOptions = getKeystoneSolanaAccountsUR(solanaIndices());
  } else if (multiAccount.value) {
    qrOptions = getKeystoneAccountsUR(props.accountIndices!);
  } else if (props.network?.blockchain === Blockchain.CARDANO) {
    qrOptions = getKeystonePublicKeyUR(purpose.hdwallet, 0);
  } else if (props.network?.blockchain === Blockchain.BITCOIN) {
    qrOptions = generateBitcoinSyncQR(props.network.network, 'segwit', 0);
  }
  if (qrOptions) {
    qrCode.value = new QRCodeStyling({
      ...qrOptions,
      width: PAIRING_QR_SIZE,
      height: PAIRING_QR_SIZE,
      // Rounded down to whole pixels, ~80 modules came out 2 px each at 190 and at 230 alike,
      // leaving the rest as white margin. Fractional modules fill the size asked.
      dotsOptions: { ...qrOptions.dotsOptions, roundSize: false },
    });
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

    if (isSolana.value) {
      const { xfp, accounts, firmwareVersion } = parseKeystoneSolanaAccounts(Buffer.from(ur.cbor, 'hex'), solanaIndices());
      snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
      keystoneScan.value = false;
      emit('connected', solanaPayload(accounts, false, xfp, firmwareVersion));
      return;
    }

    if (props.network?.blockchain === Blockchain.BITCOIN) {
      // Keep the scanned type: UR.from() would label it 'bytes' and parseBitcoinAccount rejects that.
      const bitcoinUR = new UR(Buffer.from(ur.cbor, 'hex'), ur.type);
      // The account the QR asked for (initKeystoneQR); any other key in the answer is refused.
      const bitcoinAccount = parseBitcoinAccount(bitcoinUR, props.network.network, 'segwit', 0);

      const payload: ConnectionPayload = {
        xfp: bitcoinAccount.xfp,
        publicKey: bitcoinAccount.xpub,
        keys: [{
          publicKey: bitcoinAccount.publicKey,
          chainCode: bitcoinAccount.chainCode,
          path: bitcoinAccount.path,
        }],
        btSupported: false,
        ...(bitcoinAccount.firmwareVersion ? { firmwareVersion: bitcoinAccount.firmwareVersion } : {}),
      };

      snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
      keystoneScan.value = false;
      emit('connected', payload);
      return;
    }

    if (multiAccount.value) {
      const { xfp, accounts, firmwareVersion } = parseKeystoneAccounts(Buffer.from(ur.cbor, 'hex'), props.accountIndices!);
      snackbar.fireSuccess(t('wallet.keystoneQRScannedSuccess') as string);
      keystoneScan.value = false;
      emit('connected', accountsPayload(accounts, false, xfp, firmwareVersion));
      return;
    }

    // The one account asked for (#0), read as the multi-account answer is; the payload stays
    // single-account (no `accounts`), so the review creates one record as before.
    const { xfp, accounts, firmwareVersion } = parseKeystoneAccounts(Buffer.from(ur.cbor, 'hex'), [0]);
    const payload: ConnectionPayload = {
      publicKey: accounts[0].publicKey,
      keys: accounts[0].keys,
      btSupported: false,
      xfp,
      ...(firmwareVersion ? { firmwareVersion } : {}),
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
    hardwareLoading.begin('Ledger', t('wallet.followHardwareInstructions', { walletType: props.walletType }) as string);

    try {
      let coldWalletProps;
      const index = 0;

      if (isSolana.value) {
        const { getLedgerSolanaAccounts } = await import('@/shared/utils/solanaLedger');
        const { btSupported, accounts } = await getLedgerSolanaAccounts(isBluetooth.value, solanaIndices());
        emit('connected', solanaPayload(accounts, btSupported));
        return;
      } else if (multiAccount.value) {
        const { btSupported, accounts } = await ledger.initLedgerAccounts(isBluetooth.value, props.accountIndices!);
        emit('connected', accountsPayload(accounts, btSupported));
        return;
      } else if (props.network?.blockchain === Blockchain.CARDANO) {
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
    hardwareLoading.begin('Trezor', t('wallet.followHardwareInstructions', { walletType: props.walletType }) as string);
    try {
      hardwareLoading.setText(t('wallet.connectingToTrezor') as string);
      if (isSolana.value) {
        // Trezor Connect runs through Trezor Suite from the page as well as from the worker.
        const trezor = (await import('@/shared/utils/trezor')).default;
        const { btSupported, accounts } = await trezor.getSolanaAccounts(solanaIndices());
        emit('connected', solanaPayload(accounts, btSupported));
        return;
      }
      const data = {
        method: 'initTrezor', chain: props.network?.blockchain, network: props.network?.network,
        ...(multiAccount.value ? { accountIndices: props.accountIndices } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = featureFlagsStore.state.flags.isTrezorWebUsbEnabled
        ? await dispatchTrezor(data)
        : await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.TREZOR, data });

      debugLog('[TREZOR] init success', response?.data?.success);

      if (response.data.success && response.data.coldWalletProps?.accounts) {
        const { btSupported, accounts } = response.data.coldWalletProps;
        emit('connected', accountsPayload(accounts, btSupported));
      } else if (response.data.success && response.data.coldWalletProps) {
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
// Type comes from the ramp class in the markup; the alert sets the tone.
.connect-steps {
  text-align: left;
  line-height: 1.5;
}

// The Keystone card sits in the middle of the free height. Auto margins, not
// justify-content: when the window is too short they drop to 0 and the card
// scrolls from its top instead of being clipped.
.step-scroll--center {
  display: flex;
  flex-direction: column;

  > .keystone-pair {
    margin-block: auto;
  }
}

// Keystone pairing: one tier card, the device and numbered steps on the left and
// the QR it scans on the right, so it fits the onboarding card without
// scrolling (issue 1656). Stacked on a phone.
.keystone-pair {
  @include g-glass-tier;
  display: flex;
  align-items: center;
  gap: var(--g-s-5);
  padding: var(--g-s-5);
  border-radius: var(--g-r-card);
  text-align: left;

  &__guide {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--g-s-4);
  }

  // Centered over the steps: it heads the column instead of sitting in its corner.
  &__device {
    align-self: center;
    width: 200px;
    height: auto;
    margin-bottom: var(--g-s-2);
  }

  // A QR needs a light quiet zone to scan, so this box stays solid white.
  // (The steps are NumberedSteps; the camera stage is QrViewfinder, the QR box's size.)
  &__qr {
    flex: none;
    padding: var(--g-s-2);
    background: white;
    border-radius: var(--g-r-control);
    line-height: 0;
  }

  @media (max-width: 600px) {
    flex-direction: column;
  }
}
</style>
