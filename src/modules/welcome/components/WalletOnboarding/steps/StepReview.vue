<template>
  <div class="step-review">
    <div class="step-scroll">
    <div class="review-form">
      <div>

        <!-- Wallet summary card -->
        <v-card class="glass-tier mb-2" flat>
          <v-card-text class="pa-3">
            <div class="d-flex align-center mb-2">
              <v-avatar size="32" class="mr-2">
                <v-img :src="walletIconSrc" cover></v-img>
              </v-avatar>
              <div v-if="createsFirstAccount" class="flex-grow-1">
                <div class="summary-label t-caption">{{ $t('welcome.walletName') }}</div>
                <v-text-field
                  v-model="walletName"
                  variant="plain"
                  density="compact"
                  hide-details
                  :disabled="creatingWalletLoader"
                  class="wallet-name-field mt-0 pt-0"
                  :placeholder="$t('welcome.walletNamePlaceholder')"
                />
              </div>
              <div v-else class="flex-grow-1 t-body">{{ $t('accounts.addingTo', { name: groupWallet?.name ?? '' }) }}</div>
            </div>
            <v-divider class="my-2" style="border-color: var(--g-hairline-2);"></v-divider>
            <!-- One row of facts: type, network, and the device's firmware and fingerprint when it reports them. -->
            <div class="review-facts">
              <div class="review-fact">
                <v-icon color="primary" size="20">mdi-shield-lock-outline</v-icon>
                <div class="review-fact__text">
                  <div class="summary-label t-caption">{{ $t('welcome.type') }}</div>
                  <div class="summary-value t-body font-weight-medium">{{ walletType }}</div>
                </div>
              </div>
              <div class="review-fact">
                <v-avatar size="20">
                  <v-img :src="network ? network.icon : ''" ></v-img>
                </v-avatar>
                <div class="review-fact__text">
                  <div class="summary-label t-caption">{{ $t('common.network') }}</div>
                  <div class="summary-value t-body font-weight-medium">{{ network ? network.title : '' }}</div>
                </div>
              </div>
              <div v-if="connection?.firmwareVersion" class="review-fact">
                <v-icon color="primary" size="20">mdi-chip</v-icon>
                <div class="review-fact__text">
                  <div class="summary-label t-caption">{{ $t('welcome.reviewFirmware') }}</div>
                  <div class="summary-value t-body font-weight-medium g-num">{{ connection.firmwareVersion }}</div>
                </div>
              </div>
              <div v-if="connection?.xfp" class="review-fact">
                <v-icon color="primary" size="20">mdi-fingerprint</v-icon>
                <div class="review-fact__text">
                  <div class="summary-label t-caption">{{ $t('welcome.reviewFingerprint') }}</div>
                  <div class="summary-value t-body font-weight-medium g-mono">{{ connection.xfp }}</div>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>

        <!-- What each account will be: its path, first addresses and balance. -->
        <v-card v-if="accountRows.length" class="glass-tier" flat>
          <v-card-text class="pa-3">
            <div class="summary-label t-caption mb-1">{{ $t('accounts.stepTitle') }}</div>
            <div v-for="row in accountRows" :key="row.accountIndex" class="review-account">
              <div class="review-account__head">
                <span class="summary-value t-body font-weight-medium">{{ row.label }}</span>
                <span v-if="row.path" class="review-account__path t-caption g-mono">{{ row.path }}</span>
                <v-spacer />
                <span v-if="row.balance" class="summary-value t-body-sm g-num">{{ row.balance }}</span>
                <span v-if="row.status" class="t-caption">{{ row.status }}</span>
              </div>
              <div v-if="row.address || row.stakeAddress" class="review-account__addresses t-caption">
                <div v-if="row.address" class="review-account__line">
                  <span>{{ $t('bitcoin.receiveAddress') }}</span>
                  <span class="review-account__value g-mono" :title="row.address">{{ shortAddress(row.address) }}</span>
                </div>
                <div v-if="row.stakeAddress" class="review-account__line">
                  <span>{{ $t('wallet.stakeAddress') }}</span>
                  <span class="review-account__value g-mono" :title="row.stakeAddress">{{ shortAddress(row.stakeAddress) }}</span>
                </div>
              </div>
            </div>
          </v-card-text>
        </v-card>

      </div>
    </div>
    </div>

    <!-- The terms stay above the actions, outside the scroll, so however many
         accounts are listed the box that enables Create is always in view. -->
    <div class="terms-row glass-tier">
      <v-checkbox
        color="primary"
        class="mt-0"
        hide-details
        density="compact"
        v-model="termsChecked"
        :disabled="creatingWalletLoader"
      >
        <template v-slot:label>
          <span class="t-body">
            {{ $t('welcome.agreeToTerms') }}
            <a class="terms-link" @click.stop href="https://gerowallet.io/legal/terms/" target="_blank" rel="noopener">{{ $t('navigation.termsOfService') }}</a>.
          </span>
        </template>
      </v-checkbox>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="approval.invalidate(); $emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        tier="primary"
        :loading="creatingWalletLoader"
        :disabled="!termsChecked || creatingWalletLoader"
        @click="walletCreationStep3()"
        class="step-next"
      >
        {{ $t('common.create') }}
      </GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, getCurrentInstance, nextTick, watch } from 'vue';
import { Blockchain, Theme } from '@/models/types';
import GeroStore from '@/stores/geroStore';
import { discoverAccounts, discoveredBalance, type DiscoveredAccount } from '@/shared/utils/accountDiscovery';
import { formatBalance } from '@/shared/utils/format';
import { debugLog } from '@/utils/debug';
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
import GButton from '@/shared/components/GButton/GButton.vue';

interface ConnectionPayload {
  publicKey: string;
  keys: Array<{ publicKey: string; chainCode: string; path: string }>;
  btSupported: boolean;
  xfp?: string;
  firmwareVersion?: string;
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
/** The accounts this step creates: the chosen ones, or the single account a device paired (#0). */
const reviewAccounts = computed<AccountXpub[]>(() => props.accounts
  ?? (props.connection ? [{ accountIndex: 0, publicKey: props.connection.publicKey, keys: props.connection.keys }] : []));

// Addresses and balances are extras for the review, read the way the Accounts step
// reads them (Cardano only). Without them the accounts and paths still show.
const discovered = ref<Record<number, DiscoveredAccount>>({});
watch(reviewAccounts, async (accounts) => {
  const { blockchain: chain, network } = props.network ?? {};
  if (chain !== Blockchain.CARDANO || !network || !accounts.length) return;
  try {
    const found = await discoverAccounts(chain, network, accounts);
    discovered.value = Object.fromEntries(found.map((account) => [account.accountIndex, account]));
  } catch (error) {
    debugLog('StepReview: account lookup failed', { chain, network, error });
  }
}, { immediate: true });

const accountRows = computed(() => [...reviewAccounts.value]
  .sort((a, b) => a.accountIndex - b.accountIndex)
  .map((account) => {
    const found = discovered.value[account.accountIndex];
    const used = found?.activity === 'used';
    return {
      accountIndex: account.accountIndex,
      label: t('accounts.label', { index: account.accountIndex }),
      path: account.keys[0]?.path ?? '',
      address: found?.address ?? '',
      stakeAddress: found?.stakeAddress ?? '',
      balance: used && found?.balance != null ? `${formatBalance(discoveredBalance(found) ?? 0)} ${props.network.currencySymbol}` : '',
      status: used ? t('accounts.used') : found?.activity === 'unused' ? t('miniGero.new') : '',
    };
  }));

const shortAddress = (address: string): string => (address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-8)}` : address);

const recordFields = () => ({
  type: props.walletType,
  theme: Theme.GERO,
  chain: props.network?.blockchain,
  network: props.network?.network,
  icon: networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || ''),
  btSupported: props.connection?.btSupported,
  ...(props.connection?.xfp ? { xfp: props.connection.xfp } : {}),
  ...(props.connection?.firmwareVersion ? { firmwareVersion: props.connection.firmwareVersion } : {}),
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
    // The terms are the step's one required answer (they used to be a form rule).
    if (termsChecked.value && current()) {
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
// Summary card: type comes from the ramp classes in the markup; these rules
// only set line height and lift each value to the primary tone.
.summary-label { line-height: 1.2; }
.summary-value { color: var(--g-text-1); line-height: 1.3; }

// Type, network, firmware and fingerprint in one row (two on a phone), instead
// of a row of two per pair with dividers.
.review-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--g-s-3);

  @media (max-width: 600px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.review-fact {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;

  &__text {
    min-width: 0;
  }
}

// One block per account: name, path, balance and status on a line, then its
// first receive and stake addresses. Hairlines between accounts.
.review-account {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--g-s-1) 0;

  & + & {
    border-top: 1px solid var(--g-hairline-1);
  }

  &__head {
    display: flex;
    align-items: baseline;
    gap: var(--g-s-3);
  }

  &__path {
    color: var(--g-text-3);
  }

  // Receive and stake address side by side, so an account takes two lines.
  &__addresses {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--g-s-4);

    @media (max-width: 600px) {
      grid-template-columns: 1fr;
      gap: var(--g-s-1);
    }
  }

  &__line {
    display: flex;
    gap: var(--g-s-2);
    min-width: 0;
  }

  &__value {
    color: var(--g-text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    word-break: normal;
  }
}

// The terms line is a tier card like the summary, pinned between the scrolling
// content and the action row.
.terms-row {
  flex-shrink: 0;
  margin-top: var(--g-s-3);
  padding: var(--g-s-1) var(--g-s-2);
  border-radius: var(--g-r-card);
}

// The accent, not the browser's purple link colour.
.terms-link {
  color: var(--g-accent);
  text-underline-offset: 2px;

  &:hover {
    text-decoration-thickness: 2px;
  }
}

.wallet-name-field {
  :deep(input) {
    font-size: 14px;
    font-weight: 500;
    color: var(--g-text-1);
    padding: 0;
  }
}
</style>
