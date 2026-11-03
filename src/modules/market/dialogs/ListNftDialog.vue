<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t(isReprice ? 'nftMarket.actions.editPrice' : 'nftMarket.actions.list')"
    :subtitle="t(isReprice ? 'nftMarket.reprice.subtitle' : 'nftMarket.list.subtitle')"
    icon="mdi-tag-outline"
    size="md"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text class="list-nft pt-2 px-5 pb-5" data-testid="list-nft">
      <ListingNftLine :name="nft.name" :image="nft.img" :caption="policyCaption" />

      <!-- A hardware wallet no device has signed a market transaction with yet: nothing to ask of anyone. -->
      <p v-if="credentials.deviceBlocked.value" class="t-body-sm" data-testid="list-nft-hardware">
        {{ t('legacyListings.hardwareSoon') }}
      </p>

      <!-- The worker is having Nexus build the transaction and checking it. -->
      <div v-else-if="view === 'preparing'" class="list-nft__wait" data-testid="list-nft-preparing">
        <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" role="status" :aria-label="t('common.loading')" />
      </div>

      <!-- What the worker verified the transaction does. Nothing here comes from Nexus's word. -->
      <template v-else-if="view === 'review' && verified && summary">
        <div data-testid="list-nft-review">
          <p class="list-nft__heading t-label">{{ t(isReprice ? 'nftMarket.reprice.review' : 'nftMarket.list.review') }}</p>
          <dl v-if="verified.oldPrice !== null" class="list-nft__old glass-tier">
            <div class="list-nft__old-row" data-testid="list-nft-old-price">
              <dt class="t-caption">{{ t('nftMarket.reprice.current') }}</dt>
              <dd class="t-body-sm g-num">{{ ada(verified.oldPrice) }} ADA</dd>
            </div>
          </dl>
          <ListingBreakdown
            :price="verified.price"
            :fee="verified.fee"
            :royalties="verified.royalties"
            :seller-receives="verified.sellerReceives"
            :dropped="verified.dropped"
            :invalid-recipients="verified.invalidRecipients"
            :min-utxo="minUtxo"
            :deposit="verified.deposit"
            :network-fee="verified.networkFee"
          />
        </div>
        <p v-if="summary.sponsoredCollateralRef" class="list-nft__sponsored t-caption" data-testid="list-nft-sponsored">
          <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
          <span>{{ t('legacyListings.sponsored') }}</span>
        </p>

        <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mt-3" data-testid="list-nft-error">
          {{ failureText }}
        </v-alert>

        <PreparedTxCredentials :credentials="credentials" testid="list-nft" :tx-id="summary.txId" />
        <div class="list-nft__actions">
          <GButton tier="secondary" :disabled="busy" data-testid="list-nft-back" @click="back()">
            {{ t('common.back') }}
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
            data-testid="list-nft-confirm"
            @click="credentials.send()"
          >
            {{ t('common.confirm') }}
          </GButton>
        </div>
      </template>

      <!-- Submitted. -->
      <template v-else-if="view === 'done'">
        <div class="text-center py-2" data-testid="list-nft-done">
          <v-icon size="48" color="var(--g-success)">mdi-check-circle-outline</v-icon>
          <p class="t-heading mt-2">{{ t(isReprice ? 'nftMarket.reprice.done' : 'nftMarket.list.done') }}</p>
          <p class="t-caption mt-2">{{ t('transactions.transactionId') }}</p>
          <p class="t-caption g-mono list-nft__wrap">
            {{ flow.submittedTxId.value }}
            <CopyButton x-small :value="flow.submittedTxId.value ?? ''" class="ml-1" />
          </p>
          <GButton v-if="txExplorerUrl" tier="tertiary" compact :href="txExplorerUrl" target="_blank" rel="noopener noreferrer" data-testid="list-nft-explorer">
            {{ t('market.viewOnExplorer') }}
          </GButton>
        </div>
        <div class="list-nft__actions">
          <GButton tier="primary" block data-testid="list-nft-done-button" @click="close()">{{ t('common.done') }}</GButton>
        </div>
      </template>

      <!-- Nothing was built, or the submit was not confirmed. -->
      <template v-else-if="view === 'failed'">
        <v-alert type="error" variant="tonal" density="compact" data-testid="list-nft-error">
          {{ failureText }}
        </v-alert>
        <div class="list-nft__actions">
          <GButton tier="secondary" data-testid="list-nft-close" @click="close()">{{ t('common.close') }}</GButton>
          <!-- Only a failure that something can fix offers a way on: building again, or looking at
               what changed first. A refusal that would fail the same way, and a signed transaction
               that may be on chain, offer neither. -->
          <GButton v-if="failureKind === 'retry'" tier="primary" data-testid="list-nft-retry" @click="retry()">{{ t('common.tryAgain') }}</GButton>
          <GButton v-else-if="failureKind === 'changed'" tier="primary" data-testid="list-nft-refresh" @click="refresh()">{{ t('common.refresh') }}</GButton>
          <!-- Signed, and the network did not confirm: it may be on chain. Look, never rebuild. -->
          <GButton v-else-if="failureKind === 'maybeSent'" tier="primary" data-testid="list-nft-activity" @click="viewActivity()">{{ t('nftMarket.actions.viewActivity') }}</GButton>
        </div>
      </template>

      <!-- The price. -->
      <template v-else>
        <dl v-if="isReprice && existing" class="list-nft__old glass-tier">
          <div class="list-nft__old-row" data-testid="list-nft-old-price">
            <dt class="t-caption">{{ t('nftMarket.reprice.current') }}</dt>
            <dd class="t-body-sm g-num">{{ ada(existing.datum.price) }} ADA</dd>
          </div>
        </dl>

        <dl v-if="floorLovelace !== null || lastSaleLovelace !== null" class="list-nft__hints">
          <div v-if="floorLovelace !== null" class="list-nft__hint" data-testid="list-nft-floor">
            <dt class="t-caption">{{ t('portfolio.floorPrice') }}</dt>
            <dd class="t-body-sm g-num">{{ ada(floorLovelace) }} ADA</dd>
          </div>
          <div v-if="lastSaleLovelace !== null" class="list-nft__hint" data-testid="list-nft-last-sale">
            <dt class="t-caption">{{ t('portfolio.lastSale') }}</dt>
            <dd class="t-body-sm g-num">{{ ada(lastSaleLovelace) }} ADA</dd>
          </div>
        </dl>

        <v-text-field
          :model-value="priceText"
          :label="t('common.price')"
          inputmode="decimal"
          variant="outlined"
          density="comfortable"
          autocomplete="off"
          suffix="ADA"
          :error-messages="priceErrors"
          :disabled="busy"
          data-testid="list-nft-price"
          @update:model-value="onPriceInput($event)"
          @keydown.enter="review()"
        />

        <!-- The terms the royalties come from. A listing is never priced without them. -->
        <p v-if="!isReprice && royaltiesState === 'loading'" class="t-caption list-nft__note" data-testid="list-nft-royalties-loading">
          {{ t('nftMarket.list.royaltiesLoading') }}
        </p>
        <div v-else-if="!isReprice && royaltiesState === 'failed'" class="list-nft__note">
          <v-alert type="error" variant="tonal" density="compact" data-testid="list-nft-royalties-error">
            {{ t('nftMarket.error.royaltiesUnreadable') }}
          </v-alert>
          <GButton tier="tertiary" compact class="mt-2" data-testid="list-nft-royalties-retry" @click="market.load()">
            {{ t('common.tryAgain') }}
          </GButton>
        </div>

        <v-alert v-if="unavailableText" type="error" variant="tonal" density="compact" class="mt-2" data-testid="list-nft-unavailable">
          {{ unavailableText }}
        </v-alert>
        <v-alert v-else-if="termsErrorText" type="error" variant="tonal" density="compact" class="mt-2" data-testid="list-nft-terms-error">
          {{ termsErrorText }}
        </v-alert>

        <ListingBreakdown
          v-if="preview"
          class="mt-3"
          :price="preview.price"
          :fee="preview.fee"
          :royalties="preview.royalties"
          :seller-receives="preview.sellerReceives"
          :dropped="preview.dropped"
          :invalid-recipients="preview.invalidRecipients"
          :min-utxo="minUtxo"
        />

        <!-- Royalties above the usual limit: the seller sees what they cost and agrees, or the listing waits. -->
        <div v-if="needsConfirmation && confirmation" class="list-nft__confirm" data-testid="list-nft-royalty-warning">
          <v-alert type="warning" variant="tonal" density="compact">{{ t('nftMarket.error.royaltyConfirmation') }}</v-alert>
          <v-checkbox
            v-model="confirmed"
            :label="t('nftMarket.list.royaltyConfirm', { amount: confirmation.ada, percent: confirmation.percent })"
            density="compact"
            hide-details
            color="var(--g-accent)"
            data-testid="list-nft-royalty-confirm"
          />
        </div>

        <div class="list-nft__actions">
          <GButton tier="secondary" :disabled="busy" data-testid="list-nft-cancel" @click="close()">{{ t('common.cancel') }}</GButton>
          <GButton tier="primary" :disabled="!canContinue" data-testid="list-nft-continue" @click="review()">{{ t('common.continue') }}</GButton>
        </div>
      </template>
    </v-card-text>

    <!-- Keystone signs by QR: this transaction's request out, the device's signature back in. -->
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
import { useRouter } from 'vue-router';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import PreparedTxCredentials from '@/shared/components/PreparedTxCredentials.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import ListingBreakdown from '@/modules/market/components/ListingBreakdown.vue';
import ListingNftLine from '@/modules/market/components/ListingNftLine.vue';
import { useListingMarketInfo } from '@/modules/market/composables/useListingMarketInfo';
import {
  adaInputText,
  pageRoyaltyMinUtxo,
  parseAdaPrice,
  previewNewListing,
  previewRepricedListing,
  type ListingPreview,
} from '@/modules/market/utils/listingPreview';
import i18n, { getLocaleCode } from '@/plugins/i18n';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { resolveNftUnit } from '@/shared/composables/useCollectibleCollections';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useNftMarketFlow } from '@/shared/composables/useNftMarketFlow';
import { usePreparedTxCredentials } from '@/shared/composables/usePreparedTxCredentials';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import { formatLovelaceAsAda, formatPercentOfFraction } from '@/shared/utils/format';
import { nftMarketDeploymentFor, nftMarketNewestDeployment } from '@/shared/utils/nftMarketAvailability';
import { networkStore } from '@/stores/networkStore';
import {
  MAX_LIST_PRICE,
  MIN_LIST_PRICE,
  MIN_SELLER_SHARE,
  POLICY_ID_HEX_LENGTH,
  isNftMarketHardware,
} from '@/utils/nftMarketDeployments';

/**
 * Lists an NFT for sale, or (given `existing`) changes the price of a listing the wallet already
 * has. Hosted by TokensDialog, which mounts a new one per NFT and action: which of the two it is
 * is fixed for the life of the dialog.
 *
 *   price (live breakdown, the limits, the royalty confirmation) -> Continue
 *     -> preparing -> review (the worker's verified figures) -> credentials -> done  |  a failure
 *
 * The seller types a price in ADA; it becomes an exact lovelace amount (never through a float)
 * and the sheet refuses what the worker would refuse: under MIN_LIST_PRICE, above MAX_LIST_PRICE,
 * a price that leaves the seller less than MIN_SELLER_SHARE after the fee and royalties. The
 * breakdown under it is a preview from the same arithmetic; the worker re-derives everything
 * (NFT_MARKET_PREPARE_LIST / _REPRICE) and the review shows ITS figures, plus the deposit that
 * comes back and the network fee. A collection whose royalties pass the usual 10% (judged on the
 * effective amount) needs the seller's agreement before anything is built.
 *
 * The page names only the NFT (or the listing) and the price: the worker chooses the owner, the
 * seller address, the royalties, the inputs. A hardware wallet no device has signed a market
 * transaction with is told so (NFT_MARKET_HARDWARE_WALLET_TYPES) and nothing is built.
 */
const props = defineProps<{
  isOpen: boolean;
  /** Policy id and hex asset name of the NFT. */
  unit: string;
  /** The wallet's own listing of this NFT: given, the sheet changes its price. */
  existing?: OwnListing;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const router = useRouter();
const isReprice = props.existing !== undefined;
// Ledger only: Bluetooth when the user picks it for this signature, USB otherwise.
const isBT = ref(false);
const flow = useNftMarketFlow(isReprice ? 'reprice' : 'list', { getIsBT: () => isBT.value });
const market = useListingMarketInfo(() => props.unit, { royalties: !isReprice });
const { royaltiesState, floorLovelace, lastSaleLovelace } = market;
const { explorerUrl } = useExplorer();

const stage = computed(() => flow.stage.value);
const failureKind = computed(() => flow.failureKind.value);
const summary = computed(() => flow.prepared.value?.summary ?? null);

const view = computed<'price' | 'preparing' | 'review' | 'done' | 'failed'>(() => {
  if (stage.value === 'done') return 'done';
  if (summary.value && (stage.value === 'review' || stage.value === 'signing' || stage.value === 'submitting')) return 'review';
  if (stage.value === 'preparing') return 'preparing';
  // Nothing built, or a submit that was not confirmed: back at idle with the reason. A royalty
  // confirmation is the one failure that is not an error: it is asked for on the price.
  if (flow.failure.value && failureKind.value !== 'confirmRoyalty') return 'failed';
  return 'price';
});

// The credentials: the password or PassKey the signature needs, the device hint, and what keeps
// them from signing another transaction (PassKey staleness, the wallet it was built for). A
// hardware wallet no device has signed a market transaction with is not allowed: the sheet says so.
const credentials = usePreparedTxCredentials(flow, {
  isBT,
  screen: () => view.value,
  allowsDevice: (walletType) => isNftMarketHardware(walletType),
  // Another wallet closes a sheet that is showing a transaction: the NFT was the last one's.
  isActive: () => props.isOpen,
  onWalletSwitch: () => emit('close'),
});
const busy = credentials.busy;

const ada = (lovelace: bigint): string => formatLovelaceAsAda(lovelace);

// ---- The NFT -------------------------------------------------------------------------------

// The NFT shown is the one the worker verified (`summary.unit`) once there is a summary: the
// review is of that transaction, not of what the page asked for.
const shownUnit = computed(() => summary.value?.unit ?? props.unit);
const nft = computed(() => resolveNftUnit(shownUnit.value));
const policyCaption = computed(() => filters.truncate(shownUnit.value.slice(0, POLICY_ID_HEX_LENGTH)));

// ---- The price -----------------------------------------------------------------------------

const priceText = ref('');
/** The seller has edited the field: an opening price (a reprice starts on the current one) is not an error to show. */
const priceTouched = ref(false);
const confirmed = ref(false);

const parsed = computed(() => parseAdaPrice(priceText.value));
const price = computed<bigint | null>(() => (parsed.value.ok ? parsed.value.lovelace : null));
const samePrice = computed(() => isReprice && price.value !== null && price.value === props.existing?.datum.price);

/** The deployment this price is held to: the newest for a new listing, the listing's own for a reprice. */
const deployment = computed(() => (props.existing ? nftMarketDeploymentFor(props.existing.deploymentVersion) : nftMarketNewestDeployment()));
const minUtxo = computed(() => pageRoyaltyMinUtxo(networkStore.epochParams?.coinsPerUtxoByte));

const preview = computed<ListingPreview | null>(() => {
  const amount = price.value;
  const d = deployment.value;
  if (amount === null || !d) return null;
  if (props.existing) return previewRepricedListing(amount, props.existing.datum.royalties, d);
  const terms = market.royalties.value;
  return terms ? previewNewListing(amount, terms, d, { minUtxo: minUtxo.value }) : null;
});

/** The limits that need no royalty terms, so they show while those are still loading. */
const limitIssue = computed(() => {
  const amount = price.value;
  if (amount === null) return null;
  if (amount < MIN_LIST_PRICE) return 'PRICE_TOO_LOW' as const;
  if (amount > MAX_LIST_PRICE) return 'PRICE_TOO_HIGH' as const;
  return null;
});
const issue = computed(() => limitIssue.value ?? preview.value?.issue ?? null);

/** What is wrong with the price itself, under the field. */
const priceErrors = computed<string[]>(() => {
  const result = parsed.value;
  if ('reason' in result) return result.reason === 'invalid' ? [t('nftMarket.list.priceInvalid')] : [];
  // Continue stays off while the price is the current one (Nexus would build a fee-only no-op), but
  // the sheet opens on that price: say it only once the seller has edited the field.
  if (samePrice.value) return priceTouched.value ? [t('nftMarket.reprice.samePrice')] : [];
  switch (issue.value) {
    case 'PRICE_TOO_LOW': return [t('nftMarket.error.priceTooLow', { min: ada(MIN_LIST_PRICE) })];
    case 'PRICE_TOO_HIGH': return [t('nftMarket.list.priceTooHigh', { max: ada(MAX_LIST_PRICE) })];
    case 'SELLER_SHARE_TOO_LOW': return [t('nftMarket.error.sellerShareTooLow', { min: ada(MIN_SELLER_SHARE) })];
    default: return [];
  }
});
/** What is wrong with the listing rather than the price: royalty terms that cannot be used. */
const termsErrorText = computed(() => (issue.value === 'ROYALTIES_MALFORMED' ? t('nftMarket.error.royaltiesMalformed') : ''));
/** No deployment for this listing or network: the market has nothing to price against. */
const unavailableText = computed(() => {
  if (deployment.value) return '';
  return t(isReprice ? 'nftMarket.error.notListing' : 'nftMarket.error.networkUnsupported');
});

// ---- Royalties above the usual limit -------------------------------------------------------

/** Above the cap on the preview, or the worker says so itself (it re-derives and may disagree). */
const needsConfirmation = computed(() => !isReprice && (preview.value?.overCap === true || failureKind.value === 'confirmRoyalty'));
/** What the seller agrees to: the worker's own figures when it asked, else the preview's effective amount. */
const confirmation = computed(() => {
  if (flow.royaltyConfirmation.value) return flow.royaltyConfirmation.value;
  const p = preview.value;
  return p ? { ada: ada(p.royaltiesTotal), percent: formatPercentOfFraction(p.royaltyFraction, getLocaleCode(i18n.locale)) } : null;
});

const canContinue = computed(() =>
  !busy.value
  && !credentials.deviceBlocked.value
  && price.value !== null
  && preview.value !== null
  && issue.value === null
  && !samePrice.value
  && (isReprice || royaltiesState.value === 'ready')
  && (!needsConfirmation.value || confirmed.value),
);

// A changed price is a different agreement, and a failure was about the last one.
watch(priceText, () => {
  confirmed.value = false;
  if (flow.failure.value) flow.reset();
});
watch(() => market.royalties.value, () => { confirmed.value = false; });

// ---- The review ----------------------------------------------------------------------------

const lovelaceOf = (value: string): bigint => BigInt(value);

/** The worker's verified figures, as the breakdown reads them. Null if a figure does not read back. */
const verified = computed(() => {
  const s = summary.value;
  if (!s) return null;
  try {
    const royalties = 'royalties' in s ? s.royalties.map((r) => ({ address: r.address, lovelace: lovelaceOf(r.lovelace) })) : [...(props.existing?.datum.royalties ?? [])];
    return {
      price: lovelaceOf(s.priceLovelace),
      fee: lovelaceOf(s.marketFeeLovelace),
      royalties,
      sellerReceives: lovelaceOf(s.sellerReceivesLovelace),
      deposit: lovelaceOf(s.depositLovelace),
      networkFee: lovelaceOf(s.networkFeeLovelace),
      dropped: 'dropped' in s ? s.dropped.map((r) => ({ address: r.address, lovelace: lovelaceOf(r.lovelace) })) : [],
      invalidRecipients: 'invalidRecipients' in s ? s.invalidRecipients : 0,
      oldPrice: 'oldPriceLovelace' in s ? lovelaceOf(s.oldPriceLovelace) : null,
    };
  } catch {
    return null;
  }
});

const failureText = computed(() => {
  const message = flow.failureMessage.value;
  return message ? t(message.key, message.params) : '';
});
const txExplorerUrl = computed(() => explorerUrl('tx', flow.submittedTxId.value));

// ---- Actions -------------------------------------------------------------------------------

/** Have the worker build and verify the listing at this price. */
async function review(): Promise<void> {
  const amount = price.value;
  if (!canContinue.value || amount === null) return;
  credentials.begin();
  if (props.existing) {
    await flow.prepare({ ref: props.existing.ref, priceLovelace: amount });
  } else {
    await flow.prepare({ unit: props.unit, priceLovelace: amount, ...(confirmed.value ? { confirmRoyaltyAboveCap: true } : {}) });
  }
}

/** Back to the price, with what was typed. */
function back(): void {
  credentials.clearPassword();
  flow.reset();
}

/** The failure was one building again can fix: ask the worker once more with the same price. */
async function retry(): Promise<void> {
  flow.reset();
  await review();
}

/**
 * Something changed (an NFT moved, a listing was bought, repriced elsewhere). A new listing looks
 * again, from the price. A reprice was opened on the listing the page held (its price, its
 * royalties) and looking again cannot change that, so it closes: reopened after the sync, it
 * starts from the listing as it now is.
 */
function refresh(): void {
  if (isReprice) {
    close();
    return;
  }
  flow.reset();
  void market.load();
}

/** The signed transaction may be on chain: take the seller to their activity. Nothing is rebuilt or re-sent. */
function viewActivity(): void {
  close();
  void router?.push({ path: '/transactions' });
}

function onPriceInput(value: string): void {
  priceTouched.value = true;
  priceText.value = value;
}

/** Start over: a clean flow and a fresh price. */
function start(): void {
  credentials.clearPassword();
  flow.reset();
  confirmed.value = false;
  priceTouched.value = false;
  priceText.value = props.existing ? adaInputText(props.existing.datum.price) : '';
  market.reset();
  void market.load();
}

function close(): void {
  if (busy.value) return;
  credentials.clearPassword();
  emit('close');
}

// State is reset when the dialog opens, not when it closes: the content stays as it was while the
// dialog fades out.
watch(() => props.isOpen, (open) => { if (open) start(); }, { immediate: true });
</script>

<style scoped lang="scss">
.list-nft__wait {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.list-nft__heading {
  margin: 0 0 var(--g-s-2);
}

.list-nft__old {
  margin: 0 0 var(--g-s-3);
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-card);
}

.list-nft__old-row,
.list-nft__hint {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);

  dt {
    color: var(--g-text-2);
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
  }
}

// The collection floor and the NFT's last sale: hints for choosing a price.
.list-nft__hints {
  display: flex;
  gap: var(--g-s-4);
  margin: 0 0 var(--g-s-3);
}

.list-nft__hint {
  flex: 1 1 0;
  flex-direction: column;
  gap: 0;
}

.list-nft__note {
  margin: 0 0 var(--g-s-2);
  color: var(--g-text-2);
}

.list-nft__confirm {
  margin-top: var(--g-s-3);
}

.list-nft__sponsored {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: var(--g-s-2) 0 0;
}

.list-nft__wrap {
  word-break: break-all;
}

.list-nft__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-4);
}
</style>
