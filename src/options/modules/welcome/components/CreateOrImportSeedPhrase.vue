<template>
  <v-card class="liquid-glass transparent-override" flat style="width: 100%; margin: auto; max-width: 520px; justify-items: center;">
    <v-list class="transparent" dense nav style="width: inherit;">
      <v-list-item class="mb-6 py-2" @click="createWalletDialog = true" >
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="walletSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word;">
            Create Wallet
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: center;">
            Set up a new wallet to manage your digital assets.
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="mb-6 py-2" @click="restoreWalletDialog = true;">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="keySvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word;">
            Restore Wallet
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: center;">
            Restore a wallet using your recovery phrase.
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item class="py-2" @click="pairHardwareWalletDialog = true;">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 14px; background-color: #13161B">
          <v-img :src="pairSvg" style="width: 22px;" max-width="22" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word;">
            Pair Hardware Wallet
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: center;">
            Connect your hardware wallet.
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <!-- Midnight Preview Mock Dashboard Button -->
      <v-list-item v-if="props.network?.blockchain === 'Midnight'" class="mb-6 py-2 midnight-dashboard-btn" @click="goToMidnightDashboard">
        <v-list-item-avatar size="50" class="my-0" rounded style="border: 1px solid #7B2FBF; border-radius: 14px; background: linear-gradient(135deg, rgba(123, 47, 191, 0.2) 0%, rgba(123, 47, 191, 0.1) 100%);">
          <v-icon color="purple lighten-1" size="24">mdi-moon-waning-crescent</v-icon>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title class="pb-1" style="font-size: 20px; font-weight: 600; word-wrap: break-word; color: #BA68C8;">
            Go to Midnight Dashboard
          </v-list-item-title>
          <v-list-item-subtitle style="font-size: 16px;  display: flex; word-break: break-word;align-items: center;">
            View mock Midnight wallet with test data (development only)
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-list>
    <v-divider class="mt-4" style="width: 100%"></v-divider>
    <v-btn text @click="back">
      <v-icon>
        mdi-arrow-left
      </v-icon>
      Back
    </v-btn>
    <CreateWallet :is-open="createWalletDialog" @close="createWalletDialog = false" :persistent="false" :network="props.network"></CreateWallet>
    <RestoreWallet :dialog="restoreWalletDialog" @dialogChange="restoreWalletDialogChange" :network="props.network"></RestoreWallet>
    <PairHardwareWallet :dialog="pairHardwareWalletDialog" @dialogChange="pairHardwareWalletDialogChange" :network="props.network"></PairHardwareWallet>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';
import CreateWallet from '@/options/modules/welcome/dialogs/CreateWallet.vue';
import PairHardwareWallet from '@/options/modules/welcome/dialogs/PairHardwareWallet.vue';
import RestoreWallet from '@/options/modules/welcome/dialogs/RestoreWallet.vue';
import { computed, ref, getCurrentInstance, toRefs } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

interface Props {
  network: any;
}

const props = defineProps<Props>();
const emit = defineEmits(['back']);

const createWalletDialog = ref<boolean>(false);
const restoreWalletDialog = ref<boolean>(false);
const pairHardwareWalletDialog = ref<boolean>(false);

const back = () => {
  emit('back');
}

const restoreWalletDialogChange = (val: boolean): void => {
  restoreWalletDialog.value = val;
};

const pairHardwareWalletDialogChange = (val: boolean): void => {
  pairHardwareWalletDialog.value = val;
};

const { wallets } = toRefs(geroStore);
const vmProxy = getCurrentInstance()!.proxy as any;

/**
 * Navigate to Midnight mock dashboard
 * Finds the Mock Midnight Wallet and logs in, or shows error if not found
 */
const goToMidnightDashboard = async (): Promise<void> => {
  try {
    console.log('🌙 Navigating to Midnight mock dashboard...');

    // Find the Mock Midnight Wallet
    const midnightWallet = (Object.values(wallets.value) as any[]).find(
      (wallet: any) => wallet.chain === 'Midnight' && wallet.network === 'Preview'
    );

    if (!midnightWallet) {
      console.error('❌ Mock Midnight Wallet not found. Please ensure the mock wallet is created in development mode.');
      alert('Mock Midnight Wallet not found. Please restart the extension or check the development setup.');
      return;
    }

    console.log('✅ Found Midnight wallet:', midnightWallet.name);

    // Log in to the Midnight wallet
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet: midnightWallet },
    });

    if (!response || (response as any).error) {
      console.error('❌ Login failed:', (response as any)?.error || 'Unknown error');
      alert('Failed to log in to Midnight wallet. Please try again.');
      return;
    }

    // Small delay to ensure store messaging has propagated
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('✅ Logged in to Midnight wallet, navigating to dashboard...');

    // Navigate to dashboard
    await vmProxy.$router.push('/').catch((err: any) => {
      if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
        console.error('Navigation error:', err);
      }
    });

    console.log('🌙 Midnight dashboard loaded successfully!');
  } catch (error) {
    console.error('❌ Error navigating to Midnight dashboard:', error);
    alert('Failed to navigate to Midnight dashboard. Please try again.');
  }
};

const hue = ref(0);
const walletSvg = computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    return assets.walletGeroApexSvg
  }
  return assets.walletGeroSvg
})
const keySvg = computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    return assets.keyApexSvg
  }
  return assets.keySvg
})

const pairSvg = computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    return assets.pairApexSvg
  }
  return assets.pairSvg
})

computed(() => {
  if (props.network?.blockchain?.includes('Apex')) {
    hue.value = 200;
  }
  hue.value = 0;
})
</script>
<style scoped>
/* Midnight Dashboard Button - Purple accent theme */
.midnight-dashboard-btn {
  background: linear-gradient(135deg, rgba(123, 47, 191, 0.08) 0%, rgba(123, 47, 191, 0.04) 100%) !important;
  border: 1px solid rgba(123, 47, 191, 0.3) !important;
  border-radius: 8px !important;
  margin: 4px 0 !important;
  transition: all 0.3s ease !important;
}

.midnight-dashboard-btn:hover {
  background: linear-gradient(135deg, rgba(123, 47, 191, 0.15) 0%, rgba(123, 47, 191, 0.08) 100%) !important;
  border-color: rgba(123, 47, 191, 0.5) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 4px 12px rgba(123, 47, 191, 0.3) !important;
}

.midnight-dashboard-btn .v-list-item__avatar {
  box-shadow: 0 2px 8px rgba(123, 47, 191, 0.3);
}

.midnight-dashboard-btn:hover .v-list-item__avatar {
  box-shadow: 0 4px 16px rgba(123, 47, 191, 0.5);
}
</style>
