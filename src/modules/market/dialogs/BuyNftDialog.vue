<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('nftMarket.buy.title')"
    :subtitle="t('nftMarket.buy.subtitle')"
    icon="mdi-cart-outline"
    size="md"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text class="buy-nft pt-2 px-5 pb-5" data-testid="buy-nft">
      <ListingNftLine :name="nftName" :image="nftImage" :caption="policyCaption" />

      <!-- The policy ID, whole, so it can be compared with the real collection's (ruling R8). -->
      <div class="buy-nft__policy" data-testid="buy-nft-policy">
        <span class="t-caption">{{ t('transactions.policyId') }}</span>
        <span class="t-caption g-mono buy-nft__policy-id">
          {{ listing.policyId }}
          <CopyButton :value="listing.policyId" x-small class="ml-1" />
          <ExplorerLink type="policy" :id="listing.policyId" x-small />
        </span>
      </div>

      <v-alert v-if="lookalike" type="warning" variant="tonal" density="compact" class="mt-3" data-testid="buy-nft-lookalike">
        {{ t('nftMarket.browse.lookalike', { name: lookalike.name, policyId: lookalike.policyId }) }}
      </v-alert>

      <!-- A hardware wallet no device has signed a market transaction with yet: nothing to ask of anyone. -->
      <p v-if="credentials.deviceBlocked.value" class="t-body-sm mt-3" data-testid="buy-nft-hardware">
        {{ t('legacyListings.hardwareSoon') }}
      </p>

      <!-- The worker is having Nexus build the purchase and checking it. -->
      <div v-else-if="view === 'preparing'" class="buy-nft__wait" data-testid="buy-nft-preparing">
        <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" role="status" :aria-label="t('common.loading')" />
      </div>

      <!-- What the worker verified the purchase does. Nothing here comes from Nexus's word or is added up here. -->
      <template v-else-if="view === 'review' && verified && summary">
        <div data-testid="buy-nft-review">
          <p class="buy-nft__heading t-label">{{ t('nftMarket.buy.review') }}</p>

          <v-alert v-if="priceDiffers" type="warning" variant="tonal" density="compact" class="mb-2" data-testid="buy-nft-price-differs">
            {{ t('nftMarket.buy.priceDiffers', { price: ada(verified.price), shown: ada(shownPrice!) }) }}
          </v-alert>

          <dl class="buy-nft__rows glass-tier">
            <div class="buy-nft__row" data-testid="buy-nft-price">
              <dt class="t-caption">{{ t('common.price') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.price) }} ADA</dd>
            </div>
            <div class="buy-nft__row" data-testid="buy-nft-network-fee">
              <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.networkFee) }} ADA</dd>
            </div>
            <div class="buy-nft__row" data-testid="buy-nft-top-up">
              <dt class="t-caption">{{ t('nftMarket.buy.minUtxo') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.topUp) }} ADA</dd>
            </div>
            <div class="buy-nft__row buy-nft__row--total" data-testid="buy-nft-total">
              <dt class="t-caption">{{ t('nftMarket.buy.total') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.total) }} ADA</dd>
            </div>
          </dl>

          <p class="buy-nft__note t-caption" data-testid="buy-nft-deposit-note">
            {{ t('nftMarket.buy.depositNote', { deposit: ada(verified.deposit) }) }}
          </p>
          <p v-if="verified.topUp > 0n" class="buy-nft__note t-caption" data-testid="buy-nft-top-up-note">
            {{ t('nftMarket.buy.minUtxoNote') }}
          </p>
          <p class="buy-nft__note t-caption" data-testid="buy-nft-nft-ada-note">{{ t('nftMarket.buy.nftAdaNote') }}</p>
        </div>
        <p v-if="summary.sponsoredCollateralRef" class="buy-nft__sponsored t-caption" data-testid="buy-nft-sponsored">
          <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
          <span>{{ t('legacyListings.sponsored') }}</span>
        </p>

        <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mt-3" data-testid="buy-nft-error">
          {{ failureText }}
        </v-alert>

        <PreparedTxCredentials :credentials="credentials" testid="buy-nft" :tx-id="summary.txId" />
        <div class="buy-nft__actions">
          <GButton tier="secondary" :disabled="busy" data-testid="buy-nft-cancel" @click="close()">
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
            data-testid="buy-nft-confirm"
            @click="credentials.send()"
          >
            {{ t('common.confirm') }}
          </GButton>
        </div>
      </template>

      <!-- Submitted. -->
      <template v-else-if="view === 'done'">
        <div class="text-center py-2" data-testid="buy-nft-done">
          <v-icon size="48" color="var(--g-success)">mdi-check-circle-outline</v-icon>
          <p class="t-heading mt-2">{{ t('nftMarket.buy.done') }}</p>
          <p class="t-caption mt-2">{{ t('transactions.transactionId') }}</p>
          <p class="t-caption g-mono buy-nft__wrap">
            {{ flow.submittedTxId.value }}
            <CopyButton x-small :value="flow.submittedTxId.value ?? ''" class="ml-1" />
          </p>
          <v-btn v-if="txExplorerUrl" variant="text" size="small" :href="txExplorerUrl" target="_blank" rel="noopener noreferrer">
            {{ t('market.viewOnExplorer') }}
          </v-btn>
        </div>
        <div class="buy-nft__actions">
          <GButton tier="primary" block data-testid="buy-nft-done-button" @click="close()">{{ t('common.done') }}</GButton>
        </div>
      </template>

      <!-- Nothing was built, or the submit was not confirmed. -->
      <template v-else>
        <v-alert type="error" variant="tonal" density="compact" class="mt-3" data-testid="buy-nft-error">
          {{ failureText }}
        </v-alert>
        <div class="buy-nft__actions">
          <GButton tier="secondary" data-testid="buy-nft-close" @click="close()">{{ t('common.close') }}</GButton>
          <!-- Only a failure that something can fix offers a way on: building again, or reloading
               the list to see what changed. A refusal that would fail the same way, and a signed
               purchase that may be on chain, offer neither. -->
          <GButton v-if="canRetry" tier="primary" data-testid="buy-nft-retry" @click="start()">{{ t('common.tryAgain') }}</GButton>
          <GButton v-else-if="failureKind === 'changed'" tier="primary" data-testid="buy-nft-refresh" @click="refreshList()">{{ t('common.refresh') }}</GButton>
        </div>
      </template>
    </v-card-text>

    <!-- Keystone signs by QR: this purchase's request out, the device's signature back in. -->
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
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import PreparedTxCredentials from '@/shared/components/PreparedTxCredentials.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import ListingNftLine from '@/modules/market/components/ListingNftLine.vue';
import type { ListingDto } from '@/api/nft-market-api';
import type { Lookalike } from '@/modules/market/utils/lookalike';
import { resolveNftUnit } from '@/shared/composables/useCollectibleCollections';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useNftMarketFlow } from '@/shared/composables/useNftMarketFlow';
import { usePreparedTxCredentials } from '@/shared/composables/usePreparedTxCredentials';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { isNftMarketHardware } from '@/utils/nftMarketDeployments';

/**
 * Buys one NFT from Gero's market: the worker has Nexus build the purchase and verifies it
 * against the listing and the chain (NFT_MARKET_PREPARE_BUY), the sheet shows what the worker
 * verified, then signs and submits that exact transaction. Hosted by CollectionListings, which
 * mounts one per listing.
 *
 *   open -> preparing -> review (price, network fee, top-up, total; the seller's deposit goes
 *        back to the seller) -> credentials -> submitting -> done (transaction link)  |  a failure
 *
 * Every figure on the review is the worker's (`BuySummary`): the page adds nothing up, so the
 * total is exactly what the wallet's own UTxOs lose. The deposit riding with the NFT is the
 * listing's own ADA, passed on to the seller, and costs the buyer nothing. The page names only
 * the listing; the worker reads it again from Nexus and from the chain, so what the list showed
 * is never what is bought. If its price is not the one the list showed, the sheet says so.
 *
 * The NFT's policy ID is always shown whole (ruling R8), and a lookalike warning from the
 * collection page is shown with the real collection's policy ID beside it.
 *
 * A listing that changed (bought, delisted, repriced) offers Refresh, which has the page read its
 * list again; a signed purchase whose submit was not confirmed may be on chain, so the buyer is
 * sent to their activity and never offered a rebuild. The page is told (`sent`) when a purchase
 * was submitted or may have been, so it stops offering Buy for that listing.
 */
const props = defineProps<{
  isOpen: boolean;
  /** The listing to buy, as the collection page shows it. */
  listing: ListingDto;
  /** Set when the collection's name is that of a popular collection under another policy ID. */
  lookalike?: Lookalike | null;
  /** The NFT's name and picture as the collection page resolved them. */
  name?: string;
  image?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  /** The purchase of this listing (`txHash#index`) was submitted, or may have been. */
  (e: 'sent', ref: string): void;
  /** The listing changed: the page should read its list again. */
  (e: 'refresh'): void;
}>();

const { t } = useTranslation();
// Ledger only: Bluetooth when the user picks it for this signature, USB otherwise.
const isBT = ref(false);
const flow = useNftMarketFlow('buy', { getIsBT: () => isBT.value });
const { explorerUrl } = useExplorer();

const listingRef = computed(() => `${props.listing.txHash}#${props.listing.outputIndex}`);
const stage = computed(() => flow.stage.value);
const failureKind = computed(() => flow.failureKind.value);
const summary = computed(() => flow.prepared.value?.summary ?? null);

/**
 * The worker's verified figures, as bigints, or null if one does not read back or the summary is
 * for another listing than the one on screen (the worker verified the inputs, so that is a fault).
 */
const verified = computed(() => {
  const s = summary.value;
  if (!s || s.ref !== listingRef.value || String(s.unit).toLowerCase() !== props.listing.unit.toLowerCase()) return null;
  try {
    return {
      price: BigInt(s.priceLovelace),
      deposit: BigInt(s.depositLovelace),
      networkFee: BigInt(s.networkFeeLovelace),
      topUp: BigInt(s.minUtxoTopUpLovelace),
      total: BigInt(s.totalOutflowLovelace),
    };
  } catch {
    return null;
  }
});

/** The price the list showed, or null if the row's price does not read. */
const shownPrice = computed(() => {
  try {
    return BigInt(props.listing.priceLovelace);
  } catch {
    return null;
  }
});
const priceDiffers = computed(() => verified.value !== null && shownPrice.value !== null && verified.value.price !== shownPrice.value);

const view = computed<'preparing' | 'review' | 'done' | 'failed'>(() => {
  if (stage.value === 'done') return 'done';
  if (summary.value && (stage.value === 'review' || stage.value === 'signing' || stage.value === 'submitting')) {
    // Never asked to sign what cannot be read back whole.
    return verified.value ? 'review' : 'failed';
  }
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
  // Another wallet closes a sheet that is showing a purchase: it was built for the last one.
  isActive: () => props.isOpen,
  onWalletSwitch: () => emit('close'),
});
const busy = credentials.busy;

const ada = (lovelace: bigint): string => formatLovelaceAsAda(lovelace);

const nft = computed(() => resolveNftUnit(props.listing.unit));
const nftName = computed(() => props.name || nft.value.name);
const nftImage = computed(() => props.image || nft.value.img);
const policyCaption = computed(() => filters.truncate(props.listing.policyId));

const failureText = computed(() => {
  const message = flow.failureMessage.value;
  if (message) return t(message.key, message.params);
  // A summary that could not be read back whole has no code of its own.
  return view.value === 'failed' ? t('nftMarket.error.failed') : '';
});
const canRetry = computed(() => failureKind.value === 'retry' || (failureKind.value === null && view.value === 'failed'));
const txExplorerUrl = computed(() => explorerUrl('tx', flow.submittedTxId.value));

let sentReported = false;

/** Start over: a clean flow, then have the worker build the purchase of this listing. */
function start(): void {
  credentials.begin();
  flow.reset();
  sentReported = false;
  if (credentials.deviceBlocked.value) return;
  void flow.prepare({ ref: listingRef.value });
}

function close(): void {
  if (busy.value) return;
  credentials.clearPassword();
  emit('close');
}

/** The listing changed: have the page read its list again, and leave. Nothing is built again here. */
function refreshList(): void {
  emit('refresh');
  close();
}

// The page stops offering Buy for a listing once a purchase of it went out or may have: it is
// told once, whether the submit was confirmed or not.
watch([stage, failureKind], ([s, kind]) => {
  if (sentReported || (s !== 'done' && kind !== 'maybeSent')) return;
  sentReported = true;
  emit('sent', listingRef.value);
});

// State is reset when the dialog opens, not when it closes: the content stays as it was while the
// dialog fades out. Starts the build, whose outcome everything above watches.
watch(() => props.isOpen, (open) => { if (open) start(); }, { immediate: true });
</script>

<style scoped lang="scss">
.buy-nft__wait {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.buy-nft__policy {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  color: var(--g-text-2);
}

.buy-nft__policy-id {
  color: var(--g-text-1);
  overflow-wrap: anywhere;
}

.buy-nft__heading {
  margin: var(--g-s-3) 0 var(--g-s-2);
}

.buy-nft__rows {
  margin: 0;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}

.buy-nft__row {
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

.buy-nft__row--total {
  margin-top: var(--g-s-1);
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-2);

  dt,
  dd {
    color: var(--g-text-1);
    font-weight: 600;
  }
}

.buy-nft__note {
  margin: var(--g-s-2) 0 0;
  color: var(--g-text-2);
}

.buy-nft__sponsored {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: var(--g-s-2) 0 0;
}

.buy-nft__wrap {
  word-break: break-all;
}

.buy-nft__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-4);
}
</style>
