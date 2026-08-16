<template>
  <div class="step-google-confirm">
    <div class="step-scroll">
    <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
      <v-card-text class="pa-3">
        <div class="d-flex align-center mb-2">
          <v-avatar size="32" class="mr-2">
            <v-img :src="walletIconSrc" cover></v-img>
          </v-avatar>
          <div>
            <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.walletName') }}</div>
            <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ name }}</div>
          </div>
        </div>
        <v-divider class="my-2" style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
        <v-row no-gutters>
          <v-col cols="6" class="pr-3">
            <div class="d-flex align-center">
              <v-icon color="primary" size="20" class="mr-2">mdi-google</v-icon>
              <div>
                <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.googleWalletSummaryTitle') }}</div>
                <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ email }}</div>
              </div>
            </div>
          </v-col>
          <v-divider vertical style="border-color: rgba(255, 255, 255, 0.12);"></v-divider>
          <v-col cols="6" class="pl-3">
            <div class="d-flex align-center">
              <v-avatar size="20" class="mr-2">
                <v-img :src="network ? network.icon : ''" contain></v-img>
              </v-avatar>
              <div>
                <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('common.network') }}</div>
                <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ network ? network.title : '' }}</div>
              </div>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="errorMessage"
      color="error"
      icon="mdi-alert-outline"
      outlined
      dense
      border="left"
      class="mb-0"
    >
      <span class="text-body-2">{{ errorMessage }}</span>
    </v-alert>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-spacer />
      <v-btn
        class="onb-continue"
        color="primary"
        :loading="finishing"
        @click="finish()"
      >
        {{ $t('common.done') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, getCurrentInstance } from 'vue';
import assets from '@/utils/assets';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import networks, { NetworkInfo } from '@/utils/networks';
import { authPayloadToWireFields, type GoogleWalletBgResponse, type GoogleAuthPayload } from './googleWalletMessages';

interface Props {
  network: NetworkInfo;
  name: string;
  email: string;
  walletId: number;
  idToken: string;
  authPayload: GoogleAuthPayload;
}

const props = defineProps<Props>();
defineEmits<{ (e: 'back'): void }>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

const finishing = ref(false);
const errorMessage = ref('');

const walletIconSrc = computed(() => {
  const iconKey = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
  return (assets as Record<string, string>)[`${iconKey}Svg`] || '';
});

const finish = async (): Promise<void> => {
  finishing.value = true;
  errorMessage.value = '';
  try {
    // Populate the session cache for this session (reconstruct-at-unlock) —
    // Note: never log idToken/spendingPassword/prfOutputHex.
    const unlockResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UNLOCK_MPC_WALLET,
      data: {
        walletId: props.walletId,
        idToken: props.idToken,
        ...authPayloadToWireFields(props.authPayload),
      },
    }) as GoogleWalletBgResponse;
    if (!unlockResponse?.data?.success) {
      throw new Error(unlockResponse?.data?.error || (vmProxy.$t('errors.unknownError') as string));
    }

    const { getAllWallets } = await import('@/db/gero-db');
    const wallets = await getAllWallets();
    const wallet = wallets[props.walletId];

    const loginResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGIN,
      data: { wallet },
    });

    const hasError = loginResponse && typeof loginResponse === 'object' && 'error' in loginResponse;
    if (loginResponse && !hasError) {
      vmProxy.$nextTick(() => {
        router.push('/').catch((err: Error) => {
          if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
            console.warn('Navigation error:', err);
          }
        });
      });
    } else {
      vmProxy.$nextTick(() => {
        router.push('/').catch(() => {});
      });
    }
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('errors.unknownError') as string);
  } finally {
    finishing.value = false;
  }
};
</script>

<style scoped>
/* Continue/CREATE CTA: black label on gradient/accent, incl. disabled */
</style>
