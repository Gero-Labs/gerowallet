import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { useListingMarketInfo, type ListingInfoState } from '@/modules/market/composables/useListingMarketInfo';
import {
  pageRoyaltyMinUtxo,
  parseAdaPrice,
  previewNewListing,
  previewRepricedListing,
  type ListingPreview,
} from '@/modules/market/utils/listingPreview';
import i18n, { getLocaleCode } from '@/plugins/i18n';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { NftMarketFailureKind, RoyaltyConfirmation } from '@/shared/composables/useNftMarketFlow';
import { formatLovelaceAsAda, formatPercentOfFraction } from '@/shared/utils/format';
import { nftMarketDeploymentFor, nftMarketNewestDeployment } from '@/shared/utils/nftMarketAvailability';
import { networkStore } from '@/stores/networkStore';
import { MAX_LIST_PRICE, MIN_LIST_PRICE, MIN_SELLER_SHARE } from '@/utils/nftMarketDeployments';

/**
 * The price half of a sheet that asks the seller what an NFT should cost: the list sheet, its
 * edit-price form (a reprice) and the move-to-Gero sheet. Shared so all three price the same way:
 *
 *  - the seller types a price in ADA; it becomes an exact lovelace amount (never through a float)
 *    and is refused for what the worker would refuse (under MIN_LIST_PRICE, above MAX_LIST_PRICE,
 *    a price that leaves the seller less than MIN_SELLER_SHARE after the fee and royalties);
 *  - the breakdown under it is a PREVIEW from the same arithmetic the worker holds the listing to
 *    (listingPreview.ts); the worker re-derives everything and the review shows ITS figures
 *    (`verifiedFigures`);
 *  - a collection whose royalties pass the usual 10% (judged on the effective amount) needs the
 *    seller's agreement before anything is built (`needsConfirmation`, `confirmed`); so does a
 *    reprice whose kept royalties pass it at the new price (they stay as lovelace amounts, so a cut
 *    in price raises their share).
 *
 * The caller owns the flow (prepare, sign, submit), the credentials and the failure copy. A new
 * listing (and a move) is priced against the newest deployment and the collection's royalty terms;
 * a reprice (`existing`) against the listing's own deployment and the royalties already in its datum.
 */

export interface ListingPriceFormOptions {
  /** The NFT's unit: its royalty terms and price hints are read for it. */
  unit: () => string;
  /** The wallet's own listing, when this form changes its price. Fixed for the life of the form. */
  existing?: () => OwnListing | undefined;
  /** What the flow says about the last attempt: a royalty confirmation is asked for on the price, never shown as an error. */
  failureKind: () => NftMarketFailureKind | null;
  /** The amounts the worker asked the seller to confirm, when it did (it re-derives and may disagree with the preview). */
  royaltyConfirmation: () => RoyaltyConfirmation | null;
}

/** What a review shows, from the worker's verified summary. */
export interface VerifiedFigures {
  price: bigint;
  fee: bigint;
  royalties: { address: string; lovelace: bigint }[];
  sellerReceives: bigint;
  deposit: bigint;
  networkFee: bigint;
  dropped: { address: string; lovelace: bigint }[];
  invalidRecipients: number;
  /** A reprice: the price it replaces. */
  oldPrice: bigint | null;
}

/** The fields of a verified list, reprice or migrate summary the review reads (each is lovelace as decimal text). */
export interface PricedSummaryLike {
  priceLovelace: string;
  marketFeeLovelace: string;
  sellerReceivesLovelace: string;
  depositLovelace: string;
  networkFeeLovelace: string;
  royalties?: { address: string; lovelace: string }[];
  dropped?: { address: string; lovelace: string }[];
  invalidRecipients?: number;
  oldPriceLovelace?: string;
}

/**
 * The worker's verified figures as the breakdown reads them. A reprice's summary names no
 * royalties, so they come from the listing it changes. Null when a figure does not read back.
 */
export function verifiedFigures(summary: PricedSummaryLike | null | undefined, existing?: OwnListing): VerifiedFigures | null {
  if (!summary) return null;
  const lovelaceOf = (value: string): bigint => BigInt(value);
  try {
    return {
      price: lovelaceOf(summary.priceLovelace),
      fee: lovelaceOf(summary.marketFeeLovelace),
      royalties: summary.royalties ? summary.royalties.map((r) => ({ address: r.address, lovelace: lovelaceOf(r.lovelace) })) : [...(existing?.datum.royalties ?? [])],
      sellerReceives: lovelaceOf(summary.sellerReceivesLovelace),
      deposit: lovelaceOf(summary.depositLovelace),
      networkFee: lovelaceOf(summary.networkFeeLovelace),
      dropped: summary.dropped ? summary.dropped.map((r) => ({ address: r.address, lovelace: lovelaceOf(r.lovelace) })) : [],
      invalidRecipients: summary.invalidRecipients ?? 0,
      oldPrice: summary.oldPriceLovelace !== undefined ? lovelaceOf(summary.oldPriceLovelace) : null,
    };
  } catch {
    return null;
  }
}

export interface ListingPriceForm {
  /** The royalty terms, the collection floor and the NFT's last sale (see useListingMarketInfo). */
  market: ReturnType<typeof useListingMarketInfo>;
  royaltiesState: Ref<ListingInfoState>;
  floorLovelace: Ref<bigint | null>;
  lastSaleLovelace: Ref<bigint | null>;
  priceText: Ref<string>;
  /** The seller has edited the field: an opening price (a reprice starts on the current one) is not an error to show. */
  priceTouched: Ref<boolean>;
  /** The seller agreed to royalties above the usual limit. */
  confirmed: Ref<boolean>;
  /** The typed price in lovelace, or null while it does not read. */
  price: ComputedRef<bigint | null>;
  /** A reprice to the price the listing already has. */
  samePrice: ComputedRef<boolean>;
  /** The deployment this price is held to: the newest for a new listing, the listing's own for a reprice. */
  deployment: ComputedRef<ReturnType<typeof nftMarketNewestDeployment>>;
  minUtxo: ComputedRef<bigint>;
  preview: ComputedRef<ListingPreview | null>;
  /** What keeps the price from being listed, before the worker is asked. */
  issue: ComputedRef<'PRICE_TOO_LOW' | 'PRICE_TOO_HIGH' | 'ROYALTIES_MALFORMED' | 'SELLER_SHARE_TOO_LOW' | null>;
  /** What is wrong with the price itself, under the field. */
  priceErrors: ComputedRef<string[]>;
  /** What is wrong with the listing rather than the price: royalty terms that cannot be used. */
  termsErrorText: ComputedRef<string>;
  /** No deployment for this listing or network: the market has nothing to price against. */
  unavailableText: ComputedRef<string>;
  needsConfirmation: ComputedRef<boolean>;
  /** What the seller agrees to: the worker's own figures when it asked, else the preview's effective amount. */
  confirmation: ComputedRef<{ ada: string; percent: string } | null>;
  /** The price is complete and allowed: everything but the caller's own conditions (busy, hardware). */
  ready: ComputedRef<boolean>;
  onPriceInput: (value: string) => void;
  /** Start over on a fresh price (and read the NFT's royalty terms and price hints again). */
  restart: (initialPriceText: string) => void;
}

export function useListingPriceForm(options: ListingPriceFormOptions): ListingPriceForm {
  const { t } = useTranslation();
  const isReprice = options.existing?.() !== undefined;
  const existing = (): OwnListing | undefined => options.existing?.();

  const market = useListingMarketInfo(options.unit, { royalties: !isReprice });
  const { royaltiesState, floorLovelace, lastSaleLovelace } = market;

  const priceText = ref('');
  const priceTouched = ref(false);
  const confirmed = ref(false);

  const ada = (lovelace: bigint): string => formatLovelaceAsAda(lovelace);

  const parsed = computed(() => parseAdaPrice(priceText.value));
  const price = computed<bigint | null>(() => (parsed.value.ok ? parsed.value.lovelace : null));
  const samePrice = computed(() => isReprice && price.value !== null && price.value === existing()?.datum.price);

  const deployment = computed(() => {
    const own = existing();
    return own ? nftMarketDeploymentFor(own.deploymentVersion) : nftMarketNewestDeployment();
  });
  const minUtxo = computed(() => pageRoyaltyMinUtxo(networkStore.epochParams?.coinsPerUtxoByte));

  const preview = computed<ListingPreview | null>(() => {
    const amount = price.value;
    const d = deployment.value;
    if (amount === null || !d) return null;
    const own = existing();
    if (own) return previewRepricedListing(amount, own.datum.royalties, d);
    const terms: RoyaltyInfo | null = market.royalties.value;
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
  const termsErrorText = computed(() => (issue.value === 'ROYALTIES_MALFORMED' ? t('nftMarket.error.royaltiesMalformed') : ''));
  const unavailableText = computed(() => {
    if (deployment.value) return '';
    return t(isReprice ? 'nftMarket.error.notListing' : 'nftMarket.error.networkUnsupported');
  });

  // Above the cap on the preview, or the worker says so itself (it re-derives and may disagree).
  const needsConfirmation = computed(() => preview.value?.overCap === true || options.failureKind() === 'confirmRoyalty');
  const confirmation = computed(() => {
    const fromWorker = options.royaltyConfirmation();
    if (fromWorker) return fromWorker;
    const p = preview.value;
    return p ? { ada: ada(p.royaltiesTotal), percent: formatPercentOfFraction(p.royaltyFraction, getLocaleCode(i18n.locale)) } : null;
  });

  const ready = computed(() =>
    price.value !== null
    && preview.value !== null
    && issue.value === null
    && !samePrice.value
    && (isReprice || royaltiesState.value === 'ready')
    && (!needsConfirmation.value || confirmed.value),
  );

  // A changed price is a different agreement.
  watch(priceText, () => { confirmed.value = false; });
  watch(() => market.royalties.value, () => { confirmed.value = false; });

  function onPriceInput(value: string): void {
    priceTouched.value = true;
    priceText.value = value;
  }

  function restart(initialPriceText: string): void {
    confirmed.value = false;
    priceTouched.value = false;
    priceText.value = initialPriceText;
    market.reset();
    void market.load();
  }

  return {
    market, royaltiesState, floorLovelace, lastSaleLovelace,
    priceText, priceTouched, confirmed, price, samePrice, deployment, minUtxo, preview, issue,
    priceErrors, termsErrorText, unavailableText, needsConfirmation, confirmation, ready,
    onPriceInput, restart,
  };
}
