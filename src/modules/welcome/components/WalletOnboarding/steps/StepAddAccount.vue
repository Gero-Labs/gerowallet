<template>
  <div class="step-add-account">
    <div class="step-scroll">
      <p class="add-account__intro t-body-lg">{{ t('accounts.addingAccountTo', { index: accountIndex, name: wallet.name }) }}</p>

      <template v-if="!preview">
        <v-text-field
          v-if="kind === 'password'"
          v-model="password"
          :type="showPassword ? 'text' : 'password'"
          :label="t('security.spendingPassword')"
          :hint="t('accounts.passwordToAdd', { name: wallet.name })"
          persistent-hint
          :error-messages="error ? [error] : []"
          variant="filled"
          density="compact"
          autocomplete="current-password"
          :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append-inner="showPassword = !showPassword"
          @keyup.enter="unlock()"
        />
        <p v-else class="add-account__hint t-body-sm" :class="{ 'add-account__hint--error': !!error }" role="status">
          {{ error || (kind === 'passkey' ? t('accounts.passKeyToAdd') : t('accounts.checking')) }}
        </p>
      </template>

      <div v-else class="account-preview glass-tier">
        <span class="account-preview__text">
          <span class="account-preview__name t-body">{{ t('accounts.label', { index: accountIndex }) }}</span>
          <span v-if="preview.address" class="account-preview__address g-mono" :title="preview.address">{{ shortAddress(preview.address) }}</span>
        </span>
        <span class="account-preview__meta">
          <span v-if="balance" class="account-preview__balance t-body-sm g-num">{{ balance }}</span>
          <span class="t-caption">{{ statusLabel }}</span>
        </span>
      </div>
    </div>

    <div class="onboarding-actions step-actions d-flex">
      <GButton tier="tertiary" :disabled="busy" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton v-if="!preview" tier="primary" class="step-next" :loading="busy" :disabled="!canUnlock" @click="unlock()">
        {{ kind === 'passkey' ? t('security.authenticateWithPassKey') : $t('common.continue') }}
      </GButton>
      <GButton v-else tier="primary" class="step-next" :loading="busy" @click="add()">{{ t('accounts.addAccount') }}</GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { Blockchain, type Wallet } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';
import { Messaging } from '@/chrome/messaging';
import GeroStore, { geroStore } from '@/stores/geroStore';
import snackbar from '@/plugins/snackbar';
import { discoverAccounts, discoverBitcoinAccounts, type DiscoveredAccount } from '@/shared/utils/accountDiscovery';
import { formatBalance } from '@/shared/utils/format';
import { toLovelace } from '@/shared/utils/lovelace';
import { nextAccountIndex, type AccountXpub } from '@/shared/utils/walletAccount';
import type { NetworkInfo } from '@/utils/networks';

const props = defineProps<{
  network: NetworkInfo;
  /** Account #0 of the wallet: the record holding its secrets. */
  wallet: Wallet;
}>();
defineEmits<{ (e: 'back'): void }>();

const { t } = useTranslation();
const router = useRouter();

/** How this wallet proves it is the user's: spending password, PassKey, or its unlocked Google session. */
const kind = computed<'password' | 'passkey' | 'google'>(() => {
  if (props.wallet.encryptionMethod === 'prf') return 'passkey';
  if (props.wallet.encryptionMethod === 'mpc') return 'google';
  return 'password';
});
const accountIndex = computed(() => nextAccountIndex(props.wallet, geroStore.wallets));
const isBitcoin = computed(() => props.wallet.chain === Blockchain.BITCOIN);

const password = ref('');
const showPassword = ref(false);
const busy = ref(false);
const error = ref('');
const account = ref<AccountXpub | null>(null);
const preview = ref<DiscoveredAccount | null>(null);
const canUnlock = computed(() => !busy.value && (kind.value !== 'password' || !!password.value));

const ERRORS: Record<string, string> = {
  'wrong-password': 'errors.wrongPassword',
  locked: 'accounts.unlockToAdd',
};

/** The account's xpub, found with the wallet's credential; only the public key reaches this page from the background. */
async function deriveXpub(): Promise<string> {
  if (kind.value === 'passkey') return derivePassKeyXpub();
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.DERIVE_ACCOUNT_XPUB,
    data: { walletId: props.wallet.id, accountIndex: accountIndex.value, ...(kind.value === 'password' ? { password: password.value } : {}) },
  }) as { data?: { success?: boolean; publicKey?: string; error?: string } };
  if (!response?.data?.success || !response.data.publicKey) {
    throw new Error(response?.data?.error ?? 'not-supported');
  }
  return response.data.publicKey;
}

/**
 * A PassKey wallet's root key can only be decrypted where WebAuthn runs, in this
 * page (the documented PRF exception): derive here and wipe it straight away.
 */
async function derivePassKeyXpub(): Promise<string> {
  if (isBitcoin.value) return deriveBitcoinPassKeyXpub();
  const { webAuthnCredentialId, prfEncryptedPrivateKey } = props.wallet;
  if (!webAuthnCredentialId || !prfEncryptedPrivateKey) throw new Error('not-supported');
  const [{ evaluateWalletPrf }, { decryptPrivateKeyWithPrf }, { Bip32PrivateKey }, { deriveAccountXpubs }] = await Promise.all([
    import('@/shared/utils/passkeyPrf'),
    import('@/shared/utils/webauthn-prf'),
    import('@cardano-sdk/crypto'),
    import('@/shared/utils/softwareAccounts'),
  ]);
  const prf = await evaluateWalletPrf({ id: props.wallet.id, webAuthnCredentialId, webAuthnTransports: props.wallet.webAuthnTransports });
  let rootKeyBytes: Uint8Array | undefined;
  try {
    rootKeyBytes = await decryptPrivateKeyWithPrf(prfEncryptedPrivateKey, webAuthnCredentialId, String(props.wallet.id), prf);
    const [own, next] = await deriveAccountXpubs(Bip32PrivateKey.fromBytes(rootKeyBytes), [0, accountIndex.value]);
    if (own.publicKey.toLowerCase() !== props.wallet.publicKey?.toLowerCase()) throw new Error('not-supported');
    return next.publicKey;
  } finally {
    rootKeyBytes?.fill(0);
    new Uint8Array(prf).fill(0);
  }
}

/**
 * A Bitcoin wallet's stored root key has no chain code, so its accounts come from
 * its recovery phrase, decrypted here with the PassKey and checked against the
 * wallet's own account-#0 xpub (base58: compared exactly).
 */
async function deriveBitcoinPassKeyXpub(): Promise<string> {
  const { webAuthnCredentialId, prfEncryptedMnemonic } = props.wallet;
  if (!webAuthnCredentialId || !prfEncryptedMnemonic) throw new Error('not-supported');
  const [{ evaluateWalletPrf }, { decryptMnemonicWithPrfOutput }, { deriveAccountXpubsFromMnemonic }] = await Promise.all([
    import('@/shared/utils/passkeyPrf'),
    import('@/shared/utils/webauthn-prf'),
    import('@/shared/utils/softwareAccounts'),
  ]);
  const prf = await evaluateWalletPrf({ id: props.wallet.id, webAuthnCredentialId, webAuthnTransports: props.wallet.webAuthnTransports });
  try {
    const mnemonic = await decryptMnemonicWithPrfOutput(prfEncryptedMnemonic, prf, webAuthnCredentialId, String(props.wallet.id));
    const chain = { chain: props.wallet.chain, network: props.wallet.network, addressType: props.wallet.addressType };
    const [own, next] = await deriveAccountXpubsFromMnemonic(mnemonic, [0, accountIndex.value], chain);
    if (own.publicKey !== props.wallet.publicKey) throw new Error('not-supported');
    return next.publicKey;
  } finally {
    new Uint8Array(prf).fill(0);
  }
}

/** The account's address and whether it has been used, on the wallet's own chain and network, for the preview. */
async function probe(found: AccountXpub): Promise<DiscoveredAccount> {
  const { chain, network } = props.wallet;
  const [result] = isBitcoin.value
    ? await discoverBitcoinAccounts(network, props.wallet.addressType ?? 'segwit', [found])
    : await discoverAccounts(chain, network, [found]);
  return result;
}

async function unlock(): Promise<void> {
  if (!canUnlock.value) return;
  busy.value = true;
  error.value = '';
  try {
    account.value = { accountIndex: accountIndex.value, publicKey: await deriveXpub(), keys: [] };
    preview.value = await probe(account.value);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    error.value = t(ERRORS[code] ?? 'errors.unknownError', { name: props.wallet.name });
  } finally {
    password.value = '';
    busy.value = false;
  }
}

async function add(): Promise<void> {
  if (!account.value || busy.value) return;
  busy.value = true;
  try {
    const [created] = await GeroStore.addAccounts(props.wallet.id, [{
      name: t('accounts.label', { index: account.value.accountIndex }),
      publicKey: account.value.publicKey,
      accountIndex: account.value.accountIndex,
    }]);
    if (created) {
      await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet: created } });
    }
    await router.push('/').catch(() => undefined);
  } catch (e) {
    console.error('Adding the account failed:', e instanceof Error ? e.message : 'unknown');
    snackbar.setError(t('errors.unknownError'));
  } finally {
    busy.value = false;
  }
}

const balance = computed(() => (preview.value?.activity === 'used' && preview.value.balance != null
  ? `${formatBalance(Number(toLovelace(preview.value.balance)) / 1_000_000)} ${props.network.currencySymbol}`
  : ''));
const statusLabel = computed(() => {
  if (preview.value?.activity === 'used') return t('accounts.used');
  if (preview.value?.activity === 'unknown') return t('common.unknown');
  return t('miniGero.new');
});
const shortAddress = (address: string) => (address.length > 24 ? `${address.slice(0, 12)}…${address.slice(-8)}` : address);

// A Google wallet needs no credential here: it uses the session it was unlocked with.
onMounted(() => {
  if (kind.value === 'google') void unlock();
});
</script>

<style scoped lang="scss">
// Type comes from the ramp classes in the markup; these rules only lay out.
.add-account__intro { margin: 0 0 var(--g-s-3); text-align: left; }
.add-account__hint { margin: 0; text-align: left; }
.add-account__hint--error { color: var(--g-error); }
// The same nested card as an account row on the accounts step, not interactive.
.account-preview { display: flex; align-items: center; gap: var(--g-s-3); min-height: var(--g-row-h-panel); padding: var(--g-s-3); }
.account-preview__text { display: flex; flex-direction: column; gap: var(--g-s-1); flex: 1; min-width: 0; text-align: left; }
.account-preview__name { color: var(--g-text-1); font-weight: 500; }
// One truncated line, so the mono recipe's break-all wrapping is switched off.
.account-preview__address { line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: normal; }
.account-preview__meta { display: flex; flex-direction: column; align-items: flex-end; gap: var(--g-s-1); flex: none; }
.account-preview__balance { color: var(--g-text-1); }
.step-actions { gap: var(--g-s-3); }
</style>
