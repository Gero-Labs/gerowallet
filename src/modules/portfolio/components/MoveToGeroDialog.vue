<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('nftMarket.move.action')"
    :subtitle="t('nftMarket.move.subtitle')"
    icon="mdi-swap-horizontal-bold"
    size="md"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text class="move-to-gero pt-2 px-5 pb-5" data-testid="move-to-gero">
      <!-- The listing is gone (spent since the list was read), or is not one that can be moved: nothing to price. -->
      <template v-if="view === 'gone'">
        <v-alert type="warning" variant="tonal" density="compact" data-testid="move-to-gero-gone">{{ goneText }}</v-alert>
        <div class="move-to-gero__actions">
          <GButton tier="primary" block data-testid="move-to-gero-gone-close" @click="close()">{{ t('common.close') }}</GButton>
        </div>
      </template>

      <template v-else>
        <ListingNftLine :name="nftName" :image="nftImage" :caption="policyCaption" />

        <!-- A hardware wallet no device has signed a market transaction with yet: nothing to ask of anyone. -->
        <p v-if="credentials.deviceBlocked.value" class="t-body-sm" data-testid="move-to-gero-hardware">
          {{ t('legacyListings.hardwareSoon') }}
        </p>

        <!-- The worker is having Nexus build the transaction and checking it. -->
        <div v-else-if="view === 'preparing'" class="move-to-gero__wait" data-testid="move-to-gero-preparing">
          <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" role="status" :aria-label="t('common.loading')" />
        </div>

        <!-- What the worker verified the transaction does. Nothing here comes from Nexus's word. -->
        <template v-else-if="view === 'review' && verified && summary">
          <div data-testid="move-to-gero-review">
            <p class="move-to-gero__heading t-label">{{ t('nftMarket.move.review') }}</p>
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
          <p v-if="summary.sponsoredCollateralRef" class="move-to-gero__sponsored t-caption" data-testid="move-to-gero-sponsored">
            <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
            <span>{{ t('legacyListings.sponsored') }}</span>
          </p>

          <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mt-3" data-testid="move-to-gero-error">
            {{ failureText }}
          </v-alert>

          <PreparedTxCredentials :credentials="credentials" testid="move-to-gero" :tx-id="summary.txId" />
          <div class="move-to-gero__actions">
            <GButton tier="secondary" :disabled="busy" data-testid="move-to-gero-back" @click="back()">
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
              data-testid="move-to-gero-confirm"
              @click="credentials.send()"
            >
              {{ t('common.confirm') }}
            </GButton>
          </div>
        </template>

        <!-- Submitted. -->
        <template v-else-if="view === 'done'">
          <div class="text-center py-2" data-testid="move-to-gero-done">
            <v-icon size="48" color="var(--g-success)">mdi-check-circle-outline</v-icon>
            <p class="t-heading mt-2">{{ t('nftMarket.move.done') }}</p>
            <p class="t-caption mt-2">{{ t('transactions.transactionId') }}</p>
            <p class="t-caption g-mono move-to-gero__wrap">
              {{ flow.submittedTxId.value }}
              <CopyButton x-small :value="flow.submittedTxId.value ?? ''" class="ml-1" />
            </p>
            <GButton v-if="txExplorerUrl" tier="tertiary" compact :href="txExplorerUrl" target="_blank" rel="noopener noreferrer" data-testid="move-to-gero-explorer">
              {{ t('market.viewOnExplorer') }}
            </GButton>
          </div>
          <div class="move-to-gero__actions">
            <GButton tier="primary" block data-testid="move-to-gero-done-button" @click="close()">{{ t('common.done') }}</GButton>
          </div>
        </template>

        <!-- Nothing was built, or the submit was not confirmed. -->
        <template v-else-if="view === 'failed'">
          <v-alert type="error" variant="tonal" density="compact" data-testid="move-to-gero-error">
            {{ failureText }}
          </v-alert>
          <div class="move-to-gero__actions">
            <GButton tier="secondary" data-testid="move-to-gero-close" @click="close()">{{ t('common.close') }}</GButton>
            <!-- Only a failure that something can fix offers a way on: building again, or looking at
                 what changed first. A refusal that would fail the same way, and a signed transaction
                 that may be on chain, offer neither. -->
            <GButton v-if="failureKind === 'retry'" tier="primary" data-testid="move-to-gero-retry" @click="retry()">{{ t('common.tryAgain') }}</GButton>
            <GButton v-else-if="failureKind === 'changed'" tier="primary" data-testid="move-to-gero-refresh" @click="refreshAndClose()">{{ t('common.refresh') }}</GButton>
            <!-- Signed, and the network did not confirm: it may be on chain. Look, never rebuild. -->
            <GButton v-else-if="failureKind === 'maybeSent'" tier="primary" data-testid="move-to-gero-activity" @click="viewActivity()">{{ t('nftMarket.actions.viewActivity') }}</GButton>
          </div>
        </template>

        <!-- The price. -->
        <template v-else>
          <ListingPriceView :form="form" testid="move-to-gero" :busy="busy" @submit="review()" />

          <div class="move-to-gero__actions">
            <GButton tier="secondary" :disabled="busy" data-testid="move-to-gero-cancel" @click="close()">{{ t('common.cancel') }}</GButton>
            <GButton tier="primary" :disabled="!canContinue" data-testid="move-to-gero-continue" @click="review()">{{ t('common.continue') }}</GButton>
          </div>
        </template>
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
import ListingPriceView from '@/modules/market/components/ListingPriceView.vue';
import ListingNftLine from '@/modules/market/components/ListingNftLine.vue';
import { useListingPriceForm, verifiedFigures } from '@/modules/market/composables/useListingPriceForm';
import { legacyItemImage, legacyItemName, singleNftUnit } from '@/modules/portfolio/components/legacyItemDisplay';
import { legacyRef as refOf, type LegacyListingItem } from '@/api/legacy-listings-api';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useLegacyListings } from '@/shared/composables/useLegacyListings';
import { useNftMarketFlow } from '@/shared/composables/useNftMarketFlow';
import { usePreparedTxCredentials } from '@/shared/composables/usePreparedTxCredentials';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import { POLICY_ID_HEX_LENGTH, isNftMarketHardware } from '@/utils/nftMarketDeployments';

/**
 * Moves ONE stuck listing of a closed marketplace into a Gero listing: the NFT leaves the old
 * marketplace's contract and goes straight into the Gero market contract, in a single transaction
 * (the worker's NFT_MARKET_PREPARE_MIGRATE). The seller chooses the price. Hosted by PortfolioPage
 * next to the rescue dialog, outside the card: a move that empties the list removes the card, and
 * this dialog's "done" screen must outlive it.
 *
 *   price (live breakdown, the limits, the royalty confirmation) -> Continue
 *     -> preparing -> review (the worker's verified figures) -> credentials -> done  |  a failure
 *
 * The price step is the list sheet's own: the form (useListingPriceForm: the typed price as an exact
 * lovelace amount, the preview, the limits, the royalty confirmation) and its view (ListingPriceView,
 * with the live ListingBreakdown). The page names only the legacy item and the price: the worker finds the item
 * again under the wallet's own key hashes, reads the royalties from the NFT's own policy, chooses the
 * owner (the legacy owner when it is one of the account's payment keys, else the receive key), has
 * Nexus build, and verifies the exact shape (verifyMigrate). Mainnet only (the legacy contracts exist
 * nowhere else) and only where a Gero deployment is configured, so on mainnet the move is not offered
 * until the market is live there: the card hides its button and the worker refuses.
 *
 * An offer (ADA locked by a buyer) holds no NFT and is never moved. A hardware wallet no device has
 * signed a market transaction with is told so and nothing is built. Success hides the item from the
 * list at once (`forget`); closing after a move that went out, or may have, looks the list up again.
 */
const props = defineProps<{
  isOpen: boolean;
  /** The legacy item to move, `txHash#index`. */
  legacyRef: string;
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const router = useRouter();
// Ledger only: Bluetooth when the user picks it for this signature, USB otherwise.
const isBT = ref(false);
const flow = useNftMarketFlow('migrate', { getIsBT: () => isBT.value });
const { items, meta, forget, refresh } = useLegacyListings();
const { explorerUrl } = useExplorer();

// The item as the list showed it when the dialog opened. A move that goes out removes it from the
// list, and the screens that follow must not lose it.
const item = ref<LegacyListingItem | null>(null);
/** The one NFT of a listing, or '' for anything that is not a single NFT listing. */
const unit = computed(() => (item.value ? singleNftUnit(item.value) ?? '' : ''));
const movable = computed(() => unit.value !== '');

const stage = computed(() => flow.stage.value);
const failureKind = computed(() => flow.failureKind.value);
const summary = computed(() => flow.prepared.value?.summary ?? null);

const form = useListingPriceForm({
  unit: () => unit.value,
  failureKind: () => flow.failureKind.value,
  royaltyConfirmation: () => flow.royaltyConfirmation.value,
});
const { priceText, confirmed, price, minUtxo } = form;

const view = computed<'gone' | 'price' | 'preparing' | 'review' | 'done' | 'failed'>(() => {
  if (stage.value === 'done') return 'done';
  if (summary.value && (stage.value === 'review' || stage.value === 'signing' || stage.value === 'submitting')) return 'review';
  if (stage.value === 'preparing') return 'preparing';
  // Nothing to move: the item was spent since the list was read, or is an offer.
  if (!movable.value) return 'gone';
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
  // Another wallet closes a sheet that is showing a transaction: the item was the last one's.
  isActive: () => props.isOpen,
  onWalletSwitch: () => emit('close'),
});
const busy = credentials.busy;

// ---- The NFT -------------------------------------------------------------------------------

// The NFT shown is the one the worker verified (`summary.unit`) once there is a summary: the
// review is of that transaction, not of what the page asked for.
const shownUnit = computed(() => summary.value?.unit ?? unit.value);
const nftName = computed(() => (item.value ? legacyItemName(item.value, meta.value) : ''));
const nftImage = computed(() => (item.value ? legacyItemImage(item.value, meta.value) : undefined));
const policyCaption = computed(() => (shownUnit.value ? filters.truncate(shownUnit.value.slice(0, POLICY_ID_HEX_LENGTH)) : ''));

/**
 * Why there is nothing to move: an offer holds no NFT, a bundle holds several, and an item the list no
 * longer has was spent since it was read. Each says so, so a bundle is never reported as gone.
 */
const goneText = computed(() => {
  if (item.value?.kind === 'offer') return t('nftMarket.error.offerNotMovable');
  return t(item.value ? 'nftMarket.error.notSingleNft' : 'nftMarket.move.gone');
});

const canContinue = computed(() => !busy.value && !credentials.deviceBlocked.value && movable.value && form.ready.value);

// A failure was about the last price: a changed one starts the sheet over.
watch(priceText, () => {
  if (flow.failure.value) flow.reset();
});

// ---- The review ----------------------------------------------------------------------------

/** The worker's verified figures, as the breakdown reads them. Null if a figure does not read back. */
const verified = computed(() => verifiedFigures(summary.value));

const failureText = computed(() => {
  const message = flow.failureMessage.value;
  return message ? t(message.key, message.params) : '';
});
const txExplorerUrl = computed(() => explorerUrl('tx', flow.submittedTxId.value));

// The move went to the network: the item leaves the list now, not when the server catches up.
watch(stage, (value) => {
  if (value === 'done') forget([props.legacyRef]);
});

// ---- Actions -------------------------------------------------------------------------------

/** Have the worker build and verify the move at this price. */
async function review(): Promise<void> {
  const amount = price.value;
  if (!canContinue.value || amount === null) return;
  credentials.begin();
  await flow.prepare({ legacyRef: props.legacyRef, priceLovelace: amount, ...(confirmed.value ? { confirmRoyaltyAboveCap: true } : {}) });
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

/** The listing changed (sold, cancelled or moved elsewhere): look the list up again and leave. */
function refreshAndClose(): void {
  void refresh();
  close();
}

/** The signed transaction may be on chain: take the seller to their activity. Nothing is rebuilt or re-sent. */
function viewActivity(): void {
  close();
  void router?.push({ path: '/transactions' });
}

/** Start over: the item as the list shows it now, a clean flow and a fresh price. */
function start(): void {
  credentials.clearPassword();
  flow.reset();
  item.value = items.value.find((candidate) => refOf(candidate) === props.legacyRef) ?? null;
  form.restart('');
}

function close(): void {
  if (busy.value) return;
  // A move that went out, or may have: the list catches up with the chain.
  const sent = stage.value === 'done' || failureKind.value === 'maybeSent';
  credentials.clearPassword();
  emit('close');
  if (sent) void refresh();
}

// State is reset when the dialog opens, not when it closes: the content stays as it was while the
// dialog fades out.
watch(() => props.isOpen, (open) => { if (open) start(); }, { immediate: true });
</script>

<style scoped lang="scss">
.move-to-gero__wait {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.move-to-gero__heading {
  margin: 0 0 var(--g-s-2);
}

.move-to-gero__sponsored {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: var(--g-s-2) 0 0;
}

.move-to-gero__wrap {
  word-break: break-all;
}

.move-to-gero__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-4);
}
</style>
