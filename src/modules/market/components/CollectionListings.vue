<template>
  <section v-if="available" class="collection-listings" data-testid="collection-listings" :aria-label="t('nftMarket.browse.forSale')">
    <header class="collection-listings__header">
      <span class="t-caption">{{ t('common.sortBy') }}</span>
      <v-btn-toggle
        :model-value="sort"
        mandatory
        density="compact"
        divided
        variant="outlined"
        class="collection-listings__sort"
        @update:model-value="onSort"
      >
        <v-btn value="price" size="small" data-testid="collection-sort-price">{{ t('nftMarket.browse.sortPrice') }}</v-btn>
        <v-btn value="recent" size="small" data-testid="collection-sort-recent">{{ t('nftMarket.browse.sortRecent') }}</v-btn>
      </v-btn-toggle>
    </header>

    <!-- No NFT verified flag exists in any data source: a collection that has the name
         of a popular one under another policy ID is flagged, and every listing shows its policy ID. -->
    <v-alert v-if="lookalike" type="warning" variant="tonal" density="compact" class="collection-listings__lookalike mb-3" data-testid="collection-lookalike">
      {{ t('nftMarket.browse.lookalike', { name: lookalike.name, policyId: lookalike.policyId }) }}
    </v-alert>
    <p v-else-if="lookalikeUnchecked" class="collection-listings__note t-caption" data-testid="collection-lookalike-unchecked">
      {{ t('nftMarket.browse.lookalikeUnchecked') }}
    </p>

    <div v-if="loading" class="collection-listings__wait" data-testid="collection-loading">
      <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" role="status" :aria-label="t('common.loading')" />
    </div>

    <!-- The first page could not be read: nothing is known, so nothing is said about the collection. -->
    <div v-else-if="error === 'first'" data-testid="collection-error">
      <v-alert type="error" variant="tonal" density="compact">{{ t('nftMarket.browse.loadFailed') }}</v-alert>
      <div class="collection-listings__actions">
        <GButton tier="secondary" data-testid="collection-retry" @click="refresh()">{{ t('common.tryAgain') }}</GButton>
      </div>
    </div>

    <template v-else>
      <!-- Only a last page with nothing on it and nothing left out is an empty collection. -->
      <p v-if="rows.length === 0 && !hasMore && droppedTotal === 0" class="collection-listings__empty t-body-sm" data-testid="collection-empty">
        {{ t('nftMarket.browse.empty') }}
      </p>

      <ul v-if="rows.length > 0" class="collection-listings__rows">
        <li
          v-for="row in rows"
          :key="row.ref"
          class="collection-listings__row glass-tier"
          data-testid="listing-row"
          :data-ref="row.ref"
        >
          <v-img :src="row.image" :alt="row.name" :aspect-ratio="1" cover class="collection-listings__tile">
            <template #error>
              <span class="collection-listings__tile-empty" aria-hidden="true">
                <v-icon size="20" color="var(--g-text-3)">mdi-image-outline</v-icon>
              </span>
            </template>
          </v-img>
          <div class="collection-listings__text">
            <p class="collection-listings__name t-body-sm" data-testid="listing-name">{{ row.name }}</p>
            <p class="collection-listings__policy t-caption g-mono" data-testid="listing-policy">
              {{ row.policyShort }}
              <CopyButton :value="row.listing.policyId" x-small class="ml-1" />
              <ExplorerLink type="policy" :id="row.listing.policyId" x-small />
            </p>
            <p v-if="row.own || row.pending || lookalike" class="collection-listings__chips">
              <v-chip v-if="row.own" size="x-small" label data-testid="listing-own">{{ t('nftMarket.list.review') }}</v-chip>
              <v-chip v-if="row.pending" size="x-small" label data-testid="listing-pending">{{ t('nftMarket.browse.pending') }}</v-chip>
              <v-chip v-if="lookalike" size="x-small" label color="warning" data-testid="listing-lookalike">
                {{ t('nftMarket.browse.lookalikeChip') }}
              </v-chip>
            </p>
          </div>
          <div class="collection-listings__buy">
            <p class="t-body-sm g-num" data-testid="listing-price">{{ row.price }} {{ ticker }}</p>
            <GButton
              v-if="canBuy && row.buyable && !row.pending"
              tier="secondary"
              compact
              data-testid="listing-buy"
              @click="startBuying(row.listing)"
            >
              {{ t('common.buy') }}
            </GButton>
          </div>
        </li>
      </ul>

      <p v-if="droppedTotal > 0" class="collection-listings__note t-caption" data-testid="collection-dropped">
        {{ tc('nftMarket.browse.dropped', droppedTotal, { count: droppedTotal }) }}
      </p>
      <!-- A wallet that signs on a device is not allowed to buy yet (no device has signed a market
           transaction); one that signs nothing (a watch wallet) can only look. -->
      <p v-if="rows.length > 0 && !canBuy && signsOnADevice" class="collection-listings__note t-caption" data-testid="collection-hardware-soon">
        {{ t('legacyListings.hardwareSoon') }}
      </p>
      <p v-else-if="rows.length > 0 && !canBuy" class="collection-listings__note t-caption" data-testid="collection-view-only">
        {{ t('nftMarket.browse.viewOnly') }}
      </p>

      <div v-if="hasMore" class="collection-listings__actions">
        <v-alert v-if="error === 'more'" type="error" variant="tonal" density="compact" class="mb-2" data-testid="collection-error">
          {{ t('nftMarket.browse.loadFailed') }}
        </v-alert>
        <GButton tier="secondary" block :loading="loadingMore" data-testid="collection-load-more" @click="loadMore()">
          {{ t('common.loadMore') }}
        </GButton>
      </div>
    </template>

    <!-- One sheet at a time, mounted for one listing and taken away on close, so each starts clean. -->
    <BuyNftDialog
      v-if="buying"
      :key="refOf(buying)"
      :is-open="true"
      :listing="buying"
      :lookalike="lookalike"
      :name="nameOf(buying)"
      :image="imageOf(buying)"
      @close="buying = null"
      @sent="onSent"
      @refresh="refresh()"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import BuyNftDialog from '@/modules/market/dialogs/BuyNftDialog.vue';
import type { ListingDto, ListingSort } from '@/api/nft-market-api';
import { useCollectionListings } from '@/modules/market/composables/useCollectionListings';
import { useListingNftMeta } from '@/modules/market/composables/useListingNftMeta';
import { loadTopNftCollections } from '@/modules/market/composables/useTopNftCollections';
import { isPendingBuy, markPendingBuy, prunePendingBuys } from '@/modules/market/composables/usePendingBuys';
import { buyerIdentity, listingBuyState } from '@/modules/market/utils/listingBuyability';
import { candidateNames, findLookalike, type Lookalike, type TopCollectionRef } from '@/modules/market/utils/lookalike';
import { collectibleCollectionsNow } from '@/shared/composables/useCollectibleCollections';
import { signsOnDevice } from '@/shared/composables/useHardwareTxSigner';
import { useMyListings } from '@/shared/composables/useMyListings';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { nftMarketAvailable, nftMarketBrowseAvailable } from '@/shared/utils/nftMarketAvailability';
import { Network } from '@/models/types';
import { walletStore } from '@/stores/walletStore';

/**
 * The open listings of one collection on Gero's market, with Buy: the "For sale" side of the
 * collection page (TokensDialog hosts it, opened from the collectibles table's `collection-click`).
 *
 * Each row shows the NFT's picture, name and price and its policy ID, and a warning
 * when the collection has the name of a top-200 collection under another policy ID: the one thing
 * that tells a copy from the real collection is the policy ID, so it is never hidden. Rows come
 * from Nexus's index, page by page on its cursor (useCollectionListings); what this page shows is
 * never what a purchase is built from: the worker reads the listing again and verifies it.
 *
 * Who may buy what (listingBuyability.ts):
 *  - Buy is offered only where the worker would build one: a wallet that can sign
 *    (`nftMarketAvailable`: the flag, a reviewed deployment, `canUseNftMarketWallet`). A watch
 *    wallet can browse and is told it can only look; a hardware wallet no device has signed a
 *    market transaction with can browse and is told it is coming.
 *  - The wallet's own listings carry "Your listing" and no Buy: those the wallet verified itself,
 *    and those whose datum names the account as owner AND as seller. A listing that names the
 *    account on one side only (the fake "your listing" that pays an attacker) gets neither the
 *    mark nor a Buy.
 *  - A private listing (a `buyer` set in its datum) is never shown, the account's own included
 *    (phase 1 buys public listings only): hidden on purpose, so not counted in the note
 *    about listings that could not be shown.
 *  - A listing whose datum is not a Gero listing, or that its row contradicts (a bait price), cannot
 *    be bought: it is left out and counted in that note, as the rows the page validation drops are.
 *
 * A page that left rows out is never an empty collection: it says some listings could not be shown,
 * and keeps offering the next page.
 */
const props = defineProps<{ policyId: string }>();

const { t, tc } = useTranslation();
const { currencyTicker: ticker } = useNativeCurrency();

const available = computed(() => nftMarketBrowseAvailable());
/** Whether this wallet may be offered Buy at all. */
const canBuy = computed(() => nftMarketAvailable());

const { items, sort, loading, loadingMore, error, dropped, loaded, hasMore, setSort, loadMore, refresh } = useCollectionListings(() => props.policyId);

/** Whether the wallet signs on a device (Ledger, Trezor, Keystone): what it is told when it cannot buy. */
const signsOnADevice = computed(() => signsOnDevice(walletStore.loggedWallet?.type));

function onSort(next: unknown): void {
  if (next === 'price' || next === 'recent') setSort(next as ListingSort);
}

// ---- Who each row is for -------------------------------------------------------------------

const { listings: myListings } = useMyListings();
const identity = computed(() => buyerIdentity(walletStore.keys, myListings.value));
const networkId = computed(() => (walletStore.loggedWallet?.network === Network.MAINNET ? 1 : 0));

const classified = computed(() => items.value.map((listing) => ({ listing, state: listingBuyState(listing, networkId.value, identity.value) })));
/** Listings that cannot be bought because their datum is not a Gero listing: counted with the dropped ones. */
const unreadable = computed(() => classified.value.filter((c) => c.state.kind === 'unreadable').length);
const droppedTotal = computed(() => dropped.value + unreadable.value);

// ---- What each row shows -------------------------------------------------------------------

const { meta } = useListingNftMeta(() => items.value.map((listing) => listing.unit));

const refOf = (listing: ListingDto): string => `${listing.txHash}#${listing.outputIndex}`;

/** A name for an NFT the metadata has not named (yet): its asset name as text, else a shortened hex. */
function fallbackName(assetName: string): string {
  if (!assetName) return t('assets.nft');
  try {
    const bytes = Uint8Array.from(assetName.match(/../g) ?? [], (byte) => parseInt(byte, 16));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/^[\x20-\x7e]+$/.test(text)) return text;
  } catch {
    // not text
  }
  return `${assetName.slice(0, 16)}...`;
}

const nameOf = (listing: ListingDto): string => meta.value.get(listing.unit)?.name || fallbackName(listing.assetName);
const imageOf = (listing: ListingDto): string | undefined => meta.value.get(listing.unit)?.image;

/** The rows' ADA price is exact: lovelace is a bigint end to end. */
function adaOf(listing: ListingDto): string {
  try {
    return formatLovelaceAsAda(BigInt(listing.priceLovelace));
  } catch {
    return '-';
  }
}

const walletId = computed(() => walletStore.loggedWallet?.id);

const rows = computed(() =>
  classified.value
    // Private and unreadable listings are not shown (the unreadable ones are counted above).
    .filter((c) => c.state.kind === 'buyable' || c.state.kind === 'own' || c.state.kind === 'contested')
    .map(({ listing, state }) => {
      const ref = refOf(listing);
      return {
        ref,
        listing,
        name: nameOf(listing),
        image: imageOf(listing),
        price: adaOf(listing),
        policyShort: filters.truncate(listing.policyId),
        own: state.kind === 'own',
        buyable: state.kind === 'buyable',
        // A purchase of it went out, or may have: no Buy while it can still be on its way, also after
        // the page was left and opened again (usePendingBuys).
        pending: isPendingBuy(walletId.value, ref),
      };
    }),
);

// ---- The lookalike warning -----------------------------------------------------------------

/** The top collections: undefined until they are asked for, null if they could not be read. */
const topCollections = ref<TopCollectionRef[] | null | undefined>(undefined);

watch(
  available,
  (on) => {
    if (!on || topCollections.value !== undefined) return;
    void loadTopNftCollections().then((list) => { topCollections.value = list; });
  },
  { immediate: true },
);

const lookalike = computed<Lookalike | null>(() => {
  const top = topCollections.value;
  if (!top) return null;
  const policy = props.policyId.toLowerCase();
  const popularName = top.find((c) => String(c.policyId).toLowerCase() === policy)?.name;
  const names = candidateNames({
    held: collectibleCollectionsNow()[props.policyId]?.name,
    items: rows.value.map((row) => ({ name: meta.value.get(row.listing.unit)?.name, collection: meta.value.get(row.listing.unit)?.collection })),
  });
  return findLookalike(popularName ? [...names, popularName] : names, props.policyId, top);
});
/** The check could not run: say so, rather than leaving the absence of a warning to read as an all-clear. */
const lookalikeUnchecked = computed(() => topCollections.value === null && rows.value.length > 0);

// ---- Buying --------------------------------------------------------------------------------

const buying = ref<ListingDto | null>(null);

function startBuying(listing: ListingDto): void {
  if (!canBuy.value) return;
  buying.value = listing;
}

function onSent(ref: string): void {
  markPendingBuy(walletId.value, props.policyId, ref);
}

// A listing that is gone from a read of the whole collection was bought or taken down: its lock lets go.
watch(
  () => loaded.value && !hasMore.value && !loading.value && !loadingMore.value && error.value === null,
  (whole) => {
    if (whole) prunePendingBuys(walletId.value, props.policyId, new Set(items.value.map(refOf)));
  },
  { immediate: true, flush: 'post' },
);

// Another collection or another wallet: the sheet of the last one does not stay on screen.
watch([() => props.policyId, walletId], () => {
  buying.value = null;
});
</script>

<style scoped lang="scss">
.collection-listings__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-bottom: var(--g-s-3);
  color: var(--g-text-2);
}

.collection-listings__wait {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.collection-listings__empty {
  padding: var(--g-s-6) 0;
  text-align: center;
  color: var(--g-text-2);
}

.collection-listings__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.collection-listings__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  text-align: left;
}

.collection-listings__tile {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: var(--g-r-control);
  overflow: hidden;
}

// No picture, or one that failed to load: a neutral tile, an avatar-like control, so a solid token.
.collection-listings__tile-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}

.collection-listings__text {
  flex: 1 1 auto;
  min-width: 0;

  p {
    margin: 0;
  }

  .collection-listings__chips {
    margin-top: var(--g-s-1);
  }
}

.collection-listings__name {
  color: var(--g-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-listings__policy {
  display: flex;
  align-items: center;
  color: var(--g-text-3);
}

.collection-listings__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
}

.collection-listings__buy {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-2);

  p {
    margin: 0;
    color: var(--g-text-1);
  }
}

.collection-listings__lookalike {
  // The text names a 56-character policy ID, which has no place to break.
  overflow-wrap: anywhere;
}

.collection-listings__note {
  margin: var(--g-s-3) 0 0;
  color: var(--g-text-2);
}

.collection-listings__actions {
  margin-top: var(--g-s-3);
}
</style>
