<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('nftMarket.actions.unlist')"
    :subtitle="t('nftMarket.unlist.subtitle')"
    icon="mdi-tag-off-outline"
    size="md"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text class="unlist-nft pt-2 px-5 pb-5" data-testid="unlist-nft">
      <ListingNftLine :name="nft.name" :image="nft.img" :caption="policyCaption" />

      <!-- A hardware wallet no device has signed a market transaction with yet: nothing to ask of anyone. -->
      <p v-if="credentials.deviceBlocked.value" class="t-body-sm" data-testid="unlist-nft-hardware">
        {{ t('legacyListings.hardwareSoon') }}
      </p>

      <!-- The worker is having Nexus build the cancel and checking it. -->
      <div v-else-if="view === 'preparing'" class="unlist-nft__wait" data-testid="unlist-nft-preparing">
        <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" role="status" :aria-label="t('common.loading')" />
      </div>

      <!-- What the worker verified the cancel does. Nothing here comes from Nexus's word. -->
      <template v-else-if="view === 'review' && verified && summary">
        <div data-testid="unlist-nft-review">
          <p class="unlist-nft__heading t-label">{{ t('nftMarket.unlist.review') }}</p>
          <dl class="unlist-nft__rows glass-tier">
            <div class="unlist-nft__row" data-testid="unlist-nft-nft">
              <dt class="t-caption">{{ t('assets.nft') }}</dt>
              <dd class="t-body-sm unlist-nft__name">{{ nft.name }}</dd>
            </div>
            <div class="unlist-nft__row" data-testid="unlist-nft-deposit">
              <dt class="t-caption">{{ t('nftMarket.breakdown.deposit') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.deposit) }} {{ ticker }}</dd>
            </div>
            <div class="unlist-nft__row" data-testid="unlist-nft-network-fee">
              <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.networkFee) }} {{ ticker }}</dd>
            </div>
          </dl>
          <p class="unlist-nft__note t-caption">{{ t('nftMarket.breakdown.depositHint') }}</p>
        </div>
        <p v-if="summary.sponsoredCollateralRef" class="unlist-nft__sponsored t-caption" data-testid="unlist-nft-sponsored">
          <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
          <span>{{ t('legacyListings.sponsored') }}</span>
        </p>

        <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mt-3" data-testid="unlist-nft-error">
          {{ failureText }}
        </v-alert>

        <PreparedTxCredentials :credentials="credentials" testid="unlist-nft" :tx-id="summary.txId" />
        <div class="unlist-nft__actions">
          <GButton tier="secondary" :disabled="busy" data-testid="unlist-nft-cancel" @click="close()">
            {{ t('common.cancel') }}
          </GButton>
          <PassKeyAuthButton
            v-if="credentials.isPrfWallet.value"
            :block="false"
            :disabled="busy"
            :text="t('common.confirm')"
            @success="credentials.sendWithPassKey"
            @error="credentials.onPassKeyError"
          />
          <GButton
            v-else
            tier="primary"
            :loading="busy"
            :disabled="busy || (credentials.usesPassword.value && !credentials.password.value)"
            data-testid="unlist-nft-confirm"
            @click="credentials.send()"
          >
            {{ t('common.confirm') }}
          </GButton>
        </div>
      </template>

      <!-- Submitted. -->
      <template v-else-if="view === 'done'">
        <div class="text-center py-2" data-testid="unlist-nft-done">
          <v-icon size="48" color="var(--g-success)">mdi-check-circle-outline</v-icon>
          <p class="t-heading mt-2">{{ t('nftMarket.unlist.done') }}</p>
          <p class="t-caption mt-2">{{ t('transactions.transactionId') }}</p>
          <p class="t-caption g-mono unlist-nft__wrap">
            {{ flow.submittedTxId.value }}
            <CopyButton x-small :value="flow.submittedTxId.value ?? ''" class="ml-1" />
          </p>
          <GButton v-if="txExplorerUrl" tier="tertiary" compact :href="txExplorerUrl" target="_blank" rel="noopener noreferrer" data-testid="unlist-nft-explorer">
            {{ t('market.viewOnExplorer') }}
          </GButton>
        </div>
        <div class="unlist-nft__actions">
          <GButton tier="primary" block data-testid="unlist-nft-done-button" @click="close()">{{ t('common.done') }}</GButton>
        </div>
      </template>

      <!-- Nothing was built, or the submit was not confirmed. -->
      <template v-else>
        <v-alert type="error" variant="tonal" density="compact" data-testid="unlist-nft-error">
          {{ failureText }}
        </v-alert>
        <div class="unlist-nft__actions">
          <GButton tier="secondary" data-testid="unlist-nft-close" @click="close()">{{ t('common.close') }}</GButton>
          <!-- Only a failure that something can fix offers a way on: building again, or looking at
               what changed first. A refusal that would fail the same way, and a signed transaction
               that may be on chain, offer neither. -->
          <GButton v-if="failureKind === 'retry'" tier="primary" data-testid="unlist-nft-retry" @click="start()">{{ t('common.tryAgain') }}</GButton>
          <GButton v-else-if="failureKind === 'changed'" tier="primary" data-testid="unlist-nft-refresh" @click="start()">{{ t('common.refresh') }}</GButton>
          <!-- Signed, and the network did not confirm: it may be on chain. Look, never rebuild. -->
          <GButton v-else-if="failureKind === 'maybeSent'" tier="primary" data-testid="unlist-nft-activity" @click="viewActivity()">{{ t('nftMarket.actions.viewActivity') }}</GButton>
        </div>
      </template>
    </v-card-text>

    <!-- Keystone signs by QR: this cancel's request out, the device's signature back in. -->
    <KeystoneSignDialog
      v-if="flow.keystone.keystoneShow.value"
      :is-open="flow.keystone.keystoneShow.value"
      :keystone-type="flow.keystone.keystoneType.value"
      :keystone-cbor="flow.keystone.keystoneCbor.value"
      @scan="flow.keystone.onKeystoneScan"
      @error="flow.keystone.failKeystone"
      @close="flow.keystone.cancelKeystone"
    />
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import { useRouter } from 'vue-router';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import PreparedTxCredentials from '@/shared/components/PreparedTxCredentials.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import ListingNftLine from '@/modules/market/components/ListingNftLine.vue';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { resolveNftUnit } from '@/shared/composables/useCollectibleCollections';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useNftMarketFlow } from '@/shared/composables/useNftMarketFlow';
import { usePreparedTxCredentials } from '@/shared/composables/usePreparedTxCredentials';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { POLICY_ID_HEX_LENGTH, isNftMarketHardware } from '@/utils/nftMarketDeployments';

/**
 * Takes an NFT off the market: the worker builds and verifies the cancel of the wallet's own
 * listing (NFT_MARKET_PREPARE_CANCEL), the sheet shows what comes back (the NFT and the deposit,
 * both to the wallet's own address) and what the transaction costs, then signs and submits it.
 * Hosted by TokensDialog, which mounts one per listing.
 *
 *   open -> preparing -> review (NFT, deposit, network fee, who lends collateral) -> credentials
 *        -> submitting -> done (transaction link)  |  a failure
 *
 * The page names only the listing: the worker finds it among the wallet's own, chooses where
 * everything returns to, and checks the built transaction before anything can be signed. A
 * listing the worker no longer finds (bought, repriced, delisted elsewhere) is said to have
 * changed and the seller may look again; a signed cancel whose submit was not confirmed may be on
 * chain, so the seller is sent to their activity and never offered a rebuild. A hardware wallet no
 * device has signed a market transaction with is told so (NFT_MARKET_HARDWARE_WALLET_TYPES) and
 * nothing is built.
 */
const props = defineProps<{
  isOpen: boolean;
  /** The wallet's own listing to take down. */
  existing: OwnListing;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const { currencyTicker: ticker } = useNativeCurrency();
const router = useRouter();
// Ledger only: Bluetooth when the user picks it for this signature, USB otherwise.
const isBT = ref(false);
const flow = useNftMarketFlow('cancel', { getIsBT: () => isBT.value });
const { explorerUrl } = useExplorer();

const stage = computed(() => flow.stage.value);
const failureKind = computed(() => flow.failureKind.value);
const summary = computed(() => flow.prepared.value?.summary ?? null);

const view = computed<'preparing' | 'review' | 'done' | 'failed'>(() => {
  if (stage.value === 'done') return 'done';
  if (summary.value && (stage.value === 'review' || stage.value === 'signing' || stage.value === 'submitting')) return 'review';
  // Nothing built, or a submit that was not confirmed: back at idle with the reason.
  if (stage.value === 'idle' && flow.failure.value) return 'failed';
  return 'preparing';
});

// The credentials: the password or PassKey the signature needs, the device hint, and what keeps
// them from signing another transaction (PassKey staleness, the wallet it was built for). A
// hardware wallet no device has signed a market transaction with is not allowed: the sheet says so.
const credentials = usePreparedTxCredentials(flow, {
  isBT,
  screen: () => view.value,
  allowsDevice: (walletType) => isNftMarketHardware(walletType),
  // Another wallet closes a sheet that is showing a cancel: the listing was the last one's.
  isActive: () => props.isOpen,
  onWalletSwitch: () => emit('close'),
});
const busy = credentials.busy;

const ada = (lovelace: bigint): string => formatLovelaceAsAda(lovelace);

// The NFT shown is the one the worker verified (`summary.unit`) once there is a summary: the
// review is of that transaction, not of what the page asked for.
const shownUnit = computed(() => summary.value?.unit ?? props.existing.unit);
const nft = computed(() => resolveNftUnit(shownUnit.value));
const policyCaption = computed(() => filters.truncate(shownUnit.value.slice(0, POLICY_ID_HEX_LENGTH)));

/** The worker's verified figures. Null if one does not read back. */
const verified = computed(() => {
  const s = summary.value;
  if (!s) return null;
  try {
    return { deposit: BigInt(s.depositLovelace), networkFee: BigInt(s.networkFeeLovelace) };
  } catch {
    return null;
  }
});

const failureText = computed(() => {
  const message = flow.failureMessage.value;
  return message ? t(message.key, message.params) : '';
});
const txExplorerUrl = computed(() => explorerUrl('tx', flow.submittedTxId.value));

/** Start over: a clean flow, then have the worker build the cancel of this listing. */
function start(): void {
  credentials.begin();
  flow.reset();
  if (credentials.deviceBlocked.value) return;
  void flow.prepare({ ref: props.existing.ref });
}

function close(): void {
  if (busy.value) return;
  credentials.clearPassword();
  emit('close');
}

/** The signed cancel may be on chain: take the seller to their activity. Nothing is rebuilt or re-sent. */
function viewActivity(): void {
  close();
  void router?.push({ path: '/transactions' });
}

// State is reset when the dialog opens, not when it closes: the content stays as it was while the
// dialog fades out. Starts the build, whose outcome everything above watches.
watch(() => props.isOpen, (open) => { if (open) start(); }, { immediate: true });
</script>

<style scoped lang="scss">
.unlist-nft__wait {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.unlist-nft__heading {
  margin: 0 0 var(--g-s-2);
}

.unlist-nft__rows {
  margin: 0;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}

.unlist-nft__row {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-1) 0;

  dt {
    color: var(--g-text-2);
    flex-shrink: 0;
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
    text-align: right;
  }
}

.unlist-nft__name {
  overflow-wrap: anywhere;
}

.unlist-nft__note {
  margin: var(--g-s-2) 0 0;
  color: var(--g-text-2);
}

.unlist-nft__sponsored {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: var(--g-s-2) 0 0;
}

.unlist-nft__wrap {
  word-break: break-all;
}

.unlist-nft__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-4);
}
</style>
