<template>
  <div class="step-review">
    <div class="step-scroll">
    <v-form ref="form3" v-model="valid3">
      <v-card flat class="transparent" :disabled="creatingWalletLoader">

        <!-- Wallet summary card -->
        <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
          <v-card-text class="pa-3">
            <div class="d-flex align-center mb-2">
              <v-avatar size="32" class="mr-2">
                <v-img :src="walletIconSrc" cover></v-img>
              </v-avatar>
              <div class="flex-grow-1">
                <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.walletName') }}</div>
                <v-text-field
                  v-model="walletName"
                  dense
                  hide-details
                  class="wallet-name-field mt-0 pt-0"
                  :placeholder="$t('welcome.walletNamePlaceholder')"
                />
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

        <v-checkbox
          class="mt-0 mb-2"
          hide-details
          v-model="termsChecked"
          :rules="[termsChecked]"
          :disabled="creatingWalletLoader"
        >
          <template v-slot:label>
            <span class="text-body-2">
              {{ $t('welcome.agreeToTerms') }}
              <a @click.stop href="https://gerowallet.io/legal/terms/" target="_blank">{{ $t('navigation.termsOfService') }}</a>.
            </span>
          </template>
        </v-checkbox>

      </v-card>
    </v-form>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn
        class="onb-continue"
        color="primary"
        :loading="creatingWalletLoader"
        :disabled="!valid3 || creatingWalletLoader"
        @click="walletCreationStep3()"
      >
        {{ $t('common.create') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, getCurrentInstance, nextTick } from 'vue';
import { Theme } from '@/models/types';
import GeroStore from '@/stores/geroStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import type { NetworkInfo } from '@/utils/networks';

interface ConnectionPayload {
  publicKey: string;
  keys: Array<{ publicKey: string; chainCode: string; path: string }>;
  btSupported: boolean;
  xfp?: string;
}

const props = defineProps<{
  network: NetworkInfo;
  walletType: string | undefined;
  connection: ConnectionPayload | null;
  name: string;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'created'): void;
  (e: 'update:name', name: string): void;
}>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

const form3 = ref<{ validate: () => boolean } | null>(null);
const valid3 = ref(false);
const creatingWalletLoader = ref(false);
// Wallet name is owned by the orchestrator (single source); edit two-way.
const walletName = computed<string>({
  get: () => props.name,
  set: (v: string) => emit('update:name', v),
});
const termsChecked = ref(false);

const walletIconSrc = computed(() => {
  const iconKey = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
  return (assets as Record<string, string>)[`${iconKey}Svg`] || '';
});

const walletCreationStep3 = async (): Promise<void> => {
  try {
    if (form3.value?.validate()) {
      creatingWalletLoader.value = true;
      const wallet = await GeroStore.createNewHardwareWallet({
        ...props.connection,
        name: walletName.value,
        type: props.walletType,
        theme: Theme.GERO,
        chain: props.network?.blockchain,
        network: props.network?.network,
        icon: networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || ''),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response: any = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      });

      if (response && !response.error) {
        nextTick(() => {
          emit('created');
          router?.push('/').catch((err: Error) => {
            if (err.name !== 'NavigationDuplicated' && !err.message?.includes('Redirected')) {
              console.error('Navigation error:', err);
            }
          });
        });
      } else if (response?.error) {
        console.warn('Login response error:', response.error);
        nextTick(() => {
          emit('created');
          router?.push('/').catch(() => {});
        });
      }
    }
  } catch (e) {
    console.error('Error creating wallet:', e);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vmProxy as any)?.['$snackbar']?.setError(vmProxy?.$t('welcome.hardwareConnectionFailed') as string);
  } finally {
    creatingWalletLoader.value = false;
  }
};

</script>

<style scoped lang="scss">
/* Continue/CREATE CTA: black label on gradient/accent, incl. disabled */
.wallet-name-field {
  ::v-deep input {
    font-size: 14px;
    font-weight: 500;
    color: white;
    padding: 0;
  }

  ::v-deep .v-input__slot::before,
  ::v-deep .v-input__slot::after {
    display: none;
  }
}
</style>
