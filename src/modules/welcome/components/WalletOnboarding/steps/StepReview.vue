<template>
  <div class="step-review">
    <div class="step-scroll">
    <v-form ref="form3" v-model="valid3">
      <v-card flat class="transparent" :disabled="creatingWalletLoader">

        <!-- Wallet summary card -->
        <v-card class="mb-3" variant="outlined" style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
          <v-card-text class="pa-3">
            <div class="d-flex align-center mb-2">
              <v-avatar size="32" class="mr-2">
                <v-img :src="walletIconSrc" cover></v-img>
              </v-avatar>
              <div v-if="createsFirstAccount" class="flex-grow-1">
                <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('welcome.walletName') }}</div>
                <v-text-field
                  v-model="walletName"
                  variant="plain"
                  density="compact"
                  hide-details
                  class="wallet-name-field mt-0 pt-0"
                  :placeholder="$t('welcome.walletNamePlaceholder')"
                />
              </div>
              <div v-else class="flex-grow-1 text-body-2">{{ $t('accounts.addingTo', { name: groupWallet?.name ?? '' }) }}</div>
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
                    <v-img :src="network ? network.icon : ''" ></v-img>
                  </v-avatar>
                  <div>
                    <div class="text-caption grey--text text--lighten-1" style="line-height: 1.2;">{{ $t('common.network') }}</div>
                    <div class="text-body-2 white--text font-weight-medium" style="line-height: 1.3;">{{ network ? network.title : '' }}</div>
                  </div>
                </div>
              </v-col>
            </v-row>
            <div v-if="accounts" class="text-body-2 mt-2">{{ $t('accounts.reviewList', { list: accountList }) }}</div>
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
      <v-btn variant="text" @click="approval.invalidate(); $emit('back')">{{ $t('common.back') }}</v-btn>
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
import { ref, computed, getCurrentInstance, nextTick, watch } from 'vue';
import { Theme } from '@/models/types';
import GeroStore from '@/stores/geroStore';
import { DuplicateWalletError, findExistingWallet } from '@/db/gero-db';
import type { AccountXpub } from '@/shared/utils/walletAccount';
import type { Wallet } from '@/models/types';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import type { NetworkInfo } from '@/utils/networks';
import { useApprovalFreshness } from '@/shared/composables/useApprovalFreshness';
import { useTranslation } from '@/shared/composables/useTranslation';
import snackbar from '@/plugins/snackbar';

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
  /** Multi-account pairing: the accounts to add, by index. */
  accounts?: AccountXpub[];
  /** Multi-account pairing: account #0's xpub, which finds the stored wallet new accounts join. */
  groupPublicKey?: string;
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'created'): void;
  (e: 'update:name', name: string): void;
}>();

const vmProxy = getCurrentInstance()!.proxy;
const router = vmProxy?.$router;

const form3 = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const valid3 = ref(false);
const creatingWalletLoader = ref(false);
// Wallet name is owned by the orchestrator (single source); edit two-way.
const walletName = computed<string>({
  get: () => props.name,
  set: (v: string) => emit('update:name', v),
});
const termsChecked = ref(false);
const { t } = useTranslation();
const approval = useApprovalFreshness(() => [props.network, props.connection, props.walletType, props.name, props.accounts, termsChecked.value]);

const walletIconSrc = computed(() => {
  const iconKey = networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
  const asset = assets[`${iconKey}Svg` as keyof typeof assets];
  return typeof asset === 'string' ? asset : '';
});

/** Account #0 is being added too, so it names the new wallet; otherwise the accounts join a stored one. */
const createsFirstAccount = computed(() => !props.accounts || props.accounts.some((account) => account.accountIndex === 0));
const groupWallet = ref<Wallet | null>(null);
watch(() => [props.accounts, props.groupPublicKey], async () => {
  groupWallet.value = createsFirstAccount.value || !props.groupPublicKey ? null
    : await findExistingWallet({ chain: props.network?.blockchain, network: props.network?.network, publicKey: props.groupPublicKey });
}, { immediate: true });
const accountList = computed(() => (props.accounts ?? []).map((account) => t('accounts.label', { index: account.accountIndex })).join(', '));

const recordFields = () => ({
  type: props.walletType,
  theme: Theme.GERO,
  chain: props.network?.blockchain,
  network: props.network?.network,
  icon: networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || ''),
  btSupported: props.connection?.btSupported,
  ...(props.connection?.xfp ? { xfp: props.connection.xfp } : {}),
});

/**
 * One record per account. Account #0 is created first and heads the group;
 * without it the accounts join the stored account #0. An account that turns out
 * to be stored already is skipped. Returns the first record created.
 */
async function createAccountRecords(accounts: AccountXpub[]): Promise<Wallet | undefined> {
  let parentWalletId: number | undefined;
  let first: Wallet | undefined;
  for (const account of accounts) {
    if (account.accountIndex === 0) {
      const wallet = await GeroStore.createNewHardwareWallet({ ...recordFields(), name: walletName.value, publicKey: account.publicKey, keys: account.keys });
      parentWalletId = wallet.id;
      first ??= wallet;
      continue;
    }
    if (parentWalletId === undefined) {
      const parent = await findExistingWallet({ chain: props.network?.blockchain, network: props.network?.network, publicKey: props.groupPublicKey });
      if (!parent) throw new Error(t('welcome.hardwareConnectionFailed'));
      parentWalletId = parent.id;
    }
    try {
      const wallet = await GeroStore.createNewHardwareWallet({
        ...recordFields(),
        name: t('accounts.label', { index: account.accountIndex }),
        publicKey: account.publicKey,
        keys: account.keys,
        accountIndex: account.accountIndex,
        parentWalletId,
      });
      first ??= wallet;
    } catch (e) {
      if (!(e instanceof DuplicateWalletError)) throw e;
    }
  }
  return first;
}

const walletCreationStep3 = (): Promise<void> => approval.run(async () => {
  const current = approval.capture();
  const approved = {
    ...props.connection,
    name: walletName.value,
    type: props.walletType,
    theme: Theme.GERO,
    chain: props.network?.blockchain,
    network: props.network?.network,
    icon: networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || ''),
  };
  creatingWalletLoader.value = true;
  try {
    if ((await form3.value?.validate())?.valid && current()) {
      const wallet = props.accounts ? await createAccountRecords(props.accounts) : await GeroStore.createNewHardwareWallet(approved);
      if (!current()) return;
      if (!wallet) {
        snackbar.setError(t('welcome.walletAlreadyExists'));
        return;
      }
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      }) as { error?: string } | undefined;
      if (!current()) return;

      if (response && !response.error) {
        nextTick(() => {
          if (!current()) return;
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
          if (!current()) return;
          emit('created');
          router?.push('/').catch(() => {});
        });
      }
    }
  } catch (e) {
    if (!current()) return;
    if (e instanceof DuplicateWalletError) {
      snackbar.setError(t('welcome.walletExistsMessage', { name: e.existingWallet.name }));
      return;
    }
    console.error('Error creating wallet:', e);
    snackbar.setError(t('welcome.hardwareConnectionFailed'));
  } finally {
    creatingWalletLoader.value = false;
  }
});

</script>

<style scoped lang="scss">
/* Continue/CREATE CTA: black label on gradient/accent, incl. disabled */
.wallet-name-field {
  :deep(input) {
    font-size: 14px;
    font-weight: 500;
    color: white;
    padding: 0;
  }
}
</style>
